package httpapi

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"regexp"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/analytics"
	"github.com/sruj08/margadarshak/services/api/internal/dsr"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/lab"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
)

var tokenRe = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,48}$`)

// ExportMyData is API-61: the bundle is built now and kept encrypted for 24 h.
func (s *Server) ExportMyData(w http.ResponseWriter, r *http.Request, _ gen.ExportMyDataParams) {
	ref, err := s.deps.DSR.Export(r.Context(), principalFrom(r.Context()))
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "export failed", "err", err)
		internalError(w, r)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "accepted", "job_id": ref.ExportID,
		"download_url": "/v1/me/exports/" + ref.ExportID, "expires_at": ref.ExpiresAt.UTC()})
}

// GetMyDataExport downloads an export bundle.
func (s *Server) GetMyDataExport(w http.ResponseWriter, r *http.Request, exportID string) {
	raw, err := s.deps.DSR.Download(r.Context(), principalFrom(r.Context()), exportID)
	switch {
	case errors.Is(err, dsr.ErrNotFound):
		notFound(w, r)
		return
	case errors.Is(err, dsr.ErrExpired):
		writeProblem(w, r, Problem{Status: http.StatusGone, Code: "GONE_DELETED", Detail: "the export link expired; ask for a new export"})
		return
	case err != nil:
		internalError(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="margdarshak-export.json"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// IngestAnalytics is API-63 (MD-136).
func (s *Server) IngestAnalytics(w http.ResponseWriter, r *http.Request) {
	var req gen.IngestAnalyticsJSONBody
	if !decodeJSON(w, r, &req, false) {
		return
	}
	evs := make([]analytics.Event, 0, len(req.Events))
	for _, e := range req.Events {
		props := map[string]any{}
		if e.Props != nil {
			props = *e.Props
		}
		evs = append(evs, analytics.Event{Name: e.Name, Props: props})
	}
	caseRef := ""
	if req.CaseId != nil {
		caseRef = *req.CaseId
	}
	_, err := s.deps.Analytics.Ingest(r.Context(), principalFrom(r.Context()), caseRef, evs)
	var ve *analytics.ValidationError
	if errors.As(err, &ve) {
		validation(w, r, ve.Pointer, ve.Code)
		return
	}
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "analytics ingest failed", "err", err)
		internalError(w, r)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) labTokenOK(r *http.Request, params gen.RecordLabTrialParams) bool {
	tok := ""
	if params.XLabToken != nil {
		tok = *params.XLabToken
	}
	for _, t := range s.deps.LabTokens {
		if t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(tok)) == 1 {
			return true
		}
	}
	return false
}

// RecordLabTrial is API-70 (MD-140): token-gated (404 without X-Lab-Token).
func (s *Server) RecordLabTrial(w http.ResponseWriter, r *http.Request, params gen.RecordLabTrialParams) {
	if !s.labTokenOK(r, params) {
		notFound(w, r)
		return
	}
	var req gen.LabTrialCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	in := lab.Trial{ParticipantCode: req.ParticipantCode, Arm: string(req.Arm), TaskID: string(req.TaskId), StartedAt: req.StartedAt, EndedAt: req.EndedAt,
		Errors: req.Errors, Completed: req.Completed, WouldPayAgent: req.WouldPayAgent, ConsentID: req.ConsentId, ScreensVisited: req.ScreensVisited,
		BackNavigations: req.BackNavigations, ValidationErrors: req.ValidationErrors}
	if req.SusScore != nil {
		v := float64(*req.SusScore)
		in.SUSScore = &v
	}
	if req.Selections != nil {
		in.Selections = *req.Selections
	}
	out, err := s.deps.Lab.Record(r.Context(), principalFrom(r.Context()), in)
	var ve *lab.ValidationError
	switch {
	case errors.As(err, &ve):
		validation(w, r, ve.Pointer, ve.Code)
	case errors.Is(err, lab.ErrConsent):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "an active field_study consent of the participant is required"})
	case err != nil:
		internalError(w, r)
	default:
		writeJSON(w, http.StatusCreated, out)
	}
}

// GetPublicStats is API-71.
func (s *Server) GetPublicStats(w http.ResponseWriter, r *http.Request) {
	out, err := s.deps.Lab.PublicStats(r.Context(), tenantFrom(r.Context()).TenantID)
	if err != nil {
		internalError(w, r)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, out)
}

// DeleteMe is API-62: erasure now (EC-26) — timers and pending messages cancelled, contacts
// crypto-shredded, consents withdrawn (proofs kept), sessions revoked.
func (s *Server) DeleteMe(w http.ResponseWriter, r *http.Request) {
	if _, err := s.deps.DSR.DeleteAccount(r.Context(), principalFrom(r.Context())); err != nil {
		s.accountError(w, r, err)
		return
	}
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusAccepted, gen.Accepted{Status: gen.AcceptedStatusAccepted})
}

// ---- Demo persona switcher (MD-122, demo tenant only) -----------------------------------------

func (s *Server) demoAllowed(r *http.Request) bool {
	t := tenantFrom(r.Context())
	return s.deps.DemoPersonas && t != nil && t.Feature("persona_switcher")
}

// ListDemoPersonas lists the synthetic personas.
func (s *Server) ListDemoPersonas(w http.ResponseWriter, r *http.Request) {
	if !s.demoAllowed(r) {
		notFound(w, r)
		return
	}
	items := []map[string]any{}
	for _, p := range seed.Personas(12) {
		if p.SwitcherID == "" {
			continue
		}
		items = append(items, map[string]any{"persona_id": p.SwitcherID, "ref": p.ID, "label": p.Label, "description_key": "persona." + p.SwitcherID, "synthetic": true})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// StartDemoPersonaSession re-seeds a persona relative to today and signs in as it.
func (s *Server) StartDemoPersonaSession(w http.ResponseWriter, r *http.Request, personaID gen.StartDemoPersonaSessionParamsPersonaId) {
	if !s.demoAllowed(r) {
		notFound(w, r)
		return
	}
	p, ok := seed.FindSwitcher(string(personaID))
	if !ok {
		notFound(w, r)
		return
	}
	t := tenantFrom(r.Context())
	d := s.deps.Seed
	d.Now = s.now()
	id, err := seed.ResetPersona(r.Context(), d, t.TenantID, p)
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "persona reset failed", "err", err)
		internalError(w, r)
		return
	}
	sess, err := s.deps.Accounts.PersonaSession(r.Context(), t.TenantID, id)
	if errors.Is(err, accounts.ErrNotSynthetic) {
		notFound(w, r)
		return
	}
	if err != nil {
		internalError(w, r)
		return
	}
	s.tokenPair(w, r, http.StatusCreated, sess)
}
