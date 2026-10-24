package httpapi_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/payment"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func kabirPlan(t *testing.T, c *client) map[string]any {
	return c.plan(t, map[string]any{"state": "JK", "dob": "2007-06-15", "vehicles": []string{"bike_gear"},
		"aadhaar_address_matches_residence": true, "aadhaar_has_relation_line": true, "aadhaar_mobile_linked": true})
}

// MD-109 / MD-117 / MD-121: Kabir from plan to DL holder through the API, with optimistic
// concurrency, idempotent events and the derived stage and next action at every step.
func TestCaseLifecycleKabir(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("kabir.lifecycle@example.com")
	plan := kabirPlan(t, c)
	cs := c.newCase(t, map[string]any{"plan_id": plan["plan_id"], "classes": []string{"MCWG"}, "path": "aadhaar_contactless"})
	id := cs["case_id"].(string)
	require.Equal(t, "PLAN", cs["state"])
	require.Equal(t, "S1", cs["stage"])
	require.Equal(t, "RESUME_STEP", cs["next_action"].(map[string]any)["action_id"])
	require.EqualValues(t, 90000, cs["fees"].(map[string]any)["total_paise"])
	require.Equal(t, "2026-10-24T04:30:00Z", cs["server_time"], "server time in every case (EC-15)")
	r := c.do("GET", "/v1/cases/"+id, nil, nil)
	etag := r.Header.Get("ETag")
	require.Equal(t, `W/"`+itoa(int(cs["version"].(float64)))+`"`, etag)

	// Autosave: stale If-Match is 412, a fresh one saves; personal and CX keys are refused.
	assertProblem(t, c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"district": "Jammu"}}, map[string]string{"If-Match": `W/"99"`}),
		http.StatusPreconditionFailed, "PRECONDITION_FAILED")
	r = c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"district": "Jammu", "test_language": "hi"}}, map[string]string{"If-Match": etag})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "PATCH", "/v1/cases/{caseId}", r)
	require.Equal(t, "Jammu", r.json(t)["answers"].(map[string]any)["district"])
	etag2 := r.Header.Get("ETag")
	require.NotEqual(t, etag, etag2)
	// A second device with the old ETag gets a conflict, not a silent overwrite (MD-109).
	assertProblem(t, c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"district": "Kathua"}}, map[string]string{"If-Match": etag}),
		http.StatusPreconditionFailed, "PRECONDITION_FAILED")
	for _, bad := range []map[string]any{{"name_on_card": "x"}, {"relation_name": "x"}, {"address_line": "x"}, {"captcha_text": "x"}, {"otp": "1234"}} {
		r = c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": bad}, map[string]string{"If-Match": etag2})
		assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
		require.Contains(t, string(r.Body), "PROHIBITED_FIELD")
	}
	// Merge patch: null deletes.
	r = c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"test_language": nil}}, map[string]string{"If-Match": etag2})
	require.Equal(t, http.StatusOK, r.Status)
	require.NotContains(t, r.json(t)["answers"], "test_language")

	// Journey events.
	for _, ev := range []struct{ typ, state string }{{"ll_application_started", "LL_APPLYING"}, {"handoff_done", "HANDED_OFF"}, {"payment_confirmed", "LL_TEST"}} {
		r = c.event(t, id, map[string]any{"type": ev.typ, "occurred_on": "2026-10-24"})
		require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
		require.Equal(t, ev.state, r.json(t)["case"].(map[string]any)["state"])
	}
	key := map[string]string{"Idempotency-Key": "kabir-ll-issued-0000001"}
	r = c.do("POST", "/v1/cases/"+id+"/events", map[string]any{"type": "ll_issued", "occurred_on": "2026-10-24", "payload": map[string]any{"number_last4": "4471"}}, key)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/cases/{caseId}/events", r)
	res := r.json(t)
	require.Equal(t, "BRIDGE", res["case"].(map[string]any)["state"])
	require.Contains(t, res["timeline_changes"].(map[string]any)["scheduled"], "LL_DAY_30_UNLOCK")
	// Same key, same body: replayed, recorded once.
	r2 := c.do("POST", "/v1/cases/"+id+"/events", map[string]any{"type": "ll_issued", "occurred_on": "2026-10-24", "payload": map[string]any{"number_last4": "4471"}}, key)
	require.Equal(t, http.StatusCreated, r2.Status)
	require.Equal(t, "true", r2.Header.Get("Idempotent-Replayed"))
	require.Equal(t, 1, e.count(`SELECT count(*) FROM core.case_events WHERE type = 'll_issued'`))
	// Same key, other body: refused.
	assertProblem(t, c.do("POST", "/v1/cases/"+id+"/events", map[string]any{"type": "ll_issued", "occurred_on": "2026-10-23"}, key), http.StatusUnprocessableEntity, "IDEMPOTENCY_KEY_REUSED")
	// An illegal transition is 409.
	assertProblem(t, c.event(t, id, map[string]any{"type": "approved", "occurred_on": "2026-10-24"}), http.StatusConflict, "JOURNEY_INVALID_TRANSITION")
	// LL number never in clear (MD-117): only the encrypted last 4.
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.case_events WHERE payload::text LIKE '%4471%'`))

	v := c.getCase(t, id)
	require.Equal(t, "S4", v["stage"])
	require.Equal(t, "PRACTISE_NAZAR", v["next_action"].(map[string]any)["action_id"])
	require.Equal(t, "4471", v["ll"].(map[string]any)["number_last4"])
	require.Equal(t, "2026-11-23", v["key_dates"].(map[string]any)["dl_test_unlock"])

	r = c.do("GET", "/v1/cases/"+id+"/timeline?limit=3", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/cases/{caseId}/timeline", r)
	page := r.json(t)
	require.Len(t, page["items"], 3)
	require.NotNil(t, page["next_cursor"])
	r = c.do("GET", "/v1/cases/"+id+"/timeline?limit=50", nil, nil)
	require.Contains(t, string(r.Body), "cas_")
	require.Contains(t, string(r.Body), ":LL_DAY_30_UNLOCK:2026-11-23")

	// Day 31 by server time: the case moves to DL_BOOKABLE without the sweep (catch-up).
	e.clock.Set(ist(2026, 11, 24, 10, 0))
	v = c.getCase(t, id)
	require.Equal(t, "DL_BOOKABLE", v["state"])
	require.Equal(t, "BOOK_TEST", v["next_action"].(map[string]any)["action_id"])
	r = c.event(t, id, map[string]any{"type": "slot_booked", "occurred_on": "2026-11-24", "payload": map[string]any{"slot_date": "2026-12-01", "class_code": "MCWG"}})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, "S6", r.json(t)["case"].(map[string]any)["stage"])
	e.clock.Set(ist(2026, 12, 1, 10, 0))
	r = c.event(t, id, map[string]any{"type": "test_passed", "occurred_on": "2026-12-01", "payload": map[string]any{"class_code": "MCWG", "test": "dl"}})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Contains(t, r.json(t)["timeline_changes"].(map[string]any)["scheduled"], "APPROVAL_CHASE")
	require.Contains(t, r.json(t)["timeline_changes"].(map[string]any)["cancelled"], "TEST_EVE")
	e.clock.Set(ist(2026, 12, 5, 10, 0))
	v = c.getCase(t, id)
	require.Contains(t, v["alerts"], "APPROVAL_STALLED", "EC-23 on day 3")
	require.Equal(t, http.StatusCreated, c.event(t, id, map[string]any{"type": "approved", "occurred_on": "2026-12-05"}).Status)
	r = c.event(t, id, map[string]any{"type": "card_received", "occurred_on": "2026-12-05", "payload": map[string]any{"valid_to": "2046-12-04"}})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	v = c.getCase(t, id)
	require.Equal(t, "DL_HOLDER", v["state"])
	require.Equal(t, "S8", v["stage"])
	require.Equal(t, "2046-12-04", v["dl"].(map[string]any)["valid_to_non_transport"])

	// My Licence (MD-124): the DL-holder view only when a DL mirror exists.
	r = c.do("GET", "/v1/me/licences", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me/licences", r)
	require.Equal(t, true, r.json(t)["show_dl_holder_view"])

	// Every transition is in the audit log (MD-121).
	require.GreaterOrEqual(t, e.auditCount("case.event"), 8)
}

func itoa(n int) string { return strconv.Itoa(n) }

// EC-22: an LL already held (issued 40 days ago) lands in S5 with "book DL test" and the right clock.
func TestEC22ExistingLLOnboarding(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("ec22@example.com")
	plan := kabirPlan(t, c)
	cs := c.newCase(t, map[string]any{"plan_id": plan["plan_id"], "classes": []string{"MCWG"},
		"existing_ll": map[string]any{"issued_on": "2026-09-14", "expires_on": "2027-03-14", "classes": []string{"MCWG"}, "number_last4": "4471", "source": "user_entered"}})
	require.Equal(t, "DL_BOOKABLE", cs["state"])
	require.Equal(t, "S5", cs["stage"])
	require.Equal(t, "BOOK_TEST", cs["next_action"].(map[string]any)["action_id"])
	require.Equal(t, "2027-03-14", cs["ll"].(map[string]any)["expires_on"])
	r := c.do("GET", "/v1/me/licences", nil, nil)
	require.Equal(t, false, r.json(t)["show_dl_holder_view"])
	require.EqualValues(t, 141, r.json(t)["items"].([]any)[0].(map[string]any)["days_to_ll_expiry"])
}

// EC-15: server time decides. A future occurred_on is refused; countdowns use the server date.
func TestEC15ServerTimeIsTheOnlyClock(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("ec15@example.com")
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	r := c.event(t, id, map[string]any{"type": "ll_issued", "occurred_on": "2026-10-28"})
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(r.Body), "future_date")
	require.Equal(t, http.StatusCreated, c.event(t, id, map[string]any{"type": "ll_issued", "occurred_on": "2026-10-24"}).Status)
	// The device claims it is day 40: nothing changes, the server says day 0.
	r = c.do("GET", "/v1/cases/"+id, nil, map[string]string{"Date": "Thu, 03 Dec 2026 10:00:00 GMT"})
	require.Equal(t, "BRIDGE", r.json(t)["state"])
	require.Equal(t, "2026-10-24T04:30:00Z", r.json(t)["server_time"])
	// A date before the previous update is refused.
	r = c.event(t, id, map[string]any{"type": "handoff_done", "occurred_on": "2026-10-20"})
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(r.Body), "before_previous_event")
}

// MD-114: Mode A hand-off is a template: no personal values, vault keys instead, Sarathi codes.
func TestContractHandoffModeA(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("handoff@example.com")
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	r := c.do("GET", "/v1/cases/"+cs["case_id"].(string)+"/handoff", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/cases/{caseId}/handoff", r)
	h := r.json(t)
	require.Equal(t, "A", h["mode"])
	require.Equal(t, "deeplink", h["adapter"])
	require.Contains(t, h["target_url"], "sarathi.parivahan.gov.in")
	body := string(r.Body)
	require.Contains(t, body, `"vault_key":"applicant_name"`)
	require.Contains(t, body, "handoff.screen.aadhaar_ekyc_on_sarathi")
	require.Contains(t, body, `"value":"MCWG"`)
	require.NotContains(t, body, "Kabir")
	require.NotContains(t, body, "2007-06-15")
}

// EC-11 + MD-116: a mock Sarathi outage gives 503 with the draft kept and the SARATHI_DOWN alert;
// Mode B (tenant flag) pushes a non-personal prefill once and mirrors the status.
func TestEC11SarathiOutageAndModeB(t *testing.T) {
	e := newEnvWith(t, func(cfg *config.Config) { cfg.AdapterSarathi = "mock" })
	c := e.userClient("ec11@example.com")
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	e.app.Registry.SarathiMock().InjectFault(ports.FaultOutage)
	assertProblem(t, c.do("GET", "/v1/cases/"+id+"/handoff", nil, nil), http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")
	v := c.getCase(t, id)
	require.Contains(t, v["alerts"], "SARATHI_DOWN")
	r := c.do("PATCH", "/v1/cases/"+id, map[string]any{"answers": map[string]any{"district": "Jammu"}}, map[string]string{"If-Match": `W/"` + itoa(int(v["version"].(float64))) + `"`})
	require.Equal(t, http.StatusOK, r.Status, "the draft is kept during an outage")
	e.app.Registry.SarathiMock().InjectFault(ports.FaultNone)

	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE core.tenants SET features = features || '{"sarathi_mode_b": true}' WHERE tenant_id = 'JK'`)
		return err
	}))
	e.app.Tenants.Invalidate()
	r = c.do("GET", "/v1/cases/"+id+"/handoff", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/cases/{caseId}/handoff", r)
	require.Equal(t, "B", r.json(t)["mode"])
	require.Equal(t, "sent", r.json(t)["prefill"].(map[string]any)["status"])
	r = c.do("GET", "/v1/cases/"+id+"/handoff", nil, nil)
	require.Equal(t, "already_sent", r.json(t)["prefill"].(map[string]any)["status"])
	v = c.getCase(t, id)
	st := v["application_status"].(map[string]any)
	require.Equal(t, "B", st["mode"])
	require.Equal(t, true, st["simulated"])
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.cases WHERE app_status::text LIKE '%SIM-JK-LL%'`), "only the last 4 of the reference")
}

// API-19 + EC-09: the intent is priced from the stored quote (fees.json); a pending payment
// blocks a second one ("do not pay twice"); the gateway callback moves the journey.
func TestEC09PaymentPendingAndIntent(t *testing.T) {
	e := newEnvWith(t, func(cfg *config.Config) { cfg.AdapterPayment = "mock" })
	c := e.userClient("ec09@example.com")
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	quote := cs["fees"].(map[string]any)["quote_id"].(string)
	for _, ev := range []string{"ll_application_started", "handoff_done"} {
		require.Equal(t, http.StatusCreated, c.event(t, id, map[string]any{"type": ev, "occurred_on": "2026-10-24"}).Status)
	}
	r := c.do("POST", "/v1/cases/"+id+"/payment-intents", map[string]any{"quote_id": quote, "stage": "ll"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/cases/{caseId}/payment-intents", r)
	pi := r.json(t)
	require.EqualValues(t, 50000, pi["amount_paise"], "LL stage: 15000 + 5000 + 30000")
	require.Equal(t, "state_gateway", pi["collected_by"])
	assertProblem(t, c.do("POST", "/v1/cases/"+id+"/payment-intents", map[string]any{"quote_id": "fq_01JB8Z6X3V9Q2K7M4N5P6R7S8T"}, idem()),
		http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	mock := e.app.Registry.PaymentMock()
	send := func(status string) {
		sig, body := mock.SignCallback(ports.PaymentCallback{IntentRef: pi["payment_intent_id"].(string), Status: status, ReceiptNumber: "RCPT1"})
		e.clock.Advance(time.Second)
		req, _ := http.NewRequest("POST", e.srv.URL+"/internal/webhooks/payment/mock", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+e.cfg.InternalBearerTokens[0])
		req.Header.Set(hmacsig.Header, sig)
		res, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		res.Body.Close()
		require.Equal(t, http.StatusNoContent, res.StatusCode)
	}
	send("pending")
	require.Equal(t, "PAYMENT_PENDING", c.getCase(t, id)["state"])
	r = c.do("POST", "/v1/cases/"+id+"/payment-intents", map[string]any{"quote_id": quote}, idem())
	assertProblem(t, r, http.StatusConflict, "PAYMENT_PENDING")
	e.clock.Advance(26 * time.Hour)
	require.Contains(t, c.getCase(t, id)["alerts"], "PAYMENT_PENDING_LONG")
	send("success")
	require.Equal(t, "LL_TEST", c.getCase(t, id)["state"])
	_ = payment.CallbackBody{}
	_ = adapters.PortPayment
	_ = store.ErrNotFound
}

// API-17 + EC-26: deleting a case cancels its timeline; nothing is sent afterwards.
func TestEC26DeleteCaseCancelsTimeline(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("ec26.case@example.com")
	cs := c.newCase(t, map[string]any{"plan_id": kabirPlan(t, c)["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)
	require.Equal(t, http.StatusCreated, c.event(t, id, map[string]any{"type": "ll_issued", "occurred_on": "2026-10-24"}).Status)
	require.Greater(t, e.count(`SELECT count(*) FROM core.timeline_events WHERE status = 'scheduled'`), 0)
	r := c.do("DELETE", "/v1/cases/"+id, nil, nil)
	require.Equal(t, http.StatusNoContent, r.Status)
	assertContract(t, "DELETE", "/v1/cases/{caseId}", r)
	require.Equal(t, 0, e.count(`SELECT count(*) FROM core.timeline_events WHERE status = 'scheduled'`))
	assertProblem(t, c.do("GET", "/v1/cases/"+id, nil, nil), http.StatusNotFound, "NOT_FOUND")
	e.clock.Set(ist(2026, 11, 23, 8, 30))
	r = e.step("clock.plan_pages", map[string]any{"tenants": []string{"JK"}, "as_of": nil, "after": nil, "limit": 200})
	require.Equal(t, http.StatusOK, r.Status)
	require.Empty(t, r.json(t)["events"])
}

// Another account never sees the case (no existence leak).
func TestCaseIsolation(t *testing.T) {
	e := newEnv(t)
	a := e.userClient("owner@example.com")
	b := e.userClient("stranger@example.com")
	cs := a.newCase(t, map[string]any{"plan_id": kabirPlan(t, a)["plan_id"], "classes": []string{"MCWG"}})
	assertProblem(t, b.do("GET", "/v1/cases/"+cs["case_id"].(string), nil, nil), http.StatusNotFound, "NOT_FOUND")
	assertProblem(t, b.do("DELETE", "/v1/cases/"+cs["case_id"].(string), nil, nil), http.StatusNotFound, "NOT_FOUND")
	// Duplicate open case for the same class: 409.
	assertProblem(t, a.do("POST", "/v1/cases", map[string]any{"plan_id": kabirPlan(t, a)["plan_id"], "classes": []string{"MCWG"}}, idem()), http.StatusConflict, "CASE_EXISTS")
}
