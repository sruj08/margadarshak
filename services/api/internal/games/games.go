// Package games is the domain logic of game sessions: API-34 (start), API-35 (complete), the
// sessions.replay_pending job step and the Nazar Score (GAME_SDK §6, NAZAR §2.5, plan §2.3).
//
// The server issues the seed and the items; the verifier's replay result always wins (D-11); a
// session the verifier could not check is stored as pending_verification and re-checked later.
// Every dependency is an interface defined here so the logic is testable with in-memory fakes:
//
//	TxRunner    *store.DB (Tenant / System transactions)
//	Store       internal/store/games.go (game.sessions, session_items, clip_exposures, staircase)
//	ClipSource  internal/clips (F): scoring documents, mock-eligible clips, presigned media URLs
//	Compute     adapters/compute (POST /verify)
//	Awards      internal/gamify (B), StudyHook internal/study (H)
//	RulePack    rulekit: rule-pack version and the LL mock format (API-03)
//	Staircase   store-backed difficulty staircase (GAME_SDK §7)
//	StudyForms  internal/study (H): fixed item lists for the online study phases
//
// Subject is learner.Subject (plan §2.1); the seams VerifiedSession, Awards, StudyHook and
// NazarScore keep the signatures of plan §2.11.3. The wiring is in internal/app/p2.go.
package games

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// Game IDs handled by this package.
const (
	GameNazar            = "nazar"
	GameLLSim            = "ll_sim"
	GameStoppingDistance = "stopping_distance"
	GameBlindSpot        = "blind_spot"
)

// Modes (game-core GameMode).
const (
	ModeLearn    = "learn"
	ModePractice = "practice"
	ModeMock     = "mock"
	ModePair     = "pair"
)

// Session statuses (game.sessions.status).
const (
	StatusStarted             = "started"
	StatusChecked             = "checked"
	StatusPendingVerification = "pending_verification"
	StatusVoided              = "voided"
)

// Exposure channels (game.clip_exposures.via).
const (
	ViaMock     = "mock"
	ViaPractice = "practice"
	ViaLearn    = "learn"
	ViaReplay   = "replay"
	ViaStudy    = "study"
)

// Eligibility keys (VerifiedSession.Eligible, game.sessions.eligibility).
const (
	EligibleXP          = "xp"          // any verified session (GAME_SDK §6.4)
	EligibleBadges      = "badges"      // verified
	EligibleCounted     = "counted"     // verified and trust ≥ 0.6 ("counted for your card")
	EligibleNazarScore  = "nazar_score" // §6.4 Nazar Score row
	EligiblePercentiles = "percentiles" // as nazar_score (the ≥ 200-mock baseline is checked by the reader)
)

// Limits and fixed values.
const (
	SessionTTL        = 60 * time.Minute // expiresAt = server time + 60 min (GAME_SDK §4.4)
	MaxReplayChars    = 524_288          // 512 KB of base64; the verifier's own cap
	MaxClientResult   = 64 << 10
	TrustThreshold    = 0.6
	NazarMockClips    = 10
	NazarScoreWindow  = 3
	PendingPageSize   = 50
	LabelKey          = "game.familiarisation_not_certification"
	CounterCounted    = "game_sessions_counted"
	SeedOriginServer  = "server"
	CohortFieldTest   = "field_test"
	mockCandidatePool = 500
)

// Errors. The HTTP layer maps them to problems (see the report for the table).
var (
	ErrNotFound         = errors.New("games: session not found")
	ErrUnsupportedGame  = errors.New("games: game not available")
	ErrUnsupportedMode  = errors.New("games: mode not available for this game")
	ErrNoUnseenClips    = errors.New("games: not enough unseen mock clips") // 409 NO_UNSEEN_CLIPS
	ErrPoolTooSmall     = errors.New("games: item pool too small")
	ErrDigestConflict   = errors.New("games: session already completed with a different digest")
	ErrReplayTooLarge   = errors.New("games: replay exceeds 512 KB")
	ErrInvalidReplay    = errors.New("games: invalid replay package")
	ErrSessionVoided    = errors.New("games: session was voided")
	ErrReplayRejected   = errors.New("games: replay rejected by the verifier")
	ErrStudyUnavailable = errors.New("games: study forms not configured")
)

// RejectedError carries the verifier's problem type for a rejected replay.
type RejectedError struct{ ProblemType string }

func (e *RejectedError) Error() string { return "games: replay rejected: " + e.ProblemType }

// Is matches ErrReplayRejected.
func (e *RejectedError) Is(target error) bool { return target == ErrReplayRejected }

// Subject is whose data a request touches: learner.Subject (the account or device holder, or
// a family member inside the account; tenant, applicant, member, band, minor, account).
type Subject = learner.Subject

// Item is one session item (game.session_items).
type Item struct {
	Ordinal        int
	Ref            string // game-core ItemRef: clip:JMU-0012@3, q:C-LL1-001:v1, sd:r1-40-dry
	ContentVersion string
	Kind           string // clip, q, sd, bs, ...
}

// Replay is the client's replay package (game-core ReplayPackage).
type Replay struct {
	TelemetryVersion int    `json:"telemetryVersion"`
	Encoding         string `json:"encoding"`
	Inputs           string `json:"inputs"`
	Digest           string `json:"digest"`
	EventCount       int    `json:"eventCount"`
}

// Hints is what the API knew at submission (GAME_SDK §6.5).
type Hints struct {
	SeenClip       bool `json:"seenClip"`
	SessionExpired bool `json:"sessionExpired"`
}

// Session is a game session row.
type Session struct {
	ID               uuid.UUID
	Subject          Subject
	GameID           string
	Mode             string
	GameVersion      string
	ScoringVersion   string
	RulePackVersion  string
	Seed             uint32
	SeedOrigin       string
	Difficulty       int
	Status           string
	Cohort           string
	StudyParticipant string
	StudyPhase       string
	Items            []Item
	Context          json.RawMessage // SessionContext as sent to the client
	StartedAt        time.Time
	ExpiresAt        time.Time
	SubmittedAt      *time.Time
	VerifiedAt       *time.Time
	Replay           *Replay
	Hints            Hints
	ClientResult     json.RawMessage
	ServerResult     json.RawMessage
	Analysis         json.RawMessage // {"nazar_clips": …, "nazar_clips_linear": …}
	ClientPct        *float64
	ServerPct        *float64
	Trust            *float64
	Flags            []string
	TimingMode       string
	Eligible         map[string]bool
	RejectedType     string
}

// Exposure records that a subject has seen a clip (UNIQUE per subject and clip; first wins).
type Exposure struct {
	ClipID    string
	Via       string
	SessionID uuid.UUID
	At        time.Time
}

// TxRunner runs transactions (*store.DB satisfies it).
type TxRunner interface {
	Tenant(ctx context.Context, tenant string, fn func(tx pgx.Tx) error) error
	System(ctx context.Context, fn func(tx pgx.Tx) error) error
}

// Store is the game schema data access (internal/store/games.go at handover).
type Store interface {
	InsertSession(ctx context.Context, tx pgx.Tx, s *Session) error
	InsertSessionItems(ctx context.Context, tx pgx.Tx, sessionID uuid.UUID, items []Item) error
	// GetSessionForUpdate locks and returns a session with its items, or ErrNotFound.
	GetSessionForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Session, error)
	// CompleteSession writes a verified outcome (status checked, server result, trust, eligibility).
	CompleteSession(ctx context.Context, tx pgx.Tx, s *Session) error
	// MarkPending stores the submission for a later replay (status pending_verification).
	MarkPending(ctx context.Context, tx pgx.Tx, s *Session) error
	// VoidSession records a rejected replay (status voided).
	VoidSession(ctx context.Context, tx pgx.Tx, s *Session) error
	// ListPending returns up to limit pending sessions, oldest submission first,
	// FOR UPDATE SKIP LOCKED (cross-tenant, System transaction).
	ListPending(ctx context.Context, tx pgx.Tx, limit int) ([]*Session, error)
	// SeenClipIDs returns every clip ID the subject has been exposed to.
	SeenClipIDs(ctx context.Context, tx pgx.Tx, subj Subject) ([]string, error)
	// ClipsSeenBefore returns the clip IDs among ids first seen strictly before t.
	ClipsSeenBefore(ctx context.Context, tx pgx.Tx, subj Subject, ids []string, t time.Time) ([]string, error)
	// RecordExposures inserts exposures, ignoring clips already recorded.
	RecordExposures(ctx context.Context, tx pgx.Tx, subj Subject, ex []Exposure) error
	// RecentItemRefs returns the item refs of the subject's last sessions of gameID, newest first.
	RecentItemRefs(ctx context.Context, tx pgx.Tx, subj Subject, gameID string, limit int) ([]string, error)
	// EligibleMocks returns the server percentages of the subject's last n sessions whose
	// eligibility nazar_score is true, newest verified first.
	EligibleMocks(ctx context.Context, tx pgx.Tx, subj Subject, n int) ([]float64, error)
	// IncrementCounter bumps an ops counter (the store.IncrementCounter pattern).
	IncrementCounter(ctx context.Context, tx pgx.Tx, tenant, name string, by int64) error
}

// ClipItem is a playable clip version.
type ClipItem struct {
	Ref               string // clip:JMU-0012@3
	ClipID            string
	Version           int
	ContentVersion    string
	CuratorDifficulty int // 1–5; 0 = unknown
}

// ClipSource is the clip bank (internal/clips, workstream F).
type ClipSource interface {
	// ScoringDocs returns the game-core NazarClip documents for refs, in order (sent inline to /verify).
	ScoringDocs(ctx context.Context, refs []string) ([]json.RawMessage, error)
	// MockEligible returns up to n published, mock-eligible clips for state, excluding clip IDs.
	MockEligible(ctx context.Context, state string, exclude []string, n int) ([]ClipItem, error)
	// AssetURL presigns the media of ref for session sid.
	AssetURL(ctx context.Context, ref string, sid uuid.UUID) (url, sha string, bytes int64, err error)
}

// PracticeClipSource is optional: practice and learn clips nearest a staircase level. Without it,
// practice draws from the mock-eligible pool, preferring clips the subject has already seen.
type PracticeClipSource interface {
	PracticeClips(ctx context.Context, state string, level, n int) ([]ClipItem, error)
}

// Compute is the verifier (ports.ScoreVerifier).
type Compute = ports.ScoreVerifier

// VerifiedSession is what the award and study hooks receive (plan §2.11.3).
type VerifiedSession struct {
	ID         uuid.UUID
	Subject    Subject
	GameID     string
	Mode       string
	Result     json.RawMessage // the server SessionResult
	Trust      float64
	Eligible   map[string]bool
	DurationMs int64
	VerifiedAt time.Time
}

// AwardSummary is what Awards reports back (B fills it).
type AwardSummary struct {
	XPAwarded     int      `json:"xp_awarded"`
	BadgesAwarded []string `json:"badges_awarded"`
}

// Awards is XP, rank, streak and badges (workstream B), called in the completing transaction.
type Awards interface {
	OnSessionVerified(ctx context.Context, tx pgx.Tx, s VerifiedSession) (AwardSummary, error)
}

// StudyHook is the field-study recorder (workstream H), called for every verified session; it
// ignores sessions outside the study.
type StudyHook interface {
	OnSessionVerified(ctx context.Context, tx pgx.Tx, s VerifiedSession) error
}

// LLFormat is the LL mock format of a tenant (rule pack PRM-LL-FORMAT, API-03).
type LLFormat struct {
	RuleID    string // "LLT-JK", or "default"
	Questions int
}

// RulePack reads the tenant's rule pack.
type RulePack interface {
	Version(ctx context.Context, tenant string) (string, error)
	LLMockFormat(ctx context.Context, tenant string) (LLFormat, error)
}

// Staircase returns the subject's difficulty level 1–5 for a game and skill (GAME_SDK §7).
type Staircase interface {
	Level(ctx context.Context, tx pgx.Tx, subj Subject, gameID, skillID string) (int, error)
}

// StudyForms returns the fixed item refs of a study phase (internal/study, workstream H).
type StudyForms interface {
	FormItems(ctx context.Context, tx pgx.Tx, participant, phase string) ([]string, error)
}

// Clock is the source of server time (servertime.Clock).
type Clock interface{ Now() time.Time }

// Service implements the game-session use cases.
type Service struct {
	DB         TxRunner
	Store      Store
	Clips      ClipSource
	Compute    Compute
	Awards     Awards     // optional
	Study      StudyHook  // optional
	StudyForms StudyForms // optional; required for study sessions
	RulePack   RulePack
	Staircase  Staircase // optional; level 1 without it. A StaircaseRecorder is also updated after practice/learn
	Catalog    *Catalog
	Clock      Clock
	Rand       io.Reader // seed source; crypto/rand when nil
	Log        *slog.Logger
}

// New returns a service with the required dependencies checked.
func New(s Service) (*Service, error) {
	switch {
	case s.DB == nil, s.Store == nil, s.Compute == nil, s.RulePack == nil, s.Catalog == nil, s.Clock == nil:
		return nil, fmt.Errorf("games: DB, Store, Compute, RulePack, Catalog and Clock are required")
	}
	if s.Log == nil {
		s.Log = logging.Discard()
	}
	return &s, nil
}
