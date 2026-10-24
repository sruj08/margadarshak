package gamify

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// 2026-10-29 (Thursday), 12:00 IST: ISO week 2026-W44.
var t0 = time.Date(2026, 10, 29, 6, 30, 0, 0, time.UTC)

// ---- compute fake (mirrors packages/gamification golden behaviour) ---------------------------

var rankTable = []struct {
	id, name, shape string
	xp              int
	learning        []string
	mastered        []string
	mocks           int
}{
	{"R1", "Gali", "rectangle", 0, nil, nil, 0},
	{"R2", "Mohalla", "rectangle", 300, []string{"SK-LL1", "SK-M1"}, nil, 0},
	{"R3", "Shehar", "circle", 900, []string{"SK-LL1", "SK-LL2", "SK-LL3", "SK-LL4", "SK-M1", "SK-M3", "SK-M6"}, nil, 1},
	{"R4", "Highway", "triangle", 2000, []string{"SK-M1", "SK-M4", "SK-M5", "SK-M7"}, []string{"SK-M1", "SK-M4"}, 0},
	{"R5", "Ghat", "octagon", 3500, []string{"SK-M8"}, []string{"SK-M14"}, 0},
}

func atLearning(s string) bool { return s == "learning" || s == "mastered" || s == "fading" }

// rankFor: cumulative requirements, never below the current rank (skilltree.test.ts golden).
func rankFor(xp int, nodes map[string]string, mocks int, current *string) int {
	best := 0
	for i := 1; i < len(rankTable); i++ {
		r := rankTable[i]
		ok := xp >= r.xp && mocks >= r.mocks
		for _, n := range r.learning {
			ok = ok && atLearning(nodes[n])
		}
		for _, n := range r.mastered {
			ok = ok && nodes[n] == "mastered"
		}
		if !ok {
			break
		}
		best = i
	}
	if current != nil {
		for i, r := range rankTable {
			if r.id == *current && i > best {
				best = i
			}
		}
	}
	return best
}

type fakeCompute struct {
	calls []EvaluateRequest
	down  bool
}

func diminish(m float64) float64 {
	switch {
	case m < 45:
		return 1
	case m < 90:
		return 0.5
	}
	return 0.2
}

func (f *fakeCompute) Evaluate(_ context.Context, req EvaluateRequest) (*EvaluateResponse, error) {
	if f.down {
		return nil, ErrComputeUnavailable
	}
	f.calls = append(f.calls, req)
	var out EvaluateResponse
	if s := req.Session; s != nil {
		base := map[string]float64{"mock": 40, "practice": 20, "pair": 20, "learn": 15}[s.Mode]
		trust := 1.0
		if s.Integrity.Trust < 0.6 {
			trust = 0.5
		}
		xp := int(math.Round(base * math.Max(0.3, s.Score.Pct/100) * diminish(req.MinutesToday) * trust))
		for _, fl := range s.Integrity.Flags {
			if fl == "INT_SEEN_CLIP" && s.Mode == "mock" {
				xp = 0
			}
		}
		out.XP.Session = &XPAward{XP: xp, Base: base}
	}
	if r := req.Reviews; r != nil {
		out.XP.Reviews = &XPAward{XP: int(math.Round(5 * float64(r.DueCardsReviewed) * diminish(req.MinutesToday))), Base: 5}
	}
	for _, a := range []*XPAward{out.XP.Session, out.XP.Reviews} {
		if a != nil {
			out.XP.Gained += a.XP
		}
	}
	out.XP.Total = req.XPTotal + out.XP.Gained
	i := rankFor(out.XP.Total, req.NodeStates, req.VerifiedNazarMocks, req.CurrentRank)
	out.Rank.Rank, out.Rank.Name, out.Rank.Shape = rankTable[i].id, rankTable[i].name, rankTable[i].shape
	cur := 0
	if req.CurrentRank != nil {
		cur = rankFor(0, nil, 0, req.CurrentRank)
	}
	out.Rank.Promoted = i > cur
	out.Rank.Next = json.RawMessage("null")

	// Streak: close the given weeks, then last week with 0 when a week was closed before.
	type streak struct {
		Status         string  `json:"status"`
		Weeks          int     `json:"weeks"`
		Tokens         int     `json:"tokens"`
		Goal           int     `json:"goal"`
		LastClosedWeek *string `json:"lastClosedWeek"`
	}
	st := streak{Status: "active", Goal: 4}
	if string(req.StreakState) != "null" && len(req.StreakState) > 0 {
		_ = json.Unmarshal(req.StreakState, &st)
	}
	closeWeek := func(wk string, n int) {
		if st.LastClosedWeek != nil && wk <= *st.LastClosedWeek {
			return
		}
		switch {
		case n >= st.Goal:
			st.Weeks++
			st.Tokens = min(2, st.Tokens+1)
			out.Streak.Events = append(out.Streak.Events, "goal_met")
		case st.Tokens > 0:
			st.Tokens--
			out.Streak.Events = append(out.Streak.Events, "token_applied")
		default:
			st.Status = "repairable"
			out.Streak.Events = append(out.Streak.Events, "became_repairable")
		}
		w := wk
		st.LastClosedWeek = &w
	}
	for _, w := range req.ClosedWeeks {
		closeWeek(w.WeekKey, w.Sessions)
	}
	if st.LastClosedWeek != nil {
		closeWeek(WeekKey(time.UnixMilli(req.Now).Add(-7*24*time.Hour)), 0)
	}
	out.Streak.State, _ = json.Marshal(st)
	out.Streak.View, _ = json.Marshal(map[string]any{"weekKey": req.WeekKey, "dots": st.Goal, "filled": req.SessionsThisWeek, "pothole": st.Status == "repairable"})
	out.Streak.Notify = false

	earned := map[string]bool{}
	if d := req.BadgeHistory.Declarations; d != nil && req.BadgeHistory.HasAccount {
		earned["B1"] = d.KhudLicence != nil
		earned["B2"] = d.FirstAttemptPass != nil && *d.FirstAttemptPass
	}
	if n := req.BadgeHistory.Nazar; n != nil && n.Score != nil && *n.Score >= 90 && n.EligibleMocks >= 3 {
		earned["B3"] = true
	}
	held := map[string]bool{}
	for _, b := range req.EarnedBadges {
		held[b] = true
	}
	out.Badges.Awarded, out.Badges.Revoked = []string{}, []string{}
	for _, id := range []string{"B1", "B2", "B3"} {
		if earned[id] && !held[id] {
			out.Badges.Awarded = append(out.Badges.Awarded, id)
		}
		if !earned[id] && held[id] {
			out.Badges.Revoked = append(out.Badges.Revoked, id)
		}
	}
	return &out, nil
}

// ---- other fakes ----------------------------------------------------------------------------

type fakeNodes map[string]string

func (f *fakeNodes) NodeStates(context.Context, Subject) (map[string]string, error) { return *f, nil }

type fakeNazar struct {
	score *float64
	n     int
}

func (f *fakeNazar) NazarScore(context.Context, Subject) (*float64, int, error) {
	return f.score, f.n, nil
}

type fakeExtras map[string]bool

func (f fakeExtras) HasParentalExtra(_ context.Context, subj Subject, extra string) (bool, error) {
	return f[subj.Key()+"|"+extra], nil
}

type countingOutbox struct{ n int }

func (o *countingOutbox) Enqueue(context.Context, Subject, string, map[string]string) error {
	o.n++
	return nil
}

type seqTokens struct{ n int }

func (s *seqTokens) Token(alphabet string, n int) string {
	s.n++
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[(s.n*7+i)%len(alphabet)]
	}
	return string(b)
}

type harness struct {
	svc     *Service
	store   *MemStore
	compute *fakeCompute
	nodes   *fakeNodes
	nazar   *fakeNazar
	extras  fakeExtras
	outbox  *countingOutbox
	clock   *servertime.Fixed
}

func newHarness() *harness {
	h := &harness{store: NewMemStore(), compute: &fakeCompute{}, nodes: &fakeNodes{}, nazar: &fakeNazar{}, extras: fakeExtras{},
		outbox: &countingOutbox{}, clock: servertime.NewFixed(t0)}
	h.svc = &Service{Store: h.store, Compute: h.compute, Nodes: h.nodes, Nazar: h.nazar, Extras: h.extras, Outbox: h.outbox,
		Tokens: &seqTokens{}, Clock: h.clock}
	return h
}

func adult() Subject { return Subject{Tenant: "JK", ApplicantID: uuid.New(), Account: true} }

func minor(parent Subject) Subject {
	m := uuid.New()
	return Subject{Tenant: "JK", ApplicantID: parent.ApplicantID, MemberID: &m, Minor: true, Account: true}
}

func session(subj Subject, mode string, pct float64, durMin int) VerifiedSession {
	res, _ := json.Marshal(map[string]any{"score": map[string]any{"pct": pct, "capApplied": nil},
		"findings":  []any{map[string]any{"findingId": "NAZ_LATE_RESPONSE", "critical": false, "severity": 0.5}},
		"integrity": map[string]any{"trust": 1, "flags": []any{}}})
	return VerifiedSession{ID: uuid.New(), Subject: subj, GameID: "nazar", Mode: mode, Result: res, DurationMs: int64(durMin) * 60000, VerifiedAt: t0}
}

// ---- tests ----------------------------------------------------------------------------------

func TestXP_NoXPForOpenShareInvite(t *testing.T) {
	for _, r := range []XPReason{"open", "app_open", "share", "invite", "squad_join", "streak_day", "profile_complete"} {
		if _, err := NewXPEntry(r, "x", 10, t0); !errors.Is(err, ErrXPReasonNotAllowed) {
			t.Fatalf("reason %q accepted: %v", r, err)
		}
	}
	h := newHarness()
	ctx, me := context.Background(), adult()
	// The store refuses such a row even if a caller bypasses NewXPEntry (the DB CHECK).
	if _, err := h.store.AppendXP(ctx, me, &XPEntry{ID: uuid.New(), Reason: "share", SourceID: "card", XP: 50}); !errors.Is(err, ErrXPReasonNotAllowed) {
		t.Fatalf("store accepted reason share: %v", err)
	}
	// Creating and joining a squad, and creating a share card, earn nothing.
	v, err := h.svc.CreateSquad(ctx, me, SquadCreate{Name: "GCET Riders", DisplayName: "Asha"})
	if err != nil {
		t.Fatal(err)
	}
	friend := adult()
	if _, err := h.svc.JoinSquad(ctx, friend, v.InviteCode, "Ravi"); err != nil {
		t.Fatal(err)
	}
	score := 64.0
	h.nazar.score, h.nazar.n = &score, 3
	if _, err := h.svc.CreateShareCard(ctx, me, ShareCardCreate{Kind: "nazar_score", Display: "initials", DisplayText: "AK"}); err != nil {
		t.Fatal(err)
	}
	if len(h.store.Ledger(me)) != 0 || len(h.store.Ledger(friend)) != 0 || len(h.compute.calls) != 0 {
		t.Fatalf("social actions touched XP: %v %v calls=%d", h.store.Ledger(me), h.store.Ledger(friend), len(h.compute.calls))
	}
	a, _ := h.svc.Achievements(ctx, me)
	if a.XPTotal != 0 {
		t.Fatalf("xp %d", a.XPTotal)
	}
	// A verified session does earn XP, with reason session.
	sum, err := h.svc.OnSessionVerified(ctx, session(me, "mock", 58, 12))
	if err != nil || sum.XPAwarded != 23 {
		t.Fatalf("mock at 58%%: %+v %v", sum, err)
	}
	if l := h.store.Ledger(me); len(l) != 1 || l[0].Reason != ReasonSession {
		t.Fatalf("ledger %+v", l)
	}
}

func TestRank_XPAloneCannotUnlock(t *testing.T) {
	h := newHarness()
	ctx, me := context.Background(), adult()
	// A huge XP balance and 50 verified mocks, but no skill node at learning.
	_ = h.store.SaveProgress(ctx, me, &Progress{XPTotal: 1_000_000, Badges: map[string]BadgeRecord{}, StreakGoal: 4})
	h.nazar.n = 50
	sum, err := h.svc.OnSessionVerified(ctx, session(me, "practice", 80, 10))
	if err != nil {
		t.Fatal(err)
	}
	if sum.Rank != "R1" || sum.RankName != "gali" || sum.Promoted {
		t.Fatalf("XP alone unlocked %+v", sum)
	}
	if got := h.compute.calls[0]; got.XPTotal != 1_000_000 || len(got.NodeStates) != 0 {
		t.Fatalf("request %+v", got)
	}
	// With SK-LL1 and SK-M1 at learning: Mohalla, promoted.
	*h.nodes = fakeNodes{"SK-LL1": "learning", "SK-M1": "learning"}
	sum, _ = h.svc.OnSessionVerified(ctx, session(me, "practice", 80, 10))
	if sum.Rank != "R2" || !sum.Promoted {
		t.Fatalf("mohalla %+v", sum)
	}
	// Ranks never go down: nodes fade, the rank stays.
	*h.nodes = fakeNodes{"SK-LL1": "fading"}
	sum, _ = h.svc.OnSessionVerified(ctx, session(me, "practice", 80, 10))
	if sum.Rank != "R2" || sum.Promoted {
		t.Fatalf("demoted %+v", sum)
	}
	if last := h.compute.calls[len(h.compute.calls)-1]; last.CurrentRank == nil || *last.CurrentRank != "R2" {
		t.Fatal("current rank not sent")
	}
}

func TestStreak_BreakIsSilent(t *testing.T) {
	h := newHarness()
	ctx, me := context.Background(), adult()
	last := "2026-W42"
	st, _ := json.Marshal(map[string]any{"status": "active", "weeks": 3, "tokens": 0, "goal": 4, "lastClosedWeek": last})
	_ = h.store.SaveProgress(ctx, me, &Progress{Streak: st, StreakGoal: 4, Badges: map[string]BadgeRecord{}})
	h.store.SeedWeek(me, "2026-W43", 1) // last week: 1 of 4, no token → the streak breaks
	sum, err := h.svc.OnSessionVerified(ctx, session(me, "practice", 70, 10))
	if err != nil {
		t.Fatal(err)
	}
	req := h.compute.calls[0]
	if len(req.ClosedWeeks) != 1 || req.ClosedWeeks[0] != (ClosedWeek{WeekKey: "2026-W43", Sessions: 1}) || req.WeekKey != "2026-W44" || req.SessionsThisWeek != 1 {
		t.Fatalf("streak input %+v", req)
	}
	var view map[string]any
	_ = json.Unmarshal(sum.Streak, &view)
	if view["pothole"] != true {
		t.Fatalf("break not recorded in the view: %s", sum.Streak)
	}
	if h.outbox.n != 0 {
		t.Fatalf("a streak break produced %d notifications", h.outbox.n)
	}
	raw, _ := json.Marshal(sum)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	for k := range m {
		if k == "notify" || k == "notification" || k == "message" {
			t.Fatalf("award summary carries %q", k)
		}
	}
}

func TestOnSessionVerified_IdempotentAndMinutesFromLedger(t *testing.T) {
	h := newHarness()
	ctx, me := context.Background(), adult()
	s1 := session(me, "mock", 100, 50)
	a, _ := h.svc.OnSessionVerified(ctx, s1)
	b, err := h.svc.OnSessionVerified(ctx, s1)
	if err != nil || !b.Replayed || b.XPAwarded != a.XPAwarded || len(h.store.Ledger(me)) != 1 || len(h.compute.calls) != 1 {
		t.Fatalf("replay: %+v %v", b, err)
	}
	// Second session the same IST day: 50 minutes already played → ×0.5.
	c, _ := h.svc.OnSessionVerified(ctx, session(me, "mock", 100, 10))
	if h.compute.calls[1].MinutesToday != 50 || c.XPAwarded != 20 {
		t.Fatalf("minutes today %v, xp %d", h.compute.calls[1].MinutesToday, c.XPAwarded)
	}
	ach, _ := h.svc.Achievements(ctx, me)
	if ach.XPTotal != 60 || ach.XPToday != 60 || ach.XPMultiplier != 0.5 || ach.Streak.ThisWeek != 2 {
		t.Fatalf("achievements %+v", ach)
	}
}

func TestSquadJoin_MinorWithoutSquadConsent(t *testing.T) {
	h := newHarness()
	ctx, parent := context.Background(), adult()
	v, err := h.svc.CreateSquad(ctx, parent, SquadCreate{Name: "Family riders", DisplayName: "Papa"})
	if err != nil {
		t.Fatal(err)
	}
	kid := minor(parent)
	_, err = h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul")
	if !errors.Is(err, ErrParentConsentRequired) || !errors.Is(err, privacy.ErrParentalConsentRequired) {
		t.Fatalf("minor joined without consent: %v", err)
	}
	if _, err := h.svc.CreateSquad(ctx, kid, SquadCreate{Name: "Kids", DisplayName: "Rahul"}); !errors.Is(err, ErrParentConsentRequired) {
		t.Fatalf("minor created a squad without consent: %v", err)
	}
	// The share_cards extra does not cover squads.
	h.extras[kid.Key()+"|share_cards"] = true
	if _, err := h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul"); !errors.Is(err, ErrParentConsentRequired) {
		t.Fatalf("share_cards extra let a minor join: %v", err)
	}
	h.extras[kid.Key()+"|squads"] = true
	got, err := h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul")
	if err != nil || len(got.Members) != 2 {
		t.Fatalf("with consent: %+v %v", got, err)
	}
	// An anonymous device session cannot join.
	if _, err := h.svc.JoinSquad(ctx, Subject{Tenant: "JK", ApplicantID: uuid.New()}, v.InviteCode, "Anon"); !errors.Is(err, ErrAccountRequired) {
		t.Fatalf("anonymous joined: %v", err)
	}
	// Cap at 5.
	for i := 0; i < 3; i++ {
		if _, err := h.svc.JoinSquad(ctx, adult(), v.InviteCode, "Friend"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.svc.JoinSquad(ctx, adult(), v.InviteCode, "Sixth"); !errors.Is(err, ErrSquadFull) {
		t.Fatalf("sixth member: %v", err)
	}
	// Members see names and roles only; the owner leaving hands over ownership.
	id := uuid.MustParse(v.SquadID[len("sqd_"):])
	if err := h.svc.LeaveSquad(ctx, parent, id); err != nil {
		t.Fatal(err)
	}
	mine, _ := h.svc.MySquads(ctx, kid)
	if len(mine) != 1 || len(mine[0].Members) != 4 || mine[0].Members[0].Role != "owner" || mine[0].Members[0].DisplayName != "Rahul" {
		t.Fatalf("after owner left: %+v", mine)
	}
	// Invites expire after 7 days.
	h.clock.Advance(InviteTTL)
	if err := h.svc.LeaveSquad(ctx, kid, id); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.JoinSquad(ctx, adult(), v.InviteCode, "Late"); !errors.Is(err, ErrInviteExpired) {
		t.Fatalf("expired invite: %v", err)
	}
}

func TestShareCard_ClientCannotChangeScore(t *testing.T) {
	h := newHarness()
	ctx, me := context.Background(), adult()
	score := 64.0
	h.nazar.score, h.nazar.n = &score, 3

	// A body with a score is refused outright.
	if _, err := DecodeShareCardCreate([]byte(`{"kind":"nazar_score","display":"initials","display_text":"AK","nazar_score":100}`)); !errors.Is(err, ErrUnknownField) {
		t.Fatalf("client score accepted: %v", err)
	}
	in, err := DecodeShareCardCreate([]byte(`{"kind":"nazar_score","display":"initials","display_text":"AK","kerala_line":true}`))
	if err != nil {
		t.Fatal(err)
	}
	card, err := h.svc.CreateShareCard(ctx, me, *in)
	if err != nil {
		t.Fatal(err)
	}
	d, err := h.svc.ShareCardData(ctx, card.ShortID)
	if err != nil || d.NazarScore == nil || *d.NazarScore != 64 || d.VerifiedSessions != 3 || d.DisplayName != "AK" || d.KeralaLineKey == "" {
		t.Fatalf("card %+v %v", d, err)
	}
	// The card follows the server score, never a stored copy.
	score = 71.4
	if d, _ = h.svc.ShareCardData(ctx, card.ShortID); *d.NazarScore != 71 {
		t.Fatalf("not recomputed: %d", *d.NazarScore)
	}
	raw, _ := json.Marshal(d)
	for _, banned := range []string{"rto", "dob", "phone", "calibration", "brier", "failed", "licence_number"} {
		if json.Valid(raw) && containsFold(string(raw), banned) {
			t.Fatalf("card leaks %q: %s", banned, raw)
		}
	}
	// Withdraw: the link is gone; another user cannot withdraw it.
	if err := h.svc.WithdrawShareCard(ctx, adult(), card.ShortID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger withdrew: %v", err)
	}
	if err := h.svc.WithdrawShareCard(ctx, me, card.ShortID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.ShareCardData(ctx, card.ShortID); !errors.Is(err, ErrGone) {
		t.Fatalf("withdrawn card served: %v", err)
	}
	// A minor needs the share_cards extra; expiry after 90 days.
	kid := minor(me)
	if _, err := h.svc.CreateShareCard(ctx, kid, *in); !errors.Is(err, ErrParentConsentRequired) {
		t.Fatalf("minor card without consent: %v", err)
	}
	h.extras[kid.Key()+"|share_cards"] = true
	c2, err := h.svc.CreateShareCard(ctx, kid, *in)
	if err != nil {
		t.Fatal(err)
	}
	h.clock.Advance(ShareCardTTL)
	if _, err := h.svc.ShareCardData(ctx, c2.ShortID); !errors.Is(err, ErrGone) {
		t.Fatalf("expired card served: %v", err)
	}
}

func containsFold(s, sub string) bool { return strings.Contains(strings.ToLower(s), sub) }

func TestDeclaration_SelfDeclaredBadgesAndSilentRevoke(t *testing.T) {
	h := newHarness()
	ctx, me := context.Background(), adult()
	ach, err := h.svc.DeclareKhudLicence(ctx, me, KhudLicenceInput{DLIssuedOn: time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC), NoAgentUsed: true, FirstAttemptPass: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(ach.Badges) != 2 || ach.Badges[0].BadgeID != "khud_licence" || !ach.Badges[0].SelfDeclared || ach.XPTotal != 0 {
		t.Fatalf("badges %+v", ach)
	}
	if len(h.store.Ledger(me)) != 0 {
		t.Fatal("a declaration earned XP")
	}
	if _, err := h.svc.DeclareKhudLicence(ctx, me, KhudLicenceInput{DLIssuedOn: t0.Add(72 * time.Hour), NoAgentUsed: true}); err == nil {
		t.Fatal("future DL date accepted")
	}
	if _, err := h.svc.DeclareKhudLicence(ctx, Subject{Tenant: "JK", ApplicantID: uuid.New()}, KhudLicenceInput{DLIssuedOn: t0, NoAgentUsed: true}); !errors.Is(err, ErrAccountRequired) {
		t.Fatalf("anonymous declaration: %v", err)
	}
	ach, err = h.svc.WithdrawDeclaration(ctx, me)
	if err != nil || len(ach.Badges) != 0 || h.outbox.n != 0 {
		t.Fatalf("after withdraw: %+v %v outbox=%d", ach, err, h.outbox.n)
	}
}
