package httpapi_test

import (
	"bytes"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/aitest"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/scam"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/app"
)

var quietLog = slog.New(slog.NewTextHandler(io.Discard, nil))

type aiFakes struct{ debrief, tutor, decoder, scam *aitest.Fake }

// aiOption wires every ADK agent to a scripted model, so the HTTP handlers, the consent gate and
// the validators run for real without calling Gemini.
func aiOption(t *testing.T, f *aiFakes) func(*app.Options) {
	t.Helper()
	contentDir := app.ContentDir("")
	cat, err := debrief.LoadCatalogue(contentDir)
	require.NoError(t, err)
	return func(o *app.Options) {
		da, err := ai.NewStructuredWithModel(f.debrief, ai.Config{}, "debrief_agent", debrief.Instruction, debrief.DraftSchema())
		require.NoError(t, err)
		ta, err := ai.NewStructuredWithModel(f.tutor, ai.Config{}, "tutor_agent", tutor.Instruction, tutor.Schema())
		require.NoError(t, err)
		xa, err := ai.NewStructuredWithModel(f.decoder, ai.Config{}, "screen_decoder_agent", decoder.Instruction, decoder.Schema())
		require.NoError(t, err)
		base, err := tutor.New(t.Context(), quietLog, contentDir, ai.Config{})
		require.NoError(t, err)
		o.AI = &app.AIAgents{
			Scam:    scam.New(t.Context(), quietLog, ai.Config{}),
			Debrief: debrief.NewWithAgent(quietLog, cat, da),
			Tutor:   tutor.NewWithAgent(base, ta),
			Decoder: decoder.NewWithAgent(quietLog, xa),
		}
	}
}

func newAIEnv(t *testing.T) (*p2Env, *aiFakes) {
	f := &aiFakes{
		debrief: &aitest.Fake{Replies: []string{`{"how_you_did":"Your score was {{fact:score_pct}}.","points":[{"finding_id":"NAZ_LATE_RESPONSE","lacked":"The truck turn showed {{fact:late_s}} before you tapped.","could":"Look beside the truck earlier."}]}`}},
		tutor:   &aitest.Fake{Replies: []string{`{"glue_text":"The red octagon asks you to stop, unlike a crossroads sign."}`}},
		decoder: &aitest.Fake{Replies: []string{`{"catalogue_id":"SAR_STAGE_SCRUTINY","doc_kind":"sarathi_status","confidence":0.9,"remark_raw":"Pending at scrutiny"}`}},
	}
	e := newP2EnvCfg(t, nil, aiOption(t, f))
	e.compute.set(func(c *p2Compute) { c.withFindings = true })
	return e, f
}

func TestAPI36_DebriefTemplateWithoutConsentThenAI(t *testing.T) {
	e, f := newAIEnv(t)
	e.seedPublishedClips(22)
	c := e.userClient("learner@example.com")
	sid, _ := gamesCompleted(t, c, clientPreview(72, 10), "1")

	// No ai_coach consent: the template card, and the model is never called.
	r := c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	card := r.json(t)
	require.Equal(t, "template", card["source"])
	require.Equal(t, "debrief.auto_notes", card["label_key"])
	require.Contains(t, card["where_you_lacked"].([]any)[0].(map[string]any)["text"], "1.4 s")
	require.Zero(t, f.debrief.Calls())

	// With consent the ADK agent words the card; the validator passes it.
	c.grant(t, "ai_coach")
	r = c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	card = r.json(t)
	require.Equal(t, "ai", card["source"])
	require.Equal(t, "ai_ready", card["status"])
	require.Equal(t, "debrief.coach_notes", card["label_key"])
	require.Contains(t, card["how_you_did"], "72%")
	require.Contains(t, card["where_you_lacked"].([]any)[0].(map[string]any)["text"], "1.4 s")
	require.Equal(t, 1, f.debrief.Calls())

	// Revoking the consent turns the model off again.
	c.revoke(t, "ai_coach")
	r = c.do("GET", "/v1/games/sessions/"+sid+"/debrief", nil, nil)
	require.Equal(t, "template", r.json(t)["source"])
	require.Equal(t, 1, f.debrief.Calls())
}

func TestAPI41_TutorGlueNeedsConsent(t *testing.T) {
	e, f := newAIEnv(t)
	c := e.userClient("learner@example.com")
	body := map[string]any{"question_id": "C-LL1-001", "variant_id": "v1", "chosen_option_id": "b", "locale": "en"}

	r := c.do("POST", "/v1/tutor/explain", body, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Nil(t, r.json(t)["glue_text"])
	require.Contains(t, r.json(t)["reviewed_text"], "red octagon")
	require.Zero(t, f.tutor.Calls())

	c.grant(t, "ai_coach")
	r = c.do("POST", "/v1/tutor/explain", body, nil)
	require.Contains(t, r.json(t)["glue_text"], "red octagon")
	require.Equal(t, 1, f.tutor.Calls())

	body["variant_id"] = "v99"
	assertProblem(t, c.do("POST", "/v1/tutor/explain", body, nil), http.StatusNotFound, "NOT_FOUND")
}

func TestAPI42_DecodeNeedsConsentAndImage(t *testing.T) {
	e, f := newAIEnv(t)
	c := e.userClient("learner@example.com")
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")

	upload := func(data []byte) resp {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, err := mw.CreateFormFile("image", "status.png")
		require.NoError(t, err)
		_, _ = fw.Write(data)
		require.NoError(t, mw.Close())
		return c.do("POST", "/v1/decode/screenshot", buf.Bytes(), map[string]string{"Content-Type": mw.FormDataContentType()})
	}
	assertProblem(t, upload(png), http.StatusForbidden, "CONSENT_REQUIRED")
	require.Zero(t, f.decoder.Calls())

	c.grant(t, "ai_coach")
	r := upload(png)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	out := r.json(t)
	require.Equal(t, "SAR_STAGE_SCRUTINY", out["catalogue_id"])
	require.Equal(t, true, out["confirm_required"])
	assertProblem(t, upload([]byte("plain text, not an image")), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
}

func TestAPI43_ScamCheckRulesDecide(t *testing.T) {
	e, _ := newAIEnv(t)
	c := e.deviceClient()
	r := c.do("POST", "/v1/scam/check", map[string]any{"text": "Install rto-help.apk and share your OTP now"}, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	out := r.json(t)
	require.Equal(t, "likely_scam", out["verdict"])
	require.Equal(t, "template", out["explanation_source"], "no model configured: the template text")
	require.Contains(t, out["red_flags"], "apk_link")
	assertContract(t, "POST", "/v1/scam/check", r)

	genuine := c.do("POST", "/v1/scam/check", map[string]any{"text": "Book your slot at parivahan.gov.in"}, nil)
	require.Equal(t, "cannot_verify", genuine.json(t)["verdict"], "never 'safe'")
	assertProblem(t, c.do("POST", "/v1/scam/check", map[string]any{}, nil), http.StatusUnprocessableEntity, "VALIDATION_FAILED")
}
