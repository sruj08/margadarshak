package gamify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// GamifyCompute mirrors POST /gamification/evaluate (score-verifier routes/learn.ts).
type GamifyCompute interface {
	Evaluate(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error)
}

// SessionLike is the SessionResult subset XP and badges read (strict on the TS side).
type SessionLike struct {
	GameID    string        `json:"gameId"`
	Mode      string        `json:"mode"`
	Score     SessionScore  `json:"score"`
	Findings  []FindingLike `json:"findings,omitempty"`
	Integrity Integrity     `json:"integrity"`
}

// SessionScore is score {pct, capApplied}.
type SessionScore struct {
	Pct        float64 `json:"pct"`
	CapApplied *string `json:"capApplied,omitempty"`
}

// FindingLike is {findingId, critical}.
type FindingLike struct {
	FindingID string `json:"findingId"`
	Critical  bool   `json:"critical"`
}

// Integrity is {trust, flags}.
type Integrity struct {
	Trust float64  `json:"trust"`
	Flags []string `json:"flags"`
}

// Reviews is a review sitting.
type Reviews struct {
	DueCardsReviewed int     `json:"dueCardsReviewed"`
	ReviewMinutes    float64 `json:"reviewMinutes"`
}

// ClosedWeek is a finished week not yet closed.
type ClosedWeek struct {
	WeekKey  string `json:"weekKey"`
	Sessions int    `json:"sessions"`
}

// NazarHistory is badgeHistory.nazar.
type NazarHistory struct {
	Score         *float64 `json:"score"`
	EligibleMocks int      `json:"eligibleMocks"`
}

// KhudLicenceHistory is badgeHistory.declarations.khudLicence.
type KhudLicenceHistory struct {
	DLIssueDate string `json:"dlIssueDate"`
}

// DeclarationsHistory is badgeHistory.declarations.
type DeclarationsHistory struct {
	KhudLicence      *KhudLicenceHistory `json:"khudLicence,omitempty"`
	FirstAttemptPass *bool               `json:"firstAttemptPass,omitempty"`
}

// BadgeHistory is the evaluate badgeHistory (fields Go fills today).
type BadgeHistory struct {
	HasAccount   bool                 `json:"hasAccount"`
	Declarations *DeclarationsHistory `json:"declarations,omitempty"`
	Nazar        *NazarHistory        `json:"nazar,omitempty"`
}

// EvaluateRequest is the /gamification/evaluate body.
type EvaluateRequest struct {
	Now                int64             `json:"now"`
	Session            *SessionLike      `json:"session,omitempty"`
	MinutesToday       float64           `json:"minutesToday"`
	SessionMinutes     float64           `json:"sessionMinutes"`
	Reviews            *Reviews          `json:"reviews,omitempty"`
	XPTotal            int               `json:"xpTotal"`
	NodeStates         map[string]string `json:"nodeStates"`
	VerifiedNazarMocks int               `json:"verifiedNazarMocks"`
	CurrentRank        *string           `json:"currentRank"`
	StreakState        json.RawMessage   `json:"streakState"` // null starts a streak
	StreakGoal         int               `json:"streakGoal,omitempty"`
	WeekKey            string            `json:"weekKey"`
	SessionsThisWeek   int               `json:"sessionsThisWeek"`
	ClosedWeeks        []ClosedWeek      `json:"closedWeeks"`
	BadgeHistory       BadgeHistory      `json:"badgeHistory"`
	EarnedBadges       []string          `json:"earnedBadges"`
}

// XPAward is gamification XpAward.
type XPAward struct {
	XP          int     `json:"xp"`
	Base        float64 `json:"base"`
	Quality     float64 `json:"quality"`
	Diminish    float64 `json:"diminish"`
	TrustFactor float64 `json:"trustFactor"`
	ZeroReason  string  `json:"zeroReason,omitempty"`
}

// BadgeStatus is one of the nine badge statuses.
type BadgeStatus struct {
	ID        string  `json:"id"`
	Key       string  `json:"key"`
	Shape     string  `json:"shape"`
	Earned    bool    `json:"earned"`
	Available bool    `json:"available"`
	YourWord  bool    `json:"yourWord"`
	Label     *string `json:"label"`
}

// EvaluateResponse is the /gamification/evaluate response.
type EvaluateResponse struct {
	XP struct {
		Session *XPAward `json:"session"`
		Reviews *XPAward `json:"reviews"`
		Gained  int      `json:"gained"`
		Total   int      `json:"total"`
	} `json:"xp"`
	Rank struct {
		Rank     string          `json:"rank"`
		Name     string          `json:"name"`
		Shape    string          `json:"shape"`
		Next     json.RawMessage `json:"next"`
		Promoted bool            `json:"promoted"`
	} `json:"rank"`
	Streak struct {
		State  json.RawMessage `json:"state"`
		Events []string        `json:"events"`
		Notify bool            `json:"notify"`
		View   json.RawMessage `json:"view"`
	} `json:"streak"`
	Badges struct {
		Statuses []BadgeStatus `json:"statuses"`
		Awarded  []string      `json:"awarded"`
		Revoked  []string      `json:"revoked"`
	} `json:"badges"`
}

// Poster is the one method a signed compute client needs (see clips.Poster).
type Poster interface {
	PostJSON(ctx context.Context, path string, in, out any) error
}

// IsUnavailable reports whether err means the compute service could not answer.
func IsUnavailable(err error) bool {
	var u interface{ Unavailable() bool }
	if errors.As(err, &u) && u.Unavailable() {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrComputeUnavailable)
}

// NewComputeVia builds GamifyCompute on a Poster.
func NewComputeVia(p Poster) GamifyCompute { return via{p} }

type via struct{ p Poster }

func (v via) Evaluate(ctx context.Context, req EvaluateRequest) (*EvaluateResponse, error) {
	var out EvaluateResponse
	if err := v.p.PostJSON(ctx, "/gamification/evaluate", req, &out); err != nil {
		if IsUnavailable(err) && !errors.Is(err, ErrComputeUnavailable) {
			return nil, fmt.Errorf("%w: %w", ErrComputeUnavailable, err)
		}
		return nil, err
	}
	return &out, nil
}
