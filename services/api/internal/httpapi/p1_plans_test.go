package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/rules"
)

func classByCode(plan map[string]any, code string) map[string]any {
	for _, c := range plan["classes"].([]any) {
		m := c.(map[string]any)
		if m["class_code"] == code {
			return m
		}
	}
	return nil
}

// MD-102 / MD-105: Kabir's 3-tap plan, fees from fees.json, provenance on every value.
func TestContractPlanKabirBikeAndCar(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2007-06-15", "vehicles": []string{"bike_gear", "car"},
		"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true, "aadhaar_mobile_linked": true, "language": "hi"})
	require.True(t, strings.HasPrefix(plan["plan_id"].(string), "pln_"))
	require.Equal(t, true, classByCode(plan, "MCWG")["eligible"])
	require.Equal(t, true, classByCode(plan, "LMV-NT")["eligible"])
	fees := plan["fees"].(map[string]any)
	// 2 classes: 15000*2 + 5000 + 30000*2 = 95000 LL stage; + 20000 DL issue = 115000; + 20000 card.
	require.EqualValues(t, 115000, fees["subtotal_govt_fee_paise"])
	require.EqualValues(t, 135000, fees["total_paise"])
	require.NotEmpty(t, fees["provenance"].(map[string]any)["source_title"])
	bundles := plan["bundles"].([]any)
	require.Len(t, bundles, 1, "both classes share one LL")
	require.Equal(t, []any{"MCWG", "LMV-NT"}, bundles[0].(map[string]any)["classes"])
	saving := plan["saving"].(map[string]any)
	require.EqualValues(t, 1, saving["applications_saved"])
	require.Equal(t, "plan.bundle.saves_if_sequential", saving["note_key"], "said only as if done one after the other (MD-105)")
	require.NotEmpty(t, plan["trace"])
	require.Equal(t, "2026-10-24", plan["as_of"], "server IST date (EC-15)")
	require.Equal(t, plan["quote_id"], fees["quote_id"])
	require.Equal(t, "18_25", plan["age_band"])

	// The snapshot is readable by its link and holds no DOB.
	r := c.do("GET", "/v1/plans/"+plan["plan_id"].(string), nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/plans/{planId}", r)
	var req []byte
	require.NoError(t, e.app.DB.Pool.QueryRow(t.Context(), `SELECT request::text::bytea FROM core.plans`).Scan(&req))
	require.NotContains(t, string(req), "2007-06-15")
	require.Equal(t, 1, e.count(`SELECT count(*) FROM core.plans WHERE dob_enc IS NOT NULL`))
	assertProblem(t, c.do("GET", "/v1/plans/pln_01JB8Z6X3V9Q2K7M4N5P6R7S8T", nil, nil), http.StatusNotFound, "NOT_FOUND")

	// Validation: no DOB, unknown state.
	assertProblem(t, c.do("POST", "/v1/plans", map[string]any{"state": "JK", "vehicles": []string{"car"}}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, c.do("POST", "/v1/plans", map[string]any{"state": "ZZ", "dob": "2000-01-01", "vehicles": []string{"car"}}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// EC-20: an Aadhaar-like value is refused before the engine sees it.
	assertProblem(t, c.do("POST", "/v1/plans", map[string]any{"state": "JK", "dob": "2000-01-01", "vehicles": []string{"car"}, "aadhaar_address_matches_residence": "234123412346"}, nil),
		http.StatusUnprocessableEntity, "VALIDATION_FAILED")
}

func TestContractRulesClassesFeesFormat(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/rules/JK/classes", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/rules/{state}/classes", r)
	var transport map[string]any
	for _, x := range r.json(t)["classes"].([]any) {
		if x.(map[string]any)["class_code"] == "LMV-TR" {
			transport = x.(map[string]any)
		}
	}
	require.EqualValues(t, 20, transport["min_age_years"])
	require.Equal(t, "always", transport["medical_form_1a"])
	require.Contains(t, transport["flags"], "verify_at_rto")
	etag := r.Header.Get("ETag")
	require.Equal(t, http.StatusNotModified, c.do("GET", "/v1/rules/JK/classes", nil, map[string]string{"If-None-Match": etag}).Status)

	r = c.do("GET", "/v1/rules/JK/fees?classes=MCWG", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/rules/{state}/fees", r)
	q := r.json(t)["quote"].(map[string]any)
	require.EqualValues(t, 70000, q["subtotal_govt_fee_paise"])
	require.EqualValues(t, 90000, q["total_paise"])

	r = c.do("GET", "/v1/rules/JK/ll-format", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/rules/{state}/ll-format", r)
	require.Equal(t, true, r.json(t)["online_test_available"])
	require.EqualValues(t, 10, r.json(t)["questions"])

	// Any supported pack can be read from the JK tenant; an unknown state is 404.
	require.Equal(t, http.StatusOK, c.do("GET", "/v1/rules/KL/classes", nil, map[string]string{"X-Tenant": ""}).Status)
	assertProblem(t, c.do("GET", "/v1/rules/ZZ/fees", nil, map[string]string{"X-Tenant": ""}), http.StatusNotFound, "NOT_FOUND")
}

// EC-10: Kerala has no online LL test: the plan says "test at the RTO".
func TestEC10KeralaLLTestAtRTO(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/rules/KL/ll-format", nil, map[string]string{"X-Tenant": ""})
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/rules/{state}/ll-format", r)
	require.Equal(t, false, r.json(t)["online_test_available"])
	plan := c.plan(t, map[string]any{"state": "KL", "dob": "2000-05-05", "vehicles": []string{"bike_gear"}})
	lt := plan["ll_test"].(map[string]any)
	require.Equal(t, false, lt["online_available"])
	require.Equal(t, "rto", lt["mode"])
}

// EC-01: a year-only DOB asks for a DOB document; eligibility uses 31 Dec (latest plausible).
func TestEC01YearOnlyDOB(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2008-06-01", "dob_precision": "year_only", "vehicles": []string{"bike_gear"}})
	require.True(t, issueRefs(plan)["EC-01"], "BLK-DOB-YEAR-ONLY: %v", plan["blockers"])
	m := classByCode(plan, "MCWG")
	require.Equal(t, false, m["eligible"], "17 by 31 Dec 2008: not yet")
	require.Equal(t, "2026-12-31", m["eligible_from"])
	require.Equal(t, "year", plan["age"].(map[string]any)["dob_precision"])
}

// EC-02 / EC-03: Tanvi's two blockers with fixes, sources and the non-Aadhaar path.
func TestEC02EC03TanviBlockers(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("tanvi.test@example.com")
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2007-02-20", "vehicles": []string{"scooter"},
		"aadhaar_address_matches_residence": false, "aadhaar_has_relation_line": false})
	ids := issueRefs(plan)
	require.True(t, ids["EC-02"] && ids["EC-03"], "%v", plan["warnings"])
	require.Equal(t, "non_aadhaar", plan["recommended_path"])
	for _, m := range issues(plan) {
		refs := m["refs"].([]any)
		if contains(refs, "EC-02") || contains(refs, "EC-03") {
			require.NotEmpty(t, m["fix_key"])
			require.NotEmpty(t, m["provenance"].(map[string]any)["source_title"])
		}
		if contains(refs, "EC-03") {
			require.Equal(t, true, m["verify_at_rto"], "relation-line row is verified=false")
		}
	}
	cs := c.newCase(t, map[string]any{"plan_id": plan["plan_id"], "classes": []string{"MCWOG"}, "path": "non_aadhaar_rto"})
	r := c.do("GET", "/v1/cases/"+cs["case_id"].(string)+"/blockers", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/cases/{caseId}/blockers", r)
	body := r.json(t)
	require.Equal(t, "has_blockers", body["status"])
	ids = blockerIDs(body["blockers"])
	require.True(t, ids["EC-02"] && ids["EC-03"])
}

// MD-106: unknown inputs give "we can't tell yet", never "no blockers".
func TestBlockersCantTellYet(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("unknown.facts@example.com")
	cs := c.newCase(t, map[string]any{"state": "JK", "classes": []string{"MCWG"}})
	r := c.do("GET", "/v1/cases/"+cs["case_id"].(string)+"/blockers", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/cases/{caseId}/blockers", r)
	require.Equal(t, "cant_tell_yet", r.json(t)["status"])
	require.Contains(t, r.json(t)["unknown_inputs"], "dob")
}

// EC-04: turning 40 between the LL and the DL adds Form 1A to the DL step only, and a dated
// FORM_1A_AT_40 milestone to the case clock.
func TestEC04TurningFortyMidJourney(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("turning.forty@example.com")
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "1987-01-12", "vehicles": []string{"car"},
		"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true})
	found := false
	for _, m := range issues(plan) {
		if contains(m["refs"].([]any), "EC-04") && m["severity"] == "warning" {
			found = true
			require.Equal(t, "2027-01-12", m["due_on"])
		}
	}
	require.True(t, found, "%v", plan["warnings"])
	for _, d := range plan["documents"].([]any) {
		m := d.(map[string]any)
		if m["doc_id"] == "form_1a_medical" {
			require.Equal(t, "DL", m["stage"], "Form 1A on the DL step only")
			require.Equal(t, false, m["required"])
		}
	}
	cs := c.newCase(t, map[string]any{"plan_id": plan["plan_id"], "classes": []string{"LMV-NT"}})
	require.Equal(t, "2027-01-12", cs["key_dates"].(map[string]any)["turns_40_on"])
	r := c.event(t, cs["case_id"].(string), map[string]any{"type": "ll_issued", "occurred_on": "2026-10-24"})
	require.Equal(t, http.StatusCreated, r.Status, "%s", r.Body)
	r = c.do("GET", "/v1/cases/"+cs["case_id"].(string)+"/timeline?limit=50", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	require.Contains(t, string(r.Body), "FORM_1A_AT_40")
}

// EC-05 (P-07 Rahul): at 17 only MC50CC, inside a parent's account with parental consent.
func TestEC05MinorFamilyMode(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("rahul.parent.test@example.com")
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2009-03-14", "vehicles": []string{"scooter_50cc", "scooter"}})
	require.Equal(t, true, plan["family_mode_required"])
	require.Equal(t, true, classByCode(plan, "MC50CC")["eligible"])
	scooter := classByCode(plan, "MCWOG")
	require.Equal(t, false, scooter["eligible"])
	require.Equal(t, "2027-03-14", scooter["eligible_from"])

	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	member := r.json(t)["member_id"].(string)
	body := map[string]any{"plan_id": plan["plan_id"], "classes": []string{"MC50CC"}, "for_family_member": true, "family_member_id": member}
	assertProblem(t, c.do("POST", "/v1/cases", body, idem()), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	r = c.do("POST", "/v1/me/family-members/"+member+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	cs := c.newCase(t, body)
	require.Contains(t, cs["flags"], "for_minor_family_member")
	require.Equal(t, member, cs["family_member_id"])
	// MC50CC + a car at 17 is refused on one case (EC-21: the car goes on a later LL).
	assertProblem(t, c.do("POST", "/v1/cases", map[string]any{"plan_id": plan["plan_id"], "classes": []string{"LMV-NT"}, "family_member_id": member}, idem()),
		http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// Revoking parental consent stops every use of the case at once (MD-133).
	r = c.do("POST", "/v1/me/family-members/"+member+"/parental-consent", map[string]any{"action": "revoke", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Equal(t, http.StatusCreated, r.Status)
	assertProblem(t, c.do("GET", "/v1/cases/"+cs["case_id"].(string), nil, nil), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
}

// EC-06: transport classes need 20; the LMV prerequisite row carries a verify flag.
func TestEC06TransportUnderTwenty(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	at19 := c.plan(t, map[string]any{"state": "JK", "dob": "2007-01-01", "classes": []string{"LMV-TR"}})
	require.Equal(t, false, classByCode(at19, "LMV-TR")["eligible"])
	require.Equal(t, "2027-01-01", classByCode(at19, "LMV-TR")["eligible_from"])
	at20 := c.plan(t, map[string]any{"state": "JK", "dob": "2006-01-01", "classes": []string{"LMV-TR"}})
	tr := classByCode(at20, "LMV-TR")
	require.Equal(t, true, tr["eligible"])
	require.Equal(t, true, tr["verify_at_rto"])
}

// EC-21: two classes with different ages split into two LLs with dates.
func TestEC21TwoClassesDifferentAges(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2009-03-14", "classes": []string{"MC50CC", "LMV-NT"}})
	bundles := plan["bundles"].([]any)
	require.Len(t, bundles, 2)
	require.Equal(t, []any{"MC50CC"}, bundles[0].(map[string]any)["classes"])
	second := bundles[1].(map[string]any)
	require.Equal(t, []any{"LMV-NT"}, second["classes"])
	require.Equal(t, "2027-03-14", second["ll_from"])
	require.Nil(t, plan["saving"], "no shared-LL saving across two LLs")
}

func issues(plan map[string]any) []map[string]any {
	var out []map[string]any
	for _, k := range []string{"blockers", "warnings", "notices"} {
		for _, x := range plan[k].([]any) {
			out = append(out, x.(map[string]any))
		}
	}
	return out
}

func issueRefs(plan map[string]any) map[string]bool {
	out := map[string]bool{}
	for _, m := range issues(plan) {
		for _, r := range m["refs"].([]any) {
			out[r.(string)] = true
		}
	}
	return out
}

func contains(list []any, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// Alignment with the web app (FE-journey): API-01 returns the engine's Plan unchanged (plus the
// snapshot fields), dob_precision accepts the engine's "year", the form's Aadhaar answer keys
// become case facts, and a weak If-Match W/"0" is a 412, not a 400.
func TestFrontendAlignment(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("fe.align@example.com")
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "2007-12-31", "dob_precision": "year", "vehicles": []string{"bike_gear", "e_cart", "goods_medium"}})
	want, err := e.app.Rules.Plan(rules.Input{AsOf: "2026-10-24", State: "JK", DOB: "2007", DOBPrecision: "year", Vehicles: []string{"bike_gear", "e_cart", "goods_medium"}})
	require.NoError(t, err)
	wantJSON, _ := json.Marshal(want)
	var wantMap map[string]any
	require.NoError(t, json.Unmarshal(wantJSON, &wantMap))
	for _, k := range []string{"plan_id", "quote_id", "expires_at", "age_band"} {
		delete(plan, k)
	}
	delete(plan["fees"].(map[string]any), "quote_id")
	require.Equal(t, wantMap, plan, "API-01 is the engine Plan, byte for byte")

	cs := c.newCase(t, map[string]any{"state": "JK", "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	r := c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"aadhaar_address_match": "no", "aadhaar_relation_line": "yes", "for_whom": "self"}},
		map[string]string{"If-Match": `W/"` + itoa(int(cs["version"].(float64))) + `"`, "Content-Type": "application/merge-patch+json"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	v := r.json(t)
	require.Equal(t, false, v["facts"].(map[string]any)["aadhaar_address_matches_residence"])
	require.Equal(t, true, v["facts"].(map[string]any)["aadhaar_has_relation_line"])
	require.NotContains(t, v["answers"], "aadhaar_address_match")
	require.Equal(t, "self", v["answers"].(map[string]any)["for_whom"])
	assertProblem(t, c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"aadhaar_address_match": "234123412346"}}, map[string]string{"If-Match": `W/"0"`}),
		http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"district": "Jammu"}}, map[string]string{"If-Match": `W/"0"`}),
		http.StatusPreconditionFailed, "PRECONDITION_FAILED")
}
