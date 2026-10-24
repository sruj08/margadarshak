// Package gamify is the gamification backend (GAMIFICATION_ENGINE §2–§10, §13; API-38, 39, 44,
// 57; plan §2.4): XP after a verified session (through /gamification/evaluate), ranks gated by
// mastery, the silent weekly streak, badges, co-op squads, share cards and the Khud Licence
// self-declaration.
//
// Rules this package enforces in Go, whatever the client sends:
//   - the XP ledger takes only the reasons session, review, lesson and prediction: never XP for
//     opening the app, sharing or inviting (and the database CHECK says the same);
//   - a streak never produces a notification;
//   - a minor's profile needs the parent's "squads" or "share_cards" extra consent;
//   - share-card numbers are always recomputed on the server.
//
// Persistence (internal/store/gamify.go) and compute (NewComputeVia) are local interfaces.
package gamify

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/learner"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Subject is whose data a request touches: learner.Subject (the account or device holder, or
// a family member inside the account; tenant, applicant, member, band, minor, account).
type Subject = learner.Subject

// XPReason is why XP was earned. Only four reasons exist (GAMIFICATION_ENGINE §2.3).
type XPReason string

// XP reasons (game.xp_ledger reason CHECK).
const (
	ReasonSession    XPReason = "session"
	ReasonReview     XPReason = "review"
	ReasonLesson     XPReason = "lesson"
	ReasonPrediction XPReason = "prediction"
)

// AllowedReasons is the closed set the ledger accepts.
var AllowedReasons = map[XPReason]bool{ReasonSession: true, ReasonReview: true, ReasonLesson: true, ReasonPrediction: true}

// XPEntry is one game.xp_ledger row (append-only, UNIQUE (subject, reason, source_id)).
type XPEntry struct {
	ID              uuid.UUID
	Reason          XPReason
	SourceID        string
	XP              int
	Minutes         float64 // active minutes this activity added to its IST day
	ISTDay          string  // YYYY-MM-DD
	WeekKey         string  // IST ISO week, 2026-W43
	CountsForStreak bool
	Breakdown       json.RawMessage
	At              time.Time
}

// NewXPEntry validates the reason. Opening, sharing, inviting, joining a squad and the rest of
// §2.3 have no reason, so they cannot earn XP.
func NewXPEntry(reason XPReason, sourceID string, xp int, at time.Time) (*XPEntry, error) {
	if !AllowedReasons[reason] {
		return nil, fmt.Errorf("%w: %q", ErrXPReasonNotAllowed, reason)
	}
	if sourceID == "" || xp < 0 {
		return nil, &ValidationError{"/xp", "invalid"}
	}
	return &XPEntry{ID: uuid.New(), Reason: reason, SourceID: sourceID, XP: xp, ISTDay: servertime.DateIST(at), WeekKey: WeekKey(at), At: at.UTC()}, nil
}

// WeekKey is the IST ISO week of t ("2026-W43"), as gamification istWeek.
func WeekKey(t time.Time) string {
	y, w := t.In(servertime.IST).ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

// BadgeRecord is one earned badge.
type BadgeRecord struct {
	ID           string    `json:"id"`
	AwardedAt    time.Time `json:"awarded_at"`
	SelfDeclared bool      `json:"self_declared"`
}

// Progress is the cached E-22 state (game.badges, game.streaks, rank) beside the ledger.
type Progress struct {
	XPTotal    int
	Rank       string // R1..R5; "" before the first evaluation
	RankNext   json.RawMessage
	Streak     json.RawMessage // gamification StreakState, stored verbatim; nil = none yet
	StreakView json.RawMessage
	StreakGoal int
	Badges     map[string]BadgeRecord
	UpdatedAt  time.Time
}

// Declaration is a records.declarations row (API-44, self-declared).
type Declaration struct {
	CaseID           string
	DLIssuedOn       string // YYYY-MM-DD
	NoAgentUsed      bool
	FirstAttemptPass bool
	DeclaredAt       time.Time
}

// Store persists gamification state (internal/store/gamify.go at handover; RLS on game.*).
type Store interface {
	// AppendXP inserts e unless (reason, source_id) exists; it returns whether it inserted. The
	// store refuses any reason outside AllowedReasons (the DB CHECK).
	AppendXP(ctx context.Context, subj Subject, e *XPEntry) (bool, error)
	XPEntryBySource(ctx context.Context, subj Subject, reason XPReason, sourceID string) (*XPEntry, error)
	MinutesOn(ctx context.Context, subj Subject, istDay string) (float64, error)
	XPOn(ctx context.Context, subj Subject, istDay string) (int, error)
	// WeekCounts counts streak sessions per IST week.
	WeekCounts(ctx context.Context, subj Subject) (map[string]int, error)
	GetProgress(ctx context.Context, subj Subject) (*Progress, error)
	SaveProgress(ctx context.Context, subj Subject, p *Progress) error

	GetDeclaration(ctx context.Context, subj Subject) (*Declaration, error)
	SaveDeclaration(ctx context.Context, subj Subject, d *Declaration) error
	DeleteDeclaration(ctx context.Context, subj Subject) error

	InsertSquad(ctx context.Context, s *Squad) error
	GetSquad(ctx context.Context, id uuid.UUID) (*Squad, error)
	SquadByInviteHash(ctx context.Context, hash []byte) (*Squad, error)
	// UpdateSquad saves members; it returns ErrSquadFull above MaxSquadMembers (the DB trigger).
	UpdateSquad(ctx context.Context, s *Squad) error
	SquadsOf(ctx context.Context, subj Subject) ([]*Squad, error)

	InsertShareCard(ctx context.Context, c *ShareCard) error
	GetShareCard(ctx context.Context, shortID string) (*ShareCard, error)
	UpdateShareCard(ctx context.Context, c *ShareCard) error
}

// NodeSource returns cached skill-tree node states (learn.Service.NodeStates).
type NodeSource interface {
	NodeStates(ctx context.Context, subj Subject) (map[string]string, error)
}

// NazarSource returns the Nazar Score (nil when none) and the verified eligible mock count
// (games.Service.NazarScore).
type NazarSource interface {
	NazarScore(ctx context.Context, subj Subject) (*float64, int, error)
}

// BrierSource returns a subject's personal Brier score (nil when not enough rated answers), for
// the squad score.
type BrierSource interface {
	Brier(ctx context.Context, subj Subject) (*float64, error)
}

// Extras reports whether the parent granted an extra consent for a minor member
// (core.family_members.parental_extras: "squads", "share_cards").
type Extras interface {
	HasParentalExtra(ctx context.Context, subj Subject, extra string) (bool, error)
}

// Outbox is the user-message seam (msg.notifications). Gamification never writes to it: a streak,
// a rank or a badge alone never triggers a notification (DP-10). It exists so tests can prove it.
type Outbox interface {
	Enqueue(ctx context.Context, subj Subject, templateID string, vars map[string]string) error
}

// Errors.
var (
	ErrXPReasonNotAllowed    = errors.New("gamify: XP reason not allowed (only session, review, lesson, prediction)")
	ErrParentConsentRequired = privacy.ErrParentalConsentRequired
	ErrAccountRequired       = errors.New("gamify: an account is needed (not an anonymous device session)")
	ErrNotFound              = errors.New("gamify: not found")
	ErrSquadFull             = errors.New("gamify: the squad already has 5 members")
	ErrInviteExpired         = errors.New("gamify: the invite link has expired")
	ErrGone                  = errors.New("gamify: the share card was withdrawn or has expired")
	ErrUnknownField          = errors.New("gamify: unknown field in request (scores are never accepted from the client)")
	ErrNothingToShare        = errors.New("gamify: nothing to put on this card yet")
	ErrComputeUnavailable    = errors.New("gamify: compute service unavailable")
)

// ValidationError points at an invalid input field.
type ValidationError struct{ Pointer, Code string }

func (e *ValidationError) Error() string { return "gamify: invalid " + e.Pointer + ": " + e.Code }

// Tokens makes random codes (invite codes, share-card short IDs).
type Tokens interface {
	Token(alphabet string, n int) string
}

type cryptoTokens struct{}

func (cryptoTokens) Token(alphabet string, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// Service is the gamification backend.
type Service struct {
	Store   Store
	Compute GamifyCompute
	Nodes   NodeSource
	Nazar   NazarSource
	Brier   BrierSource
	Extras  Extras
	Outbox  Outbox
	Tokens  Tokens
	Clock   servertime.Clock
	Log     *slog.Logger
}

func (s *Service) now() time.Time { return s.Clock.Now().UTC() }

func (s *Service) tokens() Tokens {
	if s.Tokens != nil {
		return s.Tokens
	}
	return cryptoTokens{}
}

// requireSocial applies GAMIFICATION_ENGINE §1/§13 to squads and share cards: an account is
// needed, and a minor's profile needs the parent's extra consent for this feature.
func (s *Service) requireSocial(ctx context.Context, subj Subject, extra string) error {
	if !subj.Account {
		return ErrAccountRequired
	}
	if !subj.Minor {
		return nil
	}
	if s.Extras == nil {
		return ErrParentConsentRequired
	}
	ok, err := s.Extras.HasParentalExtra(ctx, subj, extra)
	if err != nil {
		return err
	}
	if !ok {
		return ErrParentConsentRequired
	}
	return nil
}

func (s *Service) progress(ctx context.Context, subj Subject) (*Progress, error) {
	p, err := s.Store.GetProgress(ctx, subj)
	if errors.Is(err, ErrNotFound) {
		return &Progress{Badges: map[string]BadgeRecord{}, StreakGoal: 4}, nil
	}
	if err != nil {
		return nil, err
	}
	if p.Badges == nil {
		p.Badges = map[string]BadgeRecord{}
	}
	if p.StreakGoal == 0 {
		p.StreakGoal = 4
	}
	return p, nil
}
