package httpapi_test

import (
	"encoding/hex"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// kabirOnLL creates a signed-in user with a case whose LL was issued on issuedOn.
func kabirOnLL(t *testing.T, e *env, email, issuedOn string, consents ...string) (*client, string) {
	c := e.userClient(email)
	for _, p := range consents {
		c.grant(t, p)
	}
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	r := c.event(t, id, map[string]any{"type": "ll_issued", "occurred_on": issuedOn})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	return c, id
}

func (e *env) planPages(t *testing.T) []string {
	t.Helper()
	var keys []string
	var cursor any
	for {
		r := e.step("clock.plan_pages", map[string]any{"sweep_id": "sweep-test", "tenants": []string{"JK"}, "as_of": nil, "after": cursor, "limit": 2})
		require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
		assertContract(t, "POST", "/internal/job-steps/{step}", r)
		body := r.json(t)
		for _, ev := range body["events"].([]any) {
			m := ev.(map[string]any)
			keys = append(keys, fmt.Sprintf("%s:%s:%s", m["case_id"], m["type"], m["due_on"]))
		}
		require.Equal(t, body["as_of"], body["result"].(map[string]any)["as_of"], "result is mirrored at the top level")
		cursor = body["next_cursor"]
		if cursor == nil {
			return keys
		}
	}
}

func (e *env) fire(t *testing.T, keys []string) map[string]any {
	t.Helper()
	r := e.step("clock.fire_batch", map[string]any{"sweep_id": "sweep-test", "as_of": nil, "page": 0, "event_keys": keys})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/job-steps/{step}", r)
	return r.json(t)
}

// MD-126: clock.plan_pages / clock.fire_batch per the Workflows contract; firing is idempotent
// per caseId:type:dueOn, so a second sweep (or a retried batch) sends nothing twice. The day-30
// milestone also moves the case to DL_BOOKABLE.
func TestClockStepsIdempotentPerEventKey(t *testing.T) {
	e := newEnv(t)
	c, id := kabirOnLL(t, e, "sweep@example.com", "2026-10-24", "email_updates")
	e.clock.Set(ist(2026, 11, 18, 8, 0)) // day 25 at 08:00 IST
	keys := e.planPages(t)
	require.Equal(t, []string{id + ":LL_DAY_25_PREP:2026-11-18"}, keys)
	res := e.fire(t, keys)
	require.EqualValues(t, 1, res["fired"])
	again := e.fire(t, keys)
	require.EqualValues(t, 0, again["fired"])
	require.EqualValues(t, 1, again["already_fired"])
	require.Empty(t, e.planPages(t), "a fired event is not planned again")
	require.Equal(t, 1, e.count(`SELECT count(*) FROM msg.notifications WHERE kind = 'nudge'`))
	nudges := 0
	for _, m := range e.email.msgs {
		if m.TemplateID == "ll_day_25_prep_v1" {
			nudges++
		}
	}
	require.Equal(t, 1, nudges, "one e-mail nudge")

	e.clock.Set(ist(2026, 11, 23, 8, 15))
	keys = e.planPages(t)
	require.Equal(t, []string{id + ":LL_DAY_30_UNLOCK:2026-11-23"}, keys)
	require.EqualValues(t, 1, e.fire(t, keys)["fired"])
	var state string
	require.NoError(t, e.app.DB.Pool.QueryRow(t.Context(), `SELECT state FROM core.cases`).Scan(&state))
	require.Equal(t, "DL_BOOKABLE", state)
	require.Equal(t, "BOOK_TEST", c.getCase(t, id)["next_action"].(map[string]any)["action_id"])

	// Unknown / malformed keys are counted, not fatal; a caller as_of in the future is ignored.
	res = e.fire(t, []string{"cas_01JB8Z6X3V9Q2K7M4N5P6R7S8T:LL_EXPIRY:2027-01-01", "not-a-key"})
	require.EqualValues(t, 2, res["failed"])
	r := e.step("clock.plan_pages", map[string]any{"as_of": "2031-01-01", "limit": 10})
	require.Equal(t, "2026-11-23", r.json(t)["as_of"])
	// The legacy count step still answers.
	r = e.step("clock.due_page", map[string]any{"tenants": []string{"JK"}})
	require.Equal(t, http.StatusOK, r.Status)
}

// API-65 -> case_clock_sweep (inline runner): the same steps; a second run the same day is a replay.
func TestClockSweepThroughAPI65(t *testing.T) {
	e := newEnv(t)
	_, _ = kabirOnLL(t, e, "api65@example.com", "2026-10-24", "email_updates")
	e.clock.Set(ist(2026, 11, 18, 8, 0))
	r := e.internal("/internal/clock/sweep", map[string]any{"sweep_id": "sweep-2026-11-18-0800", "as_of": "2026-11-18T02:30:00Z"}, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	require.Eventually(t, func() bool {
		return e.count(`SELECT count(*) FROM ops.job_runs WHERE job = 'case_clock_sweep' AND status = 'succeeded'`) == 1
	}, 10*time.Second, 50*time.Millisecond)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM msg.notifications WHERE kind = 'nudge'`))
	e.clock.Advance(time.Minute)
	r = e.internal("/internal/clock/sweep", map[string]any{"sweep_id": "sweep-2026-11-18-0800", "as_of": "2026-11-18T02:30:00Z"}, nil)
	require.Equal(t, true, r.json(t)["idempotent_replay"])
	var result string
	require.NoError(t, e.app.DB.Pool.QueryRow(t.Context(), `SELECT result::text FROM ops.job_runs WHERE job = 'case_clock_sweep'`).Scan(&result))
	require.Contains(t, result, `"fired": 1`)
}

// MD-130: at most one nudge per account per IST day (property test across random schedules) and
// no nudge in quiet hours (21:00-08:00 IST).
func TestNudgeLimitsAndQuietHours(t *testing.T) {
	e := newEnv(t)
	rng := rand.New(rand.NewPCG(7, 13))
	var users []*client
	for i := 0; i < 3; i++ {
		c := e.userClient(fmt.Sprintf("nudge%d@example.com", i))
		c.grant(t, "email_updates")
		users = append(users, c)
		// Several cases per account, each with a different LL date: many reminders collide.
		classes := []string{"MCWG", "LMV-NT", "MC50CC"}
		for j := 0; j < 1+rng.IntN(2); j++ {
			cs := c.newCase(t, map[string]any{"state": "JK", "classes": []string{classes[j]}})
			day := 20 + rng.IntN(5)
			r := c.event(t, cs["case_id"].(string), map[string]any{"type": "ll_issued", "occurred_on": fmt.Sprintf("2026-10-%02d", day)})
			require.Equal(t, http.StatusCreated, r.Status)
		}
	}
	// Quiet hours: 22:30 IST nothing is sent, everything stays scheduled.
	e.clock.Set(ist(2026, 11, 20, 22, 30))
	res := e.fire(t, e.planPages(t))
	require.EqualValues(t, 0, res["fired"])
	require.Greater(t, res["deferred_quiet_hours"].(float64), 0.0)
	// Daily sweeps for three weeks at 08:00 IST.
	for d := 0; d < 21; d++ {
		e.clock.Set(ist(2026, 11, 13, 8, 0).AddDate(0, 0, d))
		keys := e.planPages(t)
		if len(keys) > 0 {
			e.fire(t, keys)
		}
	}
	require.Equal(t, 0, e.count(`SELECT count(*) FROM (SELECT applicant_id, nudge_day FROM msg.notifications WHERE kind = 'nudge'
		GROUP BY 1, 2 HAVING count(*) > 1) x`), "no account got 2 nudges on one day")
	require.Greater(t, e.count(`SELECT count(*) FROM msg.notifications WHERE kind = 'nudge'`), 3)
	_ = users
}

// API-04 (MD-104) + W02 envelope (MD-128): the plan card goes to n8n as a signed envelope
// {ts, payload, sig: sha256=<hex>} with the template ID and vars only; without consent nothing
// is stored and the wa.me link is the fallback.
func TestPlanToWhatsAppAndW02Envelope(t *testing.T) {
	e, n8n := newEnvN8n(t)
	c := e.deviceClient()
	plan := kabirPlan(t, c)
	pid := plan["plan_id"].(string)
	body := map[string]any{"phone_e164": "+919876543210", "consent": map[string]any{"purpose": "whatsapp_updates", "notice_version": "notice-2026.10.23-hi", "granted": false}}
	r := c.do("POST", "/v1/plans/"+pid+"/whatsapp", body, idem())
	assertProblem(t, r, http.StatusForbidden, "CONSENT_REQUIRED")
	require.Contains(t, string(r.Body), "wa.me")
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.contacts WHERE kind = 'phone'`))

	body["consent"].(map[string]any)["granted"] = true
	body["language"] = "hi"
	r = c.do("POST", "/v1/plans/"+pid+"/whatsapp", body, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/plans/{planId}/whatsapp", r)
	out := r.json(t)
	require.Equal(t, "plan_card_v1", out["template_id"])
	require.Equal(t, "queued", out["status"])
	require.Contains(t, out["share_url"], "https://wa.me/?text=")
	require.Equal(t, true, out["test_number"])
	msgs := n8n.messages()
	require.Len(t, msgs, 1)
	require.Equal(t, "whatsapp", msgs[0].Channel)
	require.Equal(t, "9876543210", msgs[0].To)
	require.Equal(t, "hi", msgs[0].Lang)
	require.Equal(t, out["notification_id"], msgs[0].NotificationID)
	require.Equal(t, "test-webhook-token", n8n.tokens[0])
	require.Equal(t, 1, e.count(`SELECT count(*) FROM privacy.consent_artefacts WHERE purpose = 'whatsapp_updates' AND revoked_at IS NULL`))
	var enc []byte
	require.NoError(t, e.app.DB.Pool.QueryRow(t.Context(), `SELECT value_enc FROM privacy.contacts WHERE kind = 'phone'`).Scan(&enc))
	require.NotContains(t, string(enc), "9876543210", "E-14 encrypted")
	require.NotContains(t, e.logs.String(), "9876543210")

	// W02 receipts (batched) move E-13 forward; the 24 h seen check asks for a fallback only
	// when another opted-in channel exists.
	e.clock.Advance(time.Second)
	r = e.internal("/internal/webhooks/n8n", map[string]any{"event": "delivery_receipt", "at": e.clock.Now().UTC().Format(time.RFC3339), "workflow": "W02",
		"execution_id": "77", "receipts": []any{map[string]any{"notification_id": out["notification_id"], "status": "delivered", "channel": "whatsapp", "provider_message_id": "wamid.1"}}}, nil)
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM msg.notifications WHERE status = 'delivered'`))
	r = e.internal("/internal/notifications/seen", map[string]any{"notification_ids": []any{out["notification_id"]}}, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/notifications/seen", r)
	require.Equal(t, "none", r.json(t)["results"].([]any)[0].(map[string]any)["action"], "a device has no e-mail channel")
}

// MD-129 + W02: an unseen WhatsApp nudge falls back to e-mail when the backend says so.
func TestW02SeenAndFallbackToEmail(t *testing.T) {
	e, n8n := newEnvN8n(t)
	c, id := kabirOnLL(t, e, "fallback@example.com", "2026-10-24", "email_updates")
	pid := kabirPlan(t, c)["plan_id"].(string)
	r := c.do("POST", "/v1/plans/"+pid+"/whatsapp", map[string]any{"phone_e164": "+919812345678",
		"consent": map[string]any{"purpose": "whatsapp_updates", "notice_version": "notice-2026.10.23-en", "granted": true}}, idem())
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	e.clock.Set(ist(2026, 11, 18, 8, 0))
	res := e.fire(t, e.planPages(t))
	require.EqualValues(t, 1, res["fired"])
	var nudge string
	for _, m := range n8n.messages() {
		if m.TemplateID == "ll_day_25_prep_v1" {
			nudge = m.NotificationID
			require.Equal(t, id+":LL_DAY_25_PREP:2026-11-18:whatsapp", m.IdempotencyKey)
		}
	}
	require.NotEmpty(t, nudge, "WhatsApp is the preferred channel")
	before := len(e.email.msgs)
	e.clock.Advance(24 * time.Hour)
	r = e.internal("/internal/notifications/seen", map[string]any{"notification_ids": []any{nudge}}, nil)
	require.Equal(t, "request_fallback", r.json(t)["results"].([]any)[0].(map[string]any)["action"])
	e.clock.Advance(time.Second)
	r = e.internal("/internal/webhooks/n8n", map[string]any{"event": "request_fallback", "at": e.clock.Now().UTC().Format(time.RFC3339), "workflow": "W02",
		"notification_ids": []any{nudge}}, nil)
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	require.Len(t, e.email.msgs, before+1)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM msg.notifications WHERE kind = 'fallback' AND channel = 'email'`))
	// Fallback is idempotent and the seen check stops offering it.
	r = e.internal("/internal/notifications/seen", map[string]any{"notification_ids": []any{nudge}}, nil)
	require.Equal(t, "none", r.json(t)["results"].([]any)[0].(map[string]any)["action"])
}

// EC-30: STOP on WhatsApp opts the number out, withdraws the consent, sends one confirmation,
// and the next sweep does not use WhatsApp.
func TestEC30StopHonouredBeforeTheNextMessage(t *testing.T) {
	e, n8n := newEnvN8n(t)
	c, _ := kabirOnLL(t, e, "stop@example.com", "2026-10-24")
	pid := kabirPlan(t, c)["plan_id"].(string)
	r := c.do("POST", "/v1/plans/"+pid+"/whatsapp", map[string]any{"phone_e164": "+919811112222",
		"consent": map[string]any{"purpose": "whatsapp_updates", "notice_version": "notice-2026.10.23-en", "granted": true}}, idem())
	require.Equal(t, http.StatusAccepted, r.Status)
	blind := e.app.Vault.BlindIndex("JK", "phone", "9811112222")
	stop := map[string]any{"event": "inbound_opt_out", "channel": "whatsapp", "phone_blind_index": "hmac:" + hex.EncodeToString(blind), "keyword": "STOP",
		"at": e.clock.Now().UTC().Format(time.RFC3339)}
	e.clock.Advance(time.Second)
	require.Equal(t, http.StatusNoContent, e.internal("/internal/webhooks/n8n", stop, nil).Status)
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.consent_artefacts WHERE purpose = 'whatsapp_updates' AND revoked_at IS NULL`))
	confirmations := 0
	for _, m := range n8n.messages() {
		if m.TemplateID == "stop_confirmation_v1" {
			confirmations++
		}
	}
	require.Equal(t, 1, confirmations)
	// A repeated STOP (another inbound message) does not send a second confirmation.
	stop["at"] = e.clock.Now().Add(time.Minute).UTC().Format(time.RFC3339)
	e.clock.Advance(time.Second)
	require.Equal(t, http.StatusNoContent, e.internal("/internal/webhooks/n8n", stop, nil).Status)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM msg.notifications WHERE template_id = 'stop_confirmation_v1'`))

	e.clock.Set(ist(2026, 11, 18, 8, 0))
	before := len(n8n.messages())
	res := e.fire(t, e.planPages(t))
	require.EqualValues(t, 0, res["fired"])
	require.EqualValues(t, 1, res["skipped_opt_out"])
	require.Len(t, n8n.messages(), before, "no business-initiated WhatsApp after STOP")
	// The user opting in again in the app is honoured, but the number stays opted out.
	c.grant(t, "whatsapp_updates")
	pid = kabirPlan(t, c)["plan_id"].(string)
	r = c.do("POST", "/v1/plans/"+pid+"/whatsapp", map[string]any{"phone_e164": "+919811112222",
		"consent": map[string]any{"purpose": "whatsapp_updates", "notice_version": "notice-2026.10.23-en", "granted": true}}, idem())
	require.Equal(t, "suppressed_opt_out", r.json(t)["status"])
}

// MD-133: revoking a purpose stops its processing on the next request, one test per purpose.
func TestConsentRevocationStopsDependentProcessing(t *testing.T) {
	e, n8n := newEnvN8n(t)
	c, _ := kabirOnLL(t, e, "revoke@example.com", "2026-10-24", "email_updates", "analytics", "field_study")
	// email_updates: no e-mail after revoke.
	c.revoke(t, "email_updates")
	e.clock.Set(ist(2026, 11, 18, 8, 0))
	before := len(e.email.msgs)
	res := e.fire(t, e.planPages(t))
	require.EqualValues(t, 1, res["skipped_opt_out"])
	require.Len(t, e.email.msgs, before)
	// whatsapp_updates: revoked in the app, nothing goes to n8n.
	c.grant(t, "whatsapp_updates")
	c.revoke(t, "whatsapp_updates")
	require.Empty(t, n8n.messages())
	// analytics: events are dropped after revoke.
	ev := map[string]any{"events": []any{map[string]any{"name": "plan_viewed", "at": "2026-11-18T03:00:00Z", "props": map[string]any{"classes_count": 1}}}}
	r0 := c.do("POST", "/v1/events/analytics", ev, nil)
	require.Equalf(t, http.StatusAccepted, r0.Status, "%s %s", r0.Body, e.logs.String()[max(0, len(e.logs.String())-3000):])
	require.Equal(t, 1, e.count(`SELECT count(*) FROM ops.analytics_events`))
	c.revoke(t, "analytics")
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/events/analytics", ev, nil).Status)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM ops.analytics_events`))
	// field_study: a lab trial with a revoked consent is refused.
	r := c.do("GET", "/v1/me/consents", nil, nil)
	var fs string
	for _, it := range r.json(t)["items"].([]any) {
		m := it.(map[string]any)
		if m["purpose"] == "field_study" && m["status"] == "active" {
			fs = m["consent_id"].(string)
		}
	}
	require.NotEmpty(t, fs)
	c.revoke(t, "field_study")
	trial := map[string]any{"participant_code": "P-017", "arm": "margdarshak", "task_id": "find_fee_and_documents", "started_at": "2026-11-18T02:00:00Z",
		"ended_at": "2026-11-18T02:01:12Z", "completed": true, "consent_id": fs}
	assertProblem(t, c.do("POST", "/v1/lab/trials", trial, map[string]string{"X-Lab-Token": "test-lab-token"}), http.StatusForbidden, "CONSENT_REQUIRED")
	// Every artefact carries its data categories (purpose catalogue).
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.consent_artefacts WHERE cardinality(data_categories) = 0`))
}

// EC-26: deleting the account mid-case cancels timers and pending messages; the sweep sends
// nothing afterwards; contacts are crypto-shredded; consent proofs stay (withdrawn).
func TestEC26AccountDeletedMidCase(t *testing.T) {
	e := newEnv(t)
	c, id := kabirOnLL(t, e, "ec26@example.com", "2026-10-24", "email_updates")
	keyDue := id + ":LL_DAY_25_PREP:2026-11-18"
	// P2 rows of the account and its family member, a squad of three with this account as the
	// owner, and the same rows for a bystander account that must survive.
	app := meApplicant(t, c)
	member := addMinor(t, c)
	p2SeedRows(t, e, app, nil, "ec26-own", e.clock.Now())
	p2SeedRows(t, e, app, &member, "ec26-minor", e.clock.Now())
	studyEnrolUser(t, c)
	other := e.userClient("ec26.other@example.com")
	third := e.userClient("ec26.third@example.com")
	otherApp, thirdApp := meApplicant(t, other), meApplicant(t, third)
	p2SeedRows(t, e, otherApp, nil, "ec26-other", e.clock.Now())
	squad := insertSquad(t, e, "Lane Keepers", app, otherApp, thirdApp)
	before := p2Counts(t, e, app)
	for _, tbl := range p2PerSubjectTables {
		require.Positivef(t, before[tbl], "%s seeded", tbl)
	}
	otherBefore := p2Counts(t, e, otherApp)

	r := c.do("DELETE", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "DELETE", "/v1/me", r)
	// API-62 covers P2: every per-subject row of the account and its member is gone, share cards
	// are withdrawn (410 at once; hard-deleted by retention), the squad keeps its other two
	// members with a new owner (below three members it no longer scores).
	after := p2Counts(t, e, app)
	for _, tbl := range p2PerSubjectTables {
		require.Zerof(t, after[tbl], "%s erased", tbl)
	}
	require.Equal(t, 2, after["game.share_cards"])
	require.Zero(t, after["game.share_cards active"])
	assertProblem(t, e.client().do("GET", "/v1/share-cards/shc_"+strings.ToUpper(shortIDFor("ec26-own")), nil, nil), http.StatusGone, "")
	require.Equal(t, otherBefore, p2Counts(t, e, otherApp), "another account's P2 rows are untouched")
	require.Equal(t, 2, e.count(`SELECT count(*) FROM game.squad_members WHERE squad_id = $1`, squad))
	require.Equal(t, 1, e.count(`SELECT count(*) FROM game.squad_members WHERE squad_id = $1 AND role = 'owner' AND applicant_id = $2`, squad, otherApp))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM game.squads WHERE squad_id = $1 AND disbanded_at IS NOT NULL`, squad))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.timeline_events WHERE status = 'scheduled'`))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.contacts WHERE applicant_id = $1`, app))
	require.Equal(t, 2, e.count(`SELECT count(*) FROM privacy.contacts`), "the other two accounts keep theirs")
	require.Greater(t, e.count(`SELECT count(*) FROM privacy.consent_artefacts WHERE revoked_at IS NOT NULL`), 0)
	e.clock.Set(ist(2026, 11, 18, 8, 0))
	require.Empty(t, e.planPages(t))
	res := e.fire(t, []string{keyDue})
	require.EqualValues(t, 0, res["fired"])
	require.EqualValues(t, 1, res["skipped_cancelled"])
	require.Equal(t, 0, e.count(`SELECT count(*) FROM msg.notifications WHERE kind = 'nudge'`))
	require.Equal(t, http.StatusUnauthorized, c.do("GET", "/v1/me", nil, nil).Status)
	require.True(t, strings.Contains(e.logs.String(), "account.erasure") || e.auditCount("account.erasure_requested") == 1)
}

// Job steps need the service bearer token as well as the HMAC (decision: bearer, documented).
func TestJobStepsNeedBearer(t *testing.T) {
	e := newEnv(t)
	r := e.internal("/internal/job-steps/clock.plan_pages", map[string]any{"args": map[string]any{}}, func(h http.Header, raw []byte) []byte {
		h.Del("Authorization")
		return raw
	})
	assertProblem(t, r, http.StatusUnauthorized, "UNAUTHENTICATED")
}
