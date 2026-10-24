package rules

import (
	"sort"
)

// InputError is a validation failure of plan input. Code values are stable
// and identical in the TS mirror.
type InputError struct {
	Code  string `json:"code"`
	Field string `json:"field"`
}

func (e *InputError) Error() string { return e.Code + " (" + e.Field + ")" }

func inErr(code, field string) error { return &InputError{Code: code, Field: field} }

// Input is the 3-tap plan request (API-01) plus the blocker-check answers
// (F-04). Dates are IST calendar dates. as_of comes from the server clock
// (ClockPort), never from the client (EC-15).
type Input struct {
	AsOf                           string   `json:"as_of"`
	State                          string   `json:"state"`
	DOB                            string   `json:"dob"`
	DOBPrecision                   string   `json:"dob_precision"`
	Vehicles                       []string `json:"vehicles"`
	Classes                        []string `json:"classes"`
	AadhaarAddressMatchesResidence *bool    `json:"aadhaar_address_matches_residence"`
	AadhaarHasRelationLine         *bool    `json:"aadhaar_has_relation_line"`
	AadhaarMobileLinked            *bool    `json:"aadhaar_mobile_linked"`
	HomeTestDevice                 *bool    `json:"home_test_device"`
	Disability                     []string `json:"disability"`
	ForeignLicence                 bool     `json:"foreign_licence"`
	NRI                            bool     `json:"nri"`
	MovingState                    bool     `json:"moving_state"`
	HoldsDL                        bool     `json:"holds_dl"`
	LMVDLHeldSince                 *string  `json:"lmv_dl_held_since"`
	WantsIDP                       bool     `json:"wants_idp"`
	HasTestVehicle                 *bool    `json:"has_test_vehicle"`
	LLIssuedOn                     *string  `json:"ll_issued_on"`
}

// ProvOut is the source chip data carried by every output value.
type ProvOut struct {
	SourceTitle string `json:"source_title"`
	SourceURL   string `json:"source_url"`
	Grade       string `json:"grade"`
	CheckedOn   string `json:"checked_on"`
	Confidence  string `json:"confidence"`
	Verified    bool   `json:"verified"`
}

func prov(p Provenance) ProvOut {
	return ProvOut{SourceTitle: p.Source.Title, SourceURL: p.Source.URL, Grade: p.Grade, CheckedOn: p.CheckedOn, Confidence: p.Confidence, Verified: p.Verified}
}

// PackRef identifies the exact pack a plan was computed with (EC-27).
type PackRef struct {
	PackID         string `json:"pack_id"`
	Version        string `json:"version"`
	BaseVersion    string `json:"base_version"`
	FeesVersion    string `json:"fees_version"`
	ClassesVersion string `json:"classes_version"`
	Partial        bool   `json:"partial"`
	Hash           string `json:"hash"`
}

// AgeInfo: years_min uses the latest plausible DOB (31 Dec for a year-only
// DOB, EC-01), years_max the earliest (1 Jan).
type AgeInfo struct {
	YearsMin     int    `json:"years_min"`
	YearsMax     int    `json:"years_max"`
	Band         string `json:"band"`
	DOBPrecision string `json:"dob_precision"`
}

// ClassResult is the per-class eligibility decision.
type ClassResult struct {
	ClassCode     string      `json:"class_code"`
	NameKey       string      `json:"name_key"`
	Eligible      bool        `json:"eligible"`
	EligibleFrom  *string     `json:"eligible_from"`
	ReasonKey     *string     `json:"reason_key"`
	ContentDepth  string      `json:"content_depth"`
	Transport     bool        `json:"transport"`
	VerifyAtRTO   bool        `json:"verify_at_rto"`
	Requires      []string    `json:"requires"`
	Flags         []string    `json:"flags"`
	Alternatives  []string    `json:"alternatives"`
	Prerequisites []PrereqOut `json:"prerequisites"`
	RuleIDs       []string    `json:"rule_ids"`
	Provenance    ProvOut     `json:"provenance"`
}

// FeeLine is one line item (E-07), integer paise.
type FeeLine struct {
	FeeID       string  `json:"fee_id"`
	LabelKey    string  `json:"label_key"`
	Per         string  `json:"per"`
	ClassCode   *string `json:"class_code"`
	Quantity    int     `json:"quantity"`
	UnitPaise   int64   `json:"unit_paise"`
	AmountPaise int64   `json:"amount_paise"`
	Stage       string  `json:"stage"`
	RuleID      string  `json:"rule_id"`
}

// StateFee is a state-reported amount that is never added to the total
// unless the row says includedInTotal.
type StateFee struct {
	FeeID           string  `json:"fee_id"`
	LabelKey        string  `json:"label_key"`
	AmountPaise     int64   `json:"amount_paise"`
	IncludedInTotal bool    `json:"included_in_total"`
	Provenance      ProvOut `json:"provenance"`
}

// RetestFee lists retest fee heads.
type RetestFee struct {
	FeeID       string `json:"fee_id"`
	LabelKey    string `json:"label_key"`
	Per         string `json:"per"`
	AmountPaise int64  `json:"amount_paise"`
}

// FeeQuote is computed from fees.json only (D-06).
type FeeQuote struct {
	Classes              []string    `json:"classes"`
	Lines                []FeeLine   `json:"lines"`
	LLStagePaise         int64       `json:"ll_stage_paise"`
	SubtotalGovtFeePaise int64       `json:"subtotal_govt_fee_paise"`
	SmartCardPaise       int64       `json:"smart_card_paise"`
	TotalPaise           int64       `json:"total_paise"`
	StateItems           []StateFee  `json:"state_items"`
	Retest               []RetestFee `json:"retest"`
	Excludes             []string    `json:"excludes"`
	Provenance           ProvOut     `json:"provenance"`
}

// Bundle is one learner's licence covering one or more classes (F-03).
type Bundle struct {
	BundleNo        int      `json:"bundle_no"`
	Classes         []string `json:"classes"`
	LLFrom          string   `json:"ll_from"`
	DLTestUnlock    string   `json:"dl_test_unlock"`
	LLExpiresOn     string   `json:"ll_expires_on"`
	EarliestLicence string   `json:"earliest_licence"`
	Fees            FeeQuote `json:"fees"`
	RuleIDs         []string `json:"rule_ids"`
}

// Saving is shown only "if you'd otherwise do them one after the other".
type Saving struct {
	ClassesOnOneLL    int      `json:"classes_on_one_ll"`
	ApplicationsSaved int      `json:"applications_saved"`
	WaitDaysSaved     int      `json:"wait_days_saved"`
	FeeSavingPaise    int64    `json:"fee_saving_paise"`
	NoteKey           string   `json:"note_key"`
	Verified          bool     `json:"verified"`
	Confidence        string   `json:"confidence"`
	RuleIDs           []string `json:"rule_ids"`
}

// Path is an application route (EC-02/EC-03).
type Path struct {
	PathID       string   `json:"path_id"`
	Recommended  bool     `json:"recommended"`
	LLTestAtRTO  bool     `json:"ll_test_at_rto"`
	MaxRTOVisits int      `json:"max_rto_visits"`
	RuleIDs      []string `json:"rule_ids"`
}

// Step is one plan step.
type Step struct {
	N       int      `json:"n"`
	Key     string   `json:"key"`
	AtRTO   bool     `json:"at_rto"`
	Visit   *int     `json:"visit"`
	Done    bool     `json:"done"`
	DueOn   *string  `json:"due_on"`
	RuleIDs []string `json:"rule_ids"`
}

// Dates are the earliest dates of the primary bundle.
type Dates struct {
	LLIssue         string `json:"ll_issue"`
	DLTestUnlock    string `json:"dl_test_unlock"`
	LLExpiresOn     string `json:"ll_expires_on"`
	EarliestLicence string `json:"earliest_licence"`
}

// Document is one checklist item.
type Document struct {
	DocID    string `json:"doc_id"`
	Required bool   `json:"required"`
	Stage    string `json:"stage"`
	RuleID   string `json:"rule_id"`
	TextKey  string `json:"text_key"`
	Verified bool   `json:"verified"`
}

// Issue is a blocker, warning or notice (F-04) with fix, source and grade.
type Issue struct {
	RuleID      string   `json:"rule_id"`
	Severity    string   `json:"severity"`
	TextKey     string   `json:"text_key"`
	FixKey      *string  `json:"fix_key"`
	DueOn       *string  `json:"due_on"`
	Refs        []string `json:"refs"`
	VerifyAtRTO bool     `json:"verify_at_rto"`
	Provenance  ProvOut  `json:"provenance"`
}

// LLTest is the state's LL test format (API-05).
type LLTest struct {
	OnlineAvailable bool     `json:"online_available"`
	Where           []string `json:"where"`
	Mode            string   `json:"mode"`
	Known           bool     `json:"known"`
	Questions       int64    `json:"questions"`
	PassCorrect     int64    `json:"pass_correct"`
	PassPct         int64    `json:"pass_pct"`
	Verified        bool     `json:"verified"`
	Confidence      string   `json:"confidence"`
	RuleIDs         []string `json:"rule_ids"`
}

// DLTest is the state's driving-test format.
type DLTest struct {
	Known     bool     `json:"known"`
	Automated *bool    `json:"automated"`
	Tracks    []string `json:"tracks"`
	Verified  bool     `json:"verified"`
	RuleID    string   `json:"rule_id"`
}

// HPT is the hazard-perception test status (Kerala, EC-28).
type HPT struct {
	Status        string  `json:"status"`
	EffectiveFrom *string `json:"effective_from"`
	Applies       bool    `json:"applies"`
	RuleID        string  `json:"rule_id"`
}

// Office is an office stub from the state pack.
type Office struct {
	OfficeID  string   `json:"office_id"`
	Name      string   `json:"name"`
	District  string   `json:"district"`
	Tests     []string `json:"tests"`
	TrackType *string  `json:"track_type"`
	Verified  bool     `json:"verified"`
	RuleID    string   `json:"rule_id"`
}

// Milestone is a dated case-clock event derived from the plan (F-09).
type Milestone struct {
	ID     string `json:"id"`
	DueOn  string `json:"due_on"`
	RuleID string `json:"rule_id"`
}

// Plan is the full, deterministic decision for one input (F-02/F-03/F-04).
type Plan struct {
	RulePack           PackRef       `json:"rule_pack"`
	AsOf               string        `json:"as_of"`
	State              string        `json:"state"`
	Age                AgeInfo       `json:"age"`
	FamilyModeRequired bool          `json:"family_mode_required"`
	RequestedClasses   []string      `json:"requested_classes"`
	Classes            []ClassResult `json:"classes"`
	Bundles            []Bundle      `json:"bundles"`
	Saving             *Saving       `json:"saving"`
	Paths              []Path        `json:"paths"`
	RecommendedPath    string        `json:"recommended_path"`
	Steps              []Step        `json:"steps"`
	MaxRTOVisits       int           `json:"max_rto_visits"`
	EarliestDates      *Dates        `json:"earliest_dates"`
	Fees               *FeeQuote     `json:"fees"`
	Documents          []Document    `json:"documents"`
	Blockers           []Issue       `json:"blockers"`
	Warnings           []Issue       `json:"warnings"`
	Notices            []Issue       `json:"notices"`
	LLTest             LLTest        `json:"ll_test"`
	DLTest             DLTest        `json:"dl_test"`
	HPT                HPT           `json:"hpt"`
	Offices            []Office      `json:"offices"`
	Milestones         []Milestone   `json:"milestones"`
	Trace              []string      `json:"trace"`
}

var knownDisabilities = map[string]bool{"deaf": true, "colour_vision": true, "low_vision": true, "locomotor": true, "other": true}

// Plan computes the plan for an input. It is a pure function of (input, pack).
func (l *Library) Plan(in Input) (*Plan, error) {
	c, ok := l.Pack(in.State)
	if !ok {
		return nil, inErr("UNKNOWN_STATE", "state")
	}
	return c.Plan(in)
}

func boolOrNil(b *bool) any {
	if b == nil {
		return nil
	}
	return *b
}

func strOrNil(d *Date) any {
	if d == nil {
		return nil
	}
	return d.String()
}

func sp(s string) *string { return &s }

func appendUnique(list []string, vals ...string) []string {
	for _, v := range vals {
		found := false
		for _, e := range list {
			if e == v {
				found = true
				break
			}
		}
		if !found {
			list = append(list, v)
		}
	}
	return list
}

func stringList(v any) []string {
	l, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(l))
	for _, e := range l {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func ageBand(years int) string {
	switch {
	case years < 16:
		return "under_16"
	case years < 18:
		return "16_17"
	case years < 20:
		return "18_19"
	case years < 40:
		return "20_39"
	}
	return "40_plus"
}

func (c *Compiled) active(r *Rule, asOf Date) bool {
	if r.EffectiveFrom != "" {
		if d, err := ParseDate(r.EffectiveFrom); err == nil && asOf.Before(d) {
			return false
		}
	}
	if r.EffectiveTo != "" {
		if d, err := ParseDate(r.EffectiveTo); err == nil && asOf.After(d) {
			return false
		}
	}
	return true
}

func (c *Compiled) paramValue(env *evalEnv, id string) any {
	r := c.params[id]
	env.used[r.ID] = true
	return r.Output["value"]
}

func intOf(v any) int64 {
	n, _ := v.(int64)
	return n
}

// Plan computes the plan with this compiled pack.
func (c *Compiled) Plan(in Input) (*Plan, error) {
	if in.State != c.PackID {
		return nil, inErr("UNKNOWN_STATE", "state")
	}
	asOf, err := ParseDate(in.AsOf)
	if err != nil {
		return nil, inErr("INVALID_AS_OF", "as_of")
	}
	prec := in.DOBPrecision
	if prec == "" {
		prec = "day"
	}
	if prec != "day" && prec != "year" {
		return nil, inErr("INVALID_DOB_PRECISION", "dob_precision")
	}
	var dobLatest, dobEarliest Date
	if prec == "day" {
		d, err := ParseDate(in.DOB)
		if err != nil {
			return nil, inErr("INVALID_DOB", "dob")
		}
		dobLatest, dobEarliest = d, d
	} else {
		var y int
		var ok bool
		switch len(in.DOB) {
		case 4:
			y, ok = ParseYear(in.DOB)
		case 10:
			d, err := ParseDate(in.DOB)
			if err == nil {
				y, _, _ = d.YMD()
				ok = true
			}
		}
		if !ok {
			return nil, inErr("INVALID_DOB", "dob")
		}
		dobLatest, dobEarliest = DateFromYMD(y, 12, 31), DateFromYMD(y, 1, 1)
	}
	if dobEarliest.After(asOf) {
		return nil, inErr("DOB_AFTER_AS_OF", "dob")
	}
	reqSet := map[string]bool{}
	for _, v := range in.Vehicles {
		cr, ok := c.classByPic[v]
		if !ok {
			return nil, inErr("UNKNOWN_VEHICLE", "vehicles")
		}
		reqSet[cr.Code] = true
	}
	for _, code := range in.Classes {
		if _, ok := c.classByCode[code]; !ok {
			return nil, inErr("UNKNOWN_CLASS", "classes")
		}
		reqSet[code] = true
	}
	if len(reqSet) == 0 {
		return nil, inErr("NO_CLASSES", "vehicles")
	}
	requested := make([]string, 0, len(reqSet))
	for code := range reqSet {
		requested = append(requested, code)
	}
	sort.Slice(requested, func(i, j int) bool { return c.classOrder[requested[i]] < c.classOrder[requested[j]] })

	var lmvSince, llIssued *Date
	if in.LMVDLHeldSince != nil {
		d, err := ParseDate(*in.LMVDLHeldSince)
		if err != nil || d.After(asOf) {
			return nil, inErr("INVALID_DATE", "lmv_dl_held_since")
		}
		lmvSince = &d
	}
	if in.LLIssuedOn != nil {
		d, err := ParseDate(*in.LLIssuedOn)
		if err != nil || d.After(asOf) {
			return nil, inErr("INVALID_DATE", "ll_issued_on")
		}
		llIssued = &d
	}
	disSet := map[string]bool{}
	for _, d := range in.Disability {
		if !knownDisabilities[d] {
			return nil, inErr("UNKNOWN_DISABILITY", "disability")
		}
		disSet[d] = true
	}
	disability := make([]string, 0, len(disSet))
	for d := range disSet {
		disability = append(disability, d)
	}
	sort.Strings(disability)

	trace := map[string]bool{}
	anyTransport, anyNonTransport, anyForm1a := false, false, false
	reqAny := make([]any, len(requested))
	for i, code := range requested {
		cr := c.classByCode[code]
		reqAny[i] = code
		if cr.Transport {
			anyTransport = true
		} else {
			anyNonTransport = true
		}
		if cr.Form1A == "always" {
			anyForm1a = true
		}
		trace[cr.ID] = true
	}
	disAny := make([]any, len(disability))
	for i, d := range disability {
		disAny[i] = d
	}
	facts := map[string]any{
		"asOf": asOf.String(), "state": c.PackID, "dobPrecision": prec,
		"dobLatest": dobLatest.String(), "dobEarliest": dobEarliest.String(),
		"aadhaarAddressMatches": boolOrNil(in.AadhaarAddressMatchesResidence),
		"aadhaarRelationLine":   boolOrNil(in.AadhaarHasRelationLine),
		"aadhaarMobileLinked":   boolOrNil(in.AadhaarMobileLinked),
		"homeTestDevice":        boolOrNil(in.HomeTestDevice),
		"disability":            disAny, "hasDisability": len(disability) > 0,
		"foreignLicence": in.ForeignLicence, "nri": in.NRI, "movingState": in.MovingState,
		"holdsDl": in.HoldsDL, "lmvDlHeldSince": strOrNil(lmvSince), "wantsIdp": in.WantsIDP,
		"hasTestVehicle": boolOrNil(in.HasTestVehicle), "llIssuedOn": strOrNil(llIssued),
		"requestedClasses": reqAny, "anyTransport": anyTransport, "anyNonTransport": anyNonTransport,
		"anyForm1aAlways": anyForm1a, "packPartial": c.Partial,
		"llDate": nil, "dlTestUnlock": nil, "llExpiresOn": nil, "earliestLicence": nil,
		"class.code": nil, "class.minAge": nil, "class.transport": nil, "class.form1a": nil,
	}
	env := &evalEnv{facts: facts, params: c.params, dobLatest: dobLatest, dobEarliest: dobEarliest, used: map[string]bool{}}

	// 1. Eligibility per class (EC-05, EC-06, EC-21).
	classes := make([]ClassResult, 0, len(requested))
	type fromInfo struct {
		date      *Date
		permanent bool
	}
	froms := make([]fromInfo, len(requested))
	for i, code := range requested {
		cr := c.classByCode[code]
		facts["class.code"], facts["class.minAge"], facts["class.transport"], facts["class.form1a"] = cr.Code, int64(cr.MinAge), cr.Transport, cr.Form1A
		res := ClassResult{
			ClassCode: cr.Code, NameKey: cr.NameKey, Eligible: true, ContentDepth: cr.ContentDepth, Transport: cr.Transport,
			VerifyAtRTO: !cr.Verified, Requires: []string{}, Flags: []string{}, Alternatives: []string{},
			Prerequisites: []PrereqOut{}, RuleIDs: []string{cr.ID}, Provenance: prov(cr.Provenance),
		}
		for _, p := range cr.Prerequisites {
			res.Prerequisites = append(res.Prerequisites, PrereqOut{ID: p.ID, TextKey: p.TextKey, Verified: p.Verified})
			if !p.Verified {
				res.VerifyAtRTO = true
			}
		}
		for _, r := range c.Rules {
			if r.Kind != "eligibility" || !c.active(r, asOf) || !appliesTo(r, code) {
				continue
			}
			if !truthy(env.eval(r.cond)) {
				continue
			}
			res.RuleIDs = append(res.RuleIDs, r.ID)
			trace[r.ID] = true
			out := r.Output
			if truthy(out["deny"]) {
				res.Eligible = false
				if rk, ok := out["reasonKey"].(string); ok && res.ReasonKey == nil {
					res.ReasonKey = sp(rk)
				}
				if n, ok := r.outExprs["eligibleFromAge"]; ok {
					if age, ok := env.eval(n).(int64); ok {
						d := BirthdayAt(dobLatest, int(age))
						if froms[i].date == nil || d.After(*froms[i].date) {
							froms[i].date = &d
						}
					} else {
						froms[i].permanent = true
					}
				} else {
					froms[i].permanent = true
				}
			}
			res.Requires = appendUnique(res.Requires, stringList(out["requires"])...)
			res.Flags = appendUnique(res.Flags, stringList(out["flags"])...)
			res.Alternatives = appendUnique(res.Alternatives, stringList(out["alternatives"])...)
			if truthy(out["verifyAtRto"]) {
				res.VerifyAtRTO = true
			}
		}
		if !res.Eligible && !froms[i].permanent && froms[i].date != nil {
			res.EligibleFrom = sp(froms[i].date.String())
		}
		classes = append(classes, res)
	}
	facts["class.code"], facts["class.minAge"], facts["class.transport"], facts["class.form1a"] = nil, nil, nil, nil

	// 2. Smart class planner: bundle classes by the date their LL can start.
	llBase := asOf
	if llIssued != nil {
		llBase = *llIssued
	}
	minWait := int(intOf(c.paramValue(env, "PRM-MIN-WAIT-DAYS")))
	validity := int(intOf(c.paramValue(env, "PRM-LL-VALIDITY-MONTHS")))
	groups := map[string][]string{}
	keys := []string{}
	for i, cl := range classes {
		var key string
		switch {
		case cl.Eligible:
			key = llBase.String()
		case cl.EligibleFrom != nil:
			key = *cl.EligibleFrom
		default:
			continue
		}
		if _, ok := groups[key]; !ok {
			keys = append(keys, key)
		}
		groups[key] = append(groups[key], requested[i])
	}
	sort.Strings(keys)
	bundles := make([]Bundle, 0, len(keys))
	for i, k := range keys {
		from, _ := ParseDate(k)
		unlock := from.AddDays(minWait)
		b := Bundle{
			BundleNo: i + 1, Classes: groups[k], LLFrom: k, DLTestUnlock: unlock.String(),
			LLExpiresOn: from.AddMonths(validity).String(), EarliestLicence: unlock.String(),
			Fees: c.feeQuote(groups[k]), RuleIDs: []string{},
		}
		if len(b.Classes) > 1 {
			b.RuleIDs = append(b.RuleIDs, "PLN-ONE-LL-MANY-CLASSES")
		}
		if i > 0 {
			b.RuleIDs = append(b.RuleIDs, "PLN-SPLIT-BY-AGE")
		}
		for _, id := range b.RuleIDs {
			trace[id] = true
		}
		for _, ln := range b.Fees.Lines {
			trace[ln.RuleID] = true
		}
		for _, s := range b.Fees.StateItems {
			trace[s.FeeID] = true
		}
		bundles = append(bundles, b)
	}
	var primary *Bundle
	if len(bundles) > 0 {
		primary = &bundles[0]
		facts["llDate"], facts["dlTestUnlock"], facts["llExpiresOn"], facts["earliestLicence"] = primary.LLFrom, primary.DLTestUnlock, primary.LLExpiresOn, primary.EarliestLicence
	}

	// 3. Routes, documents, blockers / warnings / notices, offices.
	forcedRTO, recommendNA, familyMode := false, false, false
	routeIDs := []string{}
	documents := []Document{}
	docSeen := map[string]bool{}
	blockers, warnings, notices := []Issue{}, []Issue{}, []Issue{}
	offices := []Office{}
	issueDue := map[string]string{}
	for _, r := range c.Rules {
		switch r.Kind {
		case "route", "document", "blocker", "warning", "notice", "office":
		default:
			continue
		}
		if !c.active(r, asOf) || !truthy(env.eval(r.cond)) {
			continue
		}
		trace[r.ID] = true
		out := r.Output
		switch r.Kind {
		case "route":
			if truthy(out["llTestAtRto"]) {
				forcedRTO = true
			}
			routeIDs = append(routeIDs, r.ID)
		case "document":
			id, _ := out["docId"].(string)
			if docSeen[id] {
				continue
			}
			docSeen[id] = true
			stage, _ := out["stage"].(string)
			documents = append(documents, Document{DocID: id, Required: truthy(out["required"]), Stage: stage, RuleID: r.ID, TextKey: r.TextKey, Verified: r.Verified})
		case "office":
			o := Office{Tests: []string{}, Verified: r.Verified, RuleID: r.ID}
			o.OfficeID, _ = out["officeId"].(string)
			o.Name, _ = out["name"].(string)
			o.District, _ = out["district"].(string)
			o.Tests = append(o.Tests, stringList(out["tests"])...)
			if tt, ok := out["trackType"].(string); ok {
				o.TrackType = sp(tt)
			}
			offices = append(offices, o)
		default:
			is := Issue{
				RuleID: r.ID, Severity: r.Kind, TextKey: r.TextKey, Refs: append([]string{}, r.Refs...),
				VerifyAtRTO: !r.Verified || r.Confidence == "low", Provenance: prov(r.Provenance),
			}
			if r.FixKey != "" {
				is.FixKey = sp(r.FixKey)
			}
			if n, ok := r.outExprs["dueOn"]; ok {
				if d, ok := env.eval(n).(string); ok {
					is.DueOn = sp(d)
					issueDue[r.ID] = d
				}
			}
			if s, _ := out["recommendPath"].(string); s == "non_aadhaar" {
				recommendNA = true
			}
			if truthy(out["familyMode"]) {
				familyMode = true
			}
			switch r.Kind {
			case "blocker":
				blockers = append(blockers, is)
			case "warning":
				warnings = append(warnings, is)
			default:
				notices = append(notices, is)
			}
		}
	}

	// 4. Paths and RTO visits (EC-02, EC-03, EC-10).
	llDone := llIssued != nil
	visits := func(atRTO bool) int {
		if atRTO && !llDone {
			return 2
		}
		return 1
	}
	trace["PLN-NON-AADHAAR-AT-RTO"] = true
	paths := []Path{
		{PathID: "aadhaar_contactless", Recommended: !recommendNA, LLTestAtRTO: forcedRTO, MaxRTOVisits: visits(forcedRTO), RuleIDs: append([]string{}, routeIDs...)},
		{PathID: "non_aadhaar", Recommended: recommendNA, LLTestAtRTO: true, MaxRTOVisits: visits(true), RuleIDs: append([]string{"PLN-NON-AADHAAR-AT-RTO"}, routeIDs...)},
	}
	rec := paths[0]
	if recommendNA {
		rec = paths[1]
	}
	llAtRTO := rec.LLTestAtRTO

	// 5. LL / DL test formats and HPT.
	tmRule, fmtRule := c.params["PRM-LL-TEST-MODE"], c.params["PRM-LL-FORMAT"]
	tm, _ := c.paramValue(env, "PRM-LL-TEST-MODE").(map[string]any)
	fm, _ := c.paramValue(env, "PRM-LL-FORMAT").(map[string]any)
	llTest := LLTest{
		OnlineAvailable: truthy(tm["onlineAvailable"]), Where: append([]string{}, stringList(tm["where"])...),
		Mode: "online", Known: truthy(fm["known"]), Questions: intOf(fm["questions"]), PassCorrect: intOf(fm["passCorrect"]),
		PassPct: intOf(fm["passPct"]), Verified: fmtRule.Verified, Confidence: fmtRule.Confidence,
		RuleIDs: []string{tmRule.ID, fmtRule.ID},
	}
	if llAtRTO {
		llTest.Mode = "rto"
	}
	dlRule := c.params["PRM-DL-TEST"]
	dv, _ := c.paramValue(env, "PRM-DL-TEST").(map[string]any)
	dlTest := DLTest{Known: truthy(dv["known"]), Tracks: append([]string{}, stringList(dv["tracks"])...), Verified: dlRule.Verified, RuleID: dlRule.ID}
	if a, ok := dv["automated"].(bool); ok {
		dlTest.Automated = &a
	}
	hptRule := c.params["PRM-HPT"]
	hv, _ := c.paramValue(env, "PRM-HPT").(map[string]any)
	hpt := HPT{RuleID: hptRule.ID}
	hpt.Status, _ = hv["status"].(string)
	if ef, ok := hv["effectiveFrom"].(string); ok {
		hpt.EffectiveFrom = sp(ef)
	}
	if primary != nil && hpt.EffectiveFrom != nil && (hpt.Status == "announced" || hpt.Status == "in_force") && primary.DLTestUnlock >= *hpt.EffectiveFrom {
		hpt.Applies = true
	}

	// 6. Steps for the recommended path of the primary bundle.
	steps := []Step{}
	maxVisits := rec.MaxRTOVisits
	var milestones []Milestone
	var dates *Dates
	var fees *FeeQuote
	if primary != nil {
		visit := 0
		add := func(key string, atRTO bool, vis *int, done bool, due *string, ids ...string) {
			ids = appendUnique([]string{}, ids...)
			for _, id := range ids {
				trace[id] = true
			}
			steps = append(steps, Step{N: len(steps) + 1, Key: key, AtRTO: atRTO, Visit: vis, Done: done, DueOn: due, RuleIDs: ids})
		}
		tutRule := c.params["PRM-TUTORIAL-DAYS"]
		c.paramValue(env, "PRM-TUTORIAL-DAYS")
		add("ll.apply", false, nil, llDone, nil, tmRule.ID, "FEE-LL-ISSUE", "FEE-LL-TEST", "FEE-DL-TEST")
		add("ll.tutorial", false, nil, llDone, nil, tutRule.ID)
		var llVisit *int
		if llAtRTO && !llDone {
			visit++
			v := visit
			llVisit = &v
		}
		llKey := "ll.test.online"
		if llAtRTO {
			llKey = "ll.test.at_rto"
		}
		var llDue *string
		if !llDone {
			llDue = sp(primary.LLFrom)
		}
		add(llKey, llAtRTO, llVisit, llDone, llDue, append([]string{tmRule.ID, fmtRule.ID}, rec.RuleIDs...)...)
		waitRule, valRule := c.params["PRM-MIN-WAIT-DAYS"], c.params["PRM-LL-VALIDITY-MONTHS"]
		add("practice", false, nil, false, sp(primary.DLTestUnlock), waitRule.ID)
		add("dl.book", false, nil, false, sp(primary.DLTestUnlock), waitRule.ID, valRule.ID)
		visit++
		dlVisit := visit
		if hpt.Applies {
			v := dlVisit
			add("dl.hpt", true, &v, false, sp(primary.DLTestUnlock), hptRule.ID)
		}
		v := dlVisit
		add("dl.test", true, &v, false, sp(primary.DLTestUnlock), dlRule.ID)
		add("dl.issue", false, nil, false, sp(primary.EarliestLicence), "FEE-DL-ISSUE", "FEE-SMART-CARD")
		maxVisits = visit

		milestones = []Milestone{
			{ID: "LL_DAY_30_UNLOCK", DueOn: primary.DLTestUnlock, RuleID: waitRule.ID},
			{ID: "LL_EXPIRY", DueOn: primary.LLExpiresOn, RuleID: valRule.ID},
		}
		if d, ok := issueDue[c.eff("WRN-TURNING-40")]; ok {
			milestones = append(milestones, Milestone{ID: "FORM_1A_AT_40", DueOn: d, RuleID: c.eff("WRN-TURNING-40")})
		}
		dates = &Dates{LLIssue: primary.LLFrom, DLTestUnlock: primary.DLTestUnlock, LLExpiresOn: primary.LLExpiresOn, EarliestLicence: primary.EarliestLicence}
		fq := primary.Fees
		fees = &fq
	}
	if milestones == nil {
		milestones = []Milestone{}
	}
	sort.SliceStable(milestones, func(i, j int) bool {
		if milestones[i].DueOn != milestones[j].DueOn {
			return milestones[i].DueOn < milestones[j].DueOn
		}
		return milestones[i].ID < milestones[j].ID
	})

	// 7. Saving (only for several classes on one LL; verified=false, D-25 row 9).
	var saving *Saving
	if primary != nil && len(primary.Classes) > 1 {
		n := len(primary.Classes)
		var perApp int64
		for _, it := range c.effectiveFeeItems() {
			if it.Per == "application" {
				perApp += it.Amount
			}
		}
		sr := c.ruleByID(c.eff("PLN-SAVING-IF-SEQUENTIAL"))
		saving = &Saving{
			ClassesOnOneLL: n, ApplicationsSaved: n - 1, WaitDaysSaved: minWait * (n - 1), FeeSavingPaise: perApp * int64(n-1),
			NoteKey: "plan.bundle.saves_if_sequential", Verified: sr.Verified, Confidence: sr.Confidence,
			RuleIDs: []string{"PLN-ONE-LL-MANY-CLASSES", "PLN-SAVING-IF-SEQUENTIAL"},
		}
		trace["PLN-SAVING-IF-SEQUENTIAL"] = true
	}

	trace[tmRule.ID], trace[fmtRule.ID], trace[dlRule.ID], trace[hptRule.ID] = true, true, true, true
	for id := range env.used {
		trace[id] = true
	}
	traceList := make([]string, 0, len(trace))
	for id := range trace {
		traceList = append(traceList, id)
	}
	sort.Strings(traceList)

	ageMin, ageMax := AgeOn(dobLatest, asOf), AgeOn(dobEarliest, asOf)
	return &Plan{
		RulePack: PackRef{PackID: c.PackID, Version: c.Version, BaseVersion: c.BaseVersion, FeesVersion: c.Fees.Version, ClassesVersion: c.Classes.Version, Partial: c.Partial, Hash: c.Hash},
		AsOf:     asOf.String(), State: c.PackID,
		Age:                AgeInfo{YearsMin: ageMin, YearsMax: ageMax, Band: ageBand(ageMin), DOBPrecision: prec},
		FamilyModeRequired: ageMin < 18 || familyMode,
		RequestedClasses:   requested, Classes: classes, Bundles: bundles, Saving: saving,
		Paths: paths, RecommendedPath: rec.PathID, Steps: steps, MaxRTOVisits: maxVisits,
		EarliestDates: dates, Fees: fees, Documents: documents,
		Blockers: blockers, Warnings: warnings, Notices: notices,
		LLTest: llTest, DLTest: dlTest, HPT: hpt, Offices: offices, Milestones: milestones, Trace: traceList,
	}, nil
}

func appliesTo(r *Rule, code string) bool {
	if len(r.AppliesTo) == 0 {
		return true
	}
	for _, c := range r.AppliesTo {
		if c == code {
			return true
		}
	}
	return false
}

func (c *Compiled) ruleByID(id string) *Rule {
	for _, r := range c.Rules {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// PrereqOut is a class prerequisite in the plan output.
type PrereqOut struct {
	ID       string `json:"id"`
	TextKey  string `json:"text_key"`
	Verified bool   `json:"verified"`
}
