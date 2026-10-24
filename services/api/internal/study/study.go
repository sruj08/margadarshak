// Package study is the online Nazar field study (S2; FIELD_STUDY §4, §6, §7; MD-237..240,
// plan §2.10): enrolment (field_study consent, 18+, forms A→B→C by arrival), the per-phase item
// lists, the CSV export that feeds field-kit/nazar_stats.mjs unmodified (its hash is
// pre-registered), and the stats.field_study_publish job step behind API-71.
//
// Persistence (internal/store/study.go) and the clip lookups are local interfaces.
package study

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// Subject is whose data a request touches: learner.Subject (the account or device holder, or
// a family member inside the account; tenant, applicant, member, band, minor, account).
type Subject = learner.Subject

// Participant is study.nazar_participants. It holds only what the consent screen lists
// (FIELD_STUDY §6.1): an anonymous code, bands, form, scores live in the game sessions.
type Participant struct {
	Code         string // P-NNN
	Tenant       string
	ApplicantID  uuid.UUID
	ConsentID    uuid.UUID
	AgeBand      string // 18_20 | 21_24 | 25_34 | 35_plus
	LicenceHeld  string // ll | 2w | 4w | both
	YearsDriving string // 0_1 | 1_3 | 3_plus
	AgeOK        bool
	Form         string // A | B | C
	Seq          int    // arrival order within the tenant, from 1
	RetakeOf     string // the earlier participant code, for test-retest
	NearMissText string // ≤ 140 chars, privacy-scanned; study table only
	CreatedAt    time.Time
	WithdrawnAt  *time.Time
}

// Blocks are the study clip blocks (study.form_blocks): three blocks of 5 clip refs balanced on
// curator difficulty, and the fixed 15-question LL set (qrefs).
type Blocks struct {
	B1, B2, B3 []string
	LLSet      []string
}

// HazardAnalysis is one hazard of the verifier's per-clip analysis (score-verifier verify.ts).
type HazardAnalysis struct {
	HazardID   string   `json:"hazardId"`
	HazardType string   `json:"hazardType"`
	Credit     float64  `json:"credit"`
	Band       *int     `json:"band"`
	TapMt      *float64 `json:"tapMt"`
	LateS      *float64 `json:"lateS"`
	Metres     *float64 `json:"metres"`
	Prediction *string  `json:"prediction"`
}

// ClipAnalysis is one clip of the verifier's analysis (ClipAnalysisJson).
type ClipAnalysis struct {
	Ordinal         int              `json:"ordinal"`
	Ref             string           `json:"ref"`
	Voided          *string          `json:"voided"`
	Taps            int              `json:"taps"`
	MaxTapsInWindow int              `json:"maxTapsInWindow"`
	EarlyTaps       int              `json:"earlyTaps"`
	FalseAlarms     int              `json:"falseAlarms"`
	Marks           float64          `json:"marks"`
	Hazards         []HazardAnalysis `json:"hazards"`
}

// NazarAnalysis is one analysis kind (rule kerala_5band or field_kit_linear).
type NazarAnalysis struct {
	Rule  string         `json:"rule"`
	Clips []ClipAnalysis `json:"clips"`
}

// Analysis kinds requested from /verify (score-verifier ANALYSIS_KINDS).
const (
	KindPrimary = "nazar_clips"        // kerala_5band (product rule, primary score)
	KindLinear  = "nazar_clips_linear" // field_kit_linear (sensitivity score)
)

// Phases of the study flow (FIELD_STUDY §4.3).
const (
	PhaseLLMock   = "ll_mock"
	PhaseTest     = "test"
	PhaseFeedback = "feedback"
	PhaseFresh    = "fresh"
)

// Session is one verified study game session as stored with the game session
// (game.sessions.analysis holds the verifier's per-clip analysis).
type Session struct {
	ParticipantCode string
	Phase           string
	SessionID       uuid.UUID
	Trust           float64
	DurationMs      int64
	ScoreRaw        float64 // ll_mock: correct answers
	ScoreMax        float64 // ll_mock: questions
	Analysis        map[string]NazarAnalysis
	VerifiedAt      time.Time
	TimingMode      string // rvfc | fallback | sim | none (clip_responses.csv; empty when the store does not read it)
}

// PublicStats is one study.public_stats row (API-71 PublicStats.nazar).
type PublicStats struct {
	AsOf         time.Time
	Payload      map[string]any
	ScriptSHA256 string
	PreregCommit string
}

// Store persists the study (internal/store/study.go at handover; RLS on study.*).
type Store interface {
	// NextSeq atomically allocates the next arrival number for tenant (1, 2, 3, …).
	NextSeq(ctx context.Context, tenant string) (int, error)
	InsertParticipant(ctx context.Context, p *Participant) error
	UpdateParticipant(ctx context.Context, p *Participant) error
	GetParticipant(ctx context.Context, tenant, code string) (*Participant, error)
	// ParticipantsByApplicant returns the applicant's participants, oldest first.
	ParticipantsByApplicant(ctx context.Context, tenant string, applicant uuid.UUID) ([]*Participant, error)
	Participants(ctx context.Context, tenant string) ([]*Participant, error)
	Sessions(ctx context.Context, tenant string) ([]*Session, error)
	FormBlocks(ctx context.Context, tenant string) (*Blocks, error)
	SavePublicStats(ctx context.Context, tenant string, s *PublicStats) error
}

// Consents finds the subject's active consent artefact for a purpose.
type Consents interface {
	ActiveConsent(ctx context.Context, tenant string, applicant uuid.UUID, purpose string) (consentID uuid.UUID, ok bool, err error)
}

// RaterRow is one raters.csv source row: the two raters' onsets of a clip's first matched hazard
// (clips.Service.RaterOnsets at handover).
type RaterRow struct {
	ClipID        string
	RaterAOnsetMs int
	RaterBOnsetMs int
}

// RaterSource returns rater rows for the study clips.
type RaterSource interface {
	RaterOnsets(ctx context.Context, clipIDs []string) ([]RaterRow, error)
}

// SpeedSource returns the curator speed estimate (km/h) per clip ref (from clip scoring docs).
type SpeedSource interface {
	ClipSpeeds(ctx context.Context, refs []string) (map[string]float64, error)
}

// Errors.
var (
	ErrDeclined         = errors.New("study: consent declined; nothing is stored")
	ErrUnder18          = errors.New("study: participants must be 18 or older; nothing is stored")
	ErrConsentRequired  = errors.New("study: an active field_study consent is required")
	ErrNotFound         = errors.New("study: not found")
	ErrUnknownPhase     = errors.New("study: unknown phase")
	ErrBlocksNotReady   = errors.New("study: form blocks are not configured (3 × 5 clips and 15 LL questions)")
	ErrWithdrawn        = errors.New("study: participant has withdrawn")
	ErrStatsMismatch    = errors.New("study: nazar_stats.mjs counts do not match the export")
	ErrMissingSpeed     = errors.New("study: a scored clip has no speed estimate")
	ErrNotEnoughBlocks  = errors.New("study: at least 15 usable clips are needed for three blocks of 5")
	ErrUnparsableOutput = errors.New("study: nazar_stats.mjs output not recognised")
)

// ValidationError points at an invalid input field.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "study: invalid " + e.Pointer + ": " + e.Code }

// Service is the study backend.
type Service struct {
	Store    Store
	Consents Consents
	Raters   RaterSource
	Speeds   SpeedSource
	Clock    servertime.Clock
	Log      *slog.Logger
	// DefaultTenant is the tenant the job steps use when their args name none (the Render
	// Workflows nightly_stats task sends {stats_id, as_of}; TENANT_DEFAULT).
	DefaultTenant string
}

func (s *Service) now() time.Time { return s.Clock.Now().UTC() }

// StepFunc is a job step (the signature of jobs.StepFunc; this package does not import jobs, so
// internal/store can implement Store without an import cycle).
type StepFunc = func(ctx context.Context, args map[string]any) (map[string]any, error)
