package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// ---- Platform: health, errors, contract coverage -------------------------------------------

func TestContractHealth(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/health", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/health", r)
	body := r.json(t)
	require.Equal(t, true, body["ok"])
	require.Equal(t, "test", body["commit"])
	require.Equal(t, "deeplink", body["adapters"].(map[string]any)["sarathi"].(map[string]any)["implementation"])
	require.NotEmpty(t, r.Header.Get("X-Request-Id"))
	require.Equal(t, "nosniff", r.Header.Get("X-Content-Type-Options"))

	start := time.Now()
	r = c.do("GET", "/v1/health?deep=true", nil, nil)
	require.Less(t, time.Since(start), 3*time.Second)
	assertContract(t, "GET", "/v1/health", r)
	require.Equal(t, "ok", r.json(t)["checks"].(map[string]any)["postgres"].(map[string]any)["status"])
}

// MD-046: unknown routes and validation errors return problem+json.
func TestContractErrorsAreProblemJSON(t *testing.T) {
	e := newEnv(t)
	c := e.deviceClient()
	assertProblem(t, c.do("GET", "/v1/does-not-exist", nil, nil), http.StatusNotFound, "NOT_FOUND")
	// API-36 debrief stays a P3 operation (decision D7): still 501 problem+json.
	assertProblem(t, c.do("GET", "/v1/games/sessions/01a16c33-1923-71fc-b81c-77670c0dd985/debrief", nil, nil), http.StatusNotImplemented, "NOT_IMPLEMENTED")
	assertProblem(t, c.do("POST", "/v1/sessions/device", `{"platform": 7}`, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, c.do("POST", "/v1/sessions/device", `{not json`, nil), http.StatusBadRequest, "BAD_REQUEST")
	assertProblem(t, c.do("GET", "/v1/tenants/ZZ", nil, nil), http.StatusNotFound, "")
}

// MD-055: every routed operation is in the spec and every spec operation is routed.
func TestContractEveryRouteIsInTheSpec(t *testing.T) {
	e := newEnv(t)
	routed := map[string]bool{}
	err := chi.Walk(e.app.Handler.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/mock/") {
			return nil // simulated government pages, deliberately outside the public contract
		}
		key := method + " " + route
		_, ok := gen.Operations[key]
		require.Truef(t, ok, "route %s is not in api/openapi.yaml", key)
		routed[key] = true
		return nil
	})
	require.NoError(t, err)
	for key := range gen.Operations {
		if strings.HasPrefix(key, "GET /v1/voice") {
			continue // WebSocket upgrade: routed by the AI layer (P3)
		}
		require.Truef(t, routed[key], "spec operation %s has no route", key)
	}
	doc := loadSpec(t)
	n := 0
	for _, item := range doc["paths"].(map[string]any) {
		for m := range item.(map[string]any) {
			switch m {
			case "get", "post", "put", "patch", "delete":
				n++
			}
		}
	}
	require.Equal(t, n, len(gen.Operations), "generated operation table is stale: run go generate ./internal/httpapi/gen")
}

// ---- Tenant (MD-056) -----------------------------------------------------------------------

func TestContractTenantConfigAndFlags(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/tenants/JK", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/tenants/{state}", r)
	body := r.json(t)
	require.Equal(t, true, body["features"].(map[string]any)["family_mode"])
	require.Equal(t, true, body["features"].(map[string]any)["ai_coach"])
	require.Equal(t, "footer.not_affiliated_simulated_data", body["disclaimer_key"])
	etag := r.Header.Get("ETag")
	require.NotEmpty(t, etag)
	r = c.do("GET", "/v1/tenants/JK", nil, map[string]string{"If-None-Match": etag})
	require.Equal(t, http.StatusNotModified, r.Status)
	// Unknown X-Tenant is refused.
	assertProblem(t, c.do("GET", "/v1/health", nil, map[string]string{"X-Tenant": "QQ"}), http.StatusNotFound, "TENANT_UNKNOWN")
}

// ---- Sessions and accounts (MD-048) ----------------------------------------------------------

func applicantID(t *testing.T, subject string) uuid.UUID {
	t.Helper()
	prefix, _, _ := strings.Cut(subject, "_")
	id, err := ids.Decode(prefix, subject)
	require.NoError(t, err)
	return id
}

func (c *client) subject(t *testing.T) string {
	r := c.do("GET", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me", r)
	return r.json(t)["subject"].(string)
}

func TestSessionsCaseCreatedAnonymouslySurvivesSignUp(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	c := e.client()
	r := c.do("POST", "/v1/sessions/device", map[string]any{"device_public_key": "MCowBQYDK2VwAyEA3b1testkey", "platform": "android_web"}, nil)
	require.Equal(t, http.StatusCreated, r.Status)
	assertContract(t, "POST", "/v1/sessions/device", r)
	require.Equal(t, "anon", r.json(t)["scope"])
	require.Nil(t, r.json(t)["session_token"], "browsers only get the HttpOnly cookie")
	cookie := r.Header.Get("Set-Cookie")
	require.Contains(t, cookie, "md_sid=")
	require.Contains(t, cookie, "HttpOnly")
	require.Contains(t, cookie, "SameSite=Lax")
	device := applicantID(t, r.json(t)["subject"].(string))

	// A case is created while anonymous (the case API is P1; insert directly).
	caseID := ids.New()
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertCase(ctx, tx, &store.Case{ID: caseID, TenantID: "JK", ApplicantID: device, RulePackVersion: "2026.10.0", Classes: []string{"MCWG"}})
	}))

	r = c.signIn("kabir.test@example.com")
	assertContract(t, "POST", "/v1/auth/token", r)
	require.Equal(t, "user", r.json(t)["scope"])
	sub := c.subject(t)
	require.True(t, strings.HasPrefix(sub, "usr_"))
	account := applicantID(t, sub)
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		got, err := store.GetCase(ctx, tx, caseID)
		require.NoError(t, err)
		require.Equal(t, account, got.ApplicantID, "the anonymous case must belong to the account after sign-up")
		return nil
	}))

	// Second device signs in to the same account: its device case is merged too.
	c2 := e.deviceClient()
	r2 := c2.do("GET", "/v1/me", nil, nil)
	dev2 := applicantID(t, r2.json(t)["subject"].(string))
	case2 := ids.New()
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertCase(ctx, tx, &store.Case{ID: case2, TenantID: "JK", ApplicantID: dev2, RulePackVersion: "2026.10.0"})
	}))
	c2.signIn("Kabir.Test@example.com")
	require.Equal(t, sub, c2.subject(t))
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		got, err := store.GetCase(ctx, tx, case2)
		require.NoError(t, err)
		require.Equal(t, account, got.ApplicantID)
		return nil
	}))

	// The e-mail contact is stored encrypted, and the address never reached the logs.
	var raw []byte
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT value_enc FROM privacy.contacts LIMIT 1`).Scan(&raw))
	require.NotContains(t, string(raw), "kabir.test")
	require.NotContains(t, strings.ToLower(e.logs.String()), "kabir.test@example.com")
}

func TestSessionsMagicLinkSingleUseAndExpiry(t *testing.T) {
	e := newEnv(t)
	c := e.deviceClient()
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "tanvi.test@example.com", "language": "hi"}, nil).Status)
	code := e.email.lastCode(t)
	require.True(t, strings.HasPrefix(code, "ml_"))
	require.Equal(t, http.StatusOK, c.do("POST", "/v1/auth/token", map[string]any{"grant_type": "magic_link", "code": code}, nil).Status)
	// Single use.
	assertProblem(t, e.client().do("POST", "/v1/auth/token", map[string]any{"grant_type": "magic_link", "code": code}, nil), http.StatusUnauthorized, "UNAUTHENTICATED")

	// 15-minute expiry (server clock).
	c2 := e.deviceClient()
	require.Equal(t, http.StatusAccepted, c2.do("POST", "/v1/auth/magic-link", map[string]any{"email": "late.test@example.com"}, nil).Status)
	code = e.email.lastCode(t)
	e.clock.Advance(16 * time.Minute)
	assertProblem(t, c2.do("POST", "/v1/auth/token", map[string]any{"grant_type": "magic_link", "code": code}, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

// MD-048: brute-force protection on link requests.
func TestSessionsMagicLinkRateLimit(t *testing.T) {
	e := newEnv(t)
	c := e.deviceClient()
	for i := 0; i < 5; i++ {
		require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "target@example.com"}, nil).Status)
	}
	r := c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "target@example.com"}, nil)
	assertProblem(t, r, http.StatusTooManyRequests, "RATE_LIMITED")
	require.NotEmpty(t, r.Header.Get("Retry-After"))
	// The response for an unknown address is identical (no enumeration): 202, nothing else.
	require.Equal(t, http.StatusAccepted, c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "someone.else@example.com"}, nil).Status)
}

func TestSessionsCSRFAndBearer(t *testing.T) {
	e := newEnv(t)
	c := e.deviceClient()
	assertProblem(t, c.do("POST", "/v1/auth/magic-link", map[string]any{"email": "a@example.com"}, map[string]string{"X-Requested-With": ""}),
		http.StatusForbidden, "CSRF_REJECTED")
	// Non-browser clients ask for the token and use Authorization: Bearer (no CSRF header needed).
	b := e.client()
	r := b.do("POST", "/v1/sessions/device", map[string]any{"device_public_key": "MCowBQYDK2VwAyEA3b1testkey", "platform": "pwa"}, map[string]string{"Prefer": "return=token"})
	require.Equal(t, http.StatusCreated, r.Status)
	tok, _ := r.json(t)["session_token"].(string)
	require.NotEmpty(t, tok)
	nb := &client{e: e, hc: &http.Client{}, bearer: tok}
	require.Equal(t, http.StatusAccepted, nb.do("POST", "/v1/auth/magic-link", map[string]any{"email": "b@example.com"}, map[string]string{"X-Requested-With": ""}).Status)
	// A tampered token is rejected before any lookup.
	bad := &client{e: e, hc: &http.Client{}, bearer: tok[:len(tok)-2] + "xx"}
	assertProblem(t, bad.do("GET", "/v1/me", nil, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

func TestSessionsSignOutEverywhere(t *testing.T) {
	e := newEnv(t)
	a := e.userClient("mohan.test@example.com")
	b := e.userClient("mohan.test@example.com")
	require.Equal(t, a.subject(t), b.subject(t))
	r := a.do("POST", "/v1/auth/logout", map[string]any{"all_sessions": true, "clear_device": true}, nil)
	require.Equal(t, http.StatusNoContent, r.Status)
	require.Contains(t, r.Header.Get("Clear-Site-Data"), "storage")
	assertProblem(t, a.do("GET", "/v1/me", nil, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
	assertProblem(t, b.do("GET", "/v1/me", nil, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

func TestSessionsGoogleStub(t *testing.T) {
	e := newEnv(t)
	c := e.deviceClient()
	r := c.do("POST", "/v1/auth/token", map[string]any{"grant_type": "google_id_token", "id_token": accounts.StubGoogleToken("g-123", "g.user@example.com")}, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, "user", r.json(t)["scope"])
	assertProblem(t, c.do("POST", "/v1/auth/token", map[string]any{"grant_type": "google_id_token", "id_token": "eyJhbGciOi.fake"}, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

// ---- Age band, family mode, parental consent (MD-049, D-13 revised) --------------------------

func TestFamilyModeParentalConsentAndNoAIGate(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	parent := e.userClient("rahul.parent.test@example.com")

	// The server computes the band from the DOB with the IST server date.
	r := parent.do("PATCH", "/v1/me", map[string]any{"dob": "1981-08-09", "dob_precision": "day"}, map[string]string{"Content-Type": "application/merge-patch+json"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "PATCH", "/v1/me", r)
	require.Equal(t, "41_60", r.json(t)["age_band"])
	require.Equal(t, "adult", r.json(t)["user_band"])

	// Tamper test: the client cannot set server-computed flags.
	assertProblem(t, parent.do("PATCH", "/v1/me", map[string]any{"age_band": "18_25"}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, parent.do("PATCH", "/v1/me", map[string]any{"user_band": "adult"}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// The account holder must be an adult; a minor belongs in family mode.
	r = parent.do("PATCH", "/v1/me", map[string]any{"dob": "2010-01-01"}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(r.Body), "ACCOUNT_HOLDER_MUST_BE_ADULT")

	// Anonymous devices cannot manage a family.
	assertProblem(t, e.deviceClient().do("GET", "/v1/me/family-members", nil, nil), http.StatusForbidden, "FORBIDDEN")

	// Add Rahul (17): minor, parental consent required.
	r = parent.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/family-members", r)
	m := r.json(t)
	require.Equal(t, true, m["is_minor"])
	require.Equal(t, "16_17", m["age_band"])
	require.Equal(t, "required", m["parental_consent"].(map[string]any)["status"])
	memberRef := m["member_id"].(string)
	memberID, err := ids.Decode(ids.FamilyMember, memberRef)
	require.NoError(t, err)
	parentID := applicantID(t, parent.subject(t))

	// A minor's case is blocked until the parent's consent is recorded: 403 PARENT_CONSENT_REQUIRED.
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		require.ErrorIs(t, accounts.RequireMemberAllowed(ctx, tx, parentID, memberID), privacy.ErrParentalConsentRequired)
		return nil
	}))
	r = parent.do("POST", "/v1/me/family-members/"+memberRef+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi", "language": "hi"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/family-members/{memberId}/parental-consent", r)
	require.Equal(t, "granted", r.json(t)["parental_consent"].(map[string]any)["status"])
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		require.NoError(t, accounts.RequireMemberAllowed(ctx, tx, parentID, memberID))
		return nil
	}))

	// AI is for everyone: any account can grant AI purposes; there is no age gate.
	r = parent.do("POST", "/v1/me/consents", map[string]any{"purpose": "ai_coach", "action": "grant", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/consents", r)
	r = parent.do("GET", "/v1/me/consents", nil, nil)
	assertContract(t, "GET", "/v1/me/consents", r)
	purposes := []string{}
	for _, it := range r.json(t)["items"].([]any) {
		purposes = append(purposes, it.(map[string]any)["purpose"].(string))
	}
	require.ElementsMatch(t, []string{"ai_coach", "parental_consent"}, purposes)

	r = parent.do("GET", "/v1/me/family-members", nil, nil)
	assertContract(t, "GET", "/v1/me/family-members", r)
	require.Len(t, r.json(t)["items"], 1)

	// Revoking consent blocks the minor's case again.
	r = parent.do("POST", "/v1/me/family-members/"+memberRef+"/parental-consent", map[string]any{"action": "revoke", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Equal(t, "revoked", r.json(t)["parental_consent"].(map[string]any)["status"])
	require.NoError(t, e.app.DB.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		require.ErrorIs(t, accounts.RequireMemberAllowed(ctx, tx, parentID, memberID), privacy.ErrParentalConsentRequired)
		return nil
	}))
	// Consent and family changes are audited.
	var n int
	require.NoError(t, e.app.DB.Pool.QueryRow(ctx, `SELECT count(*) FROM audit.audit_log WHERE action IN ('family.member_added','consent.parental_grant','consent.parental_revoke','consent.grant')`).Scan(&n))
	require.Equal(t, 4, n)
}

// EC-20 + MD-051: an Aadhaar number sent to the API is rejected and never reaches the logs.
func TestEC20AadhaarInBodyRejectedAndNeverLogged(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("ec20.test@example.com")
	aad := "34567890123"
	aad += string(privacy.VerhoeffCheckDigit(aad))
	r := c.do("POST", "/v1/me/consents", map[string]any{"purpose": "ai_coach", "action": "grant", "notice_version": "my aadhaar is " + aad}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	require.Contains(t, string(r.Body), `"pointer":"/notice_version"`)
	require.Contains(t, string(r.Body), "PROHIBITED_FIELD")
	require.NotContains(t, string(r.Body), aad)
	r = c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "dob": "2009-03-14", "dob_precision": "day", "otp": "123456"}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// Log something Aadhaar-like on purpose through the app logger too.
	e.app.Log.Info("debug echo " + aad)
	require.NotContains(t, e.logs.String(), aad)
}

func TestDeleteMeRevokesSessions(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("delete.test@example.com")
	r := c.do("DELETE", "/v1/me", nil, nil)
	require.Equal(t, http.StatusAccepted, r.Status)
	assertContract(t, "DELETE", "/v1/me", r)
	assertProblem(t, c.do("GET", "/v1/me", nil, nil), http.StatusUnauthorized, "UNAUTHENTICATED")
}

// ---- Offices and slots (MD-043 through the API) ------------------------------------------------

func TestContractOfficesAndSlots(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	r := c.do("GET", "/v1/offices?state=JK", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/offices", r)
	require.GreaterOrEqual(t, len(r.json(t)["items"].([]any)), 4)
	r = c.do("GET", "/v1/offices/off_jk02/slots?kind=dl_test&from=2026-11-02&to=2026-11-08", nil, nil)
	require.Equal(t, http.StatusOK, r.Status)
	assertContract(t, "GET", "/v1/offices/{officeId}/slots", r)
	for _, it := range r.json(t)["items"].([]any) {
		require.Equal(t, true, it.(map[string]any)["simulated"])
	}
	r2 := c.do("GET", "/v1/offices/off_jk02/slots?kind=dl_test&from=2026-11-02&to=2026-11-08", nil, nil)
	require.JSONEq(t, string(stripAsOf(t, r.Body)), string(stripAsOf(t, r2.Body)))
	assertProblem(t, c.do("GET", "/v1/offices/off_jk02/slots?kind=dl_test&from=2026-11-02&to=2027-02-01", nil, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	assertProblem(t, c.do("GET", "/v1/offices/off_nowhere/slots?kind=dl_test", nil, nil), http.StatusNotFound, "NOT_FOUND")
}

func stripAsOf(t *testing.T, b []byte) []byte {
	m := resp{Body: b}.json(t)
	delete(m, "as_of")
	return mustJSON(t, m)
}
