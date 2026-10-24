package store_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/games/gamestest"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

var gamesT0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

// gamesSubjects creates A (adult account holder, JK), B (minor family member in A's account) and
// C (adult device holder, KL) and returns their subjects as accounts.ResolveLearner builds them.
func gamesSubjects(t *testing.T, db *store.DB) (a, b, c games.Subject) {
	t.Helper()
	ctx := context.Background()
	addTenantKL(t, db)
	holder := &store.Applicant{ID: ids.New(), TenantID: "JK", Kind: "account", UserBand: "adult"}
	member := &store.FamilyMember{ID: ids.New(), TenantID: "JK", ApplicantID: holder.ID, Relation: "child", DOBEnc: []byte{1},
		DOBPrecision: "year_only", AgeBand: "16_17", IsMinor: true, ParentalConsentStatus: "required"}
	device := &store.Applicant{ID: ids.New(), TenantID: "KL", Kind: "device", UserBand: "adult"}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		if err := store.InsertApplicant(ctx, tx, holder); err != nil {
			return err
		}
		return store.InsertFamilyMember(ctx, tx, member)
	}))
	require.NoError(t, db.Tenant(ctx, "KL", func(tx pgx.Tx) error { return store.InsertApplicant(ctx, tx, device) }))
	a = games.Subject{Tenant: "JK", ApplicantID: holder.ID, UserBand: "adult", Account: true}
	b = a
	b.MemberID, b.UserBand, b.Minor = &member.ID, "u18", true
	c = games.Subject{Tenant: "KL", ApplicantID: device.ID, UserBand: "adult"}
	return a, b, c
}

func gamesFixture(t *testing.T) gamestest.Fixture {
	db := testdb.Open(t)
	a, b, c := gamesSubjects(t, db)
	return gamestest.Fixture{
		Store: store.GamesStore{}, Staircase: store.GamesStaircase{}, DB: db, A: a, B: b, C: c,
		Counter: func(t *testing.T, tenant, name string) int64 {
			var n int64
			require.NoError(t, db.System(context.Background(), func(tx pgx.Tx) error {
				m, err := store.Counters(context.Background(), tx, tenant)
				n = m[name]
				return err
			}))
			return n
		},
	}
}

// The pgx store passes the same contract as games.MemStore (internal/games/memstore_contract_test.go).
func TestGamesStoreContract(t *testing.T) {
	gamestest.RunStoreContract(t, gamesFixture)
}

func gamesSession(t *testing.T, subj games.Subject, start time.Time, clipNums ...int) *games.Session {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	s := &games.Session{
		ID: id, Subject: subj, GameID: games.GameNazar, Mode: games.ModeMock, GameVersion: "1.0.0", ScoringVersion: "1.0",
		RulePackVersion: "2026.10.23", Seed: 7, SeedOrigin: games.SeedOriginServer, Difficulty: 3, Status: games.StatusStarted,
		Context: json.RawMessage(`{"sid":"x"}`), StartedAt: start, ExpiresAt: start.Add(games.SessionTTL),
	}
	for i, n := range clipNums {
		s.Items = append(s.Items, games.Item{Ordinal: i + 1, Ref: fmt.Sprintf("clip:KL-%04d@1", n), ContentVersion: "1", Kind: "clip"})
	}
	return s
}

func gamesInsert(t *testing.T, db *store.DB, s *games.Session) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, db.Tenant(ctx, s.Subject.Tenant, func(tx pgx.Tx) error {
		if err := (store.GamesStore{}).InsertSession(ctx, tx, s); err != nil {
			return err
		}
		return store.GamesStore{}.InsertSessionItems(ctx, tx, s.ID, s.Items)
	}))
}

func gamesDigest(c string) string { return "sha256:" + strings.Repeat(c, 64) }

// RLS: another tenant sees none of the game rows and cannot write them.
func TestGamesRLSTenantIsolation(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, _, c := gamesSubjects(t, db)
	st, sc := store.GamesStore{}, store.GamesStaircase{}
	s := gamesSession(t, a, gamesT0, 1, 2)
	gamesInsert(t, db, s)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		if err := st.RecordExposures(ctx, tx, a, []games.Exposure{{ClipID: "KL-0001", Via: games.ViaMock, SessionID: s.ID, At: gamesT0}}); err != nil {
			return err
		}
		_, err := sc.Record(ctx, tx, a, games.GameNazar, "nazar", true)
		return err
	}))

	require.NoError(t, db.Tenant(ctx, "KL", func(tx pgx.Tx) error {
		_, err := st.GetSessionForUpdate(ctx, tx, s.ID)
		require.ErrorIs(t, err, games.ErrNotFound)
		seen, err := st.SeenClipIDs(ctx, tx, a)
		require.NoError(t, err)
		require.Empty(t, seen)
		refs, err := st.RecentItemRefs(ctx, tx, a, games.GameNazar, 10)
		require.NoError(t, err)
		require.Empty(t, refs)
		for _, table := range []string{"game.sessions", "game.session_items", "game.clip_exposures", "game.staircase"} {
			var n int
			require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&n))
			require.Zerof(t, n, "%s visible to KL", table)
		}
		// An update through the store touches nothing.
		err = st.VoidSession(ctx, tx, &games.Session{ID: s.ID, Status: games.StatusVoided, RejectedType: "x"})
		require.ErrorIs(t, err, games.ErrNotFound)
		return nil
	}))
	// Writing JK rows from a KL transaction is refused (WITH CHECK).
	for name, write := range map[string]func(tx pgx.Tx) error{
		"session": func(tx pgx.Tx) error { return st.InsertSession(ctx, tx, gamesSession(t, a, gamesT0)) },
		"exposure": func(tx pgx.Tx) error {
			return st.RecordExposures(ctx, tx, a, []games.Exposure{{ClipID: "KL-0003", Via: games.ViaMock, At: gamesT0}})
		},
		"staircase": func(tx pgx.Tx) error {
			_, err := sc.Record(ctx, tx, a, games.GameNazar, "other", true)
			return err
		},
	} {
		require.Errorf(t, db.Tenant(ctx, "KL", write), "%s written across tenants", name)
	}
	// The System role sees both tenants (the replay step is cross-tenant).
	gamesInsert(t, db, gamesSession(t, c, gamesT0, 3))
	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		var n int
		require.NoError(t, tx.QueryRow(ctx, `SELECT count(DISTINCT tenant_id) FROM game.sessions`).Scan(&n))
		require.Equal(t, 2, n)
		return nil
	}))
}

// replay_inputs holds the decoded base64; it is re-encoded on read.
func TestGamesReplayInputsStoredDecoded(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, _, _ := gamesSubjects(t, db)
	st := store.GamesStore{}
	pend := func(inputs string) (*games.Session, error) {
		s := gamesSession(t, a, gamesT0, 1)
		gamesInsert(t, db, s)
		now := gamesT0.Add(time.Minute)
		s.Status, s.SubmittedAt = games.StatusPendingVerification, &now
		s.Replay = &games.Replay{TelemetryVersion: 1, Encoding: "mdr1", Inputs: inputs, Digest: gamesDigest("b"), EventCount: 2}
		return s, db.Tenant(ctx, "JK", func(tx pgx.Tx) error { return st.MarkPending(ctx, tx, s) })
	}
	raw := []byte("{\"r\":[[0,1],[16,2]]}\x00\xff")
	s, err := pend(base64.StdEncoding.EncodeToString(raw))
	require.NoError(t, err)
	var stored []byte
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT replay_inputs FROM game.sessions WHERE session_id = $1`, s.ID).Scan(&stored))
	require.Equal(t, raw, stored)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		got, err := st.GetSessionForUpdate(ctx, tx, s.ID)
		require.NoError(t, err)
		require.Equal(t, *s.Replay, *got.Replay)
		return nil
	}))
	// Unpadded base64 is accepted and comes back padded; garbage is an invalid replay.
	s, err = pend("eyJyIjpbXX0")
	require.NoError(t, err)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		got, err := st.GetSessionForUpdate(ctx, tx, s.ID)
		require.NoError(t, err)
		require.Equal(t, "eyJyIjpbXX0=", got.Replay.Inputs)
		return nil
	}))
	_, err = pend("A")
	require.ErrorIs(t, err, games.ErrInvalidReplay)
}

// Two concurrent replay runs never take the same pending session (FOR UPDATE SKIP LOCKED).
func TestGamesListPendingSkipLocked(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, b, c := gamesSubjects(t, db)
	st := store.GamesStore{}
	var want []uuid.UUID
	for i, subj := range []games.Subject{c, a, b} {
		s := gamesSession(t, subj, gamesT0, i+1)
		gamesInsert(t, db, s)
		at := gamesT0.Add(time.Duration(i+1) * time.Minute)
		s.Status, s.SubmittedAt = games.StatusPendingVerification, &at
		s.Replay = &games.Replay{TelemetryVersion: 1, Encoding: "mdr1", Inputs: "AA==", Digest: gamesDigest("c")}
		require.NoError(t, db.Tenant(ctx, subj.Tenant, func(tx pgx.Tx) error { return st.MarkPending(ctx, tx, s) }))
		want = append(want, s.ID)
	}
	require.NoError(t, db.System(ctx, func(tx1 pgx.Tx) error {
		first, err := st.ListPending(ctx, tx1, 1)
		require.NoError(t, err)
		require.Len(t, first, 1)
		require.Equal(t, want[0], first[0].ID)
		require.Len(t, first[0].Items, 1)
		// A second run while the first holds its row gets the rest.
		return db.System(ctx, func(tx2 pgx.Tx) error {
			rest, err := st.ListPending(ctx, tx2, 10)
			require.NoError(t, err)
			require.Len(t, rest, 2)
			require.Equal(t, want[1], rest[0].ID)
			require.Equal(t, want[2], rest[1].ID)
			require.True(t, rest[1].Subject.Minor) // B, rebuilt from core.family_members
			return nil
		})
	}))
}

// The staircase upsert is safe under concurrent records (one row per subject, game and skill).
func TestGamesStaircaseConcurrentRecords(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, _, _ := gamesSubjects(t, db)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
				_, err := store.GamesStaircase{}.Record(ctx, tx, a, games.GameBlindSpot, "mirrors", true)
				return err
			})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		var rows int
		require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM game.staircase`).Scan(&rows))
		require.Equal(t, 1, rows)
		l, err := store.GamesStaircase{}.Level(ctx, tx, a, games.GameBlindSpot, "mirrors")
		require.NoError(t, err)
		require.Equal(t, 5, l) // 8 passes: 1→2→3→4→5
		return nil
	}))
}

// gamesAnalysis is a stored analysis with one clip and the given hazards.
func gamesAnalysis(ref string, voided bool, hazards ...string) json.RawMessage {
	v := "null"
	if voided {
		v = `"pattern"`
	}
	return json.RawMessage(fmt.Sprintf(`{"nazar_clips":{"rule":"kerala_5band","clips":[{"ordinal":1,"ref":%q,"voided":%s,"hazards":[%s]}]},`+
		`"nazar_clips_linear":{"rule":"field_kit_linear","clips":[]}}`, ref, v, strings.Join(hazards, ",")))
}

func TestGamesTakerStats(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, b, c := gamesSubjects(t, db)
	st := store.GamesStore{}
	attempt := func(subj games.Subject, verified time.Duration, nazar bool, analysis json.RawMessage) {
		s := gamesSession(t, subj, gamesT0, 1)
		gamesInsert(t, db, s)
		at := gamesT0.Add(verified)
		pct, trust := 50.0, 1.0
		s.Status, s.SubmittedAt, s.VerifiedAt = games.StatusChecked, &at, &at
		s.Replay = &games.Replay{TelemetryVersion: 1, Encoding: "mdr1", Inputs: "AA==", Digest: gamesDigest("d")}
		s.ServerResult, s.ServerPct, s.Trust, s.Analysis = json.RawMessage(`{}`), &pct, &trust, analysis
		s.Eligible = map[string]bool{games.EligibleNazarScore: nazar}
		require.NoError(t, db.Tenant(ctx, subj.Tenant, func(tx pgx.Tx) error { return st.CompleteSession(ctx, tx, s) }))
	}
	const ref = "clip:KL-0001@1"
	// A: band 1 (5 points) and an uncredited hazard (0): 2.5 per hazard. A later attempt is ignored.
	attempt(a, time.Minute, true, gamesAnalysis(ref, false, `{"hazardId":"h1","credit":5,"band":1}`, `{"hazardId":"h2","credit":0,"band":null}`))
	attempt(a, time.Hour, true, gamesAnalysis(ref, false, `{"hazardId":"h1","credit":1,"band":5}`, `{"hazardId":"h2","credit":1,"band":5}`))
	// B (another person, family member): band 2 and band 4 → 4 and 2.
	attempt(b, 2*time.Minute, true, gamesAnalysis(ref, false, `{"hazardId":"h1","credit":4,"band":2}`, `{"hazardId":"h2","credit":2,"band":4}`))
	// C (other tenant): no band, credit is already 5-band points.
	attempt(c, 3*time.Minute, true, gamesAnalysis(ref, false, `{"hazardId":"h1","credit":3,"band":null}`, `{"hazardId":"h2","credit":3,"band":null}`))
	// Not counted: an ineligible session, another clip, a voided clip.
	d := games.Subject{Tenant: "JK", ApplicantID: ids.New(), UserBand: "adult"}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertApplicant(ctx, tx, &store.Applicant{ID: d.ApplicantID, TenantID: "JK", Kind: "device", UserBand: "adult"})
	}))
	attempt(d, time.Minute, false, gamesAnalysis(ref, false, `{"hazardId":"h1","credit":0,"band":null}`))
	attempt(d, 2*time.Minute, true, gamesAnalysis("clip:KL-0002@1", false, `{"hazardId":"h1","credit":0,"band":null}`))
	e := games.Subject{Tenant: "JK", ApplicantID: ids.New()}
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		return store.InsertApplicant(ctx, tx, &store.Applicant{ID: e.ApplicantID, TenantID: "JK", Kind: "device", UserBand: "unknown"})
	}))
	attempt(e, time.Minute, true, gamesAnalysis(ref, true, `{"hazardId":"h1","credit":0,"band":null}`))

	ts := store.GamesTakerStats{DB: db}
	for _, r := range []string{"KL-0001@1", ref} { // clips.Doc.Ref() form and the item ref form
		mean, n, err := ts.ClipTakerStats(ctx, r)
		require.NoError(t, err)
		require.Equal(t, 3, n)
		require.InDelta(t, (5+0+4+2+3+3)/6.0, mean, 1e-9)
	}
	mean, n, err := ts.ClipTakerStats(ctx, "KL-0099@1")
	require.NoError(t, err)
	require.Zero(t, n)
	require.Zero(t, mean)
	// Inside a transaction carried by ctx, the same read reuses it.
	require.NoError(t, db.System(ctx, func(tx pgx.Tx) error {
		_, n, err := ts.ClipTakerStats(store.ContextWithTx(ctx, tx), ref)
		require.Equal(t, 3, n)
		return err
	}))
}

// ---- games.Service against GamesStore on Postgres ------------------------------------------
// Fakes copied from internal/games/fakes_test.go (the clip bank and the verifier).

type gamesFakeClips struct{ clips []games.ClipItem }

func gamesNewFakeClips(n int) *gamesFakeClips {
	f := &gamesFakeClips{}
	for i := range n {
		id := fmt.Sprintf("KL-%04d", i+1)
		f.clips = append(f.clips, games.ClipItem{Ref: "clip:" + id + "@1", ClipID: id, Version: 1, CuratorDifficulty: i%5 + 1})
	}
	return f
}

func (f *gamesFakeClips) ScoringDocs(_ context.Context, refs []string) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, len(refs))
	for i, ref := range refs {
		id, v, _ := strings.Cut(strings.TrimPrefix(ref, "clip:"), "@")
		out[i] = json.RawMessage(fmt.Sprintf(`{"clipId":%q,"version":%s,"speedKmhEst":40,"durationMs":30000,`+
			`"hazards":[{"hazardId":"h1","hazardType":"bus_stop_pedestrian","window":{"aMs":12000,"bMs":16500}}],"quietSegments":[]}`, id, v))
	}
	return out, nil
}

func (f *gamesFakeClips) MockEligible(_ context.Context, _ string, exclude []string, n int) ([]games.ClipItem, error) {
	ex := map[string]bool{}
	for _, id := range exclude {
		ex[id] = true
	}
	var out []games.ClipItem
	for _, c := range f.clips {
		if !ex[c.ClipID] && len(out) < n {
			out = append(out, c)
		}
	}
	return out, nil
}

func (f *gamesFakeClips) AssetURL(_ context.Context, ref string, sid uuid.UUID) (string, string, int64, error) {
	return "https://media.test/" + ref + "?sid=" + sid.String(), strings.Repeat("ab", 32), 1_840_000, nil
}

type gamesFakeCompute struct {
	mu    sync.Mutex
	err   error
	pct   float64
	calls int
}

func (f *gamesFakeCompute) Verify(_ context.Context, req compute.VerifyRequest) (*compute.VerifyResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	result, _ := json.Marshal(map[string]any{
		"sid": req.SID, "gameId": req.GameID, "gameVersion": req.GameVersion, "scoringVersion": req.ScoringVersion,
		"seed": req.Seed, "seedOrigin": req.SeedOrigin, "difficulty": req.Difficulty, "mode": req.Mode,
		"score":    map[string]any{"raw": f.pct, "max": 100, "pct": f.pct, "passed": f.pct >= 60, "passRule": nil, "components": []any{}, "capApplied": nil},
		"findings": []any{}, "evidence": []any{}, "calibration": nil,
		"integrity": map[string]any{"flags": []string{}, "trust": 1, "timingMode": "rvfc", "provisional": false},
		"replay":    map[string]any{"seed": req.Seed, "inputs": req.Inputs},
	})
	resp := &compute.VerifyResponse{Result: result, Digest: "sha256:result", EventsDigest: req.Digest, ServerChecked: true}
	if len(req.Analysis) > 0 {
		// Every clip: its one hazard tapped in band 2 (4 points).
		band := 2
		clipsOut := make([]compute.ClipAnalysis, len(req.Items))
		for i, it := range req.Items {
			clipsOut[i] = compute.ClipAnalysis{Ordinal: i + 1, Ref: it.Ref, Hazards: []compute.HazardAnalysis{
				{HazardID: "h1", HazardType: "bus_stop_pedestrian", Credit: 4, Band: &band}}}
		}
		resp.Analysis = map[string]compute.NazarAnalysis{}
		for _, k := range req.Analysis {
			resp.Analysis[k] = compute.NazarAnalysis{Rule: k, Clips: clipsOut}
		}
	}
	sum, err := compute.ParseResult(result)
	if err != nil {
		return nil, err
	}
	resp.Summary = sum
	return resp, nil
}

type gamesFakeAwards struct {
	mu    sync.Mutex
	calls []games.VerifiedSession
}

func (a *gamesFakeAwards) OnSessionVerified(ctx context.Context, tx pgx.Tx, s games.VerifiedSession) (games.AwardSummary, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, s)
	// Awards write in the games transaction with the subject's tenant (also from the System replay).
	if err := store.IncrementCounter(ctx, tx, s.Subject.Tenant, "test_awards", 1); err != nil {
		return games.AwardSummary{}, err
	}
	return games.AwardSummary{XPAwarded: 23}, nil
}

type gamesFakeRulePack struct{}

func (gamesFakeRulePack) Version(context.Context, string) (string, error) { return "2026.10.23", nil }
func (gamesFakeRulePack) LLMockFormat(context.Context, string) (games.LLFormat, error) {
	return games.LLFormat{RuleID: "LLT-JK", Questions: 10}, nil
}

func TestGamesServiceOnPostgres(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	a, b, _ := gamesSubjects(t, db)
	catalog, err := games.LoadCatalog(filepath.Join("..", "..", "..", "..", "content", "generated", "game-items.json"))
	require.NoError(t, err)
	cmp := &gamesFakeCompute{pct: 64}
	awards := &gamesFakeAwards{}
	clock := servertime.NewFixed(gamesT0)
	svc, err := games.New(games.Service{
		DB: db, Store: store.GamesStore{}, Clips: gamesNewFakeClips(60), Compute: cmp, Awards: awards,
		RulePack: gamesFakeRulePack{}, Staircase: store.GamesStaircase{}, Catalog: catalog, Clock: clock,
	})
	require.NoError(t, err)
	replay := games.Replay{Encoding: "mdr1", Inputs: "eyJyIjpbXX0=", Digest: gamesDigest("a"), EventCount: 35, TelemetryVersion: 1}

	// Start: a Nazar mock with 10 unseen clips, exposures recorded.
	st, err := svc.Start(ctx, games.StartRequest{Subject: a, GameID: games.GameNazar, Mode: games.ModeMock})
	require.NoError(t, err)
	require.Len(t, st.Items, games.NazarMockClips)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		seen, err := store.GamesStore{}.SeenClipIDs(ctx, tx, a)
		require.Len(t, seen, games.NazarMockClips)
		return err
	}))

	// Complete while the verifier is down: pending, provisional.
	cmp.err = &compute.ProblemError{Status: 503, Type: "internal"}
	clock.Advance(4 * time.Minute)
	client := json.RawMessage(`{"score":{"pct":90},"findings":[],"integrity":{"trust":1,"flags":[],"timingMode":"rvfc","provisional":false}}`)
	out, err := svc.Complete(ctx, games.CompleteRequest{Subject: a, SessionID: st.Session.ID, ClientResult: client, Replay: replay})
	require.NoError(t, err)
	require.Equal(t, games.StatusPendingVerification, out.Status)
	require.True(t, out.Provisional)
	// Idempotent while pending; another subject (B, A's family member) does not see it.
	again, err := svc.Complete(ctx, games.CompleteRequest{Subject: a, SessionID: st.Session.ID, ClientResult: client, Replay: replay})
	require.NoError(t, err)
	require.True(t, again.Replayed)
	_, err = svc.Complete(ctx, games.CompleteRequest{Subject: b, SessionID: st.Session.ID, Replay: replay})
	require.ErrorIs(t, err, games.ErrNotFound)

	// Still down: the step leaves it pending.
	stats, err := svc.ReplayPending(ctx, 50)
	require.NoError(t, err)
	require.Equal(t, games.ReplayStats{Scanned: 1, Pending: 1}, stats)

	// Back up: the cross-tenant replay verifies it; awards run once, in the System transaction.
	cmp.mu.Lock()
	cmp.err, cmp.pct = nil, 58
	cmp.mu.Unlock()
	clock.Advance(10 * time.Minute)
	stats, err = svc.ReplayPending(ctx, 50)
	require.NoError(t, err)
	require.Equal(t, games.ReplayStats{Scanned: 1, Verified: 1}, stats)
	require.Len(t, awards.calls, 1)
	vs := awards.calls[0]
	require.True(t, vs.Subject.Same(a))
	require.True(t, vs.Subject.Account) // rebuilt from core.applicants
	require.Equal(t, "adult", vs.Subject.UserBand)
	require.Equal(t, int64(4*time.Minute/time.Millisecond), vs.DurationMs)
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		s, err := store.GamesStore{}.GetSessionForUpdate(ctx, tx, st.Session.ID)
		require.NoError(t, err)
		require.Equal(t, games.StatusChecked, s.Status)
		require.InDelta(t, 58, *s.ServerPct, 1e-9)
		require.True(t, s.Eligible[games.EligibleNazarScore])
		require.Equal(t, replay, *s.Replay)
		require.Len(t, s.Items, games.NazarMockClips)
		c, err := store.Counters(ctx, tx, "JK")
		require.Equal(t, int64(1), c[games.CounterCounted])
		require.Equal(t, int64(1), c["test_awards"])
		return err
	}))
	stats, err = svc.ReplayPending(ctx, 50)
	require.NoError(t, err)
	require.Zero(t, stats.Scanned)

	// A second mock: disjoint clips, verified directly, Nazar Score over both; repeat is idempotent.
	st2, err := svc.Start(ctx, games.StartRequest{Subject: a, GameID: games.GameNazar, Mode: games.ModeMock})
	require.NoError(t, err)
	first := map[string]bool{}
	for _, it := range st.Items {
		first[it.Ref] = true
	}
	for _, it := range st2.Items {
		require.Falsef(t, first[it.Ref], "clip %s dealt twice", it.Ref)
	}
	clock.Advance(time.Minute)
	cmp.pct = 70
	done, err := svc.Complete(ctx, games.CompleteRequest{Subject: a, SessionID: st2.Session.ID, Replay: replay})
	require.NoError(t, err)
	require.True(t, done.ServerChecked)
	require.Equal(t, 2, done.NazarScoreN)
	require.InDelta(t, 64, *done.NazarScore, 1e-9)
	rep, err := svc.Complete(ctx, games.CompleteRequest{Subject: a, SessionID: st2.Session.ID, Replay: replay})
	require.NoError(t, err)
	require.True(t, rep.Replayed)
	require.JSONEq(t, string(done.Result), string(rep.Result)) // jsonb: equal, not byte-equal
	require.Equal(t, 4, cmp.calls)                             // down, replay while down, replay up, the second mock; repeats never call
	bad := replay
	bad.Digest = gamesDigest("f")
	_, err = svc.Complete(ctx, games.CompleteRequest{Subject: a, SessionID: st2.Session.ID, Replay: bad})
	require.ErrorIs(t, err, games.ErrDigestConflict)

	// Practice follows the Postgres staircase.
	require.NoError(t, db.Tenant(ctx, "JK", func(tx pgx.Tx) error {
		for range 2 {
			if _, err := (store.GamesStaircase{}).Record(ctx, tx, a, games.GameNazar, games.GameNazar, true); err != nil {
				return err
			}
		}
		return nil
	}))
	pr, err := svc.Start(ctx, games.StartRequest{Subject: a, GameID: games.GameNazar, Mode: games.ModePractice})
	require.NoError(t, err)
	require.Equal(t, 2, pr.Context.Difficulty)

	// Every clip of both verified mocks: one taker (A) at 4 points per hazard.
	mean, n, err := store.GamesTakerStats{DB: db}.ClipTakerStats(ctx, strings.TrimPrefix(st2.Items[0].Ref, "clip:"))
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.InDelta(t, 4, mean, 1e-9)

	// A rejected replay voids the session.
	st3, err := svc.Start(ctx, games.StartRequest{Subject: b, GameID: games.GameLLSim, Mode: games.ModeMock})
	require.NoError(t, err)
	cmp.err = &compute.ProblemError{Status: 422, Type: "digest-mismatch"}
	_, err = svc.Complete(ctx, games.CompleteRequest{Subject: b, SessionID: st3.Session.ID, Replay: replay})
	require.ErrorIs(t, err, games.ErrReplayRejected)
	_, err = svc.Complete(ctx, games.CompleteRequest{Subject: b, SessionID: st3.Session.ID, Replay: replay})
	require.ErrorIs(t, err, games.ErrSessionVoided)
}
