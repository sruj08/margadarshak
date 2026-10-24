package rules

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustPlan(t *testing.T, lib *Library, in Input) *Plan {
	t.Helper()
	p, err := lib.Plan(in)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	return p
}

func bp(b bool) *bool { return &b }

// copyRulepacks copies rulepacks/ into a temp dir and applies string edits to one file.
func copyRulepacks(t *testing.T, file, old, new string) string {
	t.Helper()
	src := filepath.Join(repoRoot(t), "rulepacks")
	dst := t.TempDir()
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if filepath.ToSlash(rel) == file {
			if !bytes.Contains(b, []byte(old)) {
				t.Fatalf("%s does not contain %q", file, old)
			}
			b = bytes.Replace(b, []byte(old), []byte(new), 1)
		}
		return os.WriteFile(target, b, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

// TestRulepackProvenance: every row of every rule-pack file carries source
// {title,url}, grade, checkedOn, confidence, verified and approvers (D-05).
func TestRulepackProvenance(t *testing.T) {
	root := filepath.Join(repoRoot(t), "rulepacks")
	files := []string{filepath.Join(root, "base", "cmvr.json"), filepath.Join(root, "fees.json"), filepath.Join(root, "classes.json")}
	states, _ := filepath.Glob(filepath.Join(root, "states", "*.json"))
	files = append(files, states...)
	rows := 0
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		for _, key := range []string{"rules", "items", "retest", "stateItems", "classes"} {
			list, _ := doc[key].([]any)
			for _, r := range list {
				row := r.(map[string]any)
				rows++
				id, _ := row["id"].(string)
				src, ok := row["source"].(map[string]any)
				if !ok || strings.TrimSpace(asString(src["title"])) == "" || !strings.HasPrefix(asString(src["url"]), "http") {
					t.Errorf("%s %s: missing source title/url", filepath.Base(f), id)
				}
				for _, k := range []string{"grade", "checkedOn", "confidence"} {
					if asString(row[k]) == "" {
						t.Errorf("%s %s: missing %s", filepath.Base(f), id, k)
					}
				}
				if _, ok := row["verified"].(bool); !ok {
					t.Errorf("%s %s: missing verified", filepath.Base(f), id)
				}
				if a, ok := row["approvers"].([]any); !ok || len(a) == 0 {
					t.Errorf("%s %s: missing approvers", filepath.Base(f), id)
				}
				if _, err := ParseDate(asString(row["checkedOn"])); err != nil {
					t.Errorf("%s %s: checkedOn %v", filepath.Base(f), id, err)
				}
			}
		}
	}
	if rows < 100 {
		t.Errorf("only %d rows checked", rows)
	}
}

func asString(v any) string { s, _ := v.(string); return s }

func TestRulepackSchemaRejectsMissingSourceOrDate(t *testing.T) {
	sch, err := CompileSchemaFile(filepath.Join(repoRoot(t), "rulepacks", "schema", "rulepack.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	good := `{"fileKind":"rulepack","packId":"JK","version":"2026.10.0","extends":"IN-base@2026.10.0","effectiveFrom":"2026-10-23","status":"draft","partial":true,"maker":"m","rules":[
	 {"id":"X-1","kind":"notice","condition":true,"output":{},"textKey":"a.b","refs":["EC-01"],
	  "source":{"title":"abc","url":"https://x.example/"},"grade":"S","checkedOn":"2026-10-22","confidence":"low","verified":false,"approvers":["maker:x"]}]}`
	if err := ValidateDocument(sch, []byte(good)); err != nil {
		t.Fatalf("good doc rejected: %v", err)
	}
	cases := map[string][2]string{
		"no source url":   {`"source":{"title":"abc","url":"https://x.example/"}`, `"source":{"title":"abc"}`},
		"no checkedOn":    {`"checkedOn":"2026-10-22",`, ``},
		"bad grade":       {`"grade":"S"`, `"grade":"rumour"`},
		"no verified":     {`"verified":false,`, ``},
		"no approvers":    {`,"approvers":["maker:x"]`, ``},
		"unknown op":      {`"condition":true`, `"condition":{"eval":"1+1"}`},
		"unknown fact":    {`"condition":true`, `"condition":{"fact":"aadhaarNumber"}`},
		"two-key op":      {`"condition":true`, `"condition":{"eq":[1,1],"ne":[1,2]}`},
		"float money ok?": {`"condition":true`, `"condition":{"eq":[1.5,1]}`},
		"extra field":     {`"textKey":"a.b"`, `"textKey":"a.b","sql":"drop"`},
	}
	for name, c := range cases {
		bad := strings.Replace(good, c[0], c[1], 1)
		if bad == good {
			t.Fatalf("%s: edit did not apply", name)
		}
		if err := ValidateDocument(sch, []byte(bad)); err == nil {
			t.Errorf("%s: schema accepted an invalid row", name)
		}
	}
}

// patchRulepacks copies rulepacks/ and mutates one row (by id) of one file at the JSON level.
func patchRulepacks(t *testing.T, file, listKey, id string, mutate func(row map[string]any)) string {
	t.Helper()
	dir := copyRulepacks(t, file, "{", "{")
	p := filepath.Join(dir, filepath.FromSlash(file))
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range doc[listKey].([]any) {
		row := r.(map[string]any)
		if row["id"] == id {
			mutate(row)
			found = true
		}
	}
	if !found {
		t.Fatalf("%s: row %s not found", file, id)
	}
	b, _ := json.MarshalIndent(doc, "", "  ")
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestLoadDirRejectsInvalidPacks(t *testing.T) {
	type patch struct {
		file, list, id string
		mutate         func(map[string]any)
	}
	cond := func(expr string) func(map[string]any) {
		return func(r map[string]any) {
			var v any
			_ = json.Unmarshal([]byte(expr), &v)
			r["condition"] = v
		}
	}
	cases := map[string]patch{
		"unknown param":     {"states/KL.json", "rules", "KL-NTC-HPT-STAYED", cond(`{"in":[{"param":{"id":"PRM-NOPE","path":"status"}},["stayed"]]}`)},
		"unknown path":      {"states/KL.json", "rules", "KL-NTC-HPT-STAYED", cond(`{"in":[{"param":{"id":"PRM-HPT","path":"colour"}},["stayed"]]}`)},
		"bad override":      {"states/TN.json", "rules", "TN-RT-AGE-40", func(r map[string]any) { r["overrides"] = "RT-AGE-41" }},
		"kind change":       {"states/TN.json", "rules", "TN-RT-AGE-40", func(r map[string]any) { r["kind"] = "notice"; r["refs"] = []any{"EC-04"} }},
		"class fact misuse": {"base/cmvr.json", "rules", "NTC-PARTIAL-PACK", cond(`{"eq":[{"fact":"class.code"},"MCWG"]}`)},
		"schema violation":  {"fees.json", "items", "FEE-LL-ISSUE", func(r map[string]any) { r["amount"] = 150.5 }},
		"missing source":    {"states/JK.json", "rules", "JK-B01", func(r map[string]any) { delete(r, "source") }},
		"missing checkedOn": {"classes.json", "classes", "CLS-MCWG", func(r map[string]any) { delete(r, "checkedOn") }},
	}
	for name, c := range cases {
		dir := patchRulepacks(t, c.file, c.list, c.id, c.mutate)
		if _, err := LoadDir(dir); err == nil {
			t.Errorf("%s: LoadDir accepted an invalid pack", name)
		}
	}
}

func TestOverlayPrecedence(t *testing.T) {
	lib := loadLib(t)
	jk, _ := lib.Pack("JK")
	dl, _ := lib.Pack("DL")
	// State value wins.
	if got := jk.params["PRM-LL-FORMAT"].ID; got != "JK-PRM-LL-FORMAT" {
		t.Errorf("JK LL format row = %s", got)
	}
	if q := jk.params["PRM-LL-FORMAT"].Output["value"].(map[string]any)["questions"]; q != int64(10) {
		t.Errorf("JK questions = %v", q)
	}
	// Base row cited when the state has none.
	if got := dl.params["PRM-LL-FORMAT"].ID; got != "PRM-LL-FORMAT" {
		t.Errorf("DL LL format row = %s", got)
	}
	if jk.eff("BLK-DOB-YEAR-ONLY") != "JK-B10" || dl.eff("BLK-DOB-YEAR-ONLY") != "BLK-DOB-YEAR-ONLY" {
		t.Error("effective IDs wrong")
	}
	for _, r := range jk.Rules {
		if r.ID == "BLK-ADDRESS-MISMATCH" {
			t.Error("overridden base row still present in JK")
		}
	}
	// Every JK blocker JK-B01..JK-B10 is present.
	for i := 1; i <= 10; i++ {
		id := "JK-B" + map[bool]string{true: "0", false: ""}[i < 10] + itoa(i)
		if jk.ruleByID(id) == nil {
			t.Errorf("missing %s", id)
		}
	}
	if jk.Hash == dl.Hash || len(jk.Hash) != 64 {
		t.Errorf("hashes: %s %s", jk.Hash, dl.Hash)
	}
}

func itoa(i int) string { b, _ := json.Marshal(i); return string(b) }

func TestExpressionLanguage(t *testing.T) {
	env := &evalEnv{
		facts: map[string]any{
			"asOf": "2026-10-23", "llDate": "2026-10-23", "requestedClasses": []any{"MCWG", "LMV-NT"}, "holdsDl": false, "aadhaarAddressMatches": nil,
		},
		params:      map[string]*Rule{"P": {ID: "P", Output: map[string]any{"value": map[string]any{"n": int64(30), "s": "x"}}}},
		dobLatest:   DateFromYMD(2008, 12, 31),
		dobEarliest: DateFromYMD(2008, 1, 1),
		used:        map[string]bool{},
	}
	cases := []struct {
		expr string
		want any
	}{
		{`{"all":[true,{"not":false}]}`, true},
		{`{"any":[false,null,1]}`, false},
		{`{"eq":[{"fact":"aadhaarAddressMatches"},null]}`, true},
		{`{"eq":[{"fact":"aadhaarAddressMatches"},false]}`, false},
		{`{"lt":[null,1]}`, false},
		{`{"lt":["2026-01-01","2026-10-23"]}`, true},
		{`{"gte":[1,"1"]}`, false},
		{`{"between":[17,16,17]}`, true},
		{`{"in":["MCWG",["MCWOG","MCWG"]]}`, true},
		{`{"has":[{"fact":"requestedClasses"},"LMV-NT"]}`, true},
		{`{"has":[{"fact":"holdsDl"},"x"]}`, false},
		{`{"ageOn":{"on":{"fact":"asOf"},"bound":"min"}}`, int64(17)},
		{`{"ageOn":{"on":{"fact":"asOf"},"bound":"max"}}`, int64(18)},
		{`{"ageOn":{"on":null,"bound":"max"}}`, nil},
		{`{"birthday":{"age":18,"bound":"min"}}`, "2026-12-31"},
		{`{"birthday":{"age":18,"bound":"max"}}`, "2026-01-01"},
		{`{"daysBetween":["2026-10-23","2026-11-22"]}`, int64(30)},
		{`{"addDays":[{"fact":"llDate"},30]}`, "2026-11-22"},
		{`{"addMonths":["2026-08-31",6]}`, "2027-02-28"},
		{`{"addMonths":["2027-08-31",6]}`, "2028-02-29"},
		{`{"param":{"id":"P","path":"n"}}`, int64(30)},
		{`{"param":{"id":"P","path":"zz"}}`, nil},
		{`{"const":{"a":1}}`, map[string]any{"a": int64(1)}},
		{`[1,"a",null]`, []any{int64(1), "a", nil}},
	}
	for _, c := range cases {
		v, err := decodeNormalized(json.RawMessage(c.expr))
		if err != nil {
			t.Fatal(err)
		}
		n, err := parseExpr(v, 1)
		if err != nil {
			t.Fatalf("%s: %v", c.expr, err)
		}
		if got := env.eval(n); !deepEqual(got, c.want) {
			t.Errorf("%s = %#v, want %#v", c.expr, got, c.want)
		}
	}
	if !env.used["P"] {
		t.Error("param use not traced")
	}
	bad := []string{
		`{"eval":"x"}`, `{"fact":"aadhaarNumber"}`, `{"eq":[1]}`, `{"between":[1,2]}`, `{"all":[]}`,
		`{"ageOn":{"on":"2026-01-01"}}`, `{"ageOn":{"on":"2026-01-01","bound":"mid"}}`, `{"param":{"path":"x"}}`,
		`{"a":1,"b":2}`, `{"not":{"not":{"not":{"not":{"not":{"not":{"not":{"not":true}}}}}}}}`,
	}
	for _, b := range bad {
		v, err := decodeNormalized(json.RawMessage(b))
		if err != nil {
			continue
		}
		if _, err := parseExpr(v, 1); err == nil {
			t.Errorf("%s: parsed, want error", b)
		}
	}
	if _, err := decodeNormalized(json.RawMessage(`{"eq":[1.5,1]}`)); err == nil {
		t.Error("float accepted")
	}
}

func TestDates(t *testing.T) {
	d := func(s string) Date {
		x, err := ParseDate(s)
		if err != nil {
			t.Fatal(err)
		}
		return x
	}
	if AgeOn(d("2008-02-29"), d("2026-02-28")) != 17 || AgeOn(d("2008-02-29"), d("2026-03-01")) != 18 {
		t.Error("leap-day age")
	}
	if BirthdayAt(d("2008-02-29"), 18).String() != "2026-03-01" || BirthdayAt(d("2008-02-29"), 20).String() != "2028-02-29" {
		t.Error("leap-day birthday")
	}
	if d("2026-01-31").AddMonths(1).String() != "2026-02-28" || d("2026-10-23").AddMonths(6).String() != "2027-04-23" {
		t.Error("AddMonths")
	}
	if d("2026-12-31").AddDays(1).String() != "2027-01-01" || d("1970-01-01").days != 0 {
		t.Error("AddDays / epoch")
	}
	for _, bad := range []string{"2026-2-01", "2026-02-30", "1899-12-31", "2201-01-01", "2026/02/01", "abcd-ef-gh"} {
		if _, err := ParseDate(bad); err == nil {
			t.Errorf("%s parsed", bad)
		}
	}
	// 20:00 UTC on 23 Oct is 01:30 IST on 24 Oct (EC-15: IST date boundaries).
	if TodayIST(time.Date(2026, 10, 23, 20, 0, 0, 0, time.UTC)).String() != "2026-10-24" {
		t.Error("TodayIST")
	}
	// Round-trip across the supported range.
	for x := d("1900-01-01"); x.Before(d("2200-12-31")); x = x.AddDays(97) {
		if y, err := ParseDate(x.String()); err != nil || y != x {
			t.Fatalf("round trip %s", x)
		}
	}
}

func TestFeeQuoteInvariants(t *testing.T) {
	lib := loadLib(t)
	for _, st := range lib.SupportedStates() {
		c, _ := lib.Pack(st)
		prev := int64(0)
		for n, set := range [][]string{{"LMV-NT"}, {"MCWG", "LMV-NT"}, {"MCWOG", "MCWG", "LMV-NT"}} {
			q := c.FeeQuote(set)
			var sum int64
			for _, l := range q.Lines {
				sum += l.AmountPaise
			}
			if sum != q.TotalPaise || q.SubtotalGovtFeePaise != q.TotalPaise-q.SmartCardPaise {
				t.Errorf("%s: totals inconsistent", st)
			}
			want := []int64{70000, 115000, 160000}[n]
			if q.SubtotalGovtFeePaise != want || q.TotalPaise != want+20000 {
				t.Errorf("%s %d classes: %d/%d", st, n+1, q.SubtotalGovtFeePaise, q.TotalPaise)
			}
			if wantLL := []int64{50000, 95000, 140000}[n]; q.LLStagePaise != wantLL {
				t.Errorf("%s LL stage %d", st, q.LLStagePaise)
			}
			if q.TotalPaise <= prev {
				t.Errorf("%s: total not monotonic", st)
			}
			prev = q.TotalPaise
		}
	}
}

// EC-28: Kerala HPT stayed -> "practice in the announced format", no HPT step.
func TestEC28KeralaHPTStayed(t *testing.T) {
	dir := copyRulepacks(t, "states/KL.json", `"status": "announced"`, `"status": "stayed"`)
	lib, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := mustPlan(t, lib, Input{AsOf: "2026-11-15", State: "KL", DOB: "2000-01-01", Vehicles: []string{"car"}})
	if p.HPT.Status != "stayed" || p.HPT.Applies {
		t.Errorf("hpt = %+v", p.HPT)
	}
	found := false
	for _, n := range p.Notices {
		if n.RuleID == "KL-NTC-HPT-STAYED" {
			found = true
		}
		if n.RuleID == "KL-NTC-HPT" || n.RuleID == "KL-NTC-HPT-UPCOMING" {
			t.Errorf("unexpected %s", n.RuleID)
		}
	}
	for _, s := range p.Steps {
		if s.Key == "dl.hpt" {
			t.Error("HPT step present while stayed")
		}
	}
	if !found {
		t.Error("stayed notice missing")
	}
}

// EC-27: a pack change changes the hash and the plan; the old plan stays reproducible.
func TestEC27PackChangeIsDetectable(t *testing.T) {
	old := loadLib(t)
	dir := patchRulepacks(t, "states/JK.json", "rules", "JK-PRM-MIN-WAIT-DAYS", func(r map[string]any) {
		r["output"] = map[string]any{"value": 45}
	})
	newLib, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	in := Input{AsOf: "2026-10-23", State: "JK", DOB: "2000-01-01", Vehicles: []string{"car"}}
	a, b := mustPlan(t, old, in), mustPlan(t, newLib, in)
	if a.RulePack.Hash == b.RulePack.Hash {
		t.Error("hash unchanged after a rule change")
	}
	if a.EarliestDates.DLTestUnlock != "2026-11-22" || b.EarliestDates.DLTestUnlock != "2026-12-07" {
		t.Errorf("unlock %s / %s", a.EarliestDates.DLTestUnlock, b.EarliestDates.DLTestUnlock)
	}
}

func TestDeterminismAndIrrelevantFacts(t *testing.T) {
	lib := loadLib(t)
	in := Input{AsOf: "2026-10-23", State: "JK", DOB: "2007-03-14", Vehicles: []string{"car", "bike_gear"}, Disability: []string{"deaf", "other", "deaf"}}
	a, _ := CanonicalJSON(mustPlan(t, lib, in))
	for i := 0; i < 20; i++ {
		b, _ := CanonicalJSON(mustPlan(t, lib, in))
		if !bytes.Equal(a, b) {
			t.Fatal("non-deterministic output")
		}
	}
	// Explicit false for an unused boolean equals absent.
	base := Input{AsOf: "2026-10-23", State: "DL", DOB: "2000-01-01", Vehicles: []string{"car"}}
	with := base
	with.WantsIDP = false
	with.Classes = []string{"LMV-NT"}
	x, _ := CanonicalJSON(mustPlan(t, lib, base))
	y, _ := CanonicalJSON(mustPlan(t, lib, with))
	if !bytes.Equal(x, y) {
		t.Error("irrelevant facts changed the decision")
	}
}

func TestEveryOutputCarriesRuleIDs(t *testing.T) {
	lib := loadLib(t)
	p := mustPlan(t, lib, Input{AsOf: "2026-10-23", State: "JK", DOB: "1986", DOBPrecision: "year", Vehicles: []string{"car", "taxi"},
		AadhaarAddressMatchesResidence: bp(false), Disability: []string{"deaf"}})
	inTrace := map[string]bool{}
	for _, id := range p.Trace {
		inTrace[id] = true
	}
	check := func(id, where string) {
		if id == "" || !inTrace[id] {
			t.Errorf("%s: rule id %q not in trace", where, id)
		}
	}
	for _, c := range p.Classes {
		for _, id := range c.RuleIDs {
			check(id, "class")
		}
	}
	for _, s := range p.Steps {
		if len(s.RuleIDs) == 0 {
			t.Errorf("step %s has no rule ids", s.Key)
		}
		for _, id := range s.RuleIDs {
			check(id, "step "+s.Key)
		}
	}
	for _, l := range p.Fees.Lines {
		check(l.RuleID, "fee")
	}
	for _, d := range p.Documents {
		check(d.RuleID, "document")
	}
	for _, list := range [][]Issue{p.Blockers, p.Warnings, p.Notices} {
		for _, is := range list {
			check(is.RuleID, "issue")
			if is.Provenance.SourceURL == "" || is.Provenance.Grade == "" {
				t.Errorf("%s without provenance", is.RuleID)
			}
		}
	}
	for _, m := range p.Milestones {
		check(m.RuleID, "milestone")
	}
}

func TestMatcherRejectsMismatch(t *testing.T) {
	act, _ := toGeneric(map[string]any{"a": []any{map[string]any{"id": "X"}, map[string]any{"id": "Y"}}, "n": 1})
	exp := func(s string) any { v, _ := decodeGeneric([]byte(s)); return v }
	if len(matchSubset(exp(`{"a":{"$includes":[{"id":"Y"}],"$len":2},"n":1}`), act, "$")) != 0 {
		t.Error("valid subset rejected")
	}
	for _, bad := range []string{`{"n":2}`, `{"a":[{"id":"X"}]}`, `{"a":{"$includes":[{"id":"Z"}]}}`, `{"a":{"$excludes":[{"id":"X"}]}}`, `{"a":{"$len":3}}`, `{"zz":null}`} {
		if len(matchSubset(exp(bad), act, "$")) == 0 {
			t.Errorf("%s matched", bad)
		}
	}
}

func TestCanonicalJSONEscaping(t *testing.T) {
	b, err := CanonicalJSON(map[string]any{"b": "q\"\\\n\t\u0001<&> हि", "a": []any{true, nil, json.Number("70000")}})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"a":[true,null,70000],"b":"q\"\\\n\t\u0001<&>` + " " + `हि"}`
	if string(b) != want {
		t.Errorf("got %s", b)
	}
	if _, err := CanonicalJSON(map[string]any{"x": 1.5}); err == nil {
		t.Error("float accepted")
	}
}

// State fee overrides replace a base head; includedInTotal rows are added; rows
// outside their effective window are skipped.
func TestFeeOverridesAndEffectiveWindows(t *testing.T) {
	stateItems := `"stateItems": [
    {
      "id": "FEE-DL-SMART-CARD", "state": "DL", "overrides": "FEE-SMART-CARD", "labelKey": "fee.smart_card", "amount": 25000, "per": "application", "stage": "DL", "smartCard": true, "includedInTotal": true,
      "source": { "title": "test row", "url": "https://x.example/" }, "grade": "S", "checkedOn": "2026-10-22", "confidence": "low", "verified": false, "approvers": ["maker:test"]
    },
    {
      "id": "FEE-DL-SERVICE", "state": "DL", "labelKey": "fee.dl.service", "amount": 3000, "per": "application", "stage": "LL", "includedInTotal": true,
      "source": { "title": "test row", "url": "https://x.example/" }, "grade": "S", "checkedOn": "2026-10-22", "confidence": "low", "verified": false, "approvers": ["maker:test"]
    },`
	dir := copyRulepacks(t, "fees.json", `"stateItems": [`, stateItems)
	lib, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	dl, _ := lib.Pack("DL")
	q := dl.FeeQuote([]string{"LMV-NT"})
	if q.SmartCardPaise != 25000 || q.TotalPaise != 70000+25000+3000 || q.SubtotalGovtFeePaise != 73000 || q.LLStagePaise != 53000 {
		t.Errorf("DL quote %+v", q)
	}
	if len(q.StateItems) != 1 || !q.StateItems[0].IncludedInTotal {
		t.Errorf("state items %+v", q.StateItems)
	}
	jk, _ := lib.Pack("JK")
	if jk.FeeQuote([]string{"LMV-NT"}).TotalPaise != 90000 {
		t.Error("DL override leaked into JK")
	}

	// Effective window: a notice valid only until 2026-10-01 is skipped on 2026-10-23,
	// and one starting 2027-01-01 is skipped before that date.
	dir2 := patchRulepacks(t, "base/cmvr.json", "rules", "NTC-STATE-CHARGES", func(r map[string]any) { r["effectiveTo"] = "2026-10-01" })
	lib2, err := LoadDir(dir2)
	if err != nil {
		t.Fatal(err)
	}
	dir3 := patchRulepacks(t, "base/cmvr.json", "rules", "NTC-STATE-CHARGES", func(r map[string]any) { r["effectiveFrom"] = "2027-01-01" })
	lib3, err := LoadDir(dir3)
	if err != nil {
		t.Fatal(err)
	}
	has := func(p *Plan) bool {
		for _, n := range p.Notices {
			if n.RuleID == "NTC-STATE-CHARGES" {
				return true
			}
		}
		return false
	}
	in := Input{AsOf: "2026-10-23", State: "DL", DOB: "2000-01-01", Vehicles: []string{"car"}}
	if has(mustPlan(t, lib2, in)) || has(mustPlan(t, lib3, in)) {
		t.Error("row outside its effective window fired")
	}
	in.AsOf = "2027-01-02"
	if !has(mustPlan(t, lib3, in)) {
		t.Error("row inside its effective window did not fire")
	}
}

func TestInputErrorsAndCompiledStateMismatch(t *testing.T) {
	lib := loadLib(t)
	jk, _ := lib.Pack("JK")
	_, err := jk.Plan(Input{AsOf: "2026-10-23", State: "DL", DOB: "2000-01-01", Vehicles: []string{"car"}})
	ie, ok := err.(*InputError)
	if !ok || ie.Code != "UNKNOWN_STATE" || ie.Error() != "UNKNOWN_STATE (state)" {
		t.Errorf("err = %v", err)
	}
	bad := "2026-13-01"
	if _, err := lib.Plan(Input{AsOf: "2026-10-23", State: "JK", DOB: "2000-01-01", Vehicles: []string{"car"}, LMVDLHeldSince: &bad}); err == nil {
		t.Error("bad lmv date accepted")
	}
	if got := lib.SupportedStates(); strings.Join(got, ",") != "DL,JK,KL,MH,PB,TN" {
		t.Errorf("states %v", got)
	}
}
