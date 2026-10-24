// Package studytest is the study.Store contract: one behaviour suite run on the MemStore
// (internal/study) and on the pgx StudyStore (internal/store), so both keep the same semantics.
package studytest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// Fixture is a fresh, empty store plus the hooks the suite needs to arrange rows the Store
// interface does not write itself.
type Fixture struct {
	Store study.Store
	// Tenant and Other are two existing tenants (for example JK and KL).
	Tenant, Other string
	// Applicant returns an applicant of tenant and the id of its active field_study consent.
	Applicant func(t *testing.T, tenant string) (applicant, consent uuid.UUID)
	// AddSession stores a verified field_test study session of applicant (the games package's
	// job in production).
	AddSession func(t *testing.T, tenant string, applicant uuid.UUID, s *study.Session)
	// SetBlocks configures the tenant's form blocks.
	SetBlocks func(t *testing.T, tenant string, b *study.Blocks)
	// LatestStats returns the newest saved public stats of tenant, or nil.
	LatestStats func(t *testing.T, tenant string) *study.PublicStats
}

// T0 is the suite's reference time (whole microseconds, as Postgres stores them).
var T0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

// Blocks returns a valid set of form blocks.
func Blocks() *study.Blocks {
	b := &study.Blocks{}
	for i := 1; i <= 5; i++ {
		b.B1 = append(b.B1, fmt.Sprintf("clip:JMU-%04d@1", i))
		b.B2 = append(b.B2, fmt.Sprintf("clip:JMU-%04d@1", 10+i))
		b.B3 = append(b.B3, fmt.Sprintf("clip:JMU-%04d@1", 20+i))
	}
	for i := 1; i <= 15; i++ {
		b.LLSet = append(b.LLSet, fmt.Sprintf("q:LL-%03d", i))
	}
	return b
}

// enrol allocates a seq and inserts a participant the way study.Service.Enrol does.
func enrol(t *testing.T, f Fixture, tenant string, applicant, consent uuid.UUID, retakeOf string) *study.Participant {
	t.Helper()
	ctx := context.Background()
	seq, err := f.Store.NextSeq(ctx, tenant)
	require.NoError(t, err)
	p := &study.Participant{Code: fmt.Sprintf("P-%03d", seq), Tenant: tenant, ApplicantID: applicant, ConsentID: consent,
		AgeBand: "21_24", LicenceHeld: "2w", YearsDriving: "1_3", AgeOK: true, Form: study.FormFor(seq), Seq: seq,
		RetakeOf: retakeOf, CreatedAt: T0.Add(time.Duration(seq) * time.Minute)}
	require.NoError(t, f.Store.InsertParticipant(ctx, p))
	return p
}

func requireParticipant(t *testing.T, want, got *study.Participant) {
	t.Helper()
	require.NotNil(t, got)
	require.True(t, want.CreatedAt.Equal(got.CreatedAt), "created_at %v != %v", want.CreatedAt, got.CreatedAt)
	require.Equal(t, want.WithdrawnAt == nil, got.WithdrawnAt == nil, "withdrawn_at")
	if want.WithdrawnAt != nil {
		require.True(t, want.WithdrawnAt.Equal(*got.WithdrawnAt))
	}
	w, g := *want, *got
	w.CreatedAt, g.CreatedAt, w.WithdrawnAt, g.WithdrawnAt = time.Time{}, time.Time{}, nil, nil
	require.Equal(t, w, g)
}

func codes(ps []*study.Participant) []string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.Code)
	}
	return out
}

func f64(x float64) *float64 { return &x }

func analysis(marks float64) map[string]study.NazarAnalysis {
	band := 4
	clip := func(rule string) study.NazarAnalysis {
		return study.NazarAnalysis{Rule: rule, Clips: []study.ClipAnalysis{{Ordinal: 1, Ref: "clip:JMU-0001@1", Taps: 2,
			MaxTapsInWindow: 1, Marks: marks, Hazards: []study.HazardAnalysis{{HazardID: "h1", HazardType: "pedestrian",
				Credit: 0.8, Band: &band, TapMt: f64(1234.5), LateS: f64(0.75), Metres: f64(6.2)}}}}}
	}
	return map[string]study.NazarAnalysis{study.KindPrimary: clip("kerala_5band"), study.KindLinear: clip("field_kit_linear")}
}

// RunStoreContract runs the study.Store behaviour suite; newFixture must return a fresh store.
func RunStoreContract(t *testing.T, newFixture func(t *testing.T) Fixture) {
	ctx := context.Background()

	t.Run("NextSeqPerTenant", func(t *testing.T) {
		f := newFixture(t)
		for want := 1; want <= 3; want++ {
			got, err := f.Store.NextSeq(ctx, f.Tenant)
			require.NoError(t, err)
			require.Equal(t, want, got)
		}
		got, err := f.Store.NextSeq(ctx, f.Other)
		require.NoError(t, err)
		require.Equal(t, 1, got, "the other tenant counts from 1")
	})

	t.Run("NextSeqConcurrentDistinct", func(t *testing.T) {
		f := newFixture(t)
		const n = 8
		var mu sync.Mutex
		var got []int
		var wg sync.WaitGroup
		errs := make(chan error, n)
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				v, err := f.Store.NextSeq(ctx, f.Tenant)
				if err != nil {
					errs <- err
					return
				}
				mu.Lock()
				got = append(got, v)
				mu.Unlock()
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			require.NoError(t, err)
		}
		sort.Ints(got)
		require.Equal(t, []int{1, 2, 3, 4, 5, 6, 7, 8}, got)
	})

	t.Run("InsertGetRoundTrip", func(t *testing.T) {
		f := newFixture(t)
		app, consent := f.Applicant(t, f.Tenant)
		p1 := enrol(t, f, f.Tenant, app, consent, "")
		p2 := enrol(t, f, f.Tenant, app, consent, p1.Code)
		for _, want := range []*study.Participant{p1, p2} {
			got, err := f.Store.GetParticipant(ctx, f.Tenant, want.Code)
			require.NoError(t, err)
			requireParticipant(t, want, got)
		}
		require.Equal(t, "A", p1.Form)
		require.Equal(t, "B", p2.Form)
		_, err := f.Store.GetParticipant(ctx, f.Tenant, "P-999")
		require.ErrorIs(t, err, study.ErrNotFound)
		_, err = f.Store.GetParticipant(ctx, f.Other, p1.Code)
		require.ErrorIs(t, err, study.ErrNotFound, "another tenant's participant is not found")
	})

	t.Run("UpdateParticipant", func(t *testing.T) {
		f := newFixture(t)
		app, consent := f.Applicant(t, f.Tenant)
		p := enrol(t, f, f.Tenant, app, consent, "")
		p.NearMissText = "A bus pulled out without signalling"
		require.NoError(t, f.Store.UpdateParticipant(ctx, p))
		got, err := f.Store.GetParticipant(ctx, f.Tenant, p.Code)
		require.NoError(t, err)
		requireParticipant(t, p, got)

		w := T0.Add(time.Hour)
		p.WithdrawnAt, p.NearMissText = &w, ""
		require.NoError(t, f.Store.UpdateParticipant(ctx, p))
		got, err = f.Store.GetParticipant(ctx, f.Tenant, p.Code)
		require.NoError(t, err)
		requireParticipant(t, p, got)

		missing := *p
		missing.Code = "P-999"
		require.ErrorIs(t, f.Store.UpdateParticipant(ctx, &missing), study.ErrNotFound)
		other := *p
		other.Tenant = f.Other
		require.ErrorIs(t, f.Store.UpdateParticipant(ctx, &other), study.ErrNotFound, "no update across tenants")
	})

	t.Run("ParticipantListsInArrivalOrder", func(t *testing.T) {
		f := newFixture(t)
		a, ca := f.Applicant(t, f.Tenant)
		b, cb := f.Applicant(t, f.Tenant)
		pa1 := enrol(t, f, f.Tenant, a, ca, "")
		pb1 := enrol(t, f, f.Tenant, b, cb, "")
		pa2 := enrol(t, f, f.Tenant, a, ca, pa1.Code)
		o, co := f.Applicant(t, f.Other)
		enrol(t, f, f.Other, o, co, "")

		mine, err := f.Store.ParticipantsByApplicant(ctx, f.Tenant, a)
		require.NoError(t, err)
		require.Equal(t, []string{pa1.Code, pa2.Code}, codes(mine))
		requireParticipant(t, pa2, mine[1])

		none, err := f.Store.ParticipantsByApplicant(ctx, f.Tenant, uuid.New())
		require.NoError(t, err)
		require.Empty(t, none)
		cross, err := f.Store.ParticipantsByApplicant(ctx, f.Other, a)
		require.NoError(t, err)
		require.Empty(t, cross)

		all, err := f.Store.Participants(ctx, f.Tenant)
		require.NoError(t, err)
		require.Equal(t, []string{pa1.Code, pb1.Code, pa2.Code}, codes(all))
		other, err := f.Store.Participants(ctx, f.Other)
		require.NoError(t, err)
		require.Equal(t, []string{"P-001"}, codes(other))
	})

	t.Run("SessionsRoundTrip", func(t *testing.T) {
		f := newFixture(t)
		empty, err := f.Store.Sessions(ctx, f.Tenant)
		require.NoError(t, err)
		require.NotNil(t, empty, "Sessions returns an empty, non-nil slice")
		require.Empty(t, empty)

		app, consent := f.Applicant(t, f.Tenant)
		p := enrol(t, f, f.Tenant, app, consent, "")
		want := []*study.Session{
			{ParticipantCode: p.Code, Phase: study.PhaseLLMock, SessionID: uuid.New(), Trust: 1, DurationMs: 95000,
				ScoreRaw: 12, ScoreMax: 15, VerifiedAt: T0.Add(time.Minute)},
			{ParticipantCode: p.Code, Phase: study.PhaseTest, SessionID: uuid.New(), Trust: 0.729, DurationMs: 181250,
				ScoreRaw: 63.5, ScoreMax: 100, Analysis: analysis(7.5), VerifiedAt: T0.Add(2 * time.Minute)},
			{ParticipantCode: p.Code, Phase: study.PhaseFresh, SessionID: uuid.New(), Trust: 0.9, DurationMs: 90000,
				ScoreRaw: 40, ScoreMax: 50, Analysis: analysis(8), VerifiedAt: T0.Add(3 * time.Minute)},
		}
		for _, s := range want {
			f.AddSession(t, f.Tenant, app, s)
		}
		o, co := f.Applicant(t, f.Other)
		po := enrol(t, f, f.Other, o, co, "")
		f.AddSession(t, f.Other, o, &study.Session{ParticipantCode: po.Code, Phase: study.PhaseTest, SessionID: uuid.New(),
			Trust: 1, DurationMs: 1000, ScoreMax: 100, Analysis: analysis(1), VerifiedAt: T0})

		got, err := f.Store.Sessions(ctx, f.Tenant)
		require.NoError(t, err)
		require.Len(t, got, len(want))
		for i := range want {
			require.True(t, want[i].VerifiedAt.Equal(got[i].VerifiedAt), "verified_at %d", i)
			w, g := *want[i], *got[i]
			w.VerifiedAt, g.VerifiedAt = time.Time{}, time.Time{}
			require.InDelta(t, w.Trust, g.Trust, 1e-9)
			w.Trust, g.Trust = 0, 0
			require.Equal(t, w, g, "session %d", i)
		}
		other, err := f.Store.Sessions(ctx, f.Other)
		require.NoError(t, err)
		require.Len(t, other, 1)
		require.Equal(t, po.Code, other[0].ParticipantCode)
	})

	t.Run("FormBlocks", func(t *testing.T) {
		f := newFixture(t)
		_, err := f.Store.FormBlocks(ctx, f.Tenant)
		require.ErrorIs(t, err, study.ErrNotFound)
		require.True(t, err == study.ErrNotFound, "Service.Export compares with ==; got %v", err) //nolint:errorlint // export.go contract
		b := Blocks()
		f.SetBlocks(t, f.Tenant, b)
		got, err := f.Store.FormBlocks(ctx, f.Tenant)
		require.NoError(t, err)
		require.Equal(t, b, got)
		items, err := study.ItemsFor(got, "B", study.PhaseFresh)
		require.NoError(t, err)
		require.Equal(t, b.B1, items)
		_, err = f.Store.FormBlocks(ctx, f.Other)
		require.True(t, errors.Is(err, study.ErrNotFound), "other tenant has no blocks: %v", err)
	})

	t.Run("PublicStats", func(t *testing.T) {
		f := newFixture(t)
		require.Nil(t, f.LatestStats(t, f.Tenant))
		sha := "ab12000000000000000000000000000000000000000000000000000000000000"
		older := &study.PublicStats{AsOf: T0, Payload: map[string]any{"participants": 3, "status": "collecting"}, ScriptSHA256: sha}
		newer := &study.PublicStats{AsOf: T0.Add(24 * time.Hour), Payload: map[string]any{"participants": 7, "status": "reported",
			"ci95": []any{12.5, 40.1}, "r_ll_quiz_vs_nazar": nil}, ScriptSHA256: sha, PreregCommit: "4f9c2e1"}
		require.NoError(t, f.Store.SavePublicStats(ctx, f.Tenant, newer))
		require.NoError(t, f.Store.SavePublicStats(ctx, f.Tenant, older))
		got := f.LatestStats(t, f.Tenant)
		require.NotNil(t, got)
		require.True(t, newer.AsOf.Equal(got.AsOf))
		require.Equal(t, newer.ScriptSHA256, got.ScriptSHA256)
		require.Equal(t, newer.PreregCommit, got.PreregCommit)
		wantJSON, err := json.Marshal(newer.Payload)
		require.NoError(t, err)
		gotJSON, err := json.Marshal(got.Payload)
		require.NoError(t, err)
		require.JSONEq(t, string(wantJSON), string(gotJSON))
		require.Nil(t, f.LatestStats(t, f.Other), "stats are per tenant")
	})
}
