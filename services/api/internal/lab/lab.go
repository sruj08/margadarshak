// Package lab is the field-study module's backend (MD-140, F-57, API-70/71): pseudonymous
// journey-test trial logs (token-gated, field_study consent) and the public counters for judges.
// Aggregates with fewer than 5 participants per arm are not shown.
package lab

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/accounts"
	"github.com/sruj08/margadarshak/services/api/internal/audit"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// KMin is the smallest per-arm sample the public stats show.
const KMin = 5

// Errors.
var ErrConsent = errors.New("lab: an active field_study consent is required")

// ValidationError points at a field.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "lab: " + e.Pointer + " " + e.Code }

// Trial is the API-70 input (and output with TrialID).
type Trial struct {
	TrialID          string    `json:"trial_id,omitempty"`
	ParticipantCode  string    `json:"participant_code"`
	Arm              string    `json:"arm"`
	TaskID           string    `json:"task_id"`
	StartedAt        time.Time `json:"started_at"`
	EndedAt          time.Time `json:"ended_at"`
	Errors           *int      `json:"errors,omitempty"`
	Completed        bool      `json:"completed"`
	SUSScore         *float64  `json:"sus_score,omitempty"`
	WouldPayAgent    *bool     `json:"would_pay_agent,omitempty"`
	ConsentID        string    `json:"consent_id"`
	ScreensVisited   *int      `json:"screens_visited,omitempty"`
	BackNavigations  *int      `json:"back_navigations,omitempty"`
	ValidationErrors *int      `json:"validation_errors,omitempty"`
	Selections       []string  `json:"selections,omitempty"`
}

var (
	codeRe      = regexp.MustCompile(`^P-\d{3}$`)
	selectionRe = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,48}$`)
	arms        = map[string]bool{"portal_replica": true, "margdarshak": true}
	tasks       = map[string]bool{"find_fee_and_documents": true, "start_ll_application": true, "choose_class": true, "nazar_mock": true}
)

// Service stores trials and computes public stats.
type Service struct {
	DB    *store.DB
	Clock servertime.Clock
	// Study supplies the published Nazar field-study figures (study.public_stats, written by the
	// stats.field_study_publish step from the pre-registered script). Optional (P2).
	Study StudyStats
}

// StudyStats reads the latest published study figures (store.StudyStore).
type StudyStats interface {
	LatestPublicStats(ctx context.Context, tenant string) (*study.PublicStats, error)
}

// Record stores a trial after checking the participant's field_study consent.
func (s *Service) Record(ctx context.Context, p *accounts.Principal, in Trial) (*Trial, error) {
	switch {
	case !codeRe.MatchString(in.ParticipantCode):
		return nil, &ValidationError{"/participant_code", "invalid"}
	case !arms[in.Arm]:
		return nil, &ValidationError{"/arm", "invalid_enum"}
	case !tasks[in.TaskID]:
		return nil, &ValidationError{"/task_id", "invalid_enum"}
	case in.EndedAt.Before(in.StartedAt):
		return nil, &ValidationError{"/ended_at", "before_start"}
	case in.EndedAt.After(s.Clock.Now().Add(5 * time.Minute)):
		return nil, &ValidationError{"/ended_at", "future_time"}
	case in.SUSScore != nil && (*in.SUSScore < 0 || *in.SUSScore > 100):
		return nil, &ValidationError{"/sus_score", "out_of_range"}
	case len(in.Selections) > 50:
		return nil, &ValidationError{"/selections", "too_many"}
	}
	for _, sel := range in.Selections {
		if !selectionRe.MatchString(sel) {
			return nil, &ValidationError{"/selections", "invalid_token"}
		}
	}
	cid, err := ids.Decode(ids.Consent, in.ConsentID)
	if err != nil {
		return nil, ErrConsent
	}
	id := ids.New()
	out := in
	out.TrialID = ids.Encode(ids.Trial, id)
	err = s.DB.Tenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		c, err := store.GetConsent(ctx, tx, cid)
		if err != nil || c.ApplicantID != p.ApplicantID || c.Purpose != "field_study" || c.RevokedAt != nil {
			return ErrConsent
		}
		row := &store.LabTrial{ID: id, TenantID: p.Tenant, ParticipantCode: in.ParticipantCode, Arm: in.Arm, TaskID: in.TaskID,
			StartedAt: in.StartedAt.UTC(), EndedAt: in.EndedAt.UTC(), Completed: in.Completed, SUSScore: in.SUSScore, WouldPayAgent: in.WouldPayAgent,
			ConsentID: cid, ScreensVisited: in.ScreensVisited, BackNavigations: in.BackNavigations, ValidationErrors: in.ValidationErrors, Selections: in.Selections}
		if in.Errors != nil {
			row.Errors = *in.Errors
		}
		if err := store.InsertLabTrial(ctx, tx, row); err != nil {
			return err
		}
		_, err = audit.Append(ctx, tx, s.Clock.Now(), audit.Entry{Tenant: p.Tenant, Actor: p.Subject(), ActorScope: p.Scope, Action: "lab.trial_recorded",
			Target: out.TrialID, Purpose: "field_study", ConsentID: &cid, Meta: map[string]any{"arm": in.Arm, "task": in.TaskID}})
		return err
	})
	if err != nil {
		return nil, err
	}
	_ = s.DB.System(ctx, func(tx pgx.Tx) error { return store.IncrementCounter(ctx, tx, p.Tenant, "lab_trials_recorded", 1) })
	return &out, nil
}

// Stats is the API-71 response (PublicStats).
type Stats struct {
	AsOf          time.Time        `json:"as_of"`
	Nazar         map[string]any   `json:"nazar"`
	JourneyTest   map[string]any   `json:"journey_test"`
	Counters      map[string]int64 `json:"counters"`
	DisclaimerKey string           `json:"disclaimer_key"`
}

// PublicStats returns live counters and the journey-test medians (arms with n >= 5 only).
func (s *Service) PublicStats(ctx context.Context, tenant string) (*Stats, error) {
	out := &Stats{AsOf: s.Clock.Now().UTC(), Counters: map[string]int64{}, DisclaimerKey: "stats.convenience_sample_preregistered",
		Nazar: map[string]any{"participants": 0, "sample": "convenience", "status": "collecting",
			// P2: the script's figures, null until stats.field_study_publish runs (the web reads every key).
			"below_kerala_60_pct": nil, "ci95": nil, "median_late_s": nil, "prereg_hash": nil}}
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		c, err := store.Counters(ctx, tx, tenant)
		if err != nil {
			return err
		}
		for _, k := range []string{"plans_computed", "cases_started", "lab_trials_recorded"} {
			out.Counters[k] = c[k]
		}
		// P2 live counters (additive): verified sessions that count, and enrolled study participants.
		out.Counters["game_sessions_counted"] = c["game_sessions_counted"]
		var enrolled int64
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM study.nazar_participants WHERE tenant_id = $1 AND withdrawn_at IS NULL`, tenant).Scan(&enrolled); err != nil {
			return err
		}
		out.Counters["nazar_participants"] = enrolled
		n, err := store.LabParticipants(ctx, tx, tenant)
		if err != nil {
			return err
		}
		arms, err := store.LabStats(ctx, tx, tenant, "find_fee_and_documents")
		if err != nil {
			return err
		}
		medians := map[string]any{}
		for _, a := range arms {
			if a.Participants >= KMin {
				medians[a.Arm] = int(a.MedianSeconds + 0.5)
			} else {
				medians[a.Arm] = "suppressed (n < 5)"
			}
		}
		out.JourneyTest = map[string]any{"participants": n, "median_seconds_find_fee_docs": medians}
		return nil
	})
	if err != nil {
		return out, err
	}
	if s.Study != nil {
		// The script's figures replace the placeholders (PublicStats.nazar, additionalProperties).
		ps, err := s.Study.LatestPublicStats(ctx, tenant)
		if err != nil {
			return out, err
		}
		if ps != nil {
			for k, v := range ps.Payload {
				out.Nazar[k] = v
			}
			out.Nazar["script_sha256"] = ps.ScriptSHA256
			out.Nazar["as_of"] = ps.AsOf.UTC()
			if ps.PreregCommit != "" {
				out.Nazar["prereg_hash"] = ps.PreregCommit
			}
			if _, ok := ps.Payload["status"]; !ok {
				out.Nazar["status"] = "published"
			}
		}
	}
	return out, nil
}
