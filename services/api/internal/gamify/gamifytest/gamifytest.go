// Package gamifytest is the gamify.Store contract: one behaviour suite that the in-memory
// gamify.MemStore and the pgx store (internal/store.GamifyStore) must both pass, so the MemStore
// the package's unit tests run on keeps the database's semantics.
package gamifytest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
)

// Fixture is one fresh store plus a way to make subjects that the store accepts (for the pgx
// store, rows in core.applicants / core.family_members).
type Fixture struct {
	Store gamify.Store
	// Tenants are two distinct tenants the store accepts (for example "JK" and "KL").
	Tenants [2]string
	// NewAdult returns a signed-in adult account holder in tenant:
	// Subject{Tenant, ApplicantID, UserBand: "adult", Account: true}.
	NewAdult func(t *testing.T, tenant string) gamify.Subject
	// NewMinor returns a minor family member of parent:
	// Subject{parent's Tenant and ApplicantID, MemberID, UserBand: "u18", Minor: true, Account: true}.
	NewMinor func(t *testing.T, parent gamify.Subject) gamify.Subject
}

// MemFixture is the Fixture for gamify.MemStore.
func MemFixture(*testing.T) Fixture {
	return Fixture{
		Store:   gamify.NewMemStore(),
		Tenants: [2]string{"JK", "KL"},
		NewAdult: func(_ *testing.T, tenant string) gamify.Subject {
			return gamify.Subject{Tenant: tenant, ApplicantID: uuid.New(), UserBand: "adult", Account: true}
		},
		NewMinor: func(_ *testing.T, parent gamify.Subject) gamify.Subject {
			m := uuid.New()
			return gamify.Subject{Tenant: parent.Tenant, ApplicantID: parent.ApplicantID, MemberID: &m, UserBand: "u18", Minor: true, Account: true}
		},
	}
}

// t0 is a microsecond-exact instant (Postgres keeps microseconds): 2026-10-29 12:00 IST.
var t0 = time.Date(2026, 10, 29, 6, 30, 0, 0, time.UTC)

// jsonEqual compares JSON semantically; nil and JSON null are both "absent" (the MemStore clones
// through encoding/json, which turns a nil RawMessage into null; the database keeps SQL NULL).
func jsonEqual(a, b json.RawMessage) bool {
	if a == nil {
		a = json.RawMessage("null")
	}
	if b == nil {
		b = json.RawMessage("null")
	}
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

func entry(reason gamify.XPReason, source string, xp int, minutes float64, at time.Time, streak bool) *gamify.XPEntry {
	e, err := gamify.NewXPEntry(reason, source, xp, at)
	if err != nil {
		panic(err)
	}
	e.Minutes, e.CountsForStreak = minutes, streak
	e.Breakdown = json.RawMessage(`{"xp": ` + itoa(xp) + `, "base": 20}`)
	return e
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func hash(code string) []byte {
	h := sha256.Sum256([]byte(code))
	return h[:]
}

func newSquad(owner gamify.Subject, name, code string, created time.Time) *gamify.Squad {
	return &gamify.Squad{ID: uuid.New(), Tenant: owner.Tenant, Name: name, InviteCodeHash: hash(code), InviteExpiresAt: created.Add(gamify.InviteTTL),
		WeeklyGoal: 15, CreatedAt: created, Members: []gamify.SquadMember{{Subject: owner, DisplayName: "Asha", Role: "owner", JoinedAt: created}}}
}

func sameSquad(t *testing.T, want, got *gamify.Squad) {
	t.Helper()
	if got.ID != want.ID || got.Tenant != want.Tenant || got.Name != want.Name || !bytes.Equal(got.InviteCodeHash, want.InviteCodeHash) ||
		!got.InviteExpiresAt.Equal(want.InviteExpiresAt) || got.WeeklyGoal != want.WeeklyGoal || !got.CreatedAt.Equal(want.CreatedAt) ||
		(got.DisbandedAt == nil) != (want.DisbandedAt == nil) || (got.DisbandedAt != nil && !got.DisbandedAt.Equal(*want.DisbandedAt)) {
		t.Fatalf("squad:\n got %+v\nwant %+v", got, want)
	}
	if len(got.Members) != len(want.Members) {
		t.Fatalf("members: got %d, want %d (%+v)", len(got.Members), len(want.Members), got.Members)
	}
	for i := range want.Members {
		w, g := want.Members[i], got.Members[i]
		if !reflect.DeepEqual(w.Subject, g.Subject) || w.DisplayName != g.DisplayName || w.Role != g.Role || !w.JoinedAt.Equal(g.JoinedAt) {
			t.Fatalf("member %d:\n got %+v\nwant %+v", i, g, w)
		}
	}
}

func sameCard(t *testing.T, want, got *gamify.ShareCard) {
	t.Helper()
	if got.ShortID != want.ShortID || !reflect.DeepEqual(got.Subject, want.Subject) || got.Kind != want.Kind || got.Display != want.Display ||
		got.DisplayText != want.DisplayText || got.BadgeID != want.BadgeID || got.KeralaLine != want.KeralaLine ||
		!got.CreatedAt.Equal(want.CreatedAt) || !got.ExpiresAt.Equal(want.ExpiresAt) ||
		(got.WithdrawnAt == nil) != (want.WithdrawnAt == nil) || (got.WithdrawnAt != nil && !got.WithdrawnAt.Equal(*want.WithdrawnAt)) {
		t.Fatalf("card:\n got %+v\nwant %+v", got, want)
	}
}

// RunStoreContract runs the gamify.Store behaviour suite; newFixture must return a fresh, empty
// store for each case.
func RunStoreContract(t *testing.T, newFixture func(t *testing.T) Fixture) {
	cases := []struct {
		name string
		run  func(t *testing.T, ctx context.Context, f Fixture)
	}{
		{"XPAppendDedupeAndRead", xpAppendDedupeAndRead},
		{"XPReasonRefused", xpReasonRefused},
		{"XPDayAndWeekSums", xpDayAndWeekSums},
		{"ProgressRoundTripAndReplace", progressRoundTrip},
		{"DeclarationLifecycle", declarationLifecycle},
		{"SquadLifecycleAndCap", squadLifecycle},
		{"SquadOwnerSwapAndOrder", squadOwnerSwap},
		{"SquadsOfOrderAndCrossTenantLookup", squadsOf},
		{"ShareCards", shareCards},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.run(t, context.Background(), newFixture(t))
		})
	}
}

func xpAppendDedupeAndRead(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	kid := f.NewMinor(t, me)
	e := entry(gamify.ReasonSession, "ses-1", 23, 12.5, t0, true)
	ok, err := f.Store.AppendXP(ctx, me, e)
	if err != nil || !ok {
		t.Fatalf("first append: %v %v", ok, err)
	}
	// Same (subject, reason, source): not inserted, even with another entry ID and XP.
	again := entry(gamify.ReasonSession, "ses-1", 99, 1, t0.Add(time.Hour), false)
	if ok, err := f.Store.AppendXP(ctx, me, again); err != nil || ok {
		t.Fatalf("duplicate append: %v %v", ok, err)
	}
	// Another reason with the same source, and the same key for another subject, are new rows.
	if ok, err := f.Store.AppendXP(ctx, me, entry(gamify.ReasonReview, "ses-1", 5, 2, t0, false)); err != nil || !ok {
		t.Fatalf("other reason: %v %v", ok, err)
	}
	if ok, err := f.Store.AppendXP(ctx, kid, entry(gamify.ReasonSession, "ses-1", 7, 3, t0, true)); err != nil || !ok {
		t.Fatalf("family member, same source: %v %v", ok, err)
	}
	got, err := f.Store.XPEntryBySource(ctx, me, gamify.ReasonSession, "ses-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != e.ID || got.Reason != e.Reason || got.SourceID != e.SourceID || got.XP != 23 || got.Minutes != 12.5 || got.ISTDay != "2026-10-29" ||
		got.WeekKey != "2026-W44" || !got.CountsForStreak || !got.At.Equal(t0) || !jsonEqual(got.Breakdown, e.Breakdown) {
		t.Fatalf("entry:\n got %+v\nwant %+v", got, e)
	}
	if k, _ := f.Store.XPEntryBySource(ctx, kid, gamify.ReasonSession, "ses-1"); k == nil || k.XP != 7 {
		t.Fatalf("family member's entry %+v", k)
	}
	if _, err := f.Store.XPEntryBySource(ctx, me, gamify.ReasonLesson, "ses-1"); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("missing entry: %v", err)
	}
	// A nil breakdown stays nil.
	nb := entry(gamify.ReasonLesson, "les-1", 0, 0, t0, false)
	nb.Breakdown = nil
	if _, err := f.Store.AppendXP(ctx, me, nb); err != nil {
		t.Fatal(err)
	}
	if g, err := f.Store.XPEntryBySource(ctx, me, gamify.ReasonLesson, "les-1"); err != nil || !jsonEqual(g.Breakdown, nil) {
		t.Fatalf("nil breakdown: %s %v", g.Breakdown, err)
	}
}

func xpReasonRefused(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	for _, r := range []gamify.XPReason{"open", "app_open", "share", "invite", "squad_join", "streak_day", ""} {
		e := &gamify.XPEntry{ID: uuid.New(), Reason: r, SourceID: "x", XP: 50, ISTDay: "2026-10-29", WeekKey: "2026-W44", At: t0}
		if ok, err := f.Store.AppendXP(ctx, me, e); !errors.Is(err, gamify.ErrXPReasonNotAllowed) || ok {
			t.Fatalf("reason %q: %v %v", r, ok, err)
		}
	}
	if n, _ := f.Store.XPOn(ctx, me, "2026-10-29"); n != 0 {
		t.Fatalf("refused rows counted: %d", n)
	}
}

func xpDayAndWeekSums(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	other := f.NewAdult(t, f.Tenants[0])
	if c, err := f.Store.WeekCounts(ctx, me); err != nil || len(c) != 0 {
		t.Fatalf("empty week counts %v %v", c, err)
	}
	if m, err := f.Store.MinutesOn(ctx, me, "2026-10-29"); err != nil || m != 0 {
		t.Fatalf("empty minutes %v %v", m, err)
	}
	day2 := t0.Add(24 * time.Hour)
	lastWeek := t0.Add(-7 * 24 * time.Hour)
	for _, e := range []*gamify.XPEntry{
		entry(gamify.ReasonSession, "a", 20, 10.25, t0, true),
		entry(gamify.ReasonReview, "b", 15, 5.5, t0, false),
		entry(gamify.ReasonSession, "c", 8, 30, day2, true),
		entry(gamify.ReasonSession, "d", 4, 1, lastWeek, true),
	} {
		if _, err := f.Store.AppendXP(ctx, me, e); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.Store.AppendXP(ctx, other, entry(gamify.ReasonSession, "a", 100, 60, t0, true)); err != nil {
		t.Fatal(err)
	}
	if m, _ := f.Store.MinutesOn(ctx, me, "2026-10-29"); m != 15.75 {
		t.Fatalf("minutes %v", m)
	}
	if x, _ := f.Store.XPOn(ctx, me, "2026-10-29"); x != 35 {
		t.Fatalf("xp %v", x)
	}
	if x, _ := f.Store.XPOn(ctx, me, "2026-10-30"); x != 8 {
		t.Fatalf("xp day 2 %v", x)
	}
	c, err := f.Store.WeekCounts(ctx, me)
	if err != nil || !reflect.DeepEqual(c, map[string]int{"2026-W44": 2, "2026-W43": 1}) {
		t.Fatalf("week counts %v %v", c, err)
	}
}

func progressRoundTrip(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	kid := f.NewMinor(t, me)
	if _, err := f.Store.GetProgress(ctx, me); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("no progress yet: %v", err)
	}
	// An empty progress (rank "", no JSON, no badges) round-trips.
	if err := f.Store.SaveProgress(ctx, kid, &gamify.Progress{StreakGoal: 4, Badges: map[string]gamify.BadgeRecord{}, UpdatedAt: t0}); err != nil {
		t.Fatal(err)
	}
	if p, err := f.Store.GetProgress(ctx, kid); err != nil || p.Rank != "" || !jsonEqual(p.RankNext, nil) || !jsonEqual(p.Streak, nil) || !jsonEqual(p.StreakView, nil) ||
		len(p.Badges) != 0 || p.StreakGoal != 4 || p.XPTotal != 0 {
		t.Fatalf("empty progress %+v %v", p, err)
	}
	want := &gamify.Progress{XPTotal: 345, Rank: "R2", RankNext: json.RawMessage(`{"rank":"R3","xp":900}`),
		Streak:     json.RawMessage(`{"status":"active","weeks":3,"tokens":1,"goal":5,"lastClosedWeek":"2026-W43"}`),
		StreakView: json.RawMessage(`{"weekKey":"2026-W44","dots":5,"filled":2,"pothole":false}`), StreakGoal: 5, UpdatedAt: t0,
		Badges: map[string]gamify.BadgeRecord{
			"B1": {ID: "B1", AwardedAt: t0, SelfDeclared: true},
			"B3": {ID: "B3", AwardedAt: t0.Add(time.Minute)},
		}}
	if err := f.Store.SaveProgress(ctx, me, want); err != nil {
		t.Fatal(err)
	}
	check := func(want *gamify.Progress) {
		t.Helper()
		got, err := f.Store.GetProgress(ctx, me)
		if err != nil {
			t.Fatal(err)
		}
		if got.XPTotal != want.XPTotal || got.Rank != want.Rank || got.StreakGoal != want.StreakGoal || !jsonEqual(got.RankNext, want.RankNext) ||
			!jsonEqual(got.Streak, want.Streak) || !jsonEqual(got.StreakView, want.StreakView) || len(got.Badges) != len(want.Badges) {
			t.Fatalf("progress:\n got %+v\nwant %+v", got, want)
		}
		for id, w := range want.Badges {
			g, ok := got.Badges[id]
			if !ok || g.ID != w.ID || g.SelfDeclared != w.SelfDeclared || !g.AwardedAt.Equal(w.AwardedAt) {
				t.Fatalf("badge %s: got %+v want %+v", id, g, w)
			}
		}
	}
	check(want)
	// Saving again replaces everything: B1 revoked (silently), B2 added, rank and XP moved on.
	next := &gamify.Progress{XPTotal: 950, Rank: "R3", RankNext: json.RawMessage(`null`), Streak: want.Streak, StreakView: want.StreakView,
		StreakGoal: 5, UpdatedAt: t0.Add(time.Hour), Badges: map[string]gamify.BadgeRecord{
			"B2": {ID: "B2", AwardedAt: t0.Add(time.Hour), SelfDeclared: true},
			"B3": {ID: "B3", AwardedAt: t0.Add(time.Minute)},
		}}
	if err := f.Store.SaveProgress(ctx, me, next); err != nil {
		t.Fatal(err)
	}
	check(next)
	// The family member's progress is separate.
	if p, _ := f.Store.GetProgress(ctx, kid); p == nil || p.XPTotal != 0 || len(p.Badges) != 0 {
		t.Fatalf("family member's progress changed: %+v", p)
	}
}

func declarationLifecycle(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	if _, err := f.Store.GetDeclaration(ctx, me); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("no declaration yet: %v", err)
	}
	if err := f.Store.DeleteDeclaration(ctx, me); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("delete with none: %v", err)
	}
	d := &gamify.Declaration{DLIssuedOn: "2026-10-02", NoAgentUsed: true, FirstAttemptPass: true, DeclaredAt: t0}
	if err := f.Store.SaveDeclaration(ctx, me, d); err != nil {
		t.Fatal(err)
	}
	if got, err := f.Store.GetDeclaration(ctx, me); err != nil || !sameDecl(got, d) {
		t.Fatalf("declaration %+v %v", got, err)
	}
	// A second declaration replaces the first, with a wire case ID.
	d2 := &gamify.Declaration{CaseID: ids.Encode(ids.Case, ids.New()), DLIssuedOn: "2026-09-30", NoAgentUsed: true, DeclaredAt: t0.Add(time.Hour)}
	if err := f.Store.SaveDeclaration(ctx, me, d2); err != nil {
		t.Fatal(err)
	}
	if got, err := f.Store.GetDeclaration(ctx, me); err != nil || !sameDecl(got, d2) {
		t.Fatalf("replaced declaration %+v %v", got, err)
	}
	if err := f.Store.DeleteDeclaration(ctx, me); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Store.GetDeclaration(ctx, me); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
}

func squadLifecycle(t *testing.T, ctx context.Context, f Fixture) {
	owner := f.NewAdult(t, f.Tenants[0])
	sq := newSquad(owner, "GCET Riders", "SQ-ABCDEF", t0)
	if err := f.Store.InsertSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, err := f.Store.GetSquad(ctx, sq.ID)
	if err != nil {
		t.Fatal(err)
	}
	sameSquad(t, sq, got)
	if got, err = f.Store.SquadByInviteHash(ctx, hash("SQ-ABCDEF")); err != nil {
		t.Fatal(err)
	}
	sameSquad(t, sq, got)
	if _, err := f.Store.GetSquad(ctx, uuid.New()); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("unknown squad: %v", err)
	}
	if _, err := f.Store.SquadByInviteHash(ctx, hash("SQ-NOPE")); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("unknown invite: %v", err)
	}
	// Join up to five (a minor family member included); all joins share one instant.
	sq.Members = append(sq.Members, gamify.SquadMember{Subject: f.NewMinor(t, owner), DisplayName: "Rahul", Role: "member", JoinedAt: t0})
	for _, n := range []string{"Ravi", "Meena", "Arjun"} {
		sq.Members = append(sq.Members, gamify.SquadMember{Subject: f.NewAdult(t, f.Tenants[0]), DisplayName: n, Role: "member", JoinedAt: t0})
	}
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	// A sixth member is refused by the store itself (the member-cap trigger), and nothing changes.
	six := *got
	six.Members = append(append([]gamify.SquadMember{}, got.Members...),
		gamify.SquadMember{Subject: f.NewAdult(t, f.Tenants[0]), DisplayName: "Sixth", Role: "member", JoinedAt: t0})
	if err := f.Store.UpdateSquad(ctx, &six); !errors.Is(err, gamify.ErrSquadFull) {
		t.Fatalf("sixth member: %v", err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	tooBig := newSquad(owner, "Too many", "SQ-BIGBIG", t0)
	for i := 0; i < 5; i++ {
		tooBig.Members = append(tooBig.Members, gamify.SquadMember{Subject: f.NewAdult(t, f.Tenants[0]), DisplayName: "M", Role: "member", JoinedAt: t0})
	}
	if err := f.Store.InsertSquad(ctx, tooBig); !errors.Is(err, gamify.ErrSquadFull) {
		t.Fatalf("insert with 6 members: %v", err)
	}
	if _, err := f.Store.GetSquad(ctx, tooBig.ID); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("refused squad stored: %v", err)
	}
	// The owner leaves: the next member becomes owner, order kept, others unchanged.
	sq.Members = append([]gamify.SquadMember{}, sq.Members[1:]...)
	sq.Members[0].Role = "owner"
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	// A member leaves from the middle and a new one joins in the same save.
	sq.Members = append(append([]gamify.SquadMember{}, sq.Members[:1]...), sq.Members[2:]...)
	sq.Members = append(sq.Members, gamify.SquadMember{Subject: f.NewAdult(t, f.Tenants[0]), DisplayName: "Kiran", Role: "member", JoinedAt: t0.Add(time.Hour)})
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	// Everyone leaves: disbanded, no members.
	at := t0.Add(2 * time.Hour)
	sq.Members, sq.DisbandedAt = []gamify.SquadMember{}, &at
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	// Updating an unknown squad.
	ghost := newSquad(owner, "Ghost", "SQ-GHOSTS", t0)
	if err := f.Store.UpdateSquad(ctx, ghost); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("update unknown squad: %v", err)
	}
}

func squadOwnerSwap(t *testing.T, ctx context.Context, f Fixture) {
	a, b := f.NewAdult(t, f.Tenants[0]), f.NewAdult(t, f.Tenants[0])
	sq := newSquad(a, "Swap", "SQ-SWAPSW", t0)
	sq.Members = append(sq.Members, gamify.SquadMember{Subject: b, DisplayName: "Bina", Role: "member", JoinedAt: t0})
	if err := f.Store.InsertSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	// Ownership moves without anyone leaving, and the display name and goal change.
	sq.Members[0].Role, sq.Members[1].Role, sq.Members[1].DisplayName = "member", "owner", "Bina K"
	sq.WeeklyGoal, sq.Name = 20, "Swapped"
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ := f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
	// Members reordered (as LeaveSquad's sort may do) keep the new order.
	sq.Members[0], sq.Members[1] = sq.Members[1], sq.Members[0]
	if err := f.Store.UpdateSquad(ctx, sq); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Store.GetSquad(ctx, sq.ID)
	sameSquad(t, sq, got)
}

func squadsOf(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	if l, err := f.Store.SquadsOf(ctx, me); err != nil || len(l) != 0 {
		t.Fatalf("no squads: %v %v", l, err)
	}
	friend := f.NewAdult(t, f.Tenants[0])
	later := newSquad(friend, "Later", "SQ-LATER2", t0.Add(time.Hour))
	later.Members = append(later.Members, gamify.SquadMember{Subject: me, DisplayName: "Me", Role: "member", JoinedAt: t0.Add(time.Hour)})
	first := newSquad(me, "First", "SQ-FIRST2", t0)
	notMine := newSquad(friend, "Not mine", "SQ-OTHER2", t0)
	at := t0.Add(3 * time.Hour)
	gone := newSquad(me, "Gone", "SQ-GONE22", t0.Add(2*time.Hour))
	for _, s := range []*gamify.Squad{later, first, notMine, gone} {
		if err := f.Store.InsertSquad(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	// A disbanded squad the subject is still listed in is returned (the service filters it).
	gone.DisbandedAt = &at
	if err := f.Store.UpdateSquad(ctx, gone); err != nil {
		t.Fatal(err)
	}
	l, err := f.Store.SquadsOf(ctx, me)
	if err != nil || len(l) != 3 {
		t.Fatalf("squads of: %d %v", len(l), err)
	}
	sameSquad(t, first, l[0])
	sameSquad(t, later, l[1])
	sameSquad(t, gone, l[2])
	// A squad of the other tenant is found by ID and invite without a tenant (the service
	// refuses a cross-tenant join), and it is not in this tenant's lists.
	kl := f.NewAdult(t, f.Tenants[1])
	klSquad := newSquad(kl, "Kochi", "SQ-KOCHI2", t0)
	if err := f.Store.InsertSquad(ctx, klSquad); err != nil {
		t.Fatal(err)
	}
	if got, err := f.Store.SquadByInviteHash(ctx, hash("SQ-KOCHI2")); err != nil || got.Tenant != f.Tenants[1] {
		t.Fatalf("cross-tenant invite lookup: %+v %v", got, err)
	}
	got, err := f.Store.GetSquad(ctx, klSquad.ID)
	if err != nil {
		t.Fatal(err)
	}
	sameSquad(t, klSquad, got)
	if l, _ := f.Store.SquadsOf(ctx, kl); len(l) != 1 || l[0].ID != klSquad.ID {
		t.Fatalf("KL squads %+v", l)
	}
}

func shareCards(t *testing.T, ctx context.Context, f Fixture) {
	me := f.NewAdult(t, f.Tenants[0])
	kid := f.NewMinor(t, me)
	c := &gamify.ShareCard{ShortID: "abcdefghij", Subject: me, Kind: "nazar_score", Display: "initials", DisplayText: "AK", KeralaLine: true,
		CreatedAt: t0, ExpiresAt: t0.Add(gamify.ShareCardTTL)}
	b := &gamify.ShareCard{ShortID: "k2m3n4p5q6", Subject: kid, Kind: "badge", Display: "first_name", DisplayText: "Rahul", BadgeID: "B3",
		CreatedAt: t0, ExpiresAt: t0.Add(gamify.ShareCardTTL)}
	klc := &gamify.ShareCard{ShortID: "zz99yy88xx", Subject: f.NewAdult(t, f.Tenants[1]), Kind: "rank", Display: "initials", DisplayText: "M",
		CreatedAt: t0, ExpiresAt: t0.Add(gamify.ShareCardTTL)}
	for _, x := range []*gamify.ShareCard{c, b, klc} {
		if err := f.Store.InsertShareCard(ctx, x); err != nil {
			t.Fatal(err)
		}
	}
	for _, x := range []*gamify.ShareCard{c, b, klc} { // read with no tenant, whichever tenant made it
		got, err := f.Store.GetShareCard(ctx, x.ShortID)
		if err != nil {
			t.Fatal(err)
		}
		sameCard(t, x, got)
	}
	if _, err := f.Store.GetShareCard(ctx, "nosuchcard"); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("unknown card: %v", err)
	}
	w := t0.Add(time.Hour)
	c.WithdrawnAt = &w
	if err := f.Store.UpdateShareCard(ctx, c); err != nil {
		t.Fatal(err)
	}
	got, _ := f.Store.GetShareCard(ctx, c.ShortID)
	sameCard(t, c, got)
	ghost := *b
	ghost.ShortID = "qqqqqqqqqq"
	if err := f.Store.UpdateShareCard(ctx, &ghost); !errors.Is(err, gamify.ErrNotFound) {
		t.Fatalf("update unknown card: %v", err)
	}
}

func sameDecl(a, b *gamify.Declaration) bool {
	return a.CaseID == b.CaseID && a.DLIssuedOn == b.DLIssuedOn && a.NoAgentUsed == b.NoAgentUsed && a.FirstAttemptPass == b.FirstAttemptPass &&
		a.DeclaredAt.Equal(b.DeclaredAt)
}
