// Package learn is the learning domain behind API-30..33 (GAMIFICATION_ENGINE §4–§6, plan §2.4):
// the curriculum modules (API-30), LL answers in offline-sync batches (API-32), the FSRS review
// queue (API-31) and Test Readiness (API-33). The maths (FSRS, mastery, readiness, calibration)
// runs in the TypeScript compute service (/learn/answers, /learn/state; decision D1); Go keeps
// the policy, the append-only review log and a cached state snapshot it serves when the compute
// service is down.
//
// Persistence (internal/store/learn.go) and compute (NewComputeVia) are local interfaces.
package learn

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// Subject is whose data a request touches: learner.Subject (the account or device holder, or
// a family member inside the account; tenant, applicant, member, band, minor, account).
type Subject = learner.Subject

// LogRow is one learn.review_log row (append-only).
type LogRow struct {
	CardID        string    `json:"card_id"`
	Rating        int       `json:"rating"`
	ReviewedAt    time.Time `json:"reviewed_at"`
	SourceKind    string    `json:"source_kind"` // answer | session | prediction
	SourceID      string    `json:"source_id"`
	Confidence    string    `json:"confidence,omitempty"`
	Correct       *bool     `json:"correct,omitempty"`
	Overconfident bool      `json:"overconfident"`
}

// StoredAnswer is one learn.answers row, UNIQUE (tenant, applicant, member, client_answer_id).
type StoredAnswer struct {
	ClientAnswerID string
	QRef           string
	CardID         string
	Topic          string
	Correct        bool
	Rating         int
	Overconfident  bool
	Confidence     string
	AnsweredAt     time.Time
	ReviewedAt     time.Time
	NextDueAt      time.Time
	ReceivedAt     time.Time
}

// Snapshot is the cached /learn/state output (learn.card_state, learn.topic_mastery,
// learn.readiness_snapshots at handover).
type Snapshot struct {
	ComputedAt    time.Time
	LogCount      int
	State         StateResponse
	NazarScore    *float64
	NazarSessions int
}

// Store persists learning data (internal/store/learn.go at handover; RLS on learn.*).
type Store interface {
	// AnswersByClientID returns the stored answers among ids.
	AnswersByClientID(ctx context.Context, subj Subject, ids []string) (map[string]*StoredAnswer, error)
	// SaveAnswers inserts each answer with its review-log row atomically, skipping answers whose
	// client_answer_id already exists (a concurrent sync); it returns the IDs it inserted, and
	// replaces the cached card states.
	SaveAnswers(ctx context.Context, subj Subject, answers []*StoredAnswer, logs map[string]LogRow, cards []json.RawMessage) ([]string, error)
	// AppendLog appends review-log rows, ignoring a row whose (source_kind, source_id, card_id)
	// already exists; it returns how many were appended.
	AppendLog(ctx context.Context, subj Subject, rows []LogRow) (int, error)
	ReviewLog(ctx context.Context, subj Subject) ([]LogRow, error)
	LogCount(ctx context.Context, subj Subject) (int, error)
	// RecentRatedAnswers returns the last n confidence-rated LL answers, oldest first.
	RecentRatedAnswers(ctx context.Context, subj Subject, n int) ([]RatedAnswer, error)
	LatestSnapshot(ctx context.Context, subj Subject) (*Snapshot, error)
	SaveSnapshot(ctx context.Context, subj Subject, s *Snapshot) error
}

// NazarScorer is games.Service.NazarScore: the mean of the last 3 eligible mocks (nil when
// there is none) and the number of eligible sessions.
type NazarScorer interface {
	NazarScore(ctx context.Context, subj Subject) (*float64, int, error)
}

// GateSource supplies the readiness gate input: verified LL mock percentages (oldest first) and
// the state's pass mark. Optional; without it the gate reports no_mock_data.
type GateSource interface {
	LLGateInput(ctx context.Context, subj Subject) (*GateInput, error)
}

// Errors.
var (
	ErrNotFound           = errors.New("learn: not found")
	ErrComputeUnavailable = errors.New("learn: compute service unavailable")
	ErrBatchTooLarge      = errors.New("learn: at most 200 answers per batch")
	ErrEmptyBatch         = errors.New("learn: the batch has no answers")
)

// ValidationError points at an invalid input field.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "learn: invalid " + e.Pointer + ": " + e.Code }

// Service is the learning backend.
type Service struct {
	Store   Store
	Compute LearnCompute
	Catalog *Catalog
	Nazar   NazarScorer
	Gate    GateSource
	Clock   servertime.Clock
	Log     *slog.Logger
	// StaleAfter is how long a snapshot is served before it is recomputed even when no new
	// evidence arrived (retrievability decays with time). Default 1 h.
	StaleAfter time.Duration
}

func (s *Service) now() time.Time { return s.Clock.Now().UTC() }

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return logging.Discard()
}

// TopicOfCard returns the module of a concept card `C-<module>-<nnn>` (gamification topicOfCard).
func TopicOfCard(cardID string) string {
	parts := strings.Split(cardID, "-")
	if len(parts) >= 3 && parts[0] == "C" {
		return parts[1]
	}
	return ""
}
