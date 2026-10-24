package rules

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Source is the citation of a row.
type Source struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Provenance is carried by every row in every rule-pack file.
type Provenance struct {
	Source     Source   `json:"source"`
	Grade      string   `json:"grade"`
	CheckedOn  string   `json:"checkedOn"`
	Confidence string   `json:"confidence"`
	Verified   bool     `json:"verified"`
	Approvers  []string `json:"approvers"`
	// Optional validity window (YYYY-MM-DD). Non-param rows outside it are skipped.
	EffectiveFrom string `json:"effectiveFrom"`
	EffectiveTo   string `json:"effectiveTo"`
}

// Rule is one row of a rule pack.
type Rule struct {
	Provenance
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Overrides string          `json:"overrides"`
	Disabled  bool            `json:"disabled"`
	AppliesTo []string        `json:"appliesTo"`
	RawCond   json.RawMessage `json:"condition"`
	RawOutput json.RawMessage `json:"output"`
	TextKey   string          `json:"textKey"`
	FixKey    string          `json:"fixKey"`
	Refs      []string        `json:"refs"`

	Output   map[string]any `json:"-"`
	cond     *exprNode
	outExprs map[string]*exprNode
	origin   string // pack ID that defined the row
}

// PackFile is a base pack or a state overlay (fileKind=rulepack).
type PackFile struct {
	FileKind      string  `json:"fileKind"`
	PackID        string  `json:"packId"`
	Name          string  `json:"name"`
	Version       string  `json:"version"`
	Extends       string  `json:"extends"`
	EffectiveFrom string  `json:"effectiveFrom"`
	Status        string  `json:"status"`
	Partial       bool    `json:"partial"`
	Maker         string  `json:"maker"`
	Checker       *string `json:"checker"`
	ApprovedAt    *string `json:"approvedAt"`
	Notes         string  `json:"notes"`
	Rules         []*Rule `json:"rules"`
}

// FeeItem is one fee head (amount in integer paise).
type FeeItem struct {
	Provenance
	ID              string `json:"id"`
	LabelKey        string `json:"labelKey"`
	NoteKey         string `json:"noteKey"`
	Amount          int64  `json:"amount"`
	Per             string `json:"per"`
	Stage           string `json:"stage"`
	SmartCard       bool   `json:"smartCard"`
	State           string `json:"state"`
	Overrides       string `json:"overrides"`
	IncludedInTotal *bool  `json:"includedInTotal"`
}

// FeesFile is rulepacks/fees.json.
type FeesFile struct {
	FileKind   string     `json:"fileKind"`
	Version    string     `json:"version"`
	Currency   string     `json:"currency"`
	Unit       string     `json:"unit"`
	Excludes   []string   `json:"excludes"`
	Items      []*FeeItem `json:"items"`
	Retest     []*FeeItem `json:"retest"`
	StateItems []*FeeItem `json:"stateItems"`
}

// Prerequisite of a class (D-25: transport prerequisites are verified=false).
type Prerequisite struct {
	ID       string `json:"id"`
	TextKey  string `json:"textKey"`
	Verified bool   `json:"verified"`
}

// ClassRow is one licence class in classes.json.
type ClassRow struct {
	Provenance
	ID                     string            `json:"id"`
	Code                   string            `json:"code"`
	SarathiCode            string            `json:"sarathiCode"`
	NameKey                string            `json:"nameKey"`
	Name                   map[string]string `json:"name"`
	Pictures               []string          `json:"pictures"`
	MinAge                 int               `json:"minAge"`
	MaxCC                  *int              `json:"maxCc"`
	GuardianConsentUnder18 bool              `json:"guardianConsentUnder18"`
	Transport              bool              `json:"transport"`
	Form1A                 string            `json:"form1a"`
	ContentDepth           string            `json:"contentDepth"`
	Prerequisites          []Prerequisite    `json:"prerequisites"`
}

// ClassesFile is rulepacks/classes.json.
type ClassesFile struct {
	FileKind string      `json:"fileKind"`
	Version  string      `json:"version"`
	Classes  []*ClassRow `json:"classes"`
}

// Library holds every validated file. It is immutable after LoadDir.
type Library struct {
	Base    *PackFile
	States  map[string]*PackFile
	Fees    *FeesFile
	Classes *ClassesFile

	docs     map[string]any // parsed documents for hashing: "base", "fees", "classes", "state:XX"
	compiled map[string]*Compiled
}

// Compiled is a merged (base + state overlay), statically checked pack.
type Compiled struct {
	PackID      string
	Version     string
	BaseVersion string
	Partial     bool
	Hash        string
	Rules       []*Rule
	params      map[string]*Rule // by own ID and by overridden base ID
	effective   map[string]string
	Fees        *FeesFile
	Classes     *ClassesFile
	classByCode map[string]*ClassRow
	classByPic  map[string]*ClassRow
	classOrder  map[string]int
}

// SupportedStates lists the state packs found, sorted.
func (l *Library) SupportedStates() []string {
	out := make([]string, 0, len(l.States))
	for k := range l.States {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Pack returns the compiled pack for a state code.
func (l *Library) Pack(state string) (*Compiled, bool) {
	c, ok := l.compiled[state]
	return c, ok
}

// LoadDir loads rulepacks/ from root: schema/rulepack.schema.json,
// base/cmvr.json, states/*.json, fees.json and classes.json. Every file is
// validated against the JSON Schema, every expression is parsed and
// statically checked, and every state overlay is merged and hashed. Any error
// fails the load (CI fails on an invalid pack).
func LoadDir(root string) (*Library, error) {
	schemaPath := filepath.Join(root, "schema", "rulepack.schema.json")
	sch, err := compileSchema(schemaPath)
	if err != nil {
		return nil, err
	}
	lib := &Library{States: map[string]*PackFile{}, docs: map[string]any{}, compiled: map[string]*Compiled{}}

	readValidated := func(rel string, into any) (any, error) {
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return nil, err
		}
		if err := ValidateDocument(sch, raw); err != nil {
			return nil, fmt.Errorf("%s: %w", rel, err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var doc any
		if err := dec.Decode(&doc); err != nil {
			return nil, fmt.Errorf("%s: %w", rel, err)
		}
		if err := json.Unmarshal(raw, into); err != nil {
			return nil, fmt.Errorf("%s: %w", rel, err)
		}
		return doc, nil
	}

	lib.Base = &PackFile{}
	if lib.docs["base"], err = readValidated(filepath.Join("base", "cmvr.json"), lib.Base); err != nil {
		return nil, err
	}
	lib.Fees = &FeesFile{}
	if lib.docs["fees"], err = readValidated("fees.json", lib.Fees); err != nil {
		return nil, err
	}
	lib.Classes = &ClassesFile{}
	if lib.docs["classes"], err = readValidated("classes.json", lib.Classes); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(root, "states"))
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		pf := &PackFile{}
		doc, err := readValidated(filepath.Join("states", e.Name()), pf)
		if err != nil {
			return nil, err
		}
		if pf.PackID+".json" != e.Name() {
			return nil, fmt.Errorf("states/%s: packId %q does not match the file name", e.Name(), pf.PackID)
		}
		lib.States[pf.PackID] = pf
		lib.docs["state:"+pf.PackID] = doc
	}
	if err := prepareRules(lib.Base); err != nil {
		return nil, err
	}
	for _, st := range lib.SupportedStates() {
		if err := prepareRules(lib.States[st]); err != nil {
			return nil, err
		}
		c, err := lib.compile(st)
		if err != nil {
			return nil, err
		}
		lib.compiled[st] = c
	}
	return lib, nil
}

func compileSchema(path string) (*jsonschema.Schema, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	const url = "https://margdarshak.example/rulepacks/schema/rulepack.schema.json"
	if err := c.AddResource(url, doc); err != nil {
		return nil, err
	}
	return c.Compile(url)
}

// ValidateDocument validates one rule-pack file against the compiled schema.
func ValidateDocument(sch *jsonschema.Schema, raw []byte) error {
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return err
	}
	return sch.Validate(inst)
}

// CompileSchemaFile is exported for tests and tooling (CI pack lint).
func CompileSchemaFile(path string) (*jsonschema.Schema, error) { return compileSchema(path) }

// prepareRules decodes outputs and parses conditions of a pack file.
func prepareRules(pf *PackFile) error {
	for _, r := range pf.Rules {
		r.origin = pf.PackID
		cond, err := decodeNormalized(r.RawCond)
		if err != nil {
			return fmt.Errorf("%s/%s condition: %w", pf.PackID, r.ID, err)
		}
		if r.cond, err = parseExpr(cond, 1); err != nil {
			return fmt.Errorf("%s/%s condition: %w", pf.PackID, r.ID, err)
		}
		out, err := decodeNormalized(r.RawOutput)
		if err != nil {
			return fmt.Errorf("%s/%s output: %w", pf.PackID, r.ID, err)
		}
		m, ok := out.(map[string]any)
		if !ok {
			return fmt.Errorf("%s/%s output must be an object", pf.PackID, r.ID)
		}
		r.Output = m
		r.outExprs = map[string]*exprNode{}
		for _, k := range []string{"eligibleFromAge", "dueOn"} {
			if v, ok := m[k]; ok {
				n, err := parseExpr(v, 1)
				if err != nil {
					return fmt.Errorf("%s/%s output.%s: %w", pf.PackID, r.ID, k, err)
				}
				r.outExprs[k] = n
			}
		}
	}
	return nil
}

func decodeNormalized(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("missing")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return normalizeJSON(v)
}

// compile merges a state overlay onto the base pack by rule ID (state row
// wins; base row is used when the state has none) and runs the static check.
func (l *Library) compile(state string) (*Compiled, error) {
	st := l.States[state]
	if st.Extends != "IN-base@"+l.Base.Version {
		return nil, fmt.Errorf("%s extends %q, base is IN-base@%s", state, st.Extends, l.Base.Version)
	}
	merged := make([]*Rule, 0, len(l.Base.Rules)+len(st.Rules))
	index := map[string]int{}
	for _, r := range l.Base.Rules {
		if _, dup := index[r.ID]; dup {
			return nil, fmt.Errorf("IN-base: duplicate rule %s", r.ID)
		}
		index[r.ID] = len(merged)
		merged = append(merged, r)
	}
	effective := map[string]string{}
	seen := map[string]bool{}
	for _, r := range st.Rules {
		if seen[r.ID] {
			return nil, fmt.Errorf("%s: duplicate rule %s", state, r.ID)
		}
		seen[r.ID] = true
		target := r.Overrides
		if target == "" {
			if _, ok := index[r.ID]; ok {
				target = r.ID
			}
		}
		if target != "" {
			pos, ok := index[target]
			if !ok {
				return nil, fmt.Errorf("%s/%s overrides unknown base rule %s", state, r.ID, target)
			}
			if merged[pos].Kind != r.Kind {
				return nil, fmt.Errorf("%s/%s changes kind of %s", state, r.ID, target)
			}
			merged[pos] = r
			effective[target] = r.ID
			continue
		}
		if _, clash := index[r.ID]; clash {
			return nil, fmt.Errorf("%s/%s clashes with a base rule", state, r.ID)
		}
		index[r.ID] = len(merged)
		merged = append(merged, r)
	}
	rules := make([]*Rule, 0, len(merged))
	for _, r := range merged {
		if !r.Disabled {
			rules = append(rules, r)
		}
	}
	c := &Compiled{
		PackID: state, Version: st.Version, BaseVersion: st.Extends, Partial: st.Partial,
		Rules: rules, params: map[string]*Rule{}, effective: effective,
		Fees: l.Fees, Classes: l.Classes,
		classByCode: map[string]*ClassRow{}, classByPic: map[string]*ClassRow{}, classOrder: map[string]int{},
	}
	for _, r := range rules {
		if r.Kind == "param" {
			c.params[r.ID] = r
		}
	}
	for base, eff := range effective {
		if r, ok := c.params[eff]; ok {
			c.params[base] = r
		}
	}
	for i, cr := range l.Classes.Classes {
		c.classByCode[cr.Code] = cr
		c.classOrder[cr.Code] = i
		for _, p := range cr.Pictures {
			if _, dup := c.classByPic[p]; dup {
				return nil, fmt.Errorf("classes: picture %s used twice", p)
			}
			c.classByPic[p] = cr
		}
	}
	if err := c.staticCheck(); err != nil {
		return nil, fmt.Errorf("%s: %w", state, err)
	}
	h, err := l.hash(state)
	if err != nil {
		return nil, err
	}
	c.Hash = h
	return c, nil
}

// eff returns the effective rule ID for a base ID (the overriding state row, if any).
func (c *Compiled) eff(id string) string {
	if e, ok := c.effective[id]; ok {
		return e
	}
	return id
}

func (c *Compiled) staticCheck() error {
	required := []string{"PRM-LL-TEST-MODE", "PRM-LL-FORMAT", "PRM-TUTORIAL-DAYS", "PRM-MIN-WAIT-DAYS", "PRM-LL-VALIDITY-MONTHS", "PRM-RETEST-GAP-DAYS", "PRM-FORM1A-AGE", "PRM-DL-TEST", "PRM-HPT"}
	for _, id := range required {
		if c.params[id] == nil {
			return fmt.Errorf("missing required param %s", id)
		}
	}
	for _, r := range c.Rules {
		var err error
		check := func(n *exprNode) {
			if err != nil {
				return
			}
			if n.op == "param" {
				p := c.params[n.paramID]
				if p == nil {
					err = fmt.Errorf("%s reads unknown param %s", r.ID, n.paramID)
					return
				}
				if n.paramPath != "" {
					m, ok := p.Output["value"].(map[string]any)
					if !ok {
						err = fmt.Errorf("%s reads path %s of non-object param %s", r.ID, n.paramPath, n.paramID)
						return
					}
					if _, ok := m[n.paramPath]; !ok {
						err = fmt.Errorf("%s reads unknown path %s of param %s", r.ID, n.paramPath, n.paramID)
					}
				}
			}
			if strings.HasPrefix(n.fact, "class.") && r.Kind != "eligibility" {
				err = fmt.Errorf("%s reads %s outside an eligibility rule", r.ID, n.fact)
			}
		}
		r.cond.walk(check)
		for _, n := range r.outExprs {
			n.walk(check)
		}
		if err != nil {
			return err
		}
		for _, cc := range r.AppliesTo {
			if c.classByCode[cc] == nil {
				return fmt.Errorf("%s applies to unknown class %s", r.ID, cc)
			}
		}
		if r.Kind == "param" {
			if _, ok := r.Output["value"]; !ok {
				return fmt.Errorf("%s: param without value", r.ID)
			}
		}
	}
	return nil
}

// hash is sha256 over the canonical JSON of the four source documents. It is
// recorded on every plan/case (EC-27) and computed identically by the TS mirror.
func (l *Library) hash(state string) (string, error) {
	doc := map[string]any{
		"base":    l.docs["base"],
		"state":   l.docs["state:"+state],
		"fees":    l.docs["fees"],
		"classes": l.docs["classes"],
	}
	b, err := CanonicalJSON(doc)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
