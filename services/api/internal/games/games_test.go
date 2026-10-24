package games

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/compute"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

var t0 = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

// realCatalog is the committed content/generated/game-items.json.
func realCatalog(t *testing.T) *Catalog {
	t.Helper()
	c, err := LoadCatalog(filepath.Join(repoRoot(t), "content", "generated", "game-items.json"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type env struct {
	svc     *Service
	store   *memStore
	clips   *fakeClips
	compute *fakeCompute
	awards  *fakeAwards
	study   *fakeStudy
	clock   *servertime.Fixed
	subj    Subject
}

// difficulties for a 30-clip bank: 6 each of 1..5 (18 usable for a mock).
func bank30() []int { return bank(30) }

// bank returns n clip difficulties cycling 1..5.
func bank(n int) []int {
	var d []int
	for i := 0; i < n; i++ {
		d = append(d, i%5+1)
	}
	return d
}

func newEnv(t *testing.T, difficulties []int) *env {
	t.Helper()
	e := &env{
		store: newMemStore(), clips: newFakeClips(difficulties...),
		compute: &fakeCompute{pct: 64, trust: 1, timing: "rvfc"},
		awards:  &fakeAwards{}, study: &fakeStudy{}, clock: servertime.NewFixed(t0),
		subj: Subject{Tenant: "JK", ApplicantID: uuid.MustParse("0192f7a8-6b1c-7d2e-9f30-4a5b6c7d8e9f"), UserBand: "adult"},
	}
	svc, err := New(Service{
		DB: fakeDB{}, Store: e.store, Clips: e.clips, Compute: e.compute, Awards: e.awards, Study: e.study,
		RulePack: fakeRulePack{questions: 10}, Staircase: fakeStaircase{level: 4}, Catalog: realCatalog(t),
		Clock: e.clock, Rand: &seqRand{},
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	return e
}

func (e *env) start(t *testing.T, game, mode string) *Started {
	t.Helper()
	st, err := e.svc.Start(context.Background(), StartRequest{Subject: e.subj, GameID: game, Mode: mode, A11yModes: []string{"no_audio"}})
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func replay(digestByte string) Replay {
	return Replay{Encoding: "mdr1", Inputs: "eyJyIjpbXX0=", Digest: "sha256:" + strings.Repeat(digestByte, 64), EventCount: 35, TelemetryVersion: 1}
}

func (e *env) complete(t *testing.T, sid uuid.UUID, client string, r Replay) *Completed {
	t.Helper()
	out, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: sid, ClientResult: json.RawMessage(client), Replay: r})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func validateContext(t *testing.T, sc SessionContext) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "packages", "game-core", "schema", "SessionContext.json"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("SessionContext.json", doc); err != nil {
		t.Fatal(err)
	}
	sch, err := c.Compile("SessionContext.json")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(sc)
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if err := sch.Validate(inst); err != nil {
		t.Fatalf("SessionContext does not match game-core's schema: %v\n%s", err, b)
	}
}

func TestNazarMockTenUnseenClipsAcrossDifficulty(t *testing.T) {
	e := newEnv(t, bank(60))
	seen := []string{"KL-0002", "KL-0003", "KL-0004", "KL-0007", "KL-0008", "KL-0009"} // difficulties 2,3,4,2,3,4
	var ex []Exposure
	for _, id := range seen {
		ex = append(ex, Exposure{ClipID: id, Via: ViaPractice, At: t0.Add(-time.Hour)})
	}
	_ = e.store.RecordExposures(context.Background(), nil, e.subj, ex)

	st := e.start(t, GameNazar, ModeMock)
	if len(st.Items) != NazarMockClips {
		t.Fatalf("%d items", len(st.Items))
	}
	diff := map[int]int{}
	byID := map[string]ClipItem{}
	for _, c := range e.clips.clips {
		byID[c.ClipID] = c
	}
	for i, it := range st.Items {
		id, _, ok := clipRef(it.Ref)
		if !ok || it.Ordinal != i+1 || it.Kind != "clip" || it.ContentVersion != "1" {
			t.Fatalf("item %+v", it)
		}
		if setOf(seen)[id] {
			t.Fatalf("seen clip %s selected", id)
		}
		if it.AssetURL == "" || !strings.Contains(it.AssetURL, st.Session.ID.String()) || it.Reveal != nil {
			t.Fatalf("mock item must carry a URL and no reveal: %+v", it)
		}
		diff[byID[id].CuratorDifficulty]++
	}
	if diff[1] != 0 || diff[5] != 0 || diff[2] == 0 || diff[3] == 0 || diff[4] == 0 {
		t.Fatalf("difficulty spread %v", diff)
	}
	// Exposures are recorded at start, so the next mock never repeats these clips.
	got, _ := e.store.SeenClipIDs(context.Background(), nil, e.subj)
	if len(got) != len(seen)+NazarMockClips {
		t.Fatalf("exposures %d", len(got))
	}
	sc := st.Context
	if sc.Seed != st.Session.Seed || sc.SeedOrigin != "server" || sc.Difficulty != 3 || sc.Tenant != "JK" ||
		sc.RulePackVersion != "2026.10.23" || sc.ServerStartISO == nil || len(sc.Items) != 10 {
		t.Fatalf("context %+v", sc)
	}
	if !st.Session.ExpiresAt.Equal(t0.Add(time.Hour)) || st.LabelKey != LabelKey {
		t.Fatalf("expiry %v label %s", st.Session.ExpiresAt, st.LabelKey)
	}
	validateContext(t, sc)

	// A second mock is disjoint from the first.
	st2 := e.start(t, GameNazar, ModeMock)
	first := map[string]bool{}
	for _, it := range st.Items {
		first[it.Ref] = true
	}
	for _, it := range st2.Items {
		if first[it.Ref] {
			t.Fatalf("clip %s dealt twice", it.Ref)
		}
	}
}

func TestNazarMockFailsCleanlyWhenPoolShort(t *testing.T) {
	// 12 clips at difficulty 2–4 plus out-of-range ones; 3 seen leaves 9 < 10.
	e := newEnv(t, []int{2, 3, 4, 2, 3, 4, 2, 3, 4, 2, 3, 4, 1, 5, 5})
	_ = e.store.RecordExposures(context.Background(), nil, e.subj, []Exposure{
		{ClipID: "KL-0001", Via: ViaMock, At: t0}, {ClipID: "KL-0002", Via: ViaMock, At: t0}, {ClipID: "KL-0003", Via: ViaMock, At: t0},
	})
	_, err := e.svc.Start(context.Background(), StartRequest{Subject: e.subj, GameID: GameNazar, Mode: ModeMock})
	if !errors.Is(err, ErrNoUnseenClips) {
		t.Fatalf("err = %v", err)
	}
	if len(e.store.sessions) != 0 {
		t.Fatal("a session was stored")
	}
	if got, _ := e.store.SeenClipIDs(context.Background(), nil, e.subj); len(got) != 3 {
		t.Fatalf("exposures changed: %v", got)
	}
}

func TestSelectNazarMockNeverPicksSeen(t *testing.T) {
	bank := newFakeClips(bank30()...).clips
	for seed := uint32(0); seed < 200; seed++ {
		seen := map[string]bool{}
		for i, c := range bank {
			if (int(seed)+i)%3 == 0 {
				seen[c.ClipID] = true
			}
		}
		got, err := selectNazarMock(bank, seen, 10, newRNG(seed))
		if errors.Is(err, ErrNoUnseenClips) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		ids := map[string]bool{}
		for _, c := range got {
			if seen[c.ClipID] || ids[c.ClipID] || c.CuratorDifficulty < 2 || c.CuratorDifficulty > 4 {
				t.Fatalf("seed %d: bad pick %+v", seed, c)
			}
			ids[c.ClipID] = true
		}
	}
}

func TestLLMockCountFromRulePack(t *testing.T) {
	e := newEnv(t, nil)
	st := e.start(t, GameLLSim, ModeMock)
	if len(st.Items) != 10 || st.Context.Difficulty != 3 {
		t.Fatalf("%d items, difficulty %d", len(st.Items), st.Context.Difficulty)
	}
	g := e.svc.Catalog.Game(GameLLSim)
	pool := map[string]CatalogItem{}
	for _, it := range g.Items {
		pool[it.Ref] = it
	}
	concepts := map[string]bool{}
	for _, it := range st.Items {
		ci, ok := pool[it.Ref]
		if !ok || ci.Pool != "mock" || it.ContentVersion != ci.ContentVersion || it.Kind != "q" {
			t.Fatalf("item %+v (catalogue %+v)", it, ci)
		}
		if concepts[ci.ConceptID] {
			t.Fatalf("concept %s twice", ci.ConceptID)
		}
		concepts[ci.ConceptID] = true
	}
	validateContext(t, st.Context)
	// The next mock avoids the variants just played where the concept has others.
	st2 := e.start(t, GameLLSim, ModeMock)
	recent := map[string]bool{}
	for _, it := range st.Items {
		recent[it.Ref] = true
	}
	repeats := 0
	for _, it := range st2.Items {
		if recent[it.Ref] {
			repeats++
		}
	}
	if repeats != 0 {
		t.Fatalf("%d recent variants reused", repeats)
	}
	// Another tenant's format size.
	e.svc.RulePack = fakeRulePack{questions: 15}
	if st3 := e.start(t, GameLLSim, ModeMock); len(st3.Items) != 15 {
		t.Fatalf("%d items for a 15-question format", len(st3.Items))
	}
}

func TestPracticeFollowsStaircaseAndRevealsWindows(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModePractice)
	if st.Context.Difficulty != 4 || len(st.Items) != nazarPracticeClips {
		t.Fatalf("difficulty %d, %d items", st.Context.Difficulty, len(st.Items))
	}
	for _, it := range st.Items {
		if !bytes.Contains(it.Reveal, []byte(`"window":{"aMs":12000,"bMs":16500}`)) {
			t.Fatalf("practice item without reveal: %s", it.Reveal)
		}
	}
	// Revealed clips are seen: a later mock cannot deal them.
	seen, _ := e.store.SeenClipIDs(context.Background(), nil, e.subj)
	if len(seen) != nazarPracticeClips || e.store.exposures[subjKey(e.subj)][seen[0]].Via != ViaPractice {
		t.Fatalf("exposures %v", seen)
	}
	ll := e.start(t, GameLLSim, ModePractice)
	if ll.Context.Difficulty != 4 || len(ll.Items) != llPracticeItems {
		t.Fatalf("LL practice difficulty %d, %d items", ll.Context.Difficulty, len(ll.Items))
	}
	validateContext(t, st.Context)
}

func TestStoppingDistanceAndBlindSpotFromCatalog(t *testing.T) {
	e := newEnv(t, nil)
	sd := e.start(t, GameStoppingDistance, ModePractice)
	g := e.svc.Catalog.Game(GameStoppingDistance)
	if len(sd.Items) != len(g.Items) || sd.Items[0].Ref != g.Items[0].Ref || sd.Items[0].Kind != "sd" {
		t.Fatalf("sd items %+v", sd.Items)
	}
	bs := e.start(t, GameBlindSpot, ModePractice)
	if len(bs.Items) != 2 || !strings.HasPrefix(bs.Items[0].Ref, "bs:part-a") || bs.Items[1].Ref != "bs:part-b-highway" {
		t.Fatalf("bs items %+v", bs.Items)
	}
	validateContext(t, bs.Context)
	if _, err := e.svc.Start(context.Background(), StartRequest{Subject: e.subj, GameID: GameBlindSpot, Mode: ModeMock}); !errors.Is(err, ErrUnsupportedMode) {
		t.Fatalf("bs mock: %v", err)
	}
	if _, err := e.svc.Start(context.Background(), StartRequest{Subject: e.subj, GameID: GameNazar, Mode: ModePair}); !errors.Is(err, ErrUnsupportedMode) {
		t.Fatalf("pair: %v", err)
	}
	if _, err := e.svc.Start(context.Background(), StartRequest{Subject: e.subj, GameID: "helmet_fit", Mode: ModePractice}); !errors.Is(err, ErrUnsupportedGame) {
		t.Fatalf("helmet_fit: %v", err)
	}
}

func TestCompleteNazarBuildsVerifyRequest(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	e.complete(t, st.Session.ID, "", replay("a"))
	req := e.compute.last()
	if req.SID != st.Session.ID.String() || req.Seed != st.Session.Seed || req.SeedOrigin != "server" || req.Mode != ModeMock ||
		req.GameVersion != "1.0.0" || req.ScoringVersion != "1.0" || req.Tenant != "JK" || len(req.Items) != 10 {
		t.Fatalf("request %+v", req)
	}
	if req.Content == nil || len(req.Content.Items) != 10 || !bytes.Contains(req.Content.Items[0], []byte(`"clipId"`)) {
		t.Fatalf("inline content %+v", req.Content)
	}
	if strings.Join(req.Analysis, ",") != "nazar_clips,nazar_clips_linear" {
		t.Fatalf("analysis %v", req.Analysis)
	}
	if req.Hints == nil || req.Hints.SeenClip == nil || *req.Hints.SeenClip || *req.Hints.SessionExpired {
		t.Fatalf("hints %+v", req.Hints)
	}
	if req.Context == nil || strings.Join(req.Context.A11yModes, ",") != "no_audio" || req.ClientResult != nil {
		t.Fatalf("context %+v client %s", req.Context, req.ClientResult)
	}
}

func TestTamperedClientScoreIsOverwritten(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	tampered := `{"score":{"pct":100},"findings":[],"integrity":{"trust":1,"flags":[],"timingMode":"rvfc","provisional":true}}`
	out := e.complete(t, st.Session.ID, tampered, replay("a"))
	if !out.ServerChecked || out.Provisional || *out.ServerPct != 64 || *out.ClientPct != 100 {
		t.Fatalf("outcome %+v", out)
	}
	sum, err := compute.ParseResult(out.Result)
	if err != nil || sum.Score.Pct != 64 || !sum.Integrity.HasFlag("INT_REPLAY_MISMATCH") || out.Comparison == nil || out.Comparison.Match {
		t.Fatalf("result %s (%v)", out.Result, err)
	}
	stored := e.store.sessions[st.Session.ID]
	if stored.Status != StatusChecked || *stored.ServerPct != 64 || !bytes.Equal(stored.ServerResult, out.Result) {
		t.Fatalf("stored %+v", stored)
	}
	if len(e.awards.calls) != 1 || len(e.study.calls) != 1 {
		t.Fatalf("hooks: awards %d study %d", len(e.awards.calls), len(e.study.calls))
	}
	vs := e.awards.calls[0]
	if vs.Trust != 0.7 || !bytes.Equal(vs.Result, out.Result) || vs.ID != st.Session.ID {
		t.Fatalf("awards got %+v", vs)
	}
	if out.Awards == nil || out.Awards.XPAwarded != 23 {
		t.Fatalf("award summary %+v", out.Awards)
	}
}

func TestCompleteIdempotentOnDigest(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	first := e.complete(t, st.Session.ID, "", replay("a"))
	again := e.complete(t, st.Session.ID, "", replay("a"))
	if !again.Replayed || !bytes.Equal(again.Result, first.Result) || *again.ServerPct != *first.ServerPct {
		t.Fatalf("repeat %+v", again)
	}
	if e.compute.count() != 1 || len(e.awards.calls) != 1 {
		t.Fatalf("verifier calls %d, awards %d", e.compute.count(), len(e.awards.calls))
	}
	_, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: st.Session.ID, Replay: replay("b")})
	if !errors.Is(err, ErrDigestConflict) {
		t.Fatalf("different digest: %v", err)
	}
	// Someone else's session does not exist for them.
	other := e.subj
	other.ApplicantID = uuid.New()
	_, err = e.svc.Complete(context.Background(), CompleteRequest{Subject: other, SessionID: st.Session.ID, Replay: replay("a")})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("other subject: %v", err)
	}
}

func TestComputeDownThenReplayPendingOverwrites(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	e.compute.set(func(f *fakeCompute) { f.err = &compute.ProblemError{Status: 503, Type: "internal"} })
	client := `{"score":{"pct":90},"findings":[],"integrity":{"trust":1,"flags":[],"timingMode":"rvfc","provisional":false}}`
	out := e.complete(t, st.Session.ID, client, replay("a"))
	if out.Status != StatusPendingVerification || out.ServerChecked || !out.Provisional || out.ServerPct != nil {
		t.Fatalf("outcome %+v", out)
	}
	var res struct {
		Integrity struct {
			Provisional bool `json:"provisional"`
		} `json:"integrity"`
	}
	if json.Unmarshal(out.Result, &res) != nil || !res.Integrity.Provisional || len(out.Eligible) != 0 {
		t.Fatalf("provisional result %s eligible %v", out.Result, out.Eligible)
	}
	if len(e.awards.calls) != 0 {
		t.Fatal("awards for an unverified session")
	}
	// The same submission again is idempotent while pending.
	if again := e.complete(t, st.Session.ID, client, replay("a")); !again.Replayed || again.Status != StatusPendingVerification {
		t.Fatalf("repeat while pending %+v", again)
	}

	// Still down: the step leaves it pending.
	stats, err := e.svc.ReplayPendingStep(context.Background(), map[string]any{})
	if err != nil || stats["verified"] != 0 || stats["pending"] != 1 {
		t.Fatalf("step while down: %v %v", stats, err)
	}
	// Back up: the replay overwrites the provisional outcome with the server result.
	e.compute.set(func(f *fakeCompute) { f.err = nil; f.pct = 58 })
	e.clock.Advance(10 * time.Minute)
	stats, err = e.svc.ReplayPendingStep(context.Background(), map[string]any{"limit": float64(50)})
	if err != nil || stats["verified"] != 1 || stats["scanned"] != 1 || stats["more"] != false {
		t.Fatalf("step: %v %v", stats, err)
	}
	s := e.store.sessions[st.Session.ID]
	if s.Status != StatusChecked || *s.ServerPct != 58 || s.VerifiedAt == nil || !s.Eligible[EligibleXP] {
		t.Fatalf("after replay %+v", s)
	}
	if len(e.awards.calls) != 1 || e.awards.calls[0].DurationMs != 0 {
		t.Fatalf("awards after replay: %+v", e.awards.calls)
	}
	// The replay sent the submission-time hints (not expired), and the client preview for comparison.
	if req := e.compute.last(); *req.Hints.SessionExpired || req.ClientResult == nil {
		t.Fatalf("replay request %+v", req)
	}
	if done, _ := e.svc.ReplayPending(context.Background(), 50); done.Scanned != 0 {
		t.Fatalf("pending left: %+v", done)
	}
}

func TestRejectedReplayVoidsSession(t *testing.T) {
	e := newEnv(t, bank(60))
	st := e.start(t, GameNazar, ModeMock)
	e.compute.set(func(f *fakeCompute) { f.err = &compute.ProblemError{Status: 422, Type: "digest-mismatch"} })
	_, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: st.Session.ID, Replay: replay("a")})
	var rej *RejectedError
	if !errors.Is(err, ErrReplayRejected) || !errors.As(err, &rej) || rej.ProblemType != "digest-mismatch" {
		t.Fatalf("err = %v", err)
	}
	if s := e.store.sessions[st.Session.ID]; s.Status != StatusVoided || s.RejectedType != "digest-mismatch" {
		t.Fatalf("stored %+v", s)
	}
	if _, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: st.Session.ID, Replay: replay("a")}); !errors.Is(err, ErrSessionVoided) {
		t.Fatalf("again: %v", err)
	}
	// A server-side problem (content we failed to send) keeps the session pending instead.
	st2 := e.start(t, GameNazar, ModeMock)
	e.compute.set(func(f *fakeCompute) { f.err = &compute.ProblemError{Status: 422, Type: "content-not-found"} })
	if out := e.complete(t, st2.Session.ID, "", replay("c")); out.Status != StatusPendingVerification {
		t.Fatalf("content-not-found: %+v", out)
	}
}

func TestHints(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	// A clip of this mock was exposed before the session started (a concurrent session).
	id, _, _ := clipRef(st.Items[3].Ref)
	row := e.store.exposures[subjKey(e.subj)][id]
	row.At = t0.Add(-time.Minute)
	e.store.exposures[subjKey(e.subj)][id] = row
	e.clock.Advance(SessionTTL + time.Minute)
	out := e.complete(t, st.Session.ID, "", replay("a"))
	req := e.compute.last()
	if !*req.Hints.SeenClip || !*req.Hints.SessionExpired {
		t.Fatalf("hints %+v", req.Hints)
	}
	if out.Eligible[EligibleNazarScore] {
		t.Fatal("a seen-clip mock counted for the Nazar Score")
	}
}

func TestReplayLimits(t *testing.T) {
	e := newEnv(t, bank30())
	st := e.start(t, GameNazar, ModeMock)
	big := replay("a")
	big.Inputs = strings.Repeat("A", MaxReplayChars+4)
	if _, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: st.Session.ID, Replay: big}); !errors.Is(err, ErrReplayTooLarge) {
		t.Fatalf("oversized: %v", err)
	}
	for name, r := range map[string]Replay{
		"digest":   {Inputs: "AA==", Digest: "md5:x", EventCount: 1},
		"encoding": {Inputs: "AA==", Digest: replay("a").Digest, Encoding: "zip"},
		"inputs":   {Inputs: "not base64!", Digest: replay("a").Digest},
		"events":   {Inputs: "AA==", Digest: replay("a").Digest, EventCount: 5001},
	} {
		if _, err := e.svc.Complete(context.Background(), CompleteRequest{Subject: e.subj, SessionID: st.Session.ID, Replay: r}); !errors.Is(err, ErrInvalidReplay) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if e.compute.count() != 0 {
		t.Fatal("verifier called for an invalid replay")
	}
	// Exactly at the cap is accepted.
	ok := replay("a")
	ok.Inputs = strings.Repeat("A", MaxReplayChars)
	e.complete(t, st.Session.ID, "", ok)
}

func TestNazarScoreEligibility(t *testing.T) {
	base := func() compute.ResultSummary {
		var s compute.ResultSummary
		s.GameID, s.Mode, s.SeedOrigin = GameNazar, ModeMock, "server"
		s.Integrity = compute.Integrity{Trust: 1, TimingMode: "rvfc", Flags: []string{}}
		return s
	}
	cases := map[string]struct {
		mod  func(*compute.ResultSummary, *Hints)
		want bool
	}{
		"eligible":        {func(*compute.ResultSummary, *Hints) {}, true},
		"trust at 0.6":    {func(s *compute.ResultSummary, _ *Hints) { s.Integrity.Trust = 0.6 }, true},
		"trust below 0.6": {func(s *compute.ResultSummary, _ *Hints) { s.Integrity.Trust = 0.59 }, false},
		"fallback timing": {func(s *compute.ResultSummary, _ *Hints) { s.Integrity.TimingMode = "fallback" }, false},
		"offline seed":    {func(s *compute.ResultSummary, _ *Hints) { s.SeedOrigin = "client_offline" }, false},
		"practice":        {func(s *compute.ResultSummary, _ *Hints) { s.Mode = ModePractice }, false},
		"seen clip flag":  {func(s *compute.ResultSummary, _ *Hints) { s.Integrity.Flags = []string{"INT_SEEN_CLIP"} }, false},
		"seen clip hint":  {func(_ *compute.ResultSummary, h *Hints) { h.SeenClip = true }, false},
		"provisional":     {func(s *compute.ResultSummary, _ *Hints) { s.Integrity.Provisional = true }, false},
		"other game":      {func(s *compute.ResultSummary, _ *Hints) { s.GameID = GameLLSim }, false},
		"mismatch, kept": {func(s *compute.ResultSummary, _ *Hints) {
			s.Integrity.Trust = 0.7
			s.Integrity.Flags = []string{"INT_REPLAY_MISMATCH"}
		}, true},
	}
	for name, tc := range cases {
		s, h := base(), Hints{}
		tc.mod(&s, &h)
		if got := eligibility(s, h)[EligibleNazarScore]; got != tc.want {
			t.Errorf("%s: eligible %v, want %v", name, got, tc.want)
		}
	}

	// The score is the mean of the last 3 eligible mocks; ineligible mocks never count.
	e := newEnv(t, bank(150))
	run := func(pct, trust float64, timing string) *Completed {
		e.compute.set(func(f *fakeCompute) { f.pct, f.trust, f.timing = pct, trust, timing })
		st := e.start(t, GameNazar, ModeMock)
		e.clock.Advance(time.Minute)
		return e.complete(t, st.Session.ID, "", replay("a"))
	}
	if out := run(50, 1, "rvfc"); out.NazarScoreN != 1 || *out.NazarScore != 50 {
		t.Fatalf("first: %v n=%d", out.NazarScore, out.NazarScoreN)
	}
	run(60, 1, "rvfc")
	run(95, 0.5, "rvfc")   // low trust
	run(99, 1, "fallback") // fallback timing
	run(70, 1, "rvfc")
	out := run(80, 1, "rvfc")
	if out.NazarScoreN != 3 || *out.NazarScore != 70 {
		t.Fatalf("score %v n=%d, want 70 over 3", *out.NazarScore, out.NazarScoreN)
	}
	score, n, err := e.svc.NazarScore(context.Background(), nil, e.subj)
	if err != nil || n != 3 || *score != 70 {
		t.Fatalf("NazarScore %v %d %v", score, n, err)
	}
	none, n, _ := e.svc.NazarScore(context.Background(), nil, Subject{Tenant: "JK", ApplicantID: uuid.New()})
	if none != nil || n != 0 {
		t.Fatal("score without mocks")
	}
	if e.store.counters["JK/"+CounterCounted] != 5 { // every session with trust ≥ 0.6
		t.Fatalf("counter %d", e.store.counters["JK/"+CounterCounted])
	}
}

func TestCatalogRejectsWrongSchema(t *testing.T) {
	if _, err := ParseCatalog([]byte(`{"schema":"other","games":[]}`)); err == nil {
		t.Fatal("accepted a foreign schema")
	}
	c := realCatalog(t)
	if g := c.Game(GameNazar); g == nil || g.ItemKind != "clip" || g.ScoringVersion == "" {
		t.Fatalf("nazar entry %+v", g)
	}
}

func TestSeedComesFromCryptoRandByDefault(t *testing.T) {
	e := newEnv(t, nil)
	e.svc.Rand = nil
	a := e.start(t, GameStoppingDistance, ModePractice)
	b := e.start(t, GameStoppingDistance, ModePractice)
	if a.Session.Seed == b.Session.Seed && a.Session.Seed == 0 {
		t.Fatal("seeds look constant")
	}
	if a.Session.ID == b.Session.ID || a.Session.ID.Version() != 7 {
		t.Fatalf("session ids %s %s", a.Session.ID, b.Session.ID)
	}
}

// The web's mock mode sends a preview with an empty score (max 0): it is not compared, so the
// verifier never flags INT_REPLAY_MISMATCH for it.
func TestEmptyClientScoreIsNotCompared(t *testing.T) {
	if got := comparable(json.RawMessage(`{"score":{"raw":0,"max":0,"pct":0},"findings":[]}`)); got != nil {
		t.Fatalf("empty preview compared: %s", got)
	}
	if got := comparable(json.RawMessage(`{"score":{"raw":7,"max":10,"pct":70},"findings":[]}`)); got == nil {
		t.Fatal("a real preview must be compared")
	}
	if clientPct(json.RawMessage(`{"score":{"max":0,"pct":0}}`)) != nil {
		t.Fatal("an empty preview has no client pct")
	}
}
