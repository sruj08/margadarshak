package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/gamify/gamifytest"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

// gamifyFixtureOn makes contract subjects as real core.applicants / core.family_members rows.
func gamifyFixtureOn(db *store.DB) gamifytest.Fixture {
	return gamifytest.Fixture{
		Store:   store.NewGamifyStore(db),
		Tenants: [2]string{"JK", "KL"},
		NewAdult: func(t *testing.T, tenant string) gamify.Subject {
			t.Helper()
			a := &store.Applicant{ID: ids.New(), TenantID: tenant, Kind: "account", UserBand: "adult"}
			require.NoError(t, db.Tenant(context.Background(), tenant, func(tx pgx.Tx) error { return store.InsertApplicant(context.Background(), tx, a) }))
			return gamify.Subject{Tenant: tenant, ApplicantID: a.ID, UserBand: "adult", Account: true}
		},
		NewMinor: func(t *testing.T, parent gamify.Subject) gamify.Subject {
			t.Helper()
			m := &store.FamilyMember{ID: ids.New(), TenantID: parent.Tenant, ApplicantID: parent.ApplicantID, Relation: "child", DOBEnc: []byte{1},
				DOBPrecision: "year_only", AgeBand: "16_17", IsMinor: true, ParentalConsentStatus: "required"}
			require.NoError(t, db.Tenant(context.Background(), parent.Tenant, func(tx pgx.Tx) error {
				return store.InsertFamilyMember(context.Background(), tx, m)
			}))
			return gamify.Subject{Tenant: parent.Tenant, ApplicantID: parent.ApplicantID, MemberID: &m.ID, UserBand: "u18", Minor: true, Account: true}
		},
	}
}

func gamifyFixture(t *testing.T) gamifytest.Fixture {
	db := testdb.Open(t)
	addTenantKL(t, db)
	return gamifyFixtureOn(db)
}

// The pgx store passes the same contract as gamify.MemStore.
func TestGamifyStoreContract(t *testing.T) {
	gamifytest.RunStoreContract(t, gamifyFixture)
}

// GAMIFICATION_ENGINE §2.3: the database itself refuses XP for opening the app, sharing or
// inviting, and the ledger is append-only for the request role.
func TestGamifyXPLedgerCheckAndAppendOnly(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	me := gamifyFixtureOn(db).NewAdult(t, "JK")
	insert := func(reason string) error {
		return db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `INSERT INTO game.xp_ledger (entry_id, tenant_id, applicant_id, reason, source_id, xp, ist_day, week_key, created_at)
				VALUES ($1, 'JK', $2, $3, 'src', 10, '2026-10-29', '2026-W44', now())`, uuid.New(), me.ApplicantID, reason)
			return err
		})
	}
	for _, r := range []string{"share", "open", "invite"} {
		err := insert(r)
		require.Errorf(t, err, "reason %q accepted", r)
		require.Truef(t, store.IsCode(err, "23514"), "reason %q: %v", r, err)
		require.Contains(t, err.Error(), "xp_ledger_reason_check")
	}
	require.NoError(t, insert("session"))
	for _, q := range []string{`UPDATE game.xp_ledger SET xp = 999`, `DELETE FROM game.xp_ledger`} {
		err := db.Tenant(ctx, "JK", func(tx pgx.Tx) error { _, err := tx.Exec(ctx, q); return err })
		require.Errorf(t, err, "%s must fail for mg_app", q)
		require.True(t, store.IsCode(err, "42501"), "%s: %v", q, err)
	}
	// The store maps the CHECK to the package error.
	_, err := store.NewGamifyStore(db).AppendXP(ctx, me, &gamify.XPEntry{ID: uuid.New(), Reason: "share", SourceID: "card", XP: 50,
		ISTDay: "2026-10-29", WeekKey: "2026-W44", At: time.Now()})
	require.ErrorIs(t, err, gamify.ErrXPReasonNotAllowed)
}

// MD-056 for game.* and records.declarations: a tenant transaction sees only its own rows.
func TestGamifyRLSTenantIsolation(t *testing.T) {
	db := testdb.Open(t)
	addTenantKL(t, db)
	ctx := context.Background()
	f := gamifyFixtureOn(db)
	s := store.NewGamifyStore(db)
	t0 := time.Date(2026, 10, 29, 6, 30, 0, 0, time.UTC)
	kl := f.NewAdult(t, "KL")
	e, err := gamify.NewXPEntry(gamify.ReasonSession, "ses-kl", 20, t0)
	require.NoError(t, err)
	_, err = s.AppendXP(ctx, kl, e)
	require.NoError(t, err)
	require.NoError(t, s.SaveProgress(ctx, kl, &gamify.Progress{XPTotal: 20, Rank: "R1", StreakGoal: 4,
		Badges: map[string]gamify.BadgeRecord{"B3": {ID: "B3", AwardedAt: t0}}}))
	require.NoError(t, s.SaveDeclaration(ctx, kl, &gamify.Declaration{DLIssuedOn: "2026-10-01", NoAgentUsed: true, DeclaredAt: t0}))
	sq := &gamify.Squad{ID: uuid.New(), Tenant: "KL", Name: "Kochi", InviteCodeHash: make([]byte, 32), InviteExpiresAt: t0.Add(gamify.InviteTTL),
		WeeklyGoal: 15, CreatedAt: t0, Members: []gamify.SquadMember{{Subject: kl, DisplayName: "Anu", Role: "owner", JoinedAt: t0}}}
	require.NoError(t, s.InsertSquad(ctx, sq))
	require.NoError(t, s.InsertShareCard(ctx, &gamify.ShareCard{ShortID: "kkkkkkkkkk", Subject: kl, Kind: "rank", Display: "initials",
		DisplayText: "A", CreatedAt: t0, ExpiresAt: t0.Add(gamify.ShareCardTTL)}))

	tables := []string{"game.xp_ledger", "game.streaks", "game.badges", "game.squads", "game.squad_members", "game.share_cards", "records.declarations"}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		for _, tbl := range tables {
			var n int
			require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM `+tbl).Scan(&n))
			require.Zerof(t, n, "JK sees %d rows of %s", n, tbl)
		}
		return nil
	}))
	// Writing a row for another tenant is refused (WITH CHECK).
	require.Error(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO game.squads (squad_id, tenant_id, name, invite_code_hash, invite_expires_at) VALUES ($1, 'KL', 'xx', $2, now())`,
			uuid.New(), make([]byte, 32))
		return err
	}))
	require.NoError(t, db.Tenant(ctx, "KL", func(tx pgx.Tx) error {
		for _, tbl := range tables {
			var n int
			require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM `+tbl).Scan(&n))
			require.NotZerof(t, n, "KL sees no rows of %s", tbl)
		}
		return nil
	}))
	// A subject-scoped call from a JK transaction carried in ctx cannot read KL rows either.
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		_, err := s.GetProgress(store.ContextWithTx(ctx, tx), kl)
		require.ErrorIs(t, err, gamify.ErrNotFound)
		return nil
	}))
}

// The schema CHECKs match what social.go produces: share-card short IDs from the real token
// source (alphabet without l and o) are all accepted; an l or o is refused.
func TestGamifyShareCardShortIDAlphabet(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	f := gamifyFixtureOn(db)
	me := f.NewAdult(t, "JK")
	svc := &gamify.Service{Store: f.Store, Clock: servertime.System{}}
	for i := 0; i < 60; i++ {
		_, err := svc.CreateShareCard(ctx, me, gamify.ShareCardCreate{Kind: "rank", Display: "first_name", DisplayText: "Asha", BadgeID: ""})
		require.NoError(t, err)
	}
	now := time.Now()
	for _, id := range []string{"abcdefghil", "abcdefghio", "ABCDEFGHIJ", "abcdefgh10"} {
		err := f.Store.InsertShareCard(ctx, &gamify.ShareCard{ShortID: id, Subject: me, Kind: "rank", Display: "initials", DisplayText: "A",
			CreatedAt: now, ExpiresAt: now.Add(time.Hour)})
		require.Errorf(t, err, "short id %q accepted", id)
	}
}

// A call that carries a transaction in ctx writes in that transaction (a games award hook).
func TestGamifyReusesContextTx(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	f := gamifyFixtureOn(db)
	me := f.NewAdult(t, "JK")
	e, err := gamify.NewXPEntry(gamify.ReasonSession, "ses-tx", 10, time.Now())
	require.NoError(t, err)
	errRollback := errors.New("rollback")
	err = db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		ok, err := f.Store.AppendXP(store.ContextWithTx(ctx, tx), me, e)
		require.NoError(t, err)
		require.True(t, ok)
		_, err = f.Store.XPEntryBySource(store.ContextWithTx(ctx, tx), me, gamify.ReasonSession, "ses-tx")
		require.NoError(t, err)
		return errRollback
	})
	require.ErrorIs(t, err, errRollback)
	_, err = f.Store.XPEntryBySource(ctx, me, gamify.ReasonSession, "ses-tx")
	require.ErrorIs(t, err, gamify.ErrNotFound)
}

// ---- gamify.Service on the pgx store, with the package's own fakes (copied from
// internal/gamify/gamify_test.go) -------------------------------------------------------------

var gamifyRankTable = []struct {
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

func gamifyAtLearning(s string) bool { return s == "learning" || s == "mastered" || s == "fading" }

func gamifyRankFor(xp int, nodes map[string]string, mocks int, current *string) int {
	best := 0
	for i := 1; i < len(gamifyRankTable); i++ {
		r := gamifyRankTable[i]
		ok := xp >= r.xp && mocks >= r.mocks
		for _, n := range r.learning {
			ok = ok && gamifyAtLearning(nodes[n])
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
		for i, r := range gamifyRankTable {
			if r.id == *current && i > best {
				best = i
			}
		}
	}
	return best
}

type gamifyFakeCompute struct {
	calls []gamify.EvaluateRequest
	down  bool
}

func gamifyDiminish(m float64) float64 {
	switch {
	case m < 45:
		return 1
	case m < 90:
		return 0.5
	}
	return 0.2
}

func (f *gamifyFakeCompute) Evaluate(_ context.Context, req gamify.EvaluateRequest) (*gamify.EvaluateResponse, error) {
	if f.down {
		return nil, gamify.ErrComputeUnavailable
	}
	f.calls = append(f.calls, req)
	var out gamify.EvaluateResponse
	if s := req.Session; s != nil {
		base := map[string]float64{"mock": 40, "practice": 20, "pair": 20, "learn": 15}[s.Mode]
		trust := 1.0
		if s.Integrity.Trust < 0.6 {
			trust = 0.5
		}
		xp := int(math.Round(base * math.Max(0.3, s.Score.Pct/100) * gamifyDiminish(req.MinutesToday) * trust))
		for _, fl := range s.Integrity.Flags {
			if fl == "INT_SEEN_CLIP" && s.Mode == "mock" {
				xp = 0
			}
		}
		out.XP.Session = &gamify.XPAward{XP: xp, Base: base}
	}
	if r := req.Reviews; r != nil {
		out.XP.Reviews = &gamify.XPAward{XP: int(math.Round(5 * float64(r.DueCardsReviewed) * gamifyDiminish(req.MinutesToday))), Base: 5}
	}
	for _, a := range []*gamify.XPAward{out.XP.Session, out.XP.Reviews} {
		if a != nil {
			out.XP.Gained += a.XP
		}
	}
	out.XP.Total = req.XPTotal + out.XP.Gained
	i := gamifyRankFor(out.XP.Total, req.NodeStates, req.VerifiedNazarMocks, req.CurrentRank)
	out.Rank.Rank, out.Rank.Name, out.Rank.Shape = gamifyRankTable[i].id, gamifyRankTable[i].name, gamifyRankTable[i].shape
	cur := 0
	if req.CurrentRank != nil {
		cur = gamifyRankFor(0, nil, 0, req.CurrentRank)
	}
	out.Rank.Promoted = i > cur
	out.Rank.Next = json.RawMessage("null")

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
		closeWeek(gamify.WeekKey(time.UnixMilli(req.Now).Add(-7*24*time.Hour)), 0)
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

type gamifyFakeNodes map[string]string

func (f *gamifyFakeNodes) NodeStates(context.Context, gamify.Subject) (map[string]string, error) {
	return *f, nil
}

type gamifyFakeNazar struct {
	score *float64
	n     int
}

func (f *gamifyFakeNazar) NazarScore(context.Context, gamify.Subject) (*float64, int, error) {
	return f.score, f.n, nil
}

type gamifyFakeExtras map[string]bool

func (f gamifyFakeExtras) HasParentalExtra(_ context.Context, subj gamify.Subject, extra string) (bool, error) {
	return f[subj.Key()+"|"+extra], nil
}

type gamifyCountingOutbox struct{ n int }

func (o *gamifyCountingOutbox) Enqueue(context.Context, gamify.Subject, string, map[string]string) error {
	o.n++
	return nil
}

type gamifySeqTokens struct{ n int }

func (s *gamifySeqTokens) Token(alphabet string, n int) string {
	s.n++
	b := make([]byte, n)
	for i := range b {
		b[i] = alphabet[(s.n*7+i)%len(alphabet)]
	}
	return string(b)
}

type gamifyHarness struct {
	db      *store.DB
	f       gamifytest.Fixture
	svc     *gamify.Service
	compute *gamifyFakeCompute
	nazar   *gamifyFakeNazar
	extras  gamifyFakeExtras
	outbox  *gamifyCountingOutbox
	clock   *servertime.Fixed
}

// 2026-10-29 (Thursday), 12:00 IST: ISO week 2026-W44 (the package tests' t0).
var gamifyT0 = time.Date(2026, 10, 29, 6, 30, 0, 0, time.UTC)

func newGamifyHarness(t *testing.T) *gamifyHarness {
	db := testdb.Open(t)
	addTenantKL(t, db)
	h := &gamifyHarness{db: db, f: gamifyFixtureOn(db), compute: &gamifyFakeCompute{}, nazar: &gamifyFakeNazar{}, extras: gamifyFakeExtras{},
		outbox: &gamifyCountingOutbox{}, clock: servertime.NewFixed(gamifyT0)}
	h.svc = &gamify.Service{Store: h.f.Store, Compute: h.compute, Nodes: &gamifyFakeNodes{}, Nazar: h.nazar, Extras: h.extras, Outbox: h.outbox,
		Tokens: &gamifySeqTokens{}, Clock: h.clock}
	return h
}

func gamifySession(subj gamify.Subject, mode string, pct float64, durMin int) gamify.VerifiedSession {
	res, _ := json.Marshal(map[string]any{"score": map[string]any{"pct": pct, "capApplied": nil},
		"findings":  []any{map[string]any{"findingId": "NAZ_LATE_RESPONSE", "critical": false, "severity": 0.5}},
		"integrity": map[string]any{"trust": 1, "flags": []any{}}})
	return gamify.VerifiedSession{ID: uuid.New(), Subject: subj, GameID: "nazar", Mode: mode, Result: res, DurationMs: int64(durMin) * 60000, VerifiedAt: gamifyT0}
}

func (h *gamifyHarness) count(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, h.db.System(context.Background(), func(tx pgx.Tx) error { return tx.QueryRow(context.Background(), q, args...).Scan(&n) }))
	return n
}

// gamify TestXP_NoXPForOpenShareInvite + TestOnSessionVerified_IdempotentAndMinutesFromLedger on
// the pgx store.
func TestGamifyServiceXPAward(t *testing.T) {
	h := newGamifyHarness(t)
	ctx, me := context.Background(), h.f.NewAdult(t, "JK")
	v, err := h.svc.CreateSquad(ctx, me, gamify.SquadCreate{Name: "GCET Riders", DisplayName: "Asha"})
	require.NoError(t, err)
	_, err = h.svc.JoinSquad(ctx, h.f.NewAdult(t, "JK"), v.InviteCode, "Ravi")
	require.NoError(t, err)
	score := 64.0
	h.nazar.score, h.nazar.n = &score, 3
	_, err = h.svc.CreateShareCard(ctx, me, gamify.ShareCardCreate{Kind: "nazar_score", Display: "initials", DisplayText: "AK"})
	require.NoError(t, err)
	require.Zero(t, h.count(t, `SELECT count(*) FROM game.xp_ledger`), "social actions earned XP")

	s1 := gamifySession(me, "mock", 58, 12)
	sum, err := h.svc.OnSessionVerified(ctx, s1)
	require.NoError(t, err)
	require.Equal(t, 23, sum.XPAwarded)
	again, err := h.svc.OnSessionVerified(ctx, s1)
	require.NoError(t, err)
	require.True(t, again.Replayed)
	require.Equal(t, 23, again.XPAwarded)
	require.Equal(t, 1, h.count(t, `SELECT count(*) FROM game.xp_ledger WHERE applicant_id = $1 AND reason = 'session'`, me.ApplicantID))
	require.Len(t, h.compute.calls, 1)

	// 12 minutes played; a 40-minute mock at 100% is still ×1.0, then 52 minutes → ×0.5.
	_, err = h.svc.OnSessionVerified(ctx, gamifySession(me, "mock", 100, 40))
	require.NoError(t, err)
	c, err := h.svc.OnSessionVerified(ctx, gamifySession(me, "mock", 100, 10))
	require.NoError(t, err)
	require.InDelta(t, 52.0, h.compute.calls[2].MinutesToday, 1e-9)
	require.Equal(t, 20, c.XPAwarded)
	ach, err := h.svc.Achievements(ctx, me)
	require.NoError(t, err)
	require.Equal(t, 83, ach.XPTotal)
	require.Equal(t, 83, ach.XPToday)
	require.InDelta(t, 0.5, ach.XPMultiplier, 1e-9)
	require.Equal(t, 3, ach.Streak.ThisWeek)
	require.Equal(t, "gali", ach.Rank)
	require.Zero(t, h.outbox.n)
}

// gamify TestSquadJoin_MinorWithoutSquadConsent on the pgx store: create, join up to 5, the 6th
// refused, the owner leaving hands over ownership, invites expire.
func TestGamifyServiceSquadCreateJoin(t *testing.T) {
	h := newGamifyHarness(t)
	ctx, parent := context.Background(), h.f.NewAdult(t, "JK")
	v, err := h.svc.CreateSquad(ctx, parent, gamify.SquadCreate{Name: "Family riders", DisplayName: "Papa"})
	require.NoError(t, err)
	kid := h.f.NewMinor(t, parent)
	_, err = h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul")
	require.ErrorIs(t, err, gamify.ErrParentConsentRequired)
	h.extras[kid.Key()+"|squads"] = true
	got, err := h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul")
	require.NoError(t, err)
	require.Len(t, got.Members, 2)
	// Joining twice is a no-op.
	got, err = h.svc.JoinSquad(ctx, kid, v.InviteCode, "Rahul")
	require.NoError(t, err)
	require.Len(t, got.Members, 2)
	// A KL applicant cannot join a JK squad, though the invite lookup crosses tenants.
	_, err = h.svc.JoinSquad(ctx, h.f.NewAdult(t, "KL"), v.InviteCode, "Anu")
	require.ErrorIs(t, err, gamify.ErrNotFound)
	for i := 0; i < 3; i++ {
		_, err := h.svc.JoinSquad(ctx, h.f.NewAdult(t, "JK"), v.InviteCode, "Friend")
		require.NoError(t, err)
	}
	_, err = h.svc.JoinSquad(ctx, h.f.NewAdult(t, "JK"), v.InviteCode, "Sixth")
	require.ErrorIs(t, err, gamify.ErrSquadFull)
	id := uuid.MustParse(v.SquadID[len("sqd_"):])
	require.Equal(t, 5, h.count(t, `SELECT count(*) FROM game.squad_members WHERE squad_id = $1`, id))
	// The trigger also refuses a 6th row written past the service check.
	sq, err := h.f.Store.GetSquad(ctx, id)
	require.NoError(t, err)
	sq.Members = append(sq.Members, gamify.SquadMember{Subject: h.f.NewAdult(t, "JK"), DisplayName: "Sneaky", Role: "member", JoinedAt: gamifyT0})
	require.ErrorIs(t, h.f.Store.UpdateSquad(ctx, sq), gamify.ErrSquadFull)

	require.NoError(t, h.svc.LeaveSquad(ctx, parent, id))
	mine, err := h.svc.MySquads(ctx, kid)
	require.NoError(t, err)
	require.Len(t, mine, 1)
	require.Len(t, mine[0].Members, 4)
	require.Equal(t, "owner", mine[0].Members[0].Role)
	require.Equal(t, "Rahul", mine[0].Members[0].DisplayName)
	parentSquads, err := h.svc.MySquads(ctx, parent)
	require.NoError(t, err)
	require.Empty(t, parentSquads)

	h.clock.Advance(gamify.InviteTTL)
	require.NoError(t, h.svc.LeaveSquad(ctx, kid, id))
	_, err = h.svc.JoinSquad(ctx, h.f.NewAdult(t, "JK"), v.InviteCode, "Late")
	require.ErrorIs(t, err, gamify.ErrInviteExpired)
}

// gamify TestShareCard_ClientCannotChangeScore + TestDeclaration_SelfDeclaredBadgesAndSilentRevoke
// on the pgx store.
func TestGamifyServiceShareCardAndDeclaration(t *testing.T) {
	h := newGamifyHarness(t)
	ctx, me := context.Background(), h.f.NewAdult(t, "KL")
	score := 64.0
	h.nazar.score, h.nazar.n = &score, 3
	card, err := h.svc.CreateShareCard(ctx, me, gamify.ShareCardCreate{Kind: "nazar_score", Display: "initials", DisplayText: "AK", KeralaLine: true})
	require.NoError(t, err)
	// The public read carries no tenant: a KL card is served.
	d, err := h.svc.ShareCardData(ctx, card.ShortID)
	require.NoError(t, err)
	require.Equal(t, 64, *d.NazarScore)
	require.NotEmpty(t, d.KeralaLineKey)
	score = 71.4
	d, err = h.svc.ShareCardData(ctx, card.ShortID)
	require.NoError(t, err)
	require.Equal(t, 71, *d.NazarScore)
	require.ErrorIs(t, h.svc.WithdrawShareCard(ctx, h.f.NewAdult(t, "KL"), card.ShortID), gamify.ErrNotFound)
	require.NoError(t, h.svc.WithdrawShareCard(ctx, me, card.ShortID))
	_, err = h.svc.ShareCardData(ctx, card.ShortID)
	require.ErrorIs(t, err, gamify.ErrGone)

	caseID := ids.Encode(ids.Case, ids.New())
	ach, err := h.svc.DeclareKhudLicence(ctx, me, gamify.KhudLicenceInput{CaseID: caseID, DLIssuedOn: time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC),
		NoAgentUsed: true, FirstAttemptPass: true})
	require.NoError(t, err)
	require.Len(t, ach.Badges, 2)
	require.Equal(t, "khud_licence", ach.Badges[0].BadgeID)
	require.True(t, ach.Badges[0].SelfDeclared)
	require.Zero(t, ach.XPTotal)
	decl, err := h.f.Store.GetDeclaration(ctx, me)
	require.NoError(t, err)
	require.Equal(t, caseID, decl.CaseID)
	require.Equal(t, "2026-10-02", decl.DLIssuedOn)
	require.Equal(t, 2, h.count(t, `SELECT count(*) FROM game.badges WHERE applicant_id = $1 AND self_declared`, me.ApplicantID))
	require.Zero(t, h.count(t, `SELECT count(*) FROM game.xp_ledger`))

	ach, err = h.svc.WithdrawDeclaration(ctx, me)
	require.NoError(t, err)
	require.Empty(t, ach.Badges)
	require.Zero(t, h.count(t, `SELECT count(*) FROM game.badges`))
	require.Zero(t, h.count(t, `SELECT count(*) FROM records.declarations`))
	require.Zero(t, h.outbox.n)
}
