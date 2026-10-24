// Package gamestest is the shared behaviour suite for games.Store and the difficulty staircase:
// the in-memory games.MemStore (the reference semantics) and the pgx store in internal/store
// (GamesStore, GamesStaircase) must both pass RunStoreContract.
package gamestest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/games"
)

// Staircase is games.Staircase plus the update (GAME_SDK §7).
type Staircase interface {
	games.Staircase
	Record(ctx context.Context, tx pgx.Tx, subj games.Subject, gameID, skillID string, passed bool) (int, error)
}

// Fixture is one fresh, empty store under test.
type Fixture struct {
	Store     games.Store
	Staircase Staircase // optional: the staircase cases are skipped without it
	DB        games.TxRunner
	// A and B are two different people in tenant A.Tenant (B may be a family member inside A's
	// account); C is a person in another tenant. For a database store they must exist (foreign
	// keys) and their UserBand, Minor and Account must match the database rows, because a
	// database store rebuilds the Subject from them.
	A, B, C games.Subject
	// Counter reads an ops counter bumped through Store.IncrementCounter.
	Counter func(t *testing.T, tenant, name string) int64
}

// NoTx is a TxRunner for in-memory stores: fn runs with a nil transaction.
type NoTx struct{}

// Tenant runs fn with a nil transaction.
func (NoTx) Tenant(_ context.Context, _ string, fn func(pgx.Tx) error) error { return fn(nil) }

// System runs fn with a nil transaction.
func (NoTx) System(_ context.Context, fn func(pgx.Tx) error) error { return fn(nil) }

// MemFixture returns a fixture over a new games.MemStore and games.MemStaircase.
func MemFixture(_ *testing.T) Fixture {
	m := games.NewMemStore()
	member := uuid.New()
	a := games.Subject{Tenant: "JK", ApplicantID: uuid.New(), UserBand: "adult", Account: true}
	b := a
	b.MemberID, b.UserBand, b.Minor = &member, "u18", true
	return Fixture{
		Store: m, Staircase: games.NewMemStaircase(), DB: NoTx{}, A: a, B: b,
		C:       games.Subject{Tenant: "KL", ApplicantID: uuid.New(), UserBand: "adult"},
		Counter: func(_ *testing.T, tenant, name string) int64 { return m.Counter(tenant, name) },
	}
}

// t0 is whole seconds so every store keeps it exactly.
var t0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

// RunStoreContract runs the behaviour suite; newFixture is called once per case.
func RunStoreContract(t *testing.T, newFixture func(t *testing.T) Fixture) {
	cases := []struct {
		name string
		run  func(t *testing.T, f Fixture)
	}{
		{"SessionRoundTrip", sessionRoundTrip},
		{"GetUnknownIsNotFound", getUnknown},
		{"DuplicateInsertFails", duplicateInsert},
		{"CompleteSessionRoundTrip", completeRoundTrip},
		{"VoidSession", voidSession},
		{"ListPendingOldestFirstAcrossTenants", listPending},
		{"ExposuresFirstWins", exposures},
		{"RecentItemRefs", recentItemRefs},
		{"EligibleMocks", eligibleMocks},
		{"IncrementCounter", incrementCounter},
		{"Staircase", staircase},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			tc.run(t, f)
		})
	}
}

// ---- helpers --------------------------------------------------------------------------------

func inTenant(t *testing.T, f Fixture, subj games.Subject, fn func(ctx context.Context, tx pgx.Tx) error) {
	t.Helper()
	ctx := context.Background()
	if err := f.DB.Tenant(ctx, subj.Tenant, func(tx pgx.Tx) error { return fn(ctx, tx) }); err != nil {
		t.Fatal(err)
	}
}

func inSystem(t *testing.T, f Fixture, fn func(ctx context.Context, tx pgx.Tx) error) {
	t.Helper()
	ctx := context.Background()
	if err := f.DB.System(ctx, func(tx pgx.Tx) error { return fn(ctx, tx) }); err != nil {
		t.Fatal(err)
	}
}

func clipRef(n int) string { return fmt.Sprintf("clip:KL-%04d@1", n) }

// newSession is a started session of subj with clip items (numbers of the clip refs).
func newSession(t *testing.T, subj games.Subject, game, mode string, start time.Time, clips ...int) *games.Session {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	items := make([]games.Item, len(clips))
	ctxItems := make([]map[string]string, len(clips))
	for i, n := range clips {
		items[i] = games.Item{Ordinal: i + 1, Ref: clipRef(n), ContentVersion: "1", Kind: "clip"}
		ctxItems[i] = map[string]string{"ref": items[i].Ref, "contentVersion": "1"}
	}
	sc, _ := json.Marshal(map[string]any{"sid": id.String(), "gameId": game, "mode": mode, "items": ctxItems, "tenant": subj.Tenant})
	return &games.Session{
		ID: id, Subject: subj, GameID: game, Mode: mode, GameVersion: "1.0.0", ScoringVersion: "1.0",
		RulePackVersion: "2026.10.23", Seed: 123456789, SeedOrigin: games.SeedOriginServer, Difficulty: 3,
		Status: games.StatusStarted, Items: items, Context: sc, StartedAt: start, ExpiresAt: start.Add(games.SessionTTL),
	}
}

func insert(t *testing.T, f Fixture, s *games.Session) {
	t.Helper()
	inTenant(t, f, s.Subject, func(ctx context.Context, tx pgx.Tx) error {
		if err := f.Store.InsertSession(ctx, tx, s); err != nil {
			return err
		}
		return f.Store.InsertSessionItems(ctx, tx, s.ID, s.Items)
	})
}

func get(t *testing.T, f Fixture, s *games.Session) *games.Session {
	t.Helper()
	var out *games.Session
	inTenant(t, f, s.Subject, func(ctx context.Context, tx pgx.Tx) (err error) {
		out, err = f.Store.GetSessionForUpdate(ctx, tx, s.ID)
		return err
	})
	return out
}

func ptr[T any](v T) *T { return &v }

func digest(c byte) string {
	b := make([]byte, 64)
	for i := range b {
		b[i] = c
	}
	return "sha256:" + string(b)
}

// submit fills the submission fields of a session.
func submit(s *games.Session, at time.Time) {
	s.SubmittedAt = ptr(at)
	s.Replay = &games.Replay{TelemetryVersion: 1, Encoding: "mdr1", Inputs: "eyJyIjpbXX0=", Digest: digest('a'), EventCount: 35}
	s.ClientResult = json.RawMessage(`{"score":{"pct":90},"findings":[]}`)
	s.ClientPct = ptr(90.0)
}

// check fills a verified outcome.
func check(s *games.Session, at time.Time, pct float64, nazar bool) {
	if s.Replay == nil {
		submit(s, at)
	}
	s.Status = games.StatusChecked
	s.VerifiedAt = ptr(at)
	s.ServerResult = json.RawMessage(fmt.Sprintf(`{"score":{"pct":%v},"integrity":{"trust":1,"flags":[]}}`, pct))
	s.ServerPct, s.Trust = ptr(pct), ptr(1.0)
	s.Flags, s.TimingMode = []string{}, "rvfc"
	s.Eligible = map[string]bool{games.EligibleXP: true, games.EligibleBadges: true, games.EligibleCounted: true,
		games.EligibleNazarScore: nazar, games.EligiblePercentiles: nazar}
}

func jsonEqual(a, b json.RawMessage) bool {
	if len(a) == 0 || len(b) == 0 {
		return len(a) == len(b)
	}
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

func timeEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func floatEqual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// sameSession compares every field the store keeps (JSON semantically, times by instant, nil and
// empty slices and maps alike).
func sameSession(t *testing.T, want, got *games.Session) {
	t.Helper()
	if got == nil {
		t.Fatal("nil session")
	}
	ws, gs := want.Subject, got.Subject
	if !ws.Same(gs) || ws.UserBand != gs.UserBand || ws.Minor != gs.Minor || ws.Account != gs.Account {
		t.Errorf("subject %+v, want %+v", gs, ws)
	}
	type scalars struct {
		ID                                                   uuid.UUID
		GameID, Mode, GameVersion, ScoringVersion, RulePack  string
		Seed                                                 uint32
		SeedOrigin                                           string
		Difficulty                                           int
		Status, Cohort, Participant, Phase, Timing, Rejected string
		Hints                                                games.Hints
		Replay                                               games.Replay
		HasReplay                                            bool
	}
	sc := func(s *games.Session) scalars {
		out := scalars{s.ID, s.GameID, s.Mode, s.GameVersion, s.ScoringVersion, s.RulePackVersion, s.Seed, s.SeedOrigin,
			s.Difficulty, s.Status, s.Cohort, s.StudyParticipant, s.StudyPhase, s.TimingMode, s.RejectedType, s.Hints,
			games.Replay{}, s.Replay != nil}
		if s.Replay != nil {
			out.Replay = *s.Replay
		}
		return out
	}
	if w, g := sc(want), sc(got); w != g {
		t.Errorf("fields\n got %+v\nwant %+v", g, w)
	}
	if !slices.Equal(want.Items, got.Items) {
		t.Errorf("items %+v, want %+v", got.Items, want.Items)
	}
	if !slices.Equal(want.Flags, got.Flags) {
		t.Errorf("flags %v, want %v", got.Flags, want.Flags)
	}
	if !maps.Equal(want.Eligible, got.Eligible) {
		t.Errorf("eligible %v, want %v", got.Eligible, want.Eligible)
	}
	for name, p := range map[string][2]json.RawMessage{
		"context": {want.Context, got.Context}, "client": {want.ClientResult, got.ClientResult},
		"server": {want.ServerResult, got.ServerResult}, "analysis": {want.Analysis, got.Analysis},
	} {
		if !jsonEqual(p[0], p[1]) {
			t.Errorf("%s %s, want %s", name, p[1], p[0])
		}
	}
	if !want.StartedAt.Equal(got.StartedAt) || !want.ExpiresAt.Equal(got.ExpiresAt) ||
		!timeEqual(want.SubmittedAt, got.SubmittedAt) || !timeEqual(want.VerifiedAt, got.VerifiedAt) {
		t.Errorf("times started %v expires %v submitted %v verified %v", got.StartedAt, got.ExpiresAt, got.SubmittedAt, got.VerifiedAt)
	}
	if !floatEqual(want.ClientPct, got.ClientPct) || !floatEqual(want.ServerPct, got.ServerPct) || !floatEqual(want.Trust, got.Trust) {
		t.Errorf("numbers client %v server %v trust %v", got.ClientPct, got.ServerPct, got.Trust)
	}
}

// ---- cases ----------------------------------------------------------------------------------

func sessionRoundTrip(t *testing.T, f Fixture) {
	s := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 3, 1, 2)
	s.Seed = 4294967295 // the full uint32 range
	insert(t, f, s)
	sameSession(t, s, get(t, f, s))

	// A family member's session keeps the member, and a study session its cohort.
	m := newSession(t, f.B, games.GameLLSim, games.ModePractice, t0)
	m.Items = []games.Item{{Ordinal: 1, Ref: "q:C-LL1-001:v1", ContentVersion: "v1", Kind: "q"}}
	m.Seed, m.Difficulty = 0, 5
	m.Cohort, m.StudyParticipant, m.StudyPhase = games.CohortFieldTest, "P-001", "test"
	insert(t, f, m)
	sameSession(t, m, get(t, f, m))
}

func getUnknown(t *testing.T, f Fixture) {
	err := f.DB.Tenant(context.Background(), f.A.Tenant, func(tx pgx.Tx) error {
		_, err := f.Store.GetSessionForUpdate(context.Background(), tx, uuid.New())
		return err
	})
	if !errors.Is(err, games.ErrNotFound) {
		t.Fatalf("unknown session: %v", err)
	}
}

func duplicateInsert(t *testing.T, f Fixture) {
	s := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 1)
	insert(t, f, s)
	err := f.DB.Tenant(context.Background(), f.A.Tenant, func(tx pgx.Tx) error {
		return f.Store.InsertSession(context.Background(), tx, s)
	})
	if err == nil {
		t.Fatal("a duplicate session ID was accepted")
	}
}

func completeRoundTrip(t *testing.T, f Fixture) {
	s := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 1, 2)
	insert(t, f, s)
	s = get(t, f, s)
	submit(s, t0.Add(5*time.Minute))
	s.Replay.Encoding, s.Replay.EventCount = "mdr1+gzip", 5000
	s.Replay.Inputs = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BB"
	s.Hints = games.Hints{SeenClip: true, SessionExpired: true}
	check(s, t0.Add(5*time.Minute+time.Second), 64.25, false)
	s.Trust = ptr(0.729)
	s.Flags = []string{"INT_REPLAY_MISMATCH", "INT_SEEN_CLIP"}
	s.Analysis = json.RawMessage(`{"nazar_clips":{"rule":"kerala_5band","clips":[{"ordinal":1,"ref":"clip:KL-0001@1","voided":null,` +
		`"hazards":[{"hazardId":"h1","credit":4,"band":2}]}]}}`)
	inTenant(t, f, s.Subject, func(ctx context.Context, tx pgx.Tx) error { return f.Store.CompleteSession(ctx, tx, s) })
	sameSession(t, s, get(t, f, s))
}

func voidSession(t *testing.T, f Fixture) {
	s := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 1)
	insert(t, f, s)
	submit(s, t0.Add(time.Minute))
	s.Status, s.RejectedType = games.StatusVoided, "digest-mismatch"
	inTenant(t, f, s.Subject, func(ctx context.Context, tx pgx.Tx) error { return f.Store.VoidSession(ctx, tx, s) })
	sameSession(t, s, get(t, f, s))
}

func listPending(t *testing.T, f Fixture) {
	pending := func(subj games.Subject, start time.Time, submitted time.Duration, clip int) *games.Session {
		s := newSession(t, subj, games.GameNazar, games.ModeMock, start, clip)
		insert(t, f, s)
		submit(s, t0.Add(submitted))
		s.Status = games.StatusPendingVerification
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) error { return f.Store.MarkPending(ctx, tx, s) })
		return s
	}
	a := pending(f.A, t0, 3*time.Minute, 1)
	c := pending(f.C, t0, time.Minute, 2) // other tenant, submitted first
	b := pending(f.B, t0, 2*time.Minute, 3)
	insert(t, f, newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 4)) // started, not pending
	done := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 5)
	insert(t, f, done)
	check(done, t0.Add(time.Second), 70, true)
	inTenant(t, f, f.A, func(ctx context.Context, tx pgx.Tx) error { return f.Store.CompleteSession(ctx, tx, done) })

	list := func(limit int) []*games.Session {
		var out []*games.Session
		inSystem(t, f, func(ctx context.Context, tx pgx.Tx) (err error) {
			out, err = f.Store.ListPending(ctx, tx, limit)
			return err
		})
		return out
	}
	got := list(10)
	if len(got) != 3 {
		t.Fatalf("%d pending sessions, want 3", len(got))
	}
	for i, want := range []*games.Session{c, b, a} {
		sameSession(t, want, got[i])
	}
	if two := list(2); len(two) != 2 || two[0].ID != c.ID || two[1].ID != b.ID {
		t.Fatalf("limit 2: %d sessions", len(two))
	}
	check(c, t0.Add(10*time.Minute), 58, false)
	inSystem(t, f, func(ctx context.Context, tx pgx.Tx) error { return f.Store.CompleteSession(ctx, tx, c) })
	if left := list(10); len(left) != 2 || left[0].ID != b.ID || left[1].ID != a.ID {
		t.Fatalf("after completing one: %d left", len(left))
	}
}

func exposures(t *testing.T, f Fixture) {
	s := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 1)
	insert(t, f, s)
	record := func(subj games.Subject, ex ...games.Exposure) {
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) error { return f.Store.RecordExposures(ctx, tx, subj, ex) })
	}
	record(f.A,
		games.Exposure{ClipID: "KL-0001", Via: games.ViaMock, SessionID: s.ID, At: t0},
		games.Exposure{ClipID: "KL-0002", Via: games.ViaPractice, At: t0},
		games.Exposure{ClipID: "KL-0001", Via: games.ViaLearn, At: t0.Add(-time.Hour)}, // duplicate in the batch: ignored
	)
	record(f.A,
		games.Exposure{ClipID: "KL-0002", Via: games.ViaReplay, At: t0.Add(-time.Hour)}, // already seen: first wins
		games.Exposure{ClipID: "JMU-00A3", Via: games.ViaStudy, At: t0.Add(5 * time.Minute)},
	)
	record(f.A) // nothing to record
	record(f.B, games.Exposure{ClipID: "KL-0009", Via: games.ViaPractice, At: t0})

	var seenA, seenB, seenC, before, atT0, none []string
	inTenant(t, f, f.A, func(ctx context.Context, tx pgx.Tx) (err error) {
		if seenA, err = f.Store.SeenClipIDs(ctx, tx, f.A); err != nil {
			return err
		}
		if seenB, err = f.Store.SeenClipIDs(ctx, tx, f.B); err != nil {
			return err
		}
		if before, err = f.Store.ClipsSeenBefore(ctx, tx, f.A, []string{"JMU-00A3", "KL-0002", "KL-0099", "KL-0001"}, t0.Add(time.Minute)); err != nil {
			return err
		}
		if atT0, err = f.Store.ClipsSeenBefore(ctx, tx, f.A, []string{"KL-0001", "KL-0002"}, t0); err != nil {
			return err
		}
		none, err = f.Store.ClipsSeenBefore(ctx, tx, f.A, nil, t0)
		return err
	})
	inTenant(t, f, f.C, func(ctx context.Context, tx pgx.Tx) (err error) {
		seenC, err = f.Store.SeenClipIDs(ctx, tx, f.C)
		return err
	})
	if !slices.Equal(seenA, []string{"JMU-00A3", "KL-0001", "KL-0002"}) {
		t.Errorf("seen by A %v", seenA)
	}
	if !slices.Equal(seenB, []string{"KL-0009"}) || len(seenC) != 0 {
		t.Errorf("seen by B %v, by C %v", seenB, seenC)
	}
	if !slices.Equal(before, []string{"KL-0002", "KL-0001"}) { // in the order asked
		t.Errorf("seen before t0+1m %v", before)
	}
	if len(atT0) != 0 || len(none) != 0 { // strictly before; the later, earlier-dated rows were ignored
		t.Errorf("seen before t0 %v, none %v", atT0, none)
	}
}

func recentItemRefs(t *testing.T, f Fixture) {
	insert(t, f, newSession(t, f.A, games.GameNazar, games.ModePractice, t0, 1, 2))
	ll := newSession(t, f.A, games.GameLLSim, games.ModePractice, t0.Add(time.Minute))
	ll.Items = []games.Item{{Ordinal: 1, Ref: "q:C-LL1-001:v1", ContentVersion: "v1", Kind: "q"}}
	insert(t, f, ll)
	insert(t, f, newSession(t, f.A, games.GameNazar, games.ModePractice, t0.Add(2*time.Minute), 3, 4, 5))
	insert(t, f, newSession(t, f.B, games.GameNazar, games.ModePractice, t0.Add(3*time.Minute), 9))

	refs := func(subj games.Subject, game string, limit int) []string {
		var out []string
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) (err error) {
			out, err = f.Store.RecentItemRefs(ctx, tx, subj, game, limit)
			return err
		})
		return out
	}
	all := []string{clipRef(3), clipRef(4), clipRef(5), clipRef(1), clipRef(2)}
	for _, tc := range []struct {
		limit int
		want  []string
	}{{100, all}, {4, all}, {3, all[:3]}, {2, all[:3]}, {1, all[:3]}} {
		if got := refs(f.A, games.GameNazar, tc.limit); !slices.Equal(got, tc.want) {
			t.Errorf("limit %d: %v, want %v", tc.limit, got, tc.want)
		}
	}
	if got := refs(f.A, games.GameNazar, 0); len(got) != 0 {
		t.Errorf("limit 0: %v", got)
	}
	if got := refs(f.A, games.GameLLSim, 10); !slices.Equal(got, []string{"q:C-LL1-001:v1"}) {
		t.Errorf("ll_sim: %v", got)
	}
	if got := refs(f.B, games.GameNazar, 10); !slices.Equal(got, []string{clipRef(9)}) {
		t.Errorf("B: %v", got)
	}
}

func eligibleMocks(t *testing.T, f Fixture) {
	mock := func(subj games.Subject, verified time.Duration, pct float64, nazar bool) {
		s := newSession(t, subj, games.GameNazar, games.ModeMock, t0, 1)
		insert(t, f, s)
		check(s, t0.Add(verified), pct, nazar)
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) error { return f.Store.CompleteSession(ctx, tx, s) })
	}
	mock(f.A, time.Minute, 50, true)
	mock(f.A, 3*time.Minute, 60.5, true)
	mock(f.A, 4*time.Minute, 99, false)
	mock(f.A, 2*time.Minute, 70, true)
	mock(f.B, 5*time.Minute, 10, true)
	p := newSession(t, f.A, games.GameNazar, games.ModeMock, t0, 2) // pending: never counts
	insert(t, f, p)
	submit(p, t0.Add(6*time.Minute))
	p.Status, p.Eligible = games.StatusPendingVerification, map[string]bool{games.EligibleNazarScore: true}
	inTenant(t, f, f.A, func(ctx context.Context, tx pgx.Tx) error { return f.Store.MarkPending(ctx, tx, p) })

	got := func(subj games.Subject, n int) []float64 {
		var out []float64
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) (err error) {
			out, err = f.Store.EligibleMocks(ctx, tx, subj, n)
			return err
		})
		return out
	}
	if g := got(f.A, 3); !slices.Equal(g, []float64{60.5, 70, 50}) {
		t.Errorf("A last 3: %v", g)
	}
	if g := got(f.A, 2); !slices.Equal(g, []float64{60.5, 70}) {
		t.Errorf("A last 2: %v", g)
	}
	if g := got(f.A, 0); len(g) != 0 {
		t.Errorf("n = 0: %v", g)
	}
	if g := got(f.B, 3); !slices.Equal(g, []float64{10}) {
		t.Errorf("B: %v", g)
	}
	if g := got(f.C, 3); len(g) != 0 {
		t.Errorf("C: %v", g)
	}
}

func incrementCounter(t *testing.T, f Fixture) {
	inTenant(t, f, f.A, func(ctx context.Context, tx pgx.Tx) error {
		if err := f.Store.IncrementCounter(ctx, tx, f.A.Tenant, games.CounterCounted, 1); err != nil {
			return err
		}
		return f.Store.IncrementCounter(ctx, tx, f.A.Tenant, games.CounterCounted, 3)
	})
	inSystem(t, f, func(ctx context.Context, tx pgx.Tx) error {
		return f.Store.IncrementCounter(ctx, tx, f.C.Tenant, games.CounterCounted, 2)
	})
	if a, c := f.Counter(t, f.A.Tenant, games.CounterCounted), f.Counter(t, f.C.Tenant, games.CounterCounted); a != 4 || c != 2 {
		t.Fatalf("counters %d %d, want 4 2", a, c)
	}
}

func staircase(t *testing.T, f Fixture) {
	if f.Staircase == nil {
		t.Skip("no staircase in this fixture")
	}
	level := func(subj games.Subject, game, skill string) int {
		var l int
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) (err error) {
			l, err = f.Staircase.Level(ctx, tx, subj, game, skill)
			return err
		})
		return l
	}
	record := func(subj games.Subject, game, skill string, passed bool) int {
		var l int
		inTenant(t, f, subj, func(ctx context.Context, tx pgx.Tx) (err error) {
			l, err = f.Staircase.Record(ctx, tx, subj, game, skill, passed)
			return err
		})
		return l
	}
	if l := level(f.A, games.GameNazar, "nazar"); l != 1 {
		t.Fatalf("initial level %d", l)
	}
	// game-core staircase.ts: 2 passes up, 1 fail down, 1..5.
	steps := []struct {
		pass bool
		want int
	}{
		{false, 1}, {true, 1}, {true, 2}, {true, 2}, {false, 1}, {true, 1}, {true, 2},
		{true, 2}, {true, 3}, {true, 3}, {true, 4}, {true, 4}, {true, 5}, {true, 5}, {true, 5},
		{true, 5}, {false, 4}, {true, 4}, {false, 3},
	}
	for i, st := range steps {
		if got := record(f.A, games.GameNazar, "nazar", st.pass); got != st.want {
			t.Fatalf("step %d (pass %v): level %d, want %d", i, st.pass, got, st.want)
		}
	}
	if l := level(f.A, games.GameNazar, "nazar"); l != 3 {
		t.Fatalf("level after the run %d", l)
	}
	// Per subject, game and skill.
	record(f.B, games.GameNazar, "nazar", true)
	if l := record(f.B, games.GameNazar, "nazar", true); l != 2 {
		t.Fatalf("B level %d", l)
	}
	if level(f.A, games.GameNazar, "other") != 1 || level(f.A, games.GameLLSim, "nazar") != 1 || level(f.C, games.GameNazar, "nazar") != 1 {
		t.Fatal("staircase leaked across skill, game or subject")
	}
	if level(f.A, games.GameNazar, "nazar") != 3 {
		t.Fatal("B's record changed A")
	}
}
