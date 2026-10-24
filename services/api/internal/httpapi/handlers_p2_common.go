package httpapi

// Shared helpers for the P2 handlers (games, learn, gamify, clips, study): who a request acts
// for (family mode), the clip-admin pseudonym, and the P2 problem codes.

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/seed"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

func init() {
	for code, title := range map[string]string{
		"NO_UNSEEN_CLIPS":           "No unseen clips left",
		"SESSION_ALREADY_COMPLETED": "This session was already submitted",
		"SESSION_NOT_COMPLETED":     "This session is not finished yet",
		"PAYLOAD_TOO_LARGE":         "Too much data",
		"REPLAY_REJECTED":           "The session could not be checked",
		"SQUAD_FULL":                "This squad is full",
		"INVITE_EXPIRED":            "This invite link has expired",
		"SHARE_CARD_NOT_ALLOWED":    "Nothing to share yet",
		"CLIP_INVALID_TRANSITION":   "Not possible in this clip's state",
		"RATING_ALREADY_SUBMITTED":  "Ratings are already complete",
		"ADJUDICATOR_IS_RATER":      "Adjudicate a clip you did not rate",
		"BLUR_AUDIT_FAILED":         "The blur audit did not pass",
		"ACCOUNT_REQUIRED":          "Sign in to use this",
	} {
		problemTitles[code] = title
	}
}

// memberRef returns the family_member_id query value or "".
func memberRef[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}

// learnerFor resolves the subject a learning or game request acts for (plan §2.1): the caller,
// or the family member named by memberID. A minor without the parent's recorded consent is 403
// PARENT_CONSENT_REQUIRED; a member that is not the caller's is 404. It writes the problem and
// returns false on failure.
func (s *Server) learnerFor(w http.ResponseWriter, r *http.Request, memberID string) (learner.Subject, bool) {
	p := principalFrom(r.Context())
	if p == nil {
		writeProblem(w, r, Problem{Status: http.StatusUnauthorized, Code: "UNAUTHENTICATED"})
		return learner.Subject{}, false
	}
	if memberID == "" {
		return accounts.LearnerOf(p), true
	}
	var subj learner.Subject
	err := s.deps.DB.Tenant(r.Context(), p.Tenant, func(tx pgx.Tx) error {
		var err error
		subj, err = accounts.ResolveLearner(r.Context(), tx, p, memberID)
		return err
	})
	if err != nil {
		s.learnerError(w, r, err)
		return learner.Subject{}, false
	}
	return subj, true
}

// learnerError maps the family-mode errors every P2 handler shares; it reports whether it wrote.
func (s *Server) learnerError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, learner.ErrParentConsentRequired):
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "PARENT_CONSENT_REQUIRED",
			Detail: "A parent's recorded consent is needed for this family member."})
	case errors.Is(err, learner.ErrUnknownMember):
		writeProblem(w, r, Problem{Status: http.StatusNotFound, Code: "NOT_FOUND", Detail: "unknown family member"})
	case ports.IsComputeUnavailable(err):
		computeUnavailable(w, r)
	default:
		return false
	}
	return true
}

// requireExtra checks a parental extra for a minor ("squads" | "share_cards" | "pair_mode").
func (s *Server) requireExtra(w http.ResponseWriter, r *http.Request, subj learner.Subject, extra string) bool {
	err := s.deps.DB.Tenant(r.Context(), subj.Tenant, func(tx pgx.Tx) error {
		return accounts.RequireExtra(r.Context(), tx, subj, extra)
	})
	if err == nil {
		return true
	}
	if !s.learnerError(w, r, err) {
		s.deps.Log.ErrorContext(r.Context(), "parental extra check failed", "err", err)
		internalError(w, r)
	}
	return false
}

// adminActor is the clip-admin pseudonym of an admin session (rater-01, curator-01). Names never
// reach the clips package; a session without a pseudonym is 403.
func (s *Server) adminActor(w http.ResponseWriter, r *http.Request) (clips.Actor, bool) {
	p := principalFrom(r.Context())
	if p == nil || p.Scope != "admin" {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "clip admin only"})
		return clips.Actor{}, false
	}
	var pseudonym string
	err := s.deps.DB.Tenant(r.Context(), p.Tenant, func(tx pgx.Tx) error {
		a, err := store.GetApplicant(r.Context(), tx, p.ApplicantID)
		if err != nil {
			return err
		}
		pseudonym = seed.PseudonymOf(a.Flags)
		return nil
	})
	if err != nil {
		s.deps.Log.ErrorContext(r.Context(), "admin pseudonym lookup failed", "err", err)
		internalError(w, r)
		return clips.Actor{}, false
	}
	if !clips.ValidPseudonym(pseudonym) {
		writeProblem(w, r, Problem{Status: http.StatusForbidden, Code: "FORBIDDEN", Detail: "this admin session has no clip pseudonym"})
		return clips.Actor{}, false
	}
	return clips.Actor{Pseudonym: pseudonym}, true
}

// computeUnavailable is 503 when the private compute service cannot answer (R-05).
func computeUnavailable(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true,
		RetryAfter: 30 * time.Second, Detail: "the scoring service is not responding; try again shortly"})
}

// serviceMissing is 503 for a P2 part that could not be built at start-up (content not found).
func serviceMissing(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, Problem{Status: http.StatusServiceUnavailable, Code: "ADAPTER_UNAVAILABLE", Retryable: true,
		RetryAfter: 60 * time.Second, Detail: "this feature is not configured on this server"})
}
