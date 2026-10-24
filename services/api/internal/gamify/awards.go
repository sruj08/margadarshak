package gamify

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// ReviewsPerStreakSession is how many due reviews in one sitting count as a streak session.
const ReviewsPerStreakSession = 10

// VerifiedSession is what the games package hands over after the verifier checked a session
// (games.VerifiedSession at handover; plan §2.11.3).
type VerifiedSession struct {
	ID         uuid.UUID
	Subject    Subject
	GameID     string
	Mode       string          // learn | practice | mock | pair
	Result     json.RawMessage // the server SessionResult
	DurationMs int64
	VerifiedAt time.Time
}

// AwardSummary is what a verified session earned. There is no notification field: nothing here
// is ever pushed to the user (DP-10).
type AwardSummary struct {
	XPAwarded     int             `json:"xp_awarded"`
	XPTotal       int             `json:"xp_total"`
	Rank          string          `json:"rank"`
	RankName      string          `json:"rank_name"`
	Promoted      bool            `json:"promoted"`
	BadgesAwarded []string        `json:"badges_awarded"`
	Streak        json.RawMessage `json:"streak"`
	Replayed      bool            `json:"replayed"`
}

// sessionLike extracts the SessionResultLike subset from a SessionResult.
func sessionLike(gameID, mode string, result json.RawMessage) (*SessionLike, error) {
	var r struct {
		Score struct {
			Pct        float64 `json:"pct"`
			CapApplied *string `json:"capApplied"`
		} `json:"score"`
		Findings []struct {
			FindingID string `json:"findingId"`
			Critical  bool   `json:"critical"`
		} `json:"findings"`
		Integrity struct {
			Trust float64  `json:"trust"`
			Flags []string `json:"flags"`
		} `json:"integrity"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return nil, &ValidationError{"/result", "invalid"}
	}
	s := &SessionLike{GameID: gameID, Mode: mode, Score: SessionScore{Pct: r.Score.Pct, CapApplied: r.Score.CapApplied},
		Integrity: Integrity{Trust: r.Integrity.Trust, Flags: r.Integrity.Flags}}
	if s.Integrity.Flags == nil {
		s.Integrity.Flags = []string{}
	}
	for i, f := range r.Findings {
		if i == 12 {
			break
		}
		s.Findings = append(s.Findings, FindingLike{FindingID: f.FindingID, Critical: f.Critical})
	}
	return s, nil
}

// activity is one thing being evaluated: a session, a review sitting, or nothing (a badge
// refresh after a declaration).
type activity struct {
	reason   XPReason
	sourceID string
	session  *SessionLike
	reviews  *Reviews
	minutes  float64
	streak   bool
}

// evaluate runs /gamification/evaluate for act and persists the result. It is idempotent per
// (reason, source): a replayed activity returns the stored outcome without new XP.
func (s *Service) evaluate(ctx context.Context, subj Subject, act activity) (*AwardSummary, error) {
	now := s.now()
	if act.reason != "" {
		if prev, err := s.Store.XPEntryBySource(ctx, subj, act.reason, act.sourceID); err == nil {
			p, err := s.progress(ctx, subj)
			if err != nil {
				return nil, err
			}
			return &AwardSummary{XPAwarded: prev.XP, XPTotal: p.XPTotal, Rank: p.Rank, RankName: RankNames[p.Rank], Streak: p.StreakView,
				BadgesAwarded: []string{}, Replayed: true}, nil
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	p, err := s.progress(ctx, subj)
	if err != nil {
		return nil, err
	}
	day, week := servertime.DateIST(now), WeekKey(now)
	minutesToday, err := s.Store.MinutesOn(ctx, subj, day)
	if err != nil {
		return nil, err
	}
	counts, err := s.Store.WeekCounts(ctx, subj)
	if err != nil {
		return nil, err
	}
	thisWeek := counts[week]
	if act.streak {
		thisWeek++
	}
	req := EvaluateRequest{Now: now.UnixMilli(), Session: act.session, Reviews: act.reviews, MinutesToday: minutesToday,
		XPTotal: p.XPTotal, NodeStates: map[string]string{}, StreakState: p.Streak, StreakGoal: p.StreakGoal, WeekKey: week,
		SessionsThisWeek: thisWeek, ClosedWeeks: closedWeeks(counts, p.Streak, week), EarnedBadges: []string{},
		BadgeHistory: BadgeHistory{HasAccount: subj.Account}}
	if act.session != nil {
		req.SessionMinutes = act.minutes
	}
	if req.StreakState == nil {
		req.StreakState = json.RawMessage("null")
	}
	if p.Rank != "" {
		r := p.Rank
		req.CurrentRank = &r
	}
	if s.Nodes != nil {
		ns, err := s.Nodes.NodeStates(ctx, subj)
		if err != nil {
			return nil, err
		}
		for k, v := range ns {
			req.NodeStates[k] = v
		}
	}
	if s.Nazar != nil {
		score, n, err := s.Nazar.NazarScore(ctx, subj)
		if err != nil {
			return nil, err
		}
		req.VerifiedNazarMocks = n
		req.BadgeHistory.Nazar = &NazarHistory{Score: score, EligibleMocks: n}
	}
	if d, err := s.Store.GetDeclaration(ctx, subj); err == nil {
		req.BadgeHistory.Declarations = &DeclarationsHistory{FirstAttemptPass: &d.FirstAttemptPass}
		if d.NoAgentUsed {
			req.BadgeHistory.Declarations.KhudLicence = &KhudLicenceHistory{DLIssueDate: d.DLIssuedOn}
		}
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	for id := range p.Badges {
		req.EarnedBadges = append(req.EarnedBadges, id)
	}
	sort.Strings(req.EarnedBadges)

	resp, err := s.Compute.Evaluate(ctx, req)
	if err != nil {
		return nil, err
	}
	gained := 0
	if act.reason != "" {
		var award *XPAward
		if act.session != nil {
			award = resp.XP.Session
		} else {
			award = resp.XP.Reviews
		}
		xp := 0
		if award != nil {
			xp = award.XP
		}
		e, err := NewXPEntry(act.reason, act.sourceID, xp, now)
		if err != nil {
			return nil, err
		}
		e.Minutes, e.CountsForStreak = act.minutes, act.streak
		e.Breakdown, _ = json.Marshal(award)
		ok, err := s.Store.AppendXP(ctx, subj, e)
		if err != nil {
			return nil, err
		}
		if !ok { // a concurrent call stored it first
			return s.evaluate(ctx, subj, act)
		}
		gained = xp
	}
	sum := &AwardSummary{XPAwarded: gained, BadgesAwarded: []string{}}
	p.XPTotal += gained
	p.Rank, p.RankNext = resp.Rank.Rank, resp.Rank.Next
	p.Streak, p.StreakView = resp.Streak.State, resp.Streak.View
	for _, id := range resp.Badges.Awarded {
		p.Badges[id] = BadgeRecord{ID: id, AwardedAt: now, SelfDeclared: id == "B1" || id == "B2"}
		sum.BadgesAwarded = append(sum.BadgesAwarded, id)
	}
	for _, id := range resp.Badges.Revoked { // silently (a withdrawn self-declaration)
		delete(p.Badges, id)
	}
	p.UpdatedAt = now
	if err := s.Store.SaveProgress(ctx, subj, p); err != nil {
		return nil, err
	}
	// resp.Streak.Notify is always false and resp.Streak.Events are ledger facts, never copy:
	// nothing is sent to the user whatever they say.
	sum.XPTotal, sum.Rank, sum.RankName, sum.Promoted, sum.Streak = p.XPTotal, p.Rank, RankNames[p.Rank], resp.Rank.Promoted, p.StreakView
	return sum, nil
}

// closedWeeks lists finished weeks after the stored streak's lastClosedWeek with their counts
// (weeks with no sessions are omitted: the compute service closes them with zero, idempotently).
func closedWeeks(counts map[string]int, streak json.RawMessage, current string) []ClosedWeek {
	var st struct {
		LastClosedWeek *string `json:"lastClosedWeek"`
	}
	_ = json.Unmarshal(streak, &st)
	out := []ClosedWeek{}
	for wk, n := range counts {
		if wk >= current || n == 0 || (st.LastClosedWeek != nil && wk <= *st.LastClosedWeek) {
			continue
		}
		out = append(out, ClosedWeek{WeekKey: wk, Sessions: n})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].WeekKey < out[j].WeekKey })
	if len(out) > 60 {
		out = out[len(out)-60:]
	}
	return out
}

// OnSessionVerified awards XP for a verified session (games Awards hook). Minutes already
// played today come from the ledger; the session counts towards the weekly streak.
func (s *Service) OnSessionVerified(ctx context.Context, vs VerifiedSession) (*AwardSummary, error) {
	sl, err := sessionLike(vs.GameID, vs.Mode, vs.Result)
	if err != nil {
		return nil, err
	}
	return s.evaluate(ctx, vs.Subject, activity{reason: ReasonSession, sourceID: vs.ID.String(), session: sl,
		minutes: float64(vs.DurationMs) / 60000, streak: true})
}

// OnReviewSitting awards XP for due FSRS reviews (5 per due card, diminishing); a sitting with
// at least 10 due reviews counts as a streak session.
func (s *Service) OnReviewSitting(ctx context.Context, subj Subject, sittingID string, dueCards int, minutes float64) (*AwardSummary, error) {
	if dueCards < 0 || minutes < 0 {
		return nil, &ValidationError{"/reviews", "invalid"}
	}
	return s.evaluate(ctx, subj, activity{reason: ReasonReview, sourceID: sittingID, reviews: &Reviews{DueCardsReviewed: dueCards, ReviewMinutes: minutes},
		minutes: minutes, streak: dueCards >= ReviewsPerStreakSession})
}

// RankNames maps rank IDs to the API-38 enum.
var RankNames = map[string]string{"R1": "gali", "R2": "mohalla", "R3": "shehar", "R4": "highway", "R5": "ghat"}

// BadgeNames maps badge IDs to API keys. B9 is Golden Hour Ready (renamed from rah_veer_ready in
// GAMIFICATION_ENGINE §9; the OpenAPI enum still says rah_veer_ready: see handover notes).
var BadgeNames = map[string]string{"B1": "khud_licence", "B2": "pehli_baar_pass", "B3": "nazar_90", "B4": "calibrated",
	"B5": "no_zone_navigator", "B6": "strap_streak", "B7": "night_ready", "B8": "ghat_ready", "B9": "golden_hour_ready"}

// AchievementBadge is one earned badge in API-38.
type AchievementBadge struct {
	BadgeID      string    `json:"badge_id"`
	AwardedAt    time.Time `json:"awarded_at"`
	SelfDeclared bool      `json:"self_declared"`
}

// StreakView is the API-38 streak block.
type StreakView struct {
	Status       string `json:"status"` // active | repairable | archived
	WeeklyGoal   int    `json:"weekly_goal"`
	ThisWeek     int    `json:"this_week"`
	Weeks        int    `json:"weeks"`
	FreezeTokens int    `json:"freeze_tokens"`
	Archived     bool   `json:"archived"`
}

// Achievements is the API-38 response (E-22).
type Achievements struct {
	XPTotal          int                `json:"xp_total"`
	XPToday          int                `json:"xp_today"`
	XPMultiplier     float64            `json:"xp_multiplier_today"`
	Rank             string             `json:"rank"`
	RankRequirements json.RawMessage    `json:"rank_requirements,omitempty"`
	Badges           []AchievementBadge `json:"badges"`
	Streak           StreakView         `json:"streak"`
}

// multiplierAt is the multiplier of the next minute played after `minutes` today (§2.2: minute
// 44→45 is the last at ×1.0).
func multiplierAt(minutes float64) float64 {
	switch {
	case minutes < 45:
		return 1.0
	case minutes < 90:
		return 0.5
	}
	return 0.2
}

// Achievements is API-38, from stored state only (no compute call).
func (s *Service) Achievements(ctx context.Context, subj Subject) (*Achievements, error) {
	p, err := s.progress(ctx, subj)
	if err != nil {
		return nil, err
	}
	now := s.now()
	day, week := servertime.DateIST(now), WeekKey(now)
	mins, err := s.Store.MinutesOn(ctx, subj, day)
	if err != nil {
		return nil, err
	}
	xpToday, err := s.Store.XPOn(ctx, subj, day)
	if err != nil {
		return nil, err
	}
	counts, err := s.Store.WeekCounts(ctx, subj)
	if err != nil {
		return nil, err
	}
	rank := p.Rank
	if rank == "" {
		rank = "R1"
	}
	out := &Achievements{XPTotal: p.XPTotal, XPToday: xpToday, XPMultiplier: multiplierAt(mins), Rank: RankNames[rank],
		RankRequirements: p.RankNext, Badges: []AchievementBadge{}, Streak: StreakView{Status: "active", WeeklyGoal: p.StreakGoal, ThisWeek: counts[week]}}
	ids := make([]string, 0, len(p.Badges))
	for id := range p.Badges {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := p.Badges[id]
		out.Badges = append(out.Badges, AchievementBadge{BadgeID: BadgeNames[id], AwardedAt: b.AwardedAt, SelfDeclared: b.SelfDeclared})
	}
	var st struct {
		Status string `json:"status"`
		Weeks  int    `json:"weeks"`
		Tokens int    `json:"tokens"`
		Goal   int    `json:"goal"`
	}
	if json.Unmarshal(p.Streak, &st) == nil && st.Goal > 0 {
		out.Streak.Weeks, out.Streak.FreezeTokens, out.Streak.WeeklyGoal, out.Streak.Archived = st.Weeks, st.Tokens, st.Goal, st.Status == "archived"
		if st.Status != "" {
			out.Streak.Status = st.Status
		}
	}
	return out, nil
}
