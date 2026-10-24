package learn

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// moduleFile is the part of content/curriculum/<id>.json (module.schema.json) API-30 reads.
type moduleFile struct {
	FileKind           string            `json:"file_kind"`
	ModuleID           string            `json:"module_id"`
	Track              string            `json:"track"`
	Title              map[string]string `json:"title"`
	VehicleScope       string            `json:"vehicle_scope"`
	DeepContentClasses []string          `json:"deep_content_classes"`
	AvailableTo        json.RawMessage   `json:"available_to"` // "all" or ["JK", …]
	Depth              string            `json:"phase_1_2_depth"`
	SkillID            string            `json:"skill_id"`
	GameIDs            []string          `json:"game_ids"`
	RuleIDs            []string          `json:"rule_ids"`
	Concepts           struct {
		Authored []string `json:"authored"`
	} `json:"concepts"`
}

// Module is one curriculum module as the catalog holds it.
type Module struct {
	ID                 string
	Kind               string // ll_syllabus | survival_skill | dl_test
	Depth              string // deep | thin | coming
	TitleEn, TitleHi   string
	VehicleScope       string
	DeepContentClasses []string
	Tenants            []string // nil = all tenants
	SkillID            string
	Games              []string
	RuleIDs            []string
	Concepts           []string // authored concept card IDs, curriculum order
}

// ModuleView is one API-30 LearnModule.
type ModuleView struct {
	ModuleID     string   `json:"module_id"`
	TitleKey     string   `json:"title_key"`
	Kind         string   `json:"kind"`
	ContentDepth string   `json:"content_depth"`
	Games        []string `json:"games"`
	RuleIDs      []string `json:"rule_ids"`
	SkillID      string   `json:"skill_id"`
}

// Catalog is the curriculum loaded at boot from CONTENT_DIR/curriculum/*.json. Its ETag is a hash
// of the files' names and bytes, so it changes exactly when the content does.
type Catalog struct {
	Modules []Module // sorted LL0..LL4, M1..M22, DL1 (curriculum order)
	hash    string
}

// LoadCatalog reads every curriculum module under contentDir/curriculum.
func LoadCatalog(contentDir string) (*Catalog, error) {
	paths, err := filepath.Glob(filepath.Join(contentDir, "curriculum", "*.json"))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("learn: no curriculum modules under %s", filepath.Join(contentDir, "curriculum"))
	}
	sort.Strings(paths)
	h := sha256.New()
	c := &Catalog{}
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		h.Write([]byte(filepath.Base(p)))
		h.Write([]byte{0})
		h.Write(raw)
		h.Write([]byte{0})
		var f moduleFile
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, fmt.Errorf("learn: %s: %w", filepath.Base(p), err)
		}
		if f.ModuleID == "" {
			return nil, fmt.Errorf("learn: %s has no module_id", filepath.Base(p))
		}
		m := Module{ID: f.ModuleID, TitleEn: f.Title["en"], TitleHi: f.Title["hi"], VehicleScope: f.VehicleScope,
			DeepContentClasses: f.DeepContentClasses, SkillID: f.SkillID, Games: nonNil(f.GameIDs), RuleIDs: nonNil(f.RuleIDs),
			Concepts: nonNil(f.Concepts.Authored)}
		switch {
		case strings.HasPrefix(f.ModuleID, "LL"):
			m.Kind = "ll_syllabus"
		case strings.HasPrefix(f.ModuleID, "DL"):
			m.Kind = "dl_test"
		default:
			m.Kind = "survival_skill"
		}
		switch d := strings.ToLower(f.Depth); {
		case strings.HasPrefix(d, "deep"):
			m.Depth = "deep"
		case strings.HasPrefix(d, "not built"), d == "":
			m.Depth = "coming"
		default:
			m.Depth = "thin"
		}
		var tenants []string
		if json.Unmarshal(f.AvailableTo, &tenants) == nil {
			m.Tenants = tenants
		}
		c.Modules = append(c.Modules, m)
	}
	sort.SliceStable(c.Modules, func(i, j int) bool { return moduleOrder(c.Modules[i].ID) < moduleOrder(c.Modules[j].ID) })
	c.hash = hex.EncodeToString(h.Sum(nil))[:20]
	return c, nil
}

func nonNil(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

// moduleOrder sorts LL* first, then M*, then DL*, numerically.
func moduleOrder(id string) int {
	group := 1
	switch {
	case strings.HasPrefix(id, "LL"):
		group = 0
	case strings.HasPrefix(id, "DL"):
		group = 2
	}
	n := 0
	for _, r := range id {
		if r >= '0' && r <= '9' {
			n = n*10 + int(r-'0')
		}
	}
	return group*1000 + n
}

// classScope maps a vehicle class to the module vehicle_scope it needs.
func classScope(class string) string {
	switch class {
	case "MCWG", "MCWOG":
		return "2W"
	case "LMV-NT", "LMV":
		return "Car"
	}
	return ""
}

// List returns the API-30 list for a class (optional) and tenant, and its ETag (a weak ETag
// over the content hash and the query, so a 304 is exact per query).
func (c *Catalog) List(class, tenant string) ([]ModuleView, string) {
	scope := classScope(class)
	out := []ModuleView{}
	for _, m := range c.Modules {
		if len(m.Tenants) > 0 && !contains(m.Tenants, tenant) {
			continue
		}
		if scope != "" && (m.VehicleScope == "2W" || m.VehicleScope == "Car") && m.VehicleScope != scope {
			continue
		}
		depth := m.Depth
		if class != "" && depth == "deep" && !contains(m.DeepContentClasses, class) {
			depth = "thin"
		}
		out = append(out, ModuleView{ModuleID: m.ID, TitleKey: "curriculum." + m.ID + ".title", Kind: m.Kind, ContentDepth: depth,
			Games: m.Games, RuleIDs: m.RuleIDs, SkillID: m.SkillID})
	}
	return out, fmt.Sprintf(`W/"%s-%s-%s"`, c.hash, class, tenant)
}

// ConceptCounts is |authored concepts| per topic, the /learn/state conceptCounts.
func (c *Catalog) ConceptCounts() map[string]int {
	out := map[string]int{}
	for _, m := range c.Modules {
		out[m.ID] = len(m.Concepts)
	}
	return out
}

// NewCandidates returns authored concepts not in seen, in curriculum order (at most max).
func (c *Catalog) NewCandidates(seen map[string]bool, max int) []string {
	var out []string
	for _, m := range c.Modules {
		for _, id := range m.Concepts {
			if !seen[id] {
				out = append(out, id)
				if len(out) == max {
					return out
				}
			}
		}
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
