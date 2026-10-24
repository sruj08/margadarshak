package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
)

// P1 follow-up (b): PATCH /v1/cases/{id} accepts family_member_id, so the web no longer swaps a
// stand-in case. Only in PLAN; a minor needs the parent's consent and must be eligible.
func TestPatchCase_ReassignToFamilyMember(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("reassign.test@example.com")
	plan := c.plan(t, map[string]any{"state": "JK", "dob": "1990-01-01", "classes": []string{"MCWG"}})
	cs := c.newCase(t, map[string]any{"plan_id": plan["plan_id"], "classes": []string{"MCWG"}})
	id := cs["case_id"].(string)

	patch := func(body map[string]any) resp {
		v := c.getCase(t, id)
		return c.do("PATCH", "/v1/cases/"+id, body, map[string]string{"If-Match": fmt.Sprintf(`W/"%v"`, v["version"]), "Idempotency-Key": idem()["Idempotency-Key"]})
	}

	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "spouse", "label": "Asha", "dob": "1992-05-05", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	adult := r.json(t)["member_id"].(string)
	r = patch(map[string]any{"family_member_id": adult})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "PATCH", "/v1/cases/{caseId}", r)
	require.Equal(t, adult, r.json(t)["family_member_id"])

	// A minor without the parent's consent: 403; with consent, MCWG at 17 is not eligible: 422.
	r = c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	minor := r.json(t)["member_id"].(string)
	assertProblem(t, patch(map[string]any{"family_member_id": minor}), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	r = c.do("POST", "/v1/me/family-members/"+minor+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-en"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertProblem(t, patch(map[string]any{"family_member_id": minor}), http.StatusUnprocessableEntity, "")

	// null hands the case back to the account holder; an unknown member is a validation error.
	r = patch(map[string]any{"family_member_id": nil})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Nil(t, r.json(t)["family_member_id"])
	assertProblem(t, patch(map[string]any{"family_member_id": "fam_01JB8ZQ0000000000000000000"}), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
	// Answers in the same patch still merge.
	r = patch(map[string]any{"family_member_id": adult, "answers": map[string]any{"residence_district": "Jammu"}})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, adult, r.json(t)["family_member_id"])
	require.Equal(t, "Jammu", r.json(t)["answers"].(map[string]any)["residence_district"])
}

// GET /v1/me returns scope "user" for an account (the web relies on it) and "admin" for the
// synthetic clip-admin personas, which the persona list does not show.
func TestMeScope_UserAndClipAdmin(t *testing.T) {
	e := newEnv(t)
	u := e.userClient("scope.test@example.com")
	r := u.do("GET", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me", r)
	require.Equal(t, "user", r.json(t)["scope"])

	a := e.adminClient("curator_01")
	r = a.do("GET", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, "admin", r.json(t)["scope"])
	r = e.client().do("GET", "/v1/demo/personas", nil, nil)
	require.NotContains(t, string(r.Body), "curator_01")
	// An ordinary account is not a clip admin.
	assertProblem(t, u.do("GET", "/v1/admin/clips", nil, nil), http.StatusForbidden, "")
}

// GET /v1/me/family-members carries parental_extras (D-09 semantics on the consent operation).
func TestFamilyMembers_ParentalExtras(t *testing.T) {
	e := newEnv(t)
	c := e.userClient("extras.test@example.com")
	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	member := r.json(t)["member_id"].(string)
	consent := func(body map[string]any) map[string]any {
		body["notice_version"] = "notice-2026.10.23-en"
		r := c.do("POST", "/v1/me/family-members/"+member+"/parental-consent", body, nil)
		require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
		assertContract(t, "POST", "/v1/me/family-members/{memberId}/parental-consent", r)
		return r.json(t)
	}
	m := consent(map[string]any{"action": "grant", "extras": []string{"squads", "share_cards"}})
	require.ElementsMatch(t, []any{"squads", "share_cards"}, m["parental_extras"])

	r = c.do("GET", "/v1/me/family-members", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/me/family-members", r)
	items := r.json(t)["items"].([]any)
	require.Len(t, items, 1)
	require.ElementsMatch(t, []any{"squads", "share_cards"}, items[0].(map[string]any)["parental_extras"])

	// Revoking one extra keeps the base consent; revoking without extras ends everything.
	m = consent(map[string]any{"action": "revoke", "extras": []string{"squads"}})
	require.Equal(t, []any{"share_cards"}, m["parental_extras"])
	require.Equal(t, "granted", m["parental_consent"].(map[string]any)["status"])
	m = consent(map[string]any{"action": "revoke"})
	require.Empty(t, m["parental_extras"])
	require.Equal(t, "revoked", m["parental_consent"].(map[string]any)["status"])
	// An unknown extra is refused.
	r = c.do("POST", "/v1/me/family-members/"+member+"/parental-consent",
		map[string]any{"action": "grant", "extras": []string{"ai_ads"}, "notice_version": "notice-2026.10.23-en"}, nil)
	assertProblem(t, r, http.StatusUnprocessableEntity, "")
}

// P1 follow-up (c): DEV_DEVICE_SESSION_RATE_LIMIT raises the device-session limit for e2e runs;
// the default stays 10 per hour per IP.
func TestDeviceSessionRateLimit_DevOverride(t *testing.T) {
	open := func(e *env) int {
		r := e.client().do("POST", "/v1/sessions/device", map[string]any{"device_public_key": "MCowBQYDK2VwAyEA3b1testkey", "platform": "android_web"}, nil)
		return r.Status
	}
	e := newEnv(t)
	for i := 0; i < 10; i++ {
		require.Equal(t, http.StatusCreated, open(e))
	}
	require.Equal(t, http.StatusTooManyRequests, open(e))

	e = newEnvWith(t, func(cfg *config.Config) { cfg.DevDeviceSessionRateLimit = 25 })
	for i := 0; i < 25; i++ {
		require.Equal(t, http.StatusCreated, open(e))
	}
	require.Equal(t, http.StatusTooManyRequests, open(e))
}

// W08: after a rater saves, the API resumes the n8n Wait node at the stored (sealed) resume URL
// with X-MD-Resume-Token and {stage, rater_id, decision, windows_hash}; the browser never sees it.
func TestClipsRating_ResumesW08Wait(t *testing.T) {
	type hit struct {
		token string
		body  map[string]any
	}
	got := make(chan hit, 4)
	n8n := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		got <- hit{token: r.Header.Get("X-MD-Resume-Token"), body: b}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(n8n.Close)

	e := newP2EnvCfg(t, func(cfg *config.Config) { cfg.N8NResumeAuthToken = "resume-token-test" })
	_, id := e.clipsRegisterOpen(t)
	r := e.clipsInternal("/internal/clips/"+id+"/review-tasks", map[string]any{"stage": "rater_1",
		"resume_url": n8n.URL + "/webhook-waiting/77", "n8n_execution_id": "77", "due_in_hours": 48})
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	task := r.json(t)["review_task_id"]
	r = e.adminClient("rater_01").do("POST", "/v1/admin/clips/"+id+"/ratings", map[string]any{"version": 1, "decision": "windows_set",
		"review_task_id": task, "marks": []any{clipsMark("cyclist", 5000, 9000, "")}}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.NotContains(t, string(r.Body), n8n.URL)
	select {
	case h := <-got:
		require.Equal(t, "resume-token-test", h.token)
		require.Equal(t, "rater_1", h.body["stage"])
		require.Equal(t, "rater-01", h.body["rater_id"])
		require.Equal(t, "windows_set", h.body["decision"])
		require.Regexp(t, `^sha256:[0-9a-f]{64}$`, h.body["windows_hash"])
	case <-time.After(10 * time.Second):
		t.Fatal("W08 was not resumed")
	}
}

// ADR-0013: API-34 clip items and the replay clips say how a clip was made (the player shows the
// AI disclosure from GameSessionItem.origin); the seeded bank is filmed.
func TestAPI34_ClipItemsCarryOrigin(t *testing.T) {
	e := newP2Env(t)
	e.seedPublishedClips(12)
	c := e.deviceClient()
	r := c.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "mock"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/games/{gameId}/sessions", r)
	start := r.json(t)
	for _, it := range start["items"].([]any) {
		require.Equal(t, "filmed", it.(map[string]any)["origin"])
	}
	sid := start["session_id"].(string)
	r = c.do("POST", "/v1/games/sessions/"+sid+"/complete", map[string]any{"client_result": clientPreview(72, 10), "replay": fakeReplay("b2")}, idem())
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	r = c.do("GET", "/v1/games/sessions/"+sid+"/replay", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "GET", "/v1/games/sessions/{sessionId}/replay", r)
	clips := r.json(t)["clips"].([]any)
	require.NotEmpty(t, clips)
	require.Equal(t, "filmed", clips[0].(map[string]any)["origin"])
}
