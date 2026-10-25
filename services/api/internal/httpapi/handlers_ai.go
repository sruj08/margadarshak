package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/aicards"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

// aiFeature pairs a tenant feature flag with the consent purpose that unlocks it.
type aiFeature struct{ flag, purpose string }

var (
	aiCoachFeature = aiFeature{flag: "ai_coach", purpose: "ai_coach"}
	aiVoiceFeature = aiFeature{flag: "voice_guide", purpose: "ai_voice"}
)

// aiGate is the server-side gate that runs before any agent (AGENTS.md §7, D-13 revised): an
// account holder (adult, or a parent acting in family mode, whose member access learnerFor has
// already checked), the tenant's feature flag, and the holder's active consent for the purpose.
// There is no age gate. It returns "" when AI may run, else the fallback reason.
func (s *Server) aiGate(r *http.Request, f aiFeature) string {
	p := principalFrom(r.Context())
	if p == nil || s.deps.Accounts == nil {
		return "no_account"
	}
	if t := tenantFrom(r.Context()); t == nil || !t.Feature(f.flag) {
		return "tenant_flag_off"
	}
	list, err := s.deps.Accounts.Consents(r.Context(), p)
	if err != nil {
		s.deps.Log.WarnContext(r.Context(), "consent lookup failed; AI off", "err", err)
		return "no_consent"
	}
	now := s.now()
	for _, c := range list {
		if c.Purpose == f.purpose && c.RevokedAt == nil && (c.ExpiresAt == nil || c.ExpiresAt.After(now)) {
			return ""
		}
	}
	return "no_consent"
}

// aiRefused writes the 403 for AI-only surfaces (decoder, sign snap, voice) that have no template.
func aiRefused(w http.ResponseWriter, r *http.Request, reason, purpose string) {
	if reason == "tenant_flag_off" {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FEATURE_DISABLED", Detail: "this feature is switched off for your state"})
		return
	}
	writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "grant the " + purpose + " consent to use this"})
}

// tutorLocale is en, hi or hinglish (Dogri reads the Hindi text).
func tutorLocale(header string) string {
	if l := debriefLocale(header); l != "doi" {
		return l
	}
	return "hi"
}

// GetDebrief is API-36: the template card now, AI-worded when consent allows and the draft passes.
func (s *Server) GetDebrief(w http.ResponseWriter, r *http.Request, sessionId gen.SessionId, params gen.GetDebriefParams) {
	if s.deps.Games == nil || s.deps.Debrief == nil {
		serviceMissing(w, r)
		return
	}
	sess, _, ok := s.gamesOwnSession(w, r, sessionId)
	if !ok {
		return
	}
	switch sess.Status {
	case games.StatusChecked:
	case games.StatusPendingVerification:
		w.Header().Set("Retry-After", "5")
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "template_pending"})
		return
	case games.StatusVoided:
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_VOIDED", Detail: "this session's replay was rejected"})
		return
	default:
		writeProblem(w, r, Problem{Status: http.StatusConflict, Code: "SESSION_NOT_COMPLETED", Detail: "finish the session first"})
		return
	}
	locale := ""
	if params.AcceptLanguage != nil {
		locale = *params.AcceptLanguage
	}
	useAI := s.deps.Debrief.AIEnabled() && s.aiGate(r, aiCoachFeature) == ""
	cards := aicards.Service{DB: s.deps.DB, Gen: s.deps.Debrief, Now: s.now, Log: s.deps.Log}
	card, err := cards.Debrief(r.Context(), sess, debriefLocale(locale), useAI)
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "debrief failed", "err", err)
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, card)
}

// debriefLocale maps Accept-Language to en, hi, hinglish (hi-Latn) or doi.
func debriefLocale(header string) string {
	h := strings.ToLower(strings.TrimSpace(header))
	switch {
	case strings.HasPrefix(h, "hi-latn"), strings.HasPrefix(h, "hinglish"):
		return "hinglish"
	case strings.HasPrefix(h, "doi"):
		return "doi"
	case strings.HasPrefix(h, "hi"):
		return "hi"
	}
	return "en"
}

// ExplainAnswer is API-41: reviewed explanation plus optional AI glue.
func (s *Server) ExplainAnswer(w http.ResponseWriter, r *http.Request, params gen.ExplainAnswerParams) {
	if s.deps.Tutor == nil {
		serviceMissing(w, r)
		return
	}
	var body gen.TutorExplainRequest
	if !decodeJSON(w, r, &body, false) {
		return
	}
	locale := ""
	if body.Locale != nil {
		locale = string(*body.Locale)
	} else if params.AcceptLanguage != nil {
		locale = *params.AcceptLanguage
	}
	confidence := 0
	if body.Confidence != nil {
		confidence = int(*body.Confidence)
	}
	useAI := s.deps.Tutor.AIEnabled() && s.aiGate(r, aiCoachFeature) == ""
	out, err := s.deps.Tutor.Explain(r.Context(), body.QuestionId, body.VariantId, body.ChosenOptionId, tutorLocale(locale), confidence, useAI)
	if errors.Is(err, tutor.ErrUnknownItem) {
		notFound(w, r)
		return
	}
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "tutor failed", "err", err)
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// DecodeScreenshot is API-42. The image is read into memory, classified and dropped.
func (s *Server) DecodeScreenshot(w http.ResponseWriter, r *http.Request) {
	if s.deps.Decoder == nil {
		serviceMissing(w, r)
		return
	}
	if reason := s.aiGate(r, aiCoachFeature); reason != "" {
		aiRefused(w, r, reason, "ai_coach")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, decoder.MaxImageBytes+64<<10)
	if err := r.ParseMultipartForm(decoder.MaxImageBytes); err != nil {
		badRequest(w, r, "send a multipart form with an image up to 1 MB")
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		validation(w, r, "/image", "required")
		return
	}
	defer func() { _ = file.Close() }()
	img, err := io.ReadAll(io.LimitReader(file, decoder.MaxImageBytes+1))
	if err != nil || len(img) == 0 || len(img) > decoder.MaxImageBytes {
		validation(w, r, "/image", "too_large")
		return
	}
	ocr := r.FormValue("ocr_text")
	if len([]rune(ocr)) > 4000 {
		validation(w, r, "/ocr_text", "too_long")
		return
	}
	res, err := s.deps.Decoder.Decode(r.Context(), img, ocr)
	switch {
	case errors.Is(err, decoder.ErrDisabled):
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: false, Detail: "screenshot decoding is off; pick the stage from the list"})
	case errors.Is(err, decoder.ErrBadImage):
		validation(w, r, "/image", "unsupported_type")
	case err != nil:
		s.deps.Log.WarnContext(r.Context(), "decoder failed", "err", err)
		writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true, RetryAfter: 5 * time.Second})
	default:
		writeJSON(w, http.StatusOK, res)
	}
}
