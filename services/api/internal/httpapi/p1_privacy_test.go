package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// API-61 (MD-134): the export holds every row tied to the account and nothing else.
func TestExportContainsOnlyMyRows(t *testing.T) {
	e := newEnv(t)
	a, caseA := kabirOnLL(t, e, "export.a@example.com", "2026-10-24", "email_updates")
	b0, caseB := kabirOnLL(t, e, "export.b@example.com", "2026-10-24")
	// P2 rows for A (the account and a family member) and for B (games, learning, study,
	// declarations, a shared squad).
	appA, appB := meApplicant(t, a), meApplicant(t, b0)
	memberA := addMinor(t, a)
	p2SeedRows(t, e, appA, nil, "rows-of-a", e.clock.Now())
	p2SeedRows(t, e, appA, &memberA, "rows-of-a-minor", e.clock.Now())
	p2SeedRows(t, e, appB, nil, "rows-of-b", e.clock.Now())
	insertSquad(t, e, "Kerala Riders", appA, appB)
	codeA, codeB := studyEnrolUser(t, a), studyEnrolUser(t, b0)
	r := a.do("POST", "/v1/me/export", nil, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/export", r)
	link := r.json(t)["download_url"].(string)
	r = a.do("GET", link, nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me/exports/{exportId}", r)
	body := string(r.Body)
	require.Contains(t, body, caseA)
	require.NotContains(t, body, caseB)
	require.Contains(t, body, "export.a@example.com", "the person's own contact is in their export")
	require.NotContains(t, body, "export.b@example.com")
	var bundle map[string]any
	require.NoError(t, json.Unmarshal(r.Body, &bundle))
	sections := bundle["sections"].(map[string]any)
	for _, k := range []string{"profile", "contacts", "consents", "family_members", "cases", "plans", "notifications", "payment_intents"} {
		require.Contains(t, sections, k)
	}
	for _, k := range []string{"game", "learning", "study", "declarations"} {
		require.Contains(t, sections, k)
	}
	game := sections["game"].(map[string]any)
	for _, k := range []string{"sessions", "clip_exposures", "staircase", "xp_ledger", "streaks", "badges", "share_cards"} {
		require.Lenf(t, game[k], 2, "game.%s: the account's row and the family member's", k)
	}
	learning := sections["learning"].(map[string]any)
	for _, k := range []string{"answers", "review_log", "card_state", "topic_mastery", "readiness_snapshots"} {
		require.Lenf(t, learning[k], 2, "learn.%s", k)
	}
	require.Len(t, sections["declarations"], 2)
	require.Len(t, game["squads"], 1, "the own membership only")
	require.Contains(t, body, "Kerala Riders-ma")
	require.NotContains(t, body, "Kerala Riders-mb", "another member's display name is not in my export")
	require.Contains(t, body, "ans-rows-of-a-minor")
	require.Contains(t, body, ids.Encode(ids.FamilyMember, memberA), "family-member rows carry the fam_ ID")
	require.Contains(t, body, "shc_"+strings.ToUpper(shortIDFor("rows-of-a")))
	require.NotContains(t, body, "rows-of-b")
	require.NotContains(t, body, shortIDFor("rows-of-b"))
	require.Contains(t, body, `"participant_code":"`+codeA+`"`)
	require.NotContains(t, body, `"participant_code":"`+codeB+`"`)
	require.Len(t, sections["cases"], 1)
	require.NotEmpty(t, sections["cases"].([]any)[0].(map[string]any)["events"])
	// Another account cannot read it; the link expires after 24 h.
	b := e.userClient("export.c@example.com")
	assertProblem(t, b.do("GET", link, nil, nil), http.StatusNotFound, "NOT_FOUND")
	e.clock.Advance(25 * time.Hour)
	r = a.do("GET", link, nil, nil)
	require.Equal(t, http.StatusGone, r.Status)
	assertContract(t, "GET", "/v1/me/exports/{exportId}", r)
	// The bundle is stored encrypted.
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.exports WHERE position('export.a' in encode(bundle_enc, 'escape')) > 0`))
}

// MD-136: allowlisted names and props only; dropped without consent and for a minor's case.
func TestAnalyticsAllowlistConsentAndMinors(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("analytics@example.com")
	ev := func(name string, props map[string]any) map[string]any {
		return map[string]any{"events": []any{map[string]any{"name": name, "at": "2026-10-24T04:00:00Z", "props": props}}}
	}
	// No consent: accepted and silently dropped.
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/events/analytics", ev("plan_started", nil), nil).Status)
	require.Equal(t, 0, e.count(`SELECT count(*) FROM ops.analytics_events`))
	c.grant(t, "analytics")
	r := c.do("POST", "/v1/events/analytics", ev("plan_viewed", map[string]any{"classes_count": 2, "min_confidence": "low", "stage": "S1"}), nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/events/analytics", r)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM ops.analytics_events WHERE day = '2026-10-24'`))
	// Unknown names, properties, free text and identifiers are rejected.
	for _, bad := range []map[string]any{
		ev("made_up_event", nil),
		ev("plan_viewed", map[string]any{"email": "x@example.com"}),
		ev("home_tile_tapped", map[string]any{"tile": "something else"}),
		ev("blocker_shown", map[string]any{"rule_id": "call me on 9876543210"}),
	} {
		r = c.do("POST", "/v1/events/analytics", bad, nil)
		assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
		assertContract(t, "POST", "/v1/events/analytics", r)
	}
	// Events about a minor family member's case are dropped (D-13 revised).
	r = c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	member := r.json(t)["member_id"].(string)
	c.do("POST", "/v1/me/family-members/"+member+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi"}, nil)
	cs := c.newCase(t, map[string]any{"state": "JK", "classes": []string{"MC50CC"}, "family_member_id": member})
	body := ev("plan_started", nil)
	body["case_id"] = cs["case_id"]
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/events/analytics", body, nil).Status)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM ops.analytics_events`))
	// No identifiers stored: the pseudonym is not the applicant id.
	require.Equal(t, 0, e.count(`SELECT count(*) FROM ops.analytics_events WHERE props::text LIKE '%usr_%' OR props::text LIKE '%cas_%'`))
}

// MD-141 / W13: the digest suppresses every cell with n < 5 and is publishable only when
// something survives suppression; signed GET with an empty body.
func TestAnalyticsDigestKAnonymity(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 6; i++ {
		c := e.userClient(fmt.Sprintf("digest%d@example.com", i))
		c.grant(t, "analytics")
		require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/events/analytics", map[string]any{"events": []any{
			map[string]any{"name": "plan_viewed", "at": "2026-10-24T04:00:00Z"}}}, nil).Status)
		if i < 2 {
			require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/events/analytics", map[string]any{"events": []any{
				map[string]any{"name": "handoff_opened", "at": "2026-10-24T04:00:00Z", "props": map[string]any{"mode": "A"}}}}, nil).Status)
		}
	}
	r := e.internalGet("/internal/analytics/digest?period=day")
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/internal/analytics/digest", r)
	d := r.json(t)
	require.Equal(t, true, d["publishable"])
	require.EqualValues(t, 5, d["k_min"])
	cells := map[string]any{}
	for _, s := range d["sections"].([]any) {
		for _, row := range s.(map[string]any)["rows"].([]any) {
			m := row.(map[string]any)
			cells[m["label"].(string)] = m["value"]
		}
	}
	require.EqualValues(t, 6, cells["plan_viewed"])
	require.Equal(t, "suppressed (n < 5)", cells["handoff_opened"])
	require.Greater(t, d["suppressed_cells"].(float64), 0.0)
	require.NotContains(t, string(r.Body), "@example.com")
	// The same signature on another path is not a replay (replay cache keyed on method + path).
	r2 := e.internalGet("/internal/analytics/digest?period=week")
	require.Equal(t, http.StatusOK, r2.Status)
	require.Equal(t, http.StatusUnauthorized, e.internalGet("/internal/analytics/digest?period=week").Status, "a real replay is rejected")
}

// MD-137: the retention job deletes exactly the expired rows (time travel).
func TestRetentionTimeTravel(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	old := kabirPlan(t, c)
	e.clock.Advance(6 * 24 * time.Hour)
	fresh := kabirPlan(t, c)
	u := e.userClient("retention@example.com")
	cs := u.newCase(t, map[string]any{"plan_id": kabirPlan(t, u)["plan_id"], "classes": []string{"MCWG"}})
	require.Equal(t, http.StatusNoContent, u.do("DELETE", "/v1/cases/"+cs["case_id"].(string), nil, nil).Status)
	e.clock.Advance(2 * 24 * time.Hour) // the old plan is 8 days old, the fresh one 2
	r := e.step("retention.sweep", map[string]any{})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.EqualValues(t, 1, r.json(t)["plans"])
	require.EqualValues(t, 0, r.json(t)["cases"], "a deleted case is kept 30 days")
	oldID, _ := ids.Decode(ids.Plan, old["plan_id"].(string))
	freshID, _ := ids.Decode(ids.Plan, fresh["plan_id"].(string))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.plans WHERE plan_id = $1`, oldID))
	require.Equal(t, 1, e.count(`SELECT count(*) FROM core.plans WHERE plan_id = $1`, freshID))
	e.clock.Advance(31 * 24 * time.Hour)
	r = e.step("retention.sweep", map[string]any{})
	require.EqualValues(t, 1, r.json(t)["cases"], "hard delete after 30 days")
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.case_events`), "events go with the case")
	// The retention job is also an allow-listed job for n8n (API-67).
	e.clock.Advance(time.Second)
	r = e.internal("/internal/jobs/retention_sweep", map[string]any{"args": map[string]any{}}, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/jobs/{job}", r)
}

// API-70 / API-71: token-gated lab trials with a field_study consent; public counters with
// per-arm suppression.
func TestLabTrialsAndPublicStats(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("lab@example.com")
	r := c.do("POST", "/v1/me/consents", map[string]any{"purpose": "field_study", "action": "grant", "notice_version": "notice-study-v1"}, nil)
	require.Equal(t, http.StatusCreated, r.Status)
	consent := r.json(t)["consent_id"].(string)
	trial := map[string]any{"participant_code": "P-017", "arm": "margdarshak", "task_id": "find_fee_and_documents", "started_at": "2026-10-24T03:00:00Z",
		"ended_at": "2026-10-24T03:01:12Z", "errors": 0, "completed": true, "sus_score": 82.5, "would_pay_agent": false, "consent_id": consent,
		"screens_visited": 6, "back_navigations": 1, "validation_errors": 0, "selections": []string{"class:MCWG"}}
	assertProblem(t, c.do("POST", "/v1/lab/trials", trial, idem()), http.StatusNotFound, "NOT_FOUND")
	r = c.do("POST", "/v1/lab/trials", trial, map[string]string{"X-Lab-Token": "test-lab-token"})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/lab/trials", r)
	require.True(t, strings.HasPrefix(r.json(t)["trial_id"].(string), "trl_"))
	bad := map[string]any{}
	for k, v := range trial {
		bad[k] = v
	}
	bad["participant_code"] = "Rahul"
	assertProblem(t, c.do("POST", "/v1/lab/trials", bad, map[string]string{"X-Lab-Token": "test-lab-token"}), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	r = e.client().do("GET", "/v1/stats/public", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/stats/public", r)
	s := r.json(t)
	require.EqualValues(t, 1, s["counters"].(map[string]any)["lab_trials_recorded"])
	require.Equal(t, "suppressed (n < 5)", s["journey_test"].(map[string]any)["median_seconds_find_fee_docs"].(map[string]any)["margdarshak"])
}

// MD-122 / MD-054: the persona switcher signs in as each synthetic persona, re-seeded relative to
// server today, and lands on the documented stage.
func TestDemoPersonaSwitcher(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/demo/personas", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/demo/personas", r)
	require.Len(t, r.json(t)["items"], 8)
	want := map[string]struct {
		state, action string
		blockers      []string
	}{
		"kabir_new":   {"", "", nil},
		"kabir_day12": {"BRIDGE", "PRACTISE_NAZAR", nil},
		"kabir_day31": {"DL_BOOKABLE", "BOOK_TEST", nil},
		"tanvi":       {"PLAN", "RESUME_STEP", []string{"EC-02", "EC-03"}},
		"mohan":       {"RENEWAL_DUE", "RENEW", []string{"EC-04"}},
		"rahul":       {"PLAN", "RESUME_STEP", nil},
		"dl_holder":   {"DL_HOLDER", "SHOW_CARD", nil},
	}
	for persona, w := range want {
		p := e.client()
		r = p.do("POST", "/v1/demo/personas/"+persona+"/session", nil, map[string]string{"Prefer": "return=token"})
		require.Equalf(t, http.StatusCreated, r.Status, "%s: %s", persona, r.Body)
		assertContract(t, "POST", "/v1/demo/personas/{personaId}/session", r)
		r = p.do("GET", "/v1/me/licences", nil, nil)
		require.Equal(t, http.StatusOK, r.Status)
		items := r.json(t)["items"].([]any)
		if w.state == "" {
			require.Empty(t, items, persona)
			continue
		}
		require.Len(t, items, 1, persona)
		id := items[0].(map[string]any)["case_id"].(string)
		v := p.getCase(t, id)
		require.Equal(t, w.state, v["state"], persona)
		require.Equal(t, w.action, v["next_action"].(map[string]any)["action_id"], persona)
		if persona == "rahul" {
			require.Contains(t, v["flags"], "for_minor_family_member")
		}
		if persona == "dl_holder" {
			require.Equal(t, true, r.json(t)["show_dl_holder_view"])
			require.Equal(t, "S8", v["stage"])
		}
		if len(w.blockers) > 0 {
			br := p.do("GET", "/v1/cases/"+id+"/blockers", nil, nil)
			got := blockerIDs(br.json(t)["blockers"])
			for _, b := range w.blockers {
				require.Truef(t, got[b], "%s: %s missing in %s", persona, b, br.Body)
			}
		}
	}
	// Switching again re-seeds (idempotent) and the day stays right.
	p := e.client()
	require.Equal(t, http.StatusCreated, p.do("POST", "/v1/demo/personas/kabir_day12/session", nil, nil).Status)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM core.cases WHERE applicant_id = $1`, idFor(t, e, "kabir-day12")))
	// Not offered on a tenant without the flag.
	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE core.tenants SET features = features - 'persona_switcher' WHERE tenant_id = 'JK'`)
		return err
	}))
	e.app.Tenants.Invalidate()
	assertProblem(t, c.do("GET", "/v1/demo/personas", nil, nil), http.StatusNotFound, "NOT_FOUND")
	_ = store.ErrNotFound
}

func idFor(t *testing.T, e *env, key string) any {
	return ids.Deterministic("JK:persona:" + key)
}
