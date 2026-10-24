package httpapi

// Online Nazar field study (S2, FIELD_STUDY §4–§7, decisions D-19..D-23): enrolment (API-70,
// not token-gated), the optional near-miss line, and the CSV export that field-kit/nazar_stats.mjs
// runs on unchanged (RW-4 nightly_stats, internal bearer + HMAC). API-71's `nazar` block is
// served by GetPublicStats (internal/lab merges study.public_stats).

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// studyCodeRe is the spec's ParticipantCode pattern.
var studyCodeRe = regexp.MustCompile(`^P-\d{3,4}$`)

// studyPhaseOut is one StudyEnrolment.phases entry.
type studyPhaseOut struct {
	Phase     string `json:"phase"`
	GameID    string `json:"game_id"`
	ItemCount int    `json:"item_count"`
}

// studyEnrolmentOut is the StudyEnrolment wire shape (apps/web/src/features/study/types.ts).
type studyEnrolmentOut struct {
	ParticipantCode string          `json:"participant_code"`
	Form            string          `json:"form"`
	Cohort          string          `json:"cohort"`
	Phases          []studyPhaseOut `json:"phases"`
	AIDebrief       bool            `json:"ai_debrief"`
	CreatedAt       time.Time       `json:"created_at"`
}

// studyPhases is the flow in order (FIELD_STUDY §4.3; D-20: feedback is the replay endpoint on
// the first two test clips, not a game session).
var studyPhases = []studyPhaseOut{
	{Phase: study.PhaseLLMock, GameID: string(gen.GameIdLlSim), ItemCount: 15},
	{Phase: study.PhaseTest, GameID: "nazar", ItemCount: 10},
	{Phase: study.PhaseFeedback, GameID: "nazar", ItemCount: 2},
	{Phase: study.PhaseFresh, GameID: "nazar", ItemCount: 5},
}

func studyEnrolmentFrom(p *study.Participant) studyEnrolmentOut {
	return studyEnrolmentOut{ParticipantCode: p.Code, Form: p.Form, Cohort: "field_test", Phases: studyPhases,
		AIDebrief: false, CreatedAt: p.CreatedAt.UTC()}
}

// studyError maps the study package's errors; it reports whether it wrote a problem.
func (s *Server) studyError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *study.ValidationError
	switch {
	case errors.As(err, &ve) && ve.Code == "PROHIBITED_FIELD":
		writeProblem(w, r, Problem{Status: http.StatusUnprocessableEntity, Code: "PROHIBITED_FIELD",
			Detail: "Leave out names, phone numbers, vehicle or licence numbers and exact places.",
			Errors: []FieldError{{Pointer: ve.Pointer, Code: "PROHIBITED_FIELD", MessageKey: "errors.prohibited_field"}}})
	case errors.As(err, &ve):
		validation(w, r, ve.Pointer, ve.Code)
	case errors.Is(err, study.ErrUnder18):
		validation(w, r, "/age_ok", "under_18")
	case errors.Is(err, study.ErrDeclined):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED", Detail: "consent was declined; nothing is stored"})
	case errors.Is(err, study.ErrConsentRequired):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "CONSENT_REQUIRED",
			Detail: "record the field_study consent (POST /v1/me/consents) before enrolling"})
	case errors.Is(err, study.ErrNotFound), errors.Is(err, study.ErrWithdrawn):
		notFound(w, r)
	default:
		s.deps.Log.ErrorContext(r.Context(), "study request failed", "err", err)
		internalError(w, r)
	}
}

// EnrolNazarStudy is API-70 (S2 enrolment, D-19). An under-18 answer (or a u18 account) is
// refused before anything is read or written; an active field_study consent is required; the
// same session enrolling again gets its participant back with 200, a new participant is 201.
func (s *Server) EnrolNazarStudy(w http.ResponseWriter, r *http.Request, _ gen.EnrolNazarStudyParams) {
	if s.deps.Study == nil {
		serviceMissing(w, r)
		return
	}
	p := principalFrom(r.Context())
	if p == nil {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
		return
	}
	var req gen.StudyEnrolmentCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	subj := accounts.LearnerOf(p)
	in := study.EnrolInput{ConsentGiven: true, AgeOK: bool(req.AgeOk) && !subj.Minor, AgeBand: string(req.AgeBand),
		LicenceHeld: string(req.LicenceHeld), YearsDriving: string(req.YearsDriving)}
	if req.RetakeOf != nil {
		in.RetakeOf = *req.RetakeOf
	}
	if !in.AgeOK {
		// No query at all: the study package refuses this before touching the store.
		s.studyError(w, r, study.ErrUnder18)
		return
	}
	var (
		part    *study.Participant
		created bool
	)
	err := s.deps.DB.Tenant(r.Context(), subj.Tenant, func(tx pgx.Tx) error {
		ctx := store.ContextWithTx(r.Context(), tx)
		if req.ConsentId != nil {
			if err := s.studyCheckConsentID(ctx, subj, *req.ConsentId); err != nil {
				return err
			}
		}
		before, err := s.deps.Study.Store.ParticipantsByApplicant(ctx, subj.Tenant, subj.ApplicantID)
		if err != nil {
			return err
		}
		part, err = s.deps.Study.Enrol(ctx, subj, in)
		if err != nil {
			return err
		}
		created = true
		for _, b := range before {
			if b.Code == part.Code {
				created = false
			}
		}
		return nil
	})
	if err != nil {
		s.studyError(w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, studyEnrolmentFrom(part))
}

// studyCheckConsentID checks an optional consent_id against the session's active field_study
// consent (the server looks it up either way).
func (s *Server) studyCheckConsentID(ctx context.Context, subj study.Subject, raw string) error {
	want, err := ids.Decode(ids.Consent, raw)
	if err != nil {
		return &study.ValidationError{Pointer: "/consent_id", Code: "invalid"}
	}
	got, ok, err := s.deps.Study.Consents.ActiveConsent(ctx, subj.Tenant, subj.ApplicantID, "field_study")
	if err != nil {
		return err
	}
	if !ok {
		return study.ErrConsentRequired
	}
	if got != want {
		return &study.ValidationError{Pointer: "/consent_id", Code: "not_active_consent"}
	}
	return nil
}

// RecordNazarNearMiss is the optional near-miss line (FIELD_STUDY §4.3 step 8, D-21): at most
// 140 characters, privacy-scanned (422 PROHIBITED_FIELD and nothing stored), only from the
// session that enrolled the participant (404 otherwise); a second call replaces the line.
func (s *Server) RecordNazarNearMiss(w http.ResponseWriter, r *http.Request, participantCode gen.ParticipantCode, _ gen.RecordNazarNearMissParams) {
	if s.deps.Study == nil {
		serviceMissing(w, r)
		return
	}
	p := principalFrom(r.Context())
	if p == nil {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
		return
	}
	if !studyCodeRe.MatchString(participantCode) {
		notFound(w, r)
		return
	}
	var req gen.StudyNearMissCreate
	if !decodeJSON(w, r, &req, false) {
		return
	}
	if req.Language != nil && !req.Language.Valid() {
		validation(w, r, "/language", "invalid_enum")
		return
	}
	if err := s.deps.Study.NearMiss(r.Context(), accounts.LearnerOf(p), participantCode, req.Text); err != nil {
		s.studyError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// ExportStudyFile is the RW-4 study export (D-22): sessions.csv (primary kerala_5band score),
// sessions_alt.csv (field-kit linear score), raters.csv and clip_responses.csv, exactly the
// FIELD_STUDY §7.1 columns; trust < 0.6 and withdrawn participants are left out, frozen_at applies
// the §7.4 freeze. Every read is audited with the file's sha256.
func (s *Server) ExportStudyFile(w http.ResponseWriter, r *http.Request, file gen.ExportStudyFileParamsFile, params gen.ExportStudyFileParams) {
	if s.deps.Study == nil {
		serviceMissing(w, r)
		return
	}
	if !file.Valid() {
		notFound(w, r)
		return
	}
	tenant := tenantFrom(r.Context()).TenantID
	var frozen time.Time
	if params.FrozenAt != nil {
		frozen = params.FrozenAt.UTC()
	}
	ex, err := s.deps.Study.ExportFrozen(r.Context(), tenant, frozen)
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "study export failed", "err", err)
		internalError(w, r)
		return
	}
	body, ok := ex.Files[string(file)]
	if !ok {
		notFound(w, r)
		return
	}
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	meta := map[string]any{"sha256": digest, "rows": strings.Count(string(body), "\n") - 1, "kept_by_script": ex.Summary.KeptByScript,
		"excluded_low_trust": len(ex.Summary.ExcludedLowTrust)}
	if !frozen.IsZero() {
		meta["frozen_at"] = frozen
	}
	if err := s.auditInternal(r, tenant, "internal.study_export", string(file), meta); err != nil {
		s.deps.Log.ErrorContext(r.Context(), "study export audit failed", "err", err)
		internalError(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("ETag", `"sha256:`+digest+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
