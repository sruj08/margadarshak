package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/debrief"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/decoder"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/tutor"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

// aiConsent is the server-side consent gate that runs before any agent (AGENTS.md §7). The
// principal is the account holder, so a family member's case is gated by the parent's consent.
func (s *Server) aiConsent(r *http.Request, p *accounts.Principal) bool {
	if p == nil || s.deps.Accounts == nil {
		return false
	}
	list, err := s.deps.Accounts.Consents(r.Context(), p)
	if err != nil {
		s.deps.Log.WarnContext(r.Context(), "consent lookup failed; AI off", "err", err)
		return false
	}
	now := s.now()
	for _, c := range list {
		if c.Purpose == "ai_coach" && c.RevokedAt == nil && (c.ExpiresAt == nil || c.ExpiresAt.After(now)) {
			return true
		}
	}
	return false
}

func aiLocale(header string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(header)), "hi") {
		return "hi"
	}
	return "en"
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
	score, found, _ := gamesResultParts(sess.ServerResult, false)
	in := make([]debrief.Finding, 0, len(found))
	for _, f := range found {
		in = append(in, debrief.Finding{ID: f.FindingID, Severity: f.Severity, Critical: f.Critical, DrillIDs: f.DrillIDs, Facts: f.Facts})
	}
	locale := ""
	if params.AcceptLanguage != nil {
		locale = *params.AcceptLanguage
	}
	useAI := s.deps.Debrief.AIEnabled() && s.aiConsent(r, principalFrom(r.Context()))
	card := s.deps.Debrief.Build(r.Context(), sess.ID.String(), score.Pct, in, aiLocale(locale), useAI)
	writeJSON(w, http.StatusOK, card)
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
	useAI := s.deps.Tutor.AIEnabled() && s.aiConsent(r, principalFrom(r.Context()))
	out, err := s.deps.Tutor.Explain(r.Context(), body.QuestionId, body.VariantId, body.ChosenOptionId, aiLocale(locale), useAI)
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
	if !s.aiConsent(r, principalFrom(r.Context())) {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "grant the ai_coach consent to decode a screenshot"})
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
	defer file.Close()
	img, err := io.ReadAll(io.LimitReader(file, decoder.MaxImageBytes+1))
	if err != nil || len(img) == 0 || len(img) > decoder.MaxImageBytes {
		validation(w, r, "/image", "too_large")
		return
	}
	res, err := s.deps.Decoder.Decode(r.Context(), img)
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
