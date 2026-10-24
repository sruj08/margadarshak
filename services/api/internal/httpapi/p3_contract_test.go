package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/app"
)

// coachReplyFor scripts a valid CoachDraft for the plan the template endpoint returned.
func coachReplyFor(t *testing.T, plan map[string]any) string {
	var ids []string
	for _, it := range plan["items"].([]any) {
		ids = append(ids, it.(map[string]any)["drill_id"].(string))
	}
	b, err := json.Marshal(map[string]any{"headline": "A calm week of short sessions.", "plan_items": ids,
		"intention_prompt": "On {{slot:day}} at {{slot:time}} I will start the first drill.", "tone": "steady"})
	require.NoError(t, err)
	return string(b)
}

func setTenantFeatures(t *testing.T, e *p2Env, patch string) {
	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE core.tenants SET features = features || $1::jsonb WHERE tenant_id = 'JK'`, patch)
		return err
	}))
	e.app.Tenants.Invalidate()
}

// The phase DoD: every AI route refuses a missing consent and a disabled tenant flag (templates
// where a template exists, 403 where none does), and serves the AI path once both are present.
func TestP3_AIGateConsentAndTenantFlagOnEveryRoute(t *testing.T) {
	e, f := newAIEnv(t)
	e.seedPublishedClips(22)
	c := e.userClient("learner@example.com")
	sid, _ := gamesCompleted(t, c, clientPreview(72, 10), "1")
	img := map[string][]byte{"image": pngBytes()}
	commentaryPath := "/v1/games/sessions/" + sid + "/commentary"
	commentaryForm := func() resp {
		return upload(c, commentaryPath, map[string][]byte{"audio": []byte("webm-bytes")}, map[string]string{"clip_ordinal": "1", "lang": "hi"})
	}

	// 1. No consent.
	plan := c.do("GET", "/v1/me/coach-plan", nil, nil)
	require.Equalf(t, http.StatusOK, plan.Status, "%s", plan.Body)
	require.Equal(t, "template", plan.json(t)["source"])
	assertContract(t, "GET", "/v1/me/coach-plan", plan)
	assertProblem(t, upload(c, "/v1/signs/snap", img, nil), http.StatusForbidden, "CONSENT_REQUIRED")
	assertProblem(t, c.do("POST", "/v1/voice/ticket", nil, idem()), http.StatusForbidden, "CONSENT_REQUIRED")
	assertProblem(t, commentaryForm(), http.StatusForbidden, "CONSENT_REQUIRED")
	require.Zero(t, f.coach.Calls()+f.signsnap.Calls()+f.voice.Calls())

	// 2. Consent given: the AI paths run.
	f.coach.Replies = []string{coachReplyFor(t, plan.json(t))}
	c.grant(t, "ai_coach")
	c.grant(t, "ai_voice")
	plan = c.do("GET", "/v1/me/coach-plan", nil, nil)
	require.Equalf(t, "ai", plan.json(t)["source"], "%s", plan.Body)
	assertContract(t, "GET", "/v1/me/coach-plan", plan)
	r := upload(c, "/v1/signs/snap", img, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, "match", r.json(t)["status"])
	assertContract(t, "POST", "/v1/signs/snap", r)
	assertProblem(t, upload(c, "/v1/signs/snap", img, map[string]string{"moving": "true"}), http.StatusConflict, "RIDING_LOCKED")
	r = c.do("POST", "/v1/voice/ticket", nil, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/voice/ticket", r)
	r = commentaryForm()
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/games/sessions/{sessionId}/commentary", r)
	require.NotContains(t, string(r.Body), "mud raha", "the transcript is never returned")

	// 3. Tenant flags off: templates again, 403 FEATURE_DISABLED where there is no template.
	setTenantFeatures(t, e, `{"ai_coach": false, "voice_guide": false}`)
	calls := f.coach.Calls()
	require.Equal(t, "template", c.do("GET", "/v1/me/coach-plan", nil, nil).json(t)["source"])
	require.Equal(t, calls, f.coach.Calls())
	require.Equal(t, "template", c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil).json(t)["source"])
	assertProblem(t, upload(c, "/v1/decode/screenshot", img, nil), http.StatusForbidden, "FEATURE_DISABLED")
	assertProblem(t, upload(c, "/v1/signs/snap", img, nil), http.StatusForbidden, "FEATURE_DISABLED")
	assertProblem(t, c.do("POST", "/v1/voice/ticket", nil, idem()), http.StatusForbidden, "FEATURE_DISABLED")
	assertProblem(t, commentaryForm(), http.StatusForbidden, "FEATURE_DISABLED")
	tut := c.do("POST", "/v1/tutor/explain", map[string]any{"question_id": "C-LL1-001", "variant_id": "v1", "chosen_option_id": "b"}, nil)
	require.Nil(t, tut.json(t)["glue_text"])
}

// D-13 revised: a minor learns inside the parent's account with the parent's recorded consent and
// gets every AI feature; there is no under-18 gate.
func TestP3_FamilyModeMinorGetsAIWithParentConsent(t *testing.T) {
	e, f := newAIEnv(t)
	e.seedPublishedClips(22)
	parent := e.personaClient("rahul")
	r := parent.do("GET", "/v1/me/family-members", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	member := r.json(t)["items"].([]any)[0].(map[string]any)["member_id"].(string)
	q := "?family_member_id=" + member

	plan := parent.do("GET", "/v1/me/coach-plan"+q, nil, nil)
	require.Equalf(t, http.StatusOK, plan.Status, "%s", plan.Body)
	f.coach.Replies = []string{coachReplyFor(t, plan.json(t))}
	parent.grant(t, "ai_coach")
	plan = parent.do("GET", "/v1/me/coach-plan"+q, nil, nil)
	require.Equalf(t, "ai", plan.json(t)["source"], "%s", plan.Body)

	start := gamesStart(t, parent, "nazar", map[string]any{"mode": "mock", "family_member_id": member})
	sid := start["session_id"].(string)
	done := gamesComplete(parent, sid, clientPreview(70, 10), fakeReplay("1"))
	require.Equalf(t, http.StatusOK, done.Status, "%s", done.Body)
	card := parent.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil)
	require.Equalf(t, http.StatusOK, card.Status, "%s", card.Body)
	require.Equal(t, "ai", card.json(t)["source"], "the minor's family-mode session is narrated like an adult's")

	r = parent.do("POST", "/v1/me/coach-plan/intentions"+q, map[string]any{"day": "sat", "time": "18:30", "drill_id": "DR-NAZ-MOCK"}, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	assertContract(t, "POST", "/v1/me/coach-plan/intentions", r)
	require.Equal(t, 1, e.count(`SELECT count(*) FROM ai.intentions WHERE drill_id = 'DR-NAZ-MOCK'`))
}

// RT-09: a minor's profile without the parent's recorded consent gets 403 on every AI route that
// acts for that member, and no model is called; with the consent the same calls succeed.
func TestP3_RT09_MinorWithoutParentConsentIsRefused(t *testing.T) {
	e, f := newAIEnv(t)
	e.seedPublishedClips(22)
	parent := e.userClient("rt09.parent@example.com")
	parent.grant(t, "ai_coach")
	r := parent.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Tanvi", "dob": "2009-05-20", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	member := r.json(t)["member_id"].(string)
	q := "?family_member_id=" + member

	assertProblem(t, parent.do("GET", "/v1/me/coach-plan"+q, nil, nil), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertProblem(t, parent.do("POST", "/v1/me/coach-plan/intentions"+q, map[string]any{"day": "sat", "time": "18:30", "drill_id": "DR-NAZ-MOCK"}, idem()), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	assertProblem(t, parent.do("POST", "/v1/games/nazar/sessions", map[string]any{"mode": "mock", "family_member_id": member}, idem()), http.StatusForbidden, "PARENT_CONSENT_REQUIRED")
	require.Zero(t, f.coach.Calls()+f.debrief.Calls())

	r = parent.do("POST", "/v1/me/family-members/"+member+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi", "language": "hi"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, http.StatusOK, parent.do("GET", "/v1/me/coach-plan"+q, nil, nil).Status)
}

func dialVoice(t *testing.T, e *p2Env) *websocket.Conn {
	u := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/v1/voice?state=JK&lang=hi"
	ws, resp, err := websocket.DefaultDialer.Dial(u, nil)
	require.NoError(t, err)
	if resp != nil {
		_ = resp.Body.Close()
	}
	t.Cleanup(func() { _ = ws.Close() })
	return ws
}

func readVoice(t *testing.T, ws *websocket.Conn, until string) []map[string]any {
	var out []map[string]any
	_ = ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		var m map[string]any
		require.NoError(t, ws.ReadJSON(&m))
		out = append(out, m)
		if m["type"] == until || m["type"] == "error" {
			return out
		}
	}
}

func voiceTicket(t *testing.T, c *client) string {
	r := c.do("POST", "/v1/voice/ticket", nil, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	return r.json(t)["ticket"].(string)
}

func TestAPI40_VoiceTicketSocketAndToolPath(t *testing.T) {
	e, f := newAIEnv(t)
	c := e.userClient("learner@example.com")
	c.grant(t, "ai_voice")
	ticket := voiceTicket(t, c)

	ws := dialVoice(t, e)
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "hello", "v": 1, "locale": "hi", "screen": "SCR_HOME", "token": ticket}))
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "text", "text": "मुझे बाइक का लाइसेंस बनवाना है"}))
	msgs := readVoice(t, ws, "transcript_out")
	var navigated bool
	for _, m := range msgs {
		if a, ok := m["action"].(map[string]any); ok && a["kind"] == "navigate" && a["screen_id"] == "SCR_PLAN" {
			navigated = true
		}
	}
	require.True(t, navigated, "%v", msgs)
	require.Equal(t, 2, f.voice.Calls())

	// A refused intent is answered by code, never by the model.
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "text", "text": "पैसे भर दो और फ़ॉर्म जमा कर दो"}))
	msgs = readVoice(t, ws, "transcript_out")
	require.Contains(t, fmt.Sprint(msgs), "Sarathi")
	require.Equal(t, 2, f.voice.Calls())

	// The ticket is single-use.
	ws2 := dialVoice(t, e)
	require.NoError(t, ws2.WriteJSON(map[string]any{"type": "hello", "v": 1, "token": ticket}))
	require.Equal(t, "voice.ticket_invalid", readVoice(t, ws2, "error")[0]["reason_key"])
}

func TestEC20_AadhaarOrOTPTypedIntoAIIsRefusedAndNeverSent(t *testing.T) {
	e, f := newAIEnv(t)
	e.seedPublishedClips(22)
	c := e.userClient("learner@example.com")
	c.grant(t, "ai_coach")
	c.grant(t, "ai_voice")

	// JSON bodies: the PII guard rejects identity numbers before any handler runs.
	for _, call := range []struct{ path, field string }{{"/v1/scam/check", "text"}, {"/v1/ai/feedback", "item_id"}} {
		body := map[string]any{call.field: "my aadhaar 2345 6789 0124"}
		if call.path == "/v1/ai/feedback" {
			body["agent"], body["helpful"] = "debrief", true
		}
		r := c.do("POST", call.path, body, idem())
		assertProblem(t, r, http.StatusUnprocessableEntity, "VALIDATION_FAILED")
		require.Contains(t, string(r.Body), "PROHIBITED_FIELD")
	}

	// Voice: refused by code, the model is never called, the number is not echoed.
	ws := dialVoice(t, e)
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "hello", "v": 1, "token": voiceTicket(t, c)}))
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "text", "text": "OTP चार आठ दो नौ एक सात आया है, डाल दो"}))
	msgs := readVoice(t, ws, "transcript_out")
	require.Contains(t, fmt.Sprint(msgs), "pii_blocked")
	require.NotContains(t, fmt.Sprint(msgs[0]["text"]), "चार आठ दो")
	require.Zero(t, f.voice.Calls())

	// Decoder: OCR text with an Aadhaar number still decodes; the OCR text never reaches the model.
	r := upload(c, "/v1/decode/screenshot", map[string][]byte{"image": pngBytes()}, map[string]string{"ocr_text": "Name RAHUL Aadhaar 2345 6789 0124 Status: under scrutiny & processing at RTO Level"})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.NotContains(t, f.decoder.LastPrompt(), "2345")
	require.NotContains(t, string(r.Body), "2345")
}

// EC-29: with the model endpoint off every AI surface still works through templates, reviewed
// text, the deterministic router or an honest 503 that the UI turns into the manual path.
func TestEC29_ModelOffEverySurfaceStillWorks(t *testing.T) {
	e := newP2EnvCfg(t, nil, func(o *app.Options) {
		built := app.AIAgentsForTest(t.Context(), app.ContentDir(""))
		o.AI = &built
	})
	e.compute.set(func(c *p2Compute) { c.withFindings = true })
	e.seedPublishedClips(22)
	c := e.userClient("learner@example.com")
	c.grant(t, "ai_coach")
	c.grant(t, "ai_voice")
	sid, _ := gamesCompleted(t, c, clientPreview(72, 10), "1")

	require.Equal(t, "template", c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil).json(t)["source"])
	tut := c.do("POST", "/v1/tutor/explain", map[string]any{"question_id": "C-LL1-001", "variant_id": "v1", "chosen_option_id": "b"}, nil)
	require.Equal(t, "reviewed_bank", tut.json(t)["source"])
	require.Equal(t, "template", c.do("POST", "/v1/scam/check", map[string]any{"text": "pay at fine.apk"}, nil).json(t)["explanation_source"])
	require.Equal(t, "template", c.do("GET", "/v1/me/coach-plan", nil, nil).json(t)["source"])
	assertProblem(t, upload(c, "/v1/decode/screenshot", map[string][]byte{"image": pngBytes()}, nil), http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")
	ocr := upload(c, "/v1/decode/screenshot", map[string][]byte{"image": pngBytes()}, map[string]string{"ocr_text": "Current Status : Approval of DL"})
	require.Equal(t, "STG.APPROVAL_OF_DL", ocr.json(t)["catalogue_id"], "on-device OCR still decodes")
	assertProblem(t, upload(c, "/v1/signs/snap", map[string][]byte{"image": pngBytes()}, nil), http.StatusServiceUnavailable, "ADAPTER_UNAVAILABLE")

	r := c.do("POST", "/v1/voice/ticket", nil, idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	require.Equal(t, false, r.json(t)["live"])
	ws := dialVoice(t, e)
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "hello", "v": 1, "token": r.json(t)["ticket"]}))
	require.NoError(t, ws.WriteJSON(map[string]any{"type": "text", "text": "मेरा केस कहाँ तक पहुँचा"}))
	require.Contains(t, fmt.Sprint(readVoice(t, ws, "ui_action")), "SCR_TRACKER", "the text router completes the intent")
	require.False(t, ai.Usage() == nil)
}

func TestAPI78_HumanReviewLoopAndMetrics(t *testing.T) {
	e, _ := newAIEnv(t)
	e.seedPublishedClips(22)
	c := e.userClient("learner@example.com")
	c.grant(t, "ai_coach")
	sid, _ := gamesCompleted(t, c, clientPreview(72, 10), "1")
	require.Equal(t, "ai", c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil).json(t)["source"])

	r1, r2 := e.adminClient("rater_01"), e.adminClient("rater_02")
	s := r1.do("GET", "/v1/admin/ai/reviews?n=5", nil, nil)
	require.Equalf(t, http.StatusOK, s.Status, "%s", s.Body)
	assertContract(t, "GET", "/v1/admin/ai/reviews", s)
	items := s.json(t)["items"].([]any)
	require.Len(t, items, 1)
	item := items[0].(map[string]any)["item_id"].(string)
	for _, rc := range []*client{r1, r2} {
		r := rc.do("POST", "/v1/admin/ai/reviews", map[string]any{"agent": "debrief", "item_id": item, "grounding": 2, "tone": 2, "usefulness": 1}, idem())
		require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	}
	assertProblem(t, r1.do("POST", "/v1/admin/ai/reviews", map[string]any{"agent": "debrief", "item_id": item, "grounding": 2, "tone": 2, "usefulness": 1}, idem()), http.StatusConflict, "CONFLICT")
	require.Empty(t, r1.do("GET", "/v1/admin/ai/reviews", nil, nil).json(t)["items"], "a rated item is not offered again")
	ag := r1.do("GET", "/v1/admin/ai/reviews/agreement", nil, nil)
	require.Equalf(t, http.StatusOK, ag.Status, "%s", ag.Body)
	require.EqualValues(t, 1, ag.json(t)["items_double_rated"])
	assertContract(t, "GET", "/v1/admin/ai/reviews/agreement", ag)

	m := r1.do("GET", "/v1/admin/ai/metrics", nil, nil)
	require.Equalf(t, http.StatusOK, m.Status, "%s", m.Body)
	require.Contains(t, string(m.Body), "debrief_agent")
	assertContract(t, "GET", "/v1/admin/ai/metrics", m)
	require.Equal(t, http.StatusForbidden, c.do("GET", "/v1/admin/ai/metrics", nil, nil).Status)

	fb := c.do("POST", "/v1/ai/feedback", map[string]any{"agent": "debrief", "item_id": sid, "helpful": false, "reason": "unclear"}, idem())
	require.Equalf(t, http.StatusNoContent, fb.Status, "%s", fb.Body)
}
