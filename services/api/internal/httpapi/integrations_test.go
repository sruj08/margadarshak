package httpapi_test

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/aadhaaroffline"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/notify"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func mustJSON(t *testing.T, v any) []byte {
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return b
}

func (e *env) auditCount(action string) int {
	var n int
	require.NoError(e.t, e.app.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit.audit_log WHERE action = $1`, action).Scan(&n))
	return n
}

func (e *env) setAdapter(port, impl string) {
	ctx := context.Background()
	require.NoError(e.t, e.app.DB.System(ctx, func(tx pgx.Tx) error { return store.UpsertAdapterConfig(ctx, tx, "JK", port, impl, "test") }))
	e.app.Tenants.Invalidate()
}

// ---- Internal HMAC channel for n8n (MD-053) --------------------------------------------------

func TestInternalHMACChannel(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"sweep_id": "sweep-2026-10-24-0630", "as_of": "2030-01-01T00:00:00Z", "tenants": []string{"JK"}}
	r := e.internal("/internal/clock/sweep", body, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/clock/sweep", r)
	require.Equal(t, "inline", r.json(t)["runner"])
	require.Equal(t, 1, e.auditCount("internal.clock_sweep"))

	// Same day, same tenants: idempotent replay of the run (new signature, same input key).
	e.clock.Advance(time.Second)
	r2 := e.internal("/internal/clock/sweep", body, nil)
	require.Equal(t, http.StatusAccepted, r2.Status)
	require.Equal(t, r.json(t)["run_id"], r2.json(t)["run_id"])
	require.Equal(t, true, r2.json(t)["idempotent_replay"])

	// The server's IST date is used, never the caller's as_of (EC-15).
	var args string
	require.NoError(t, e.app.DB.Pool.QueryRow(context.Background(), `SELECT args::text FROM ops.job_runs WHERE job = 'case_clock_sweep'`).Scan(&args))
	require.Contains(t, args, `"as_of": "2026-10-24"`)

	// Replay of an identical signed request is rejected.
	raw := mustJSON(t, map[string]any{"sweep_id": "replay-1", "as_of": "2026-10-24T01:00:00Z"})
	sig := hmacsig.Sign([]byte(e.cfg.InternalHMACSecret), e.clock.Now(), raw)
	fixed := func(h http.Header, _ []byte) []byte { h.Set(hmacsig.Header, sig); return raw }
	require.Equal(t, http.StatusAccepted, e.internal("/internal/clock/sweep", nil, fixed).Status)
	assertProblem(t, e.internal("/internal/clock/sweep", nil, fixed), http.StatusUnauthorized, "UNAUTHENTICATED")

	// Stale timestamp, tampered body, missing bearer, wrong secret: all rejected.
	stale := func(h http.Header, raw []byte) []byte {
		h.Set(hmacsig.Header, hmacsig.Sign([]byte(e.cfg.InternalHMACSecret), e.clock.Now().Add(-6*time.Minute), raw))
		return raw
	}
	assertProblem(t, e.internal("/internal/clock/sweep", body, stale), http.StatusUnauthorized, "UNAUTHENTICATED")
	tamper := func(_ http.Header, raw []byte) []byte {
		return bytes.Replace(raw, []byte("sweep-"), []byte("sweeq-"), 1)
	}
	assertProblem(t, e.internal("/internal/clock/sweep", body, tamper), http.StatusUnauthorized, "UNAUTHENTICATED")
	noBearer := func(h http.Header, raw []byte) []byte { h.Del("Authorization"); return raw }
	assertProblem(t, e.internal("/internal/clock/sweep", body, noBearer), http.StatusUnauthorized, "UNAUTHENTICATED")
	wrong := func(h http.Header, raw []byte) []byte {
		h.Set(hmacsig.Header, hmacsig.Sign([]byte("not-the-secret"), e.clock.Now(), raw))
		return raw
	}
	assertProblem(t, e.internal("/internal/clock/sweep", body, wrong), http.StatusUnauthorized, "UNAUTHENTICATED")
	// A citizen session can never reach /internal.
	c := e.userClient("not.n8n@example.com")
	assertProblem(t, c.do("POST", "/internal/clock/sweep", body, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

// MD-052 through the API: an allow-listed job runs inline and its status is recorded.
func TestInternalJobsAndSteps(t *testing.T) {
	e := newEnv(t)
	r := e.internal("/internal/jobs/nightly_stats", map[string]any{"args": map[string]any{"date": "2026-10-23"}}, nil)
	require.Equalf(t, http.StatusAccepted, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/jobs/{job}", r)
	require.Eventually(t, func() bool {
		var st string
		_ = e.app.DB.Pool.QueryRow(context.Background(), `SELECT status FROM ops.job_runs WHERE job = 'nightly_stats'`).Scan(&st)
		return st == "succeeded"
	}, 5*time.Second, 20*time.Millisecond)
	assertProblem(t, e.internal("/internal/jobs/drop_tables", map[string]any{}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")

	r = e.internal("/internal/job-steps/clock.due_page", map[string]any{"run_id": "trn-1", "args": map[string]any{"tenants": []string{"JK"}}}, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/internal/job-steps/{step}", r)
	require.EqualValues(t, 0, r.json(t)["result"].(map[string]any)["due"])
	require.Equal(t, 1, e.auditCount("internal.job_start"))
	require.Equal(t, 1, e.auditCount("internal.job_step"))
}

// API-66 + MD-042: delivery receipts update E-13; STOP opts the contact out (EC-30).
func TestInternalN8nReceiptsAndOptOut(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	c := e.deviceClient()
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "receipt.test@example.com"}, nil).Status)
	var nid [16]byte
	var status string
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT notification_id, status FROM msg.notifications`).Scan(&nid, &status))
	require.Equal(t, "sent", status)
	ref := ids.Encode(ids.Notification, nid)
	at := e.clock.Now().UTC().Format(time.RFC3339)
	r := e.internal("/internal/webhooks/n8n", map[string]any{"event": "delivery_receipt", "notification_id": ref, "status": "delivered", "provider_message_id": "wamid.X", "at": at}, nil)
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT status FROM msg.notifications`).Scan(&status))
	require.Equal(t, "delivered", status)
	// Duplicate delivery is idempotent.
	e.clock.Advance(time.Second)
	require.Equal(t, http.StatusNoContent, e.internal("/internal/webhooks/n8n", map[string]any{"event": "delivery_receipt", "notification_id": ref, "status": "read", "at": at}, nil).Status)
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT status FROM msg.notifications`).Scan(&status))
	require.Equal(t, "delivered", status)

	// STOP from WhatsApp: the phone contact is opted out of that channel.
	sub := c.signIn("receipt.test@example.com")
	_ = sub
	account := applicantID(t, c.subject(t))
	phone := "9876543210"
	blind := e.app.Vault.BlindIndex("JK", "phone", phone)
	enc, _ := e.app.Vault.EncryptString("JK", "contacts.value", phone)
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.UpsertContact(ctx, tx, &store.Contact{ID: ids.New(), TenantID: "JK", ApplicantID: account, Kind: "phone", ValueEnc: enc, BlindIndex: blind})
	}))
	r = e.internal("/internal/webhooks/n8n", map[string]any{"event": "inbound_opt_out", "channel": "whatsapp", "phone_blind_index": "hmac:" + hex.EncodeToString(blind), "keyword": "STOP", "at": at}, nil)
	require.Equalf(t, http.StatusNoContent, r.Status, "%s", r.Body)
	var opted []string
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT opted_out_channels FROM privacy.contacts WHERE kind = 'phone'`).Scan(&opted))
	require.Equal(t, []string{"whatsapp"}, opted)
	require.Equal(t, 2, e.auditCount("n8n.delivery_receipt")+e.auditCount("n8n.inbound_opt_out"))
	require.NotContains(t, e.logs.String(), phone)
}

// ---- Payment mock: fake page + signed callback (MD-041, EC-09) -------------------------------

func TestPaymentMockSignedCallbackAndPending(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.setAdapter("payment", "mock") // config change only (MD-036)
	c := e.userClient("payer.test@example.com")
	account := applicantID(t, c.subject(t))
	pid := ids.New()
	ref := ids.Encode(ids.PaymentIntent, pid)
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertPaymentIntent(ctx, tx, &store.PaymentIntent{ID: pid, TenantID: "JK", ApplicantID: account, Adapter: "mock",
			RedirectURL: "/mock/payment/" + ref, AmountPaise: 90000, Status: "redirected"})
	}))
	page := c.do("GET", "/mock/payment/"+ref, nil, nil)
	require.Equal(t, http.StatusOK, page.Status)
	require.Contains(t, string(page.Body), "Simulated payment page")
	require.Contains(t, string(page.Body), "Not affiliated")

	form := url.Values{"outcome": {"pending"}, "return": {e.cfg.WebBaseURL + "/case/payment-return"}}
	r := c.do("POST", "/mock/payment/"+ref, form.Encode(), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if r.Status != http.StatusSeeOther {
		t.Log(e.logs.String())
	}
	require.Equalf(t, http.StatusSeeOther, r.Status, "%s", r.Body)
	require.Contains(t, r.Header.Get("Location"), "payment=pending")
	var status string
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT status FROM core.payment_intents`).Scan(&status))
	require.Equal(t, "pending", status, "EC-09: debited but pending stays pending")

	// An unsigned callback is rejected.
	unsigned := func(h http.Header, raw []byte) []byte { h.Del(hmacsig.Header); return raw }
	cb := map[string]any{"payment_intent_id": ref, "status": "success", "at": e.clock.Now().UTC().Format(time.RFC3339)}
	assertProblem(t, e.internal("/internal/webhooks/payment/mock", cb, unsigned), http.StatusUnauthorized, "UNAUTHENTICATED")
	// The internal HMAC secret is not the gateway's secret.
	assertProblem(t, e.internal("/internal/webhooks/payment/mock", cb, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
	// A properly signed callback succeeds once; its replay is rejected.
	sig, body := e.app.Registry.PaymentMock().SignCallback(ports.PaymentCallback{IntentRef: ref, Status: "success", ReceiptNumber: "SIM-RCPT-9"})
	gateway := func(h http.Header, _ []byte) []byte { h.Set(hmacsig.Header, sig); return body }
	require.Equal(t, http.StatusNoContent, e.internal("/internal/webhooks/payment/mock", nil, gateway).Status)
	assertProblem(t, e.internal("/internal/webhooks/payment/mock", nil, gateway), http.StatusUnauthorized, "UNAUTHENTICATED")
	var receipt []byte
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT status, receipt_number_enc FROM core.payment_intents`).Scan(&status, &receipt))
	require.Equal(t, "success", status)
	require.NotContains(t, string(receipt), "SIM-RCPT-9", "receipt numbers are stored encrypted")
	require.GreaterOrEqual(t, e.auditCount("payment.callback"), 2)
}

// ---- DigiLocker OAuth 2.0 + PKCE simulation (MD-038) -----------------------------------------

func TestDigiLockerSimulatedConsentWritesAndRevokesArtefact(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("dl.holder.test@example.com")
	r := c.do("GET", "/v1/integrations/digilocker/authorize?case_id=cas_01JB8ZCQ4TXK2M7N9PRSVWYZAB", nil, nil)
	require.Equalf(t, http.StatusFound, r.Status, "%s", r.Body)
	loc, err := url.Parse(r.Header.Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "/mock/digilocker/authorize", loc.Path)
	require.Equal(t, "S256", loc.Query().Get("code_challenge_method"))
	require.NotEmpty(t, loc.Query().Get("code_challenge"))
	require.Empty(t, loc.Query().Get("code_verifier"), "the verifier never leaves the server")

	screen := c.do("GET", loc.String(), nil, nil)
	require.Equal(t, http.StatusOK, screen.Status)
	require.Contains(t, string(screen.Body), "Simulated DigiLocker consent")
	require.Contains(t, string(screen.Body), "Purpose")
	require.Contains(t, string(screen.Body), "Valid for")

	form := url.Values{"request": {loc.Query().Get("request")}, "decision": {"allow"}}
	r = c.do("POST", e.srv.URL+"/mock/digilocker/authorize", form.Encode(), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	require.Equal(t, http.StatusFound, r.Status)
	cb := r.Header.Get("Location")
	require.Contains(t, cb, "/v1/integrations/digilocker/callback?")
	r = c.do("GET", cb, nil, nil)
	require.Equalf(t, http.StatusFound, r.Status, "%s", r.Body)
	require.Contains(t, r.Header.Get("Location"), "result=ok")
	require.Contains(t, r.Header.Get("Location"), "MCWG")
	// The same callback cannot be replayed (state is single use).
	require.Equal(t, http.StatusBadRequest, c.do("GET", cb, nil, nil).Status)

	// E-15 written on grant ...
	list := c.do("GET", "/v1/me/consents", nil, nil).json(t)["items"].([]any)
	require.Len(t, list, 1)
	require.Equal(t, "digilocker_pull", list[0].(map[string]any)["purpose"])
	require.Equal(t, 1, e.auditCount("adapter.digilocker.pull"))
	// ... and revoked on revoke.
	r = c.do("POST", "/v1/me/consents", map[string]any{"purpose": "digilocker_pull", "action": "revoke", "notice_version": "notice-2026.10.23-en"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, "revoked", r.json(t)["status"])
	require.NotEmpty(t, r.json(t)["revoked_at"])
}

// ---- Aadhaar offline mock through API-18 (MD-039) --------------------------------------------

func TestAadhaarOfflineEndpointRejectsTwelveDigits(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	c := e.userClient("aadhaar.offline.test@example.com")
	account := applicantID(t, c.subject(t))
	caseID := ids.New()
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertCase(ctx, tx, &store.Case{ID: caseID, TenantID: "JK", ApplicantID: account, RulePackVersion: "2026.10.0"})
	}))
	cr := c.do("POST", "/v1/me/consents", map[string]any{"purpose": "aadhaar_offline_check", "action": "grant", "notice_version": "notice-2026.10.23-en"}, nil)
	require.Equal(t, http.StatusCreated, cr.Status)
	consent := cr.json(t)["consent_id"].(string)

	send := func(payload []byte) resp {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		_ = mw.WriteField("kind", "secure_qr")
		_ = mw.WriteField("consent_id", consent)
		fw, _ := mw.CreateFormFile("artefact", "qr.bin")
		_, _ = fw.Write(payload)
		_ = mw.Close()
		return c.do("POST", "/v1/cases/"+ids.Encode(ids.Case, caseID)+"/identity/aadhaar-offline", buf.Bytes(), map[string]string{"Content-Type": mw.FormDataContentType()})
	}
	key := []byte(e.cfg.AadhaarMockKey)
	ok := send(aadhaaroffline.Sign(key, aadhaaroffline.Sample{V: 1, YearOfBirth: 2007, State: "JK", District: "Jammu", RelationLine: true, Ref: "SIMREF-T"}))
	require.Equalf(t, http.StatusOK, ok.Status, "%s", ok.Body)
	assertContract(t, "POST", "/v1/cases/{caseId}/identity/aadhaar-offline", ok)
	require.Equal(t, "year_only", ok.json(t)["dob_precision"])
	require.Equal(t, true, ok.json(t)["simulated"])

	twelve := "SIMREF-" + strconv.Itoa(234567890123)
	bad := send(aadhaaroffline.Sign(key, aadhaaroffline.Sample{V: 1, YearOfBirth: 2007, State: "JK", Ref: twelve}))
	assertProblem(t, bad, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(bad.Body), "PROHIBITED_FIELD")
	require.Contains(t, e.logs.String(), "pii_trip")
	require.NotContains(t, e.logs.String(), "234567890123")
	var n int
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT count(*) FROM audit.audit_log WHERE action = 'adapter.aadhaar_offline.verify' AND outcome = 'prohibited'`).Scan(&n))
	require.Equal(t, 1, n)
	require.False(t, strings.Contains(e.logs.String(), "SIMREF-T"), "artefact content is never logged")
}

// MD-042: delivery state is written to E-13; SMS stays disabled until TRAI DLT; STOP suppresses.
func TestNotificationDeliveryStateInE13(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	tn, err := e.app.Tenants.Get(ctx, "JK")
	require.NoError(t, err)
	res, err := e.app.Notify.Send(ctx, tn.Adapters.Notification, notifyRequest("sms:1", "sms", nil))
	require.Error(t, err)
	require.Equal(t, ports.DeliveryDisabledUntilDLT, res.Status)
	res, err = e.app.Notify.Send(ctx, tn.Adapters.Notification, notifyRequest("wa:1", "whatsapp", []string{"whatsapp"}))
	require.NoError(t, err)
	require.Equal(t, ports.DeliveryOptedOut, res.Status)
	res, err = e.app.Notify.Send(ctx, tn.Adapters.Notification, notifyRequest("mail:1", "email", nil))
	require.NoError(t, err)
	require.Equal(t, ports.DeliverySent, res.Status)
	again, err := e.app.Notify.Send(ctx, tn.Adapters.Notification, notifyRequest("mail:1", "email", nil))
	require.NoError(t, err)
	require.True(t, again.Duplicate, "same idempotency key is not sent twice")
	rows, err := e.app.DB.Pool.Query(ctx, `SELECT idempotency_key, status FROM msg.notifications ORDER BY idempotency_key`)
	require.NoError(t, err)
	got := map[string]string{}
	for rows.Next() {
		var k, s string
		require.NoError(t, rows.Scan(&k, &s))
		got[k] = s
	}
	require.Equal(t, map[string]string{"mail:1": "sent", "sms:1": "disabled_until_dlt", "wa:1": "suppressed_opt_out"}, got)
}

func notifyRequest(key, channel string, optedOut []string) notify.Request {
	return notify.Request{Tenant: "JK", Channel: channel, TemplateID: "auth.magic_link", Language: "en", To: "x@example.com",
		Vars: map[string]string{"link": "http://web.test/x", "ttl_minutes": "15"}, OptedOutChannels: optedOut, IdempotencyKey: key}
}
