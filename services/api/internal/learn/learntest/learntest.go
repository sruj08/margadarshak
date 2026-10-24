// Package learntest is the learn.Store contract: one behaviour suite that every Store
// implementation must pass (learn.MemStore, the reference semantics, in internal/learn, and the
// PostgreSQL store in internal/store). It also runs learn.Service on the store (offline replay,
// snapshot caching) with a deterministic fake of the compute service.
package learntest

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/learn"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

// Fixture is a fresh, empty store and three subjects it may write for: Holder (an account or
// device holder), Member (a family member inside Holder's account) and Other (another applicant
// of the same tenant). The subjects must exist wherever the store needs them to (core.applicants,
// core.family_members).
type Fixture struct {
	Store  learn.Store
	Holder learn.Subject
	Member learn.Subject
	Other  learn.Subject
}

// T0 is the suite's reference time (millisecond precision, as the compute service reports).
var T0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

// RunStoreContract runs the suite; newFixture is called once per case.
func RunStoreContract(t *testing.T, newFixture func(t *testing.T) Fixture) {
	t.Helper()
	cases := []struct {
		name string
		run  func(t *testing.T, f Fixture)
	}{
		{"AnswersByClientID/empty", answersEmpty},
		{"SaveAnswers/round trip and logs", saveRoundTrip},
		{"SaveAnswers/skips stored and repeated IDs", saveSkipsExisting},
		{"SaveAnswers/concurrent syncs insert once", saveConcurrent},
		{"SaveAnswers/subjects are separate", subjectsSeparate},
		{"AppendLog/dedupe and order", appendLogDedupe},
		{"RecentRatedAnswers/last n rated, oldest first", recentRated},
		{"Snapshot/not found, latest, round trip", snapshotRoundTrip},
		{"Snapshot/out-of-range summary numbers", snapshotOutOfRange},
		{"Service/offline replay counted once", serviceReplay},
		{"Service/readiness served from the snapshot", serviceSnapshot},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { c.run(t, newFixture(t)) })
	}
}

func boolp(b bool) *bool { return &b }

// Answer builds a stored answer (confidence "" = unrated) received at T0.
func Answer(id, card string, correct bool, conf string, at time.Time) *learn.StoredAnswer {
	rating := 1
	if correct {
		rating = 3
	}
	return &learn.StoredAnswer{ClientAnswerID: id, QRef: card + ":v1", CardID: card, Topic: learn.TopicOfCard(card), Correct: correct,
		Rating: rating, Overconfident: !correct && conf == "100", Confidence: conf, AnsweredAt: at, ReviewedAt: at,
		NextDueAt: at.Add(24 * time.Hour), ReceivedAt: T0}
}

// LogFor is the review-log row the service writes for a.
func LogFor(a *learn.StoredAnswer) learn.LogRow {
	return learn.LogRow{CardID: a.CardID, Rating: a.Rating, ReviewedAt: a.ReviewedAt, SourceKind: "answer", SourceID: a.ClientAnswerID,
		Confidence: a.Confidence, Correct: boolp(a.Correct), Overconfident: a.Overconfident}
}

func logsFor(as ...*learn.StoredAnswer) map[string]learn.LogRow {
	out := map[string]learn.LogRow{}
	for _, a := range as {
		out[a.ClientAnswerID] = LogFor(a)
	}
	return out
}

// Card is a gamification CardState JSON with the given id and due time.
func Card(id string, due time.Time) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"cardId": id, "phase": "review", "due": due.UnixMilli(), "stability": 3.2, "difficulty": 5.1,
		"reps": 2, "lapses": 0, "lastReview": due.Add(-48 * time.Hour).UnixMilli(), "firstReview": nil})
	return b
}

func requireAnswer(t *testing.T, want, got *learn.StoredAnswer) {
	t.Helper()
	require.NotNil(t, got)
	require.Equal(t, want.ClientAnswerID, got.ClientAnswerID)
	require.Equal(t, want.QRef, got.QRef)
	require.Equal(t, want.CardID, got.CardID)
	require.Equal(t, want.Topic, got.Topic)
	require.Equal(t, want.Correct, got.Correct)
	require.Equal(t, want.Rating, got.Rating)
	require.Equal(t, want.Overconfident, got.Overconfident)
	require.Equal(t, want.Confidence, got.Confidence)
	for _, p := range [][2]time.Time{{want.AnsweredAt, got.AnsweredAt}, {want.ReviewedAt, got.ReviewedAt}, {want.NextDueAt, got.NextDueAt},
		{want.ReceivedAt, got.ReceivedAt}} {
		require.Truef(t, p[0].Equal(p[1]), "time %v != %v", p[1], p[0])
	}
}

func requireLog(t *testing.T, want, got []learn.LogRow) {
	t.Helper()
	require.Len(t, got, len(want))
	for i := range want {
		w, g := want[i], got[i]
		require.Truef(t, w.ReviewedAt.Equal(g.ReviewedAt), "row %d reviewed_at %v != %v", i, g.ReviewedAt, w.ReviewedAt)
		g.ReviewedAt = w.ReviewedAt
		require.Equalf(t, w, g, "row %d", i)
	}
}

func answersEmpty(t *testing.T, f Fixture) {
	ctx := context.Background()
	got, err := f.Store.AnswersByClientID(ctx, f.Holder, nil)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Empty(t, got)
	got, err = f.Store.AnswersByClientID(ctx, f.Holder, []string{"nope"})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Empty(t, got)
	log, err := f.Store.ReviewLog(ctx, f.Holder)
	require.NoError(t, err)
	require.Empty(t, log)
	n, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Zero(t, n)
	rated, err := f.Store.RecentRatedAnswers(ctx, f.Holder, 40)
	require.NoError(t, err)
	require.Empty(t, rated)
	// Nothing to insert is not an error.
	ins, err := f.Store.SaveAnswers(ctx, f.Holder, nil, nil, nil)
	require.NoError(t, err)
	require.Empty(t, ins)
}

func saveRoundTrip(t *testing.T, f Fixture) {
	ctx := context.Background()
	a1 := Answer("a1", "C-LL1-001", true, "75", T0.Add(-time.Hour))
	a2 := Answer("a2", "C-LL1-002", false, "100", T0.Add(-50*time.Minute))
	a3 := Answer("a3", "C-LL2-001", false, "", T0.Add(-40*time.Minute)) // unrated; no log row handed over
	cards := []json.RawMessage{Card("C-LL1-001", T0.Add(24*time.Hour)), Card("C-LL1-002", T0.Add(time.Hour))}
	ins, err := f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1, a2, a3}, logsFor(a1, a2), cards)
	require.NoError(t, err)
	require.Equal(t, []string{"a1", "a2", "a3"}, ins)

	got, err := f.Store.AnswersByClientID(ctx, f.Holder, []string{"a1", "a2", "a3", "a9"})
	require.NoError(t, err)
	require.Len(t, got, 3)
	requireAnswer(t, a1, got["a1"])
	requireAnswer(t, a2, got["a2"])
	requireAnswer(t, a3, got["a3"])
	// The map holds copies: changing one does not change the store.
	got["a1"].Rating = 4
	again, err := f.Store.AnswersByClientID(ctx, f.Holder, []string{"a1"})
	require.NoError(t, err)
	require.Equal(t, 3, again["a1"].Rating)

	log, err := f.Store.ReviewLog(ctx, f.Holder)
	require.NoError(t, err)
	requireLog(t, []learn.LogRow{LogFor(a1), LogFor(a2)}, log)
	n, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, 2, n)
}

func saveSkipsExisting(t *testing.T, f Fixture) {
	ctx := context.Background()
	a1 := Answer("a1", "C-LL1-001", true, "75", T0.Add(-time.Hour))
	_, err := f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1}, logsFor(a1), nil)
	require.NoError(t, err)
	// A concurrent sync stored a1 first; this batch carries a different result for it, a new a2
	// and a2 repeated.
	a1b := Answer("a1", "C-LL1-001", false, "100", T0.Add(-time.Minute))
	a2 := Answer("a2", "C-LL1-002", true, "50", T0.Add(-30*time.Minute))
	a2b := Answer("a2", "C-LL1-002", false, "50", T0.Add(-20*time.Minute))
	ins, err := f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1b, a2, a2b}, logsFor(a1b, a2), nil)
	require.NoError(t, err)
	require.Equal(t, []string{"a2"}, ins)
	got, err := f.Store.AnswersByClientID(ctx, f.Holder, []string{"a1", "a2"})
	require.NoError(t, err)
	requireAnswer(t, a1, got["a1"])
	requireAnswer(t, a2, got["a2"])
	log, err := f.Store.ReviewLog(ctx, f.Holder)
	require.NoError(t, err)
	requireLog(t, []learn.LogRow{LogFor(a1), LogFor(a2)}, log)
	// Replaying everything inserts nothing.
	ins, err = f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1, a2}, logsFor(a1, a2), nil)
	require.NoError(t, err)
	require.Empty(t, ins)
	n, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, 2, n)
}

func saveConcurrent(t *testing.T, f Fixture) {
	ctx := context.Background()
	var batch []*learn.StoredAnswer
	for i := 0; i < 20; i++ {
		batch = append(batch, Answer("c"+strings.Repeat("x", i), "C-LL1-001", i%2 == 0, "75", T0.Add(time.Duration(i)*time.Second)))
	}
	const syncs = 4
	var wg sync.WaitGroup
	results := make([][]string, syncs)
	errs := make([]error, syncs)
	for g := 0; g < syncs; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cards := []json.RawMessage{Card("C-LL1-001", T0.Add(time.Duration(g)*time.Hour)), Card("C-LL1-002", T0)}
			results[g], errs[g] = f.Store.SaveAnswers(ctx, f.Holder, batch, logsFor(batch...), cards)
		}()
	}
	wg.Wait()
	seen := map[string]int{}
	for g := 0; g < syncs; g++ {
		require.NoError(t, errs[g])
		for _, id := range results[g] {
			seen[id]++
		}
	}
	require.Len(t, seen, len(batch))
	for id, c := range seen {
		require.Equalf(t, 1, c, "%s inserted %d times", id, c)
	}
	n, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, len(batch), n)
}

func subjectsSeparate(t *testing.T, f Fixture) {
	ctx := context.Background()
	subjects := []learn.Subject{f.Holder, f.Member, f.Other}
	for i, s := range subjects {
		var as []*learn.StoredAnswer
		for j := 0; j <= i; j++ {
			as = append(as, Answer("same-"+strings.Repeat("y", j), "C-LL1-00"+string(rune('1'+j)), true, "75", T0.Add(-time.Hour)))
		}
		ins, err := f.Store.SaveAnswers(ctx, s, as, logsFor(as...), []json.RawMessage{Card("C-LL1-001", T0)})
		require.NoError(t, err)
		require.Lenf(t, ins, i+1, "subject %d", i)
		require.NoError(t, f.Store.SaveSnapshot(ctx, s, &learn.Snapshot{ComputedAt: T0, LogCount: i + 1}))
	}
	for i, s := range subjects {
		n, err := f.Store.LogCount(ctx, s)
		require.NoError(t, err)
		require.Equalf(t, i+1, n, "subject %d", i)
		got, err := f.Store.AnswersByClientID(ctx, s, []string{"same-", "same-y", "same-yy"})
		require.NoError(t, err)
		require.Len(t, got, i+1)
		snap, err := f.Store.LatestSnapshot(ctx, s)
		require.NoError(t, err)
		require.Equal(t, i+1, snap.LogCount)
	}
	// Session evidence for the member does not touch the holder.
	added, err := f.Store.AppendLog(ctx, f.Member, []learn.LogRow{{CardID: "C-LL1-001", Rating: 3, ReviewedAt: T0, SourceKind: "session", SourceID: "sid"}})
	require.NoError(t, err)
	require.Equal(t, 1, added)
	added, err = f.Store.AppendLog(ctx, f.Holder, []learn.LogRow{{CardID: "C-LL1-001", Rating: 3, ReviewedAt: T0, SourceKind: "session", SourceID: "sid"}})
	require.NoError(t, err)
	require.Equal(t, 1, added)
	n, _ := f.Store.LogCount(ctx, f.Holder)
	m, _ := f.Store.LogCount(ctx, f.Member)
	require.Equal(t, 2, n)
	require.Equal(t, 3, m)
}

func appendLogDedupe(t *testing.T, f Fixture) {
	ctx := context.Background()
	a1 := Answer("a1", "C-LL1-001", true, "75", T0.Add(-time.Hour))
	_, err := f.Store.SaveAnswers(ctx, f.Holder, []*learn.StoredAnswer{a1}, logsFor(a1), nil)
	require.NoError(t, err)
	at := T0.Add(-10 * time.Minute)
	rows := []learn.LogRow{
		{CardID: "C-LL1-001", Rating: 3, ReviewedAt: at, SourceKind: "session", SourceID: "sid-1", Confidence: "100", Correct: boolp(true)},
		{CardID: "C-LL1-002", Rating: 1, ReviewedAt: at, SourceKind: "session", SourceID: "sid-1", Correct: boolp(false), Overconfident: true},
		{CardID: "C-LL1-002", Rating: 4, ReviewedAt: at, SourceKind: "session", SourceID: "sid-1"}, // repeat inside rows
		{CardID: "C-LL1-003", Rating: 2, ReviewedAt: at, SourceKind: "prediction", SourceID: "sid-1"},
	}
	n, err := f.Store.AppendLog(ctx, f.Holder, rows)
	require.NoError(t, err)
	require.Equal(t, 3, n)
	n, err = f.Store.AppendLog(ctx, f.Holder, rows)
	require.NoError(t, err)
	require.Zero(t, n)
	// The same card and source ID under another kind is another row; the answer's own row is a dupe.
	n, err = f.Store.AppendLog(ctx, f.Holder, []learn.LogRow{
		{CardID: "C-LL1-001", Rating: 2, ReviewedAt: T0, SourceKind: "prediction", SourceID: "sid-1"},
		LogFor(a1),
	})
	require.NoError(t, err)
	require.Equal(t, 1, n)
	n, err = f.Store.AppendLog(ctx, f.Holder, nil)
	require.NoError(t, err)
	require.Zero(t, n)
	log, err := f.Store.ReviewLog(ctx, f.Holder)
	require.NoError(t, err)
	requireLog(t, []learn.LogRow{LogFor(a1), rows[0], rows[1], rows[3],
		{CardID: "C-LL1-001", Rating: 2, ReviewedAt: T0, SourceKind: "prediction", SourceID: "sid-1"}}, log)
	c, err := f.Store.LogCount(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, 5, c)
}

func recentRated(t *testing.T, f Fixture) {
	ctx := context.Background()
	var batch []*learn.StoredAnswer
	confs := []string{"50", "", "75", "100", "", "50"}
	for i, c := range confs {
		batch = append(batch, Answer("r"+string(rune('a'+i)), "C-LL1-001", i%2 == 0, c, T0.Add(time.Duration(i)*time.Minute)))
	}
	_, err := f.Store.SaveAnswers(ctx, f.Holder, batch[:3], nil, nil)
	require.NoError(t, err)
	_, err = f.Store.SaveAnswers(ctx, f.Holder, batch[3:], nil, nil)
	require.NoError(t, err)
	all, err := f.Store.RecentRatedAnswers(ctx, f.Holder, 40)
	require.NoError(t, err)
	require.Equal(t, []learn.RatedAnswer{{Correct: true, Confidence: "50"}, {Correct: true, Confidence: "75"},
		{Correct: false, Confidence: "100"}, {Correct: false, Confidence: "50"}}, all)
	last2, err := f.Store.RecentRatedAnswers(ctx, f.Holder, 2)
	require.NoError(t, err)
	require.Equal(t, []learn.RatedAnswer{{Correct: false, Confidence: "100"}, {Correct: false, Confidence: "50"}}, last2)
	other, err := f.Store.RecentRatedAnswers(ctx, f.Member, 40)
	require.NoError(t, err)
	require.Empty(t, other)
}

// StateFixture is a /learn/state output with every block filled.
func StateFixture(readiness, knowledge, pen float64, met bool) learn.StateResponse {
	var s learn.StateResponse
	s.Cards = []json.RawMessage{Card("C-LL1-001", T0.Add(24*time.Hour)), Card("C-LL1-002", T0)}
	s.Readiness.Readiness, s.Readiness.Knowledge, s.Readiness.CalPenalty = readiness, knowledge, pen
	s.Readiness.WeightsSource = "equal"
	s.Readiness.Gate.Met, s.Readiness.Gate.Reasons, s.Readiness.Gate.WeakTopics = met, []string{"readiness_below_85"}, []string{"LL2"}
	s.Readiness.Gate.BookAnywayVisible = true
	oc := 0.125
	s.Readiness.Calibration.N, s.Readiness.Calibration.OC, s.Readiness.Calibration.Enough = 12, &oc, true
	s.Readiness.Topics = []learn.ReadinessTopic{{Topic: "LL1", Mastery: 0.91, Weight: 0.25}, {Topic: "LL2", Mastery: 0.4, Weight: 0.75}}
	mr := 0.83
	s.MasteryByTopic = map[string]learn.TopicMastery{"LL1": {Mastery: 0.91, Coverage: 0.95, MeanRetrievability: &mr, ConceptCount: 20, Seen: 19, Covered: 18},
		"LL2": {Mastery: 0.4, Coverage: 0.5, ConceptCount: 10, Seen: 5, Covered: 5}}
	s.NodeStates = map[string]string{"SK-LL1": "mastered", "SK-LL2": "learning"}
	s.ReviewQueue = learn.ReviewQueueOut{Due: []learn.DueCard{{CardID: "C-LL1-002", Retrievability: 0.71, Due: T0.UnixMilli()}},
		Fresh: []string{"C-LL1-009"}, DueRemaining: 3, NewIntroducedToday: 2}
	brier := 0.1875
	s.Calibration = learn.CalibrationOut{N: 12, Brier: &brier, Bins: []json.RawMessage{json.RawMessage(`{"p":0.75,"n":4,"hit":0.5}`)},
		SureAndWrong: 1}
	score, nz := 71.5, 64.25
	s.RoadReadiness = learn.RoadReadinessOut{Score: &score, KnowledgePart: 77.75, NazarPart: &nz, Modules: []string{"M1", "M2"}}
	return s
}

// RequireSameState compares two /learn/state outputs as JSON values (a store may re-encode the
// verbatim card and bin JSON: key order and whitespace are not part of the contract).
func RequireSameState(t *testing.T, want, got learn.StateResponse) {
	t.Helper()
	norm := func(s learn.StateResponse) any {
		b, err := json.Marshal(s)
		require.NoError(t, err)
		var v any
		require.NoError(t, json.Unmarshal(b, &v))
		return v
	}
	require.Equal(t, norm(want), norm(got))
}

func snapshotRoundTrip(t *testing.T, f Fixture) {
	ctx := context.Background()
	_, err := f.Store.LatestSnapshot(ctx, f.Holder)
	require.True(t, errors.Is(err, learn.ErrNotFound), "got %v", err)

	nz := 64.25
	first := &learn.Snapshot{ComputedAt: T0, LogCount: 4, State: StateFixture(78, 84, 6, false), NazarScore: &nz, NazarSessions: 3}
	require.NoError(t, f.Store.SaveSnapshot(ctx, f.Holder, first))
	got, err := f.Store.LatestSnapshot(ctx, f.Holder)
	require.NoError(t, err)
	require.True(t, got.ComputedAt.Equal(T0))
	require.Equal(t, 4, got.LogCount)
	require.NotNil(t, got.NazarScore)
	require.InDelta(t, 64.25, *got.NazarScore, 1e-9)
	require.Equal(t, 3, got.NazarSessions)
	RequireSameState(t, first.State, got.State)

	second := &learn.Snapshot{ComputedAt: T0.Add(time.Hour), LogCount: 5, State: StateFixture(90, 92, 2, true)}
	require.NoError(t, f.Store.SaveSnapshot(ctx, f.Holder, second))
	got, err = f.Store.LatestSnapshot(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, 5, got.LogCount)
	require.Nil(t, got.NazarScore)
	require.Zero(t, got.NazarSessions)
	require.True(t, got.State.Readiness.Gate.Met)
	RequireSameState(t, second.State, got.State)
	// The snapshot handed back is a copy.
	got.LogCount = 99
	again, err := f.Store.LatestSnapshot(ctx, f.Holder)
	require.NoError(t, err)
	require.Equal(t, 5, again.LogCount)

	_, err = f.Store.LatestSnapshot(ctx, f.Member)
	require.ErrorIs(t, err, learn.ErrNotFound)
}

func snapshotOutOfRange(t *testing.T, f Fixture) {
	ctx := context.Background()
	// Numbers outside the summary columns' ranges, a topic outside the mastery cache's pattern
	// and a mastery above 1: the snapshot is still kept and its state comes back unchanged.
	st := StateFixture(101.6, -3, 250, false)
	st.MasteryByTopic["not-a-topic"] = learn.TopicMastery{Mastery: 1.2, Coverage: -0.1}
	st.MasteryByTopic["LL3"] = learn.TopicMastery{Mastery: 1.0000001, Coverage: 2}
	st.NodeStates["SK-LL3"] = "unknown"
	snap := &learn.Snapshot{ComputedAt: T0, LogCount: 0, State: st, NazarSessions: 0}
	require.NoError(t, f.Store.SaveSnapshot(ctx, f.Member, snap))
	got, err := f.Store.LatestSnapshot(ctx, f.Member)
	require.NoError(t, err)
	RequireSameState(t, st, got.State)
	require.InDelta(t, 101.6, got.State.Readiness.Readiness, 1e-9)
}

// ---- learn.Service on the store --------------------------------------------------------------

// fakeCompute is the compute fake from internal/learn/learn_test.go: option "a" is correct,
// rating 3 when correct else 1, overconfident when wrong at 100, due one day after the answer.
type fakeCompute struct {
	mu          sync.Mutex
	answerCalls [][]learn.ComputeAnswer
	stateCalls  int
	lastState   learn.StateRequest
	state       learn.StateResponse
	down        bool
}

func (f *fakeCompute) Answers(_ context.Context, req learn.AnswersRequest) (*learn.AnswersResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		return nil, learn.ErrComputeUnavailable
	}
	f.answerCalls = append(f.answerCalls, req.Answers)
	out := &learn.AnswersResponse{Cards: []json.RawMessage{}}
	for _, a := range req.Answers {
		card, _, _ := strings.Cut(a.QRef, ":")
		correct := a.SelectedOptionID != nil && *a.SelectedOptionID == "a"
		rating := 1
		if correct {
			rating = 3
		}
		out.Results = append(out.Results, learn.ComputeAnswerResult{ClientAnswerID: a.ClientAnswerID, QRef: a.QRef, CardID: card,
			Topic: learn.TopicOfCard(card), Correct: correct, Rating: rating, Overconfident: !correct && a.Confidence == "100",
			ReviewedAt: a.AnsweredAt, NextDueAt: a.AnsweredAt + 86_400_000})
		out.Cards = append(out.Cards, Card(card, time.UnixMilli(a.AnsweredAt+86_400_000)))
	}
	return out, nil
}

func (f *fakeCompute) State(_ context.Context, req learn.StateRequest) (*learn.StateResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		return nil, learn.ErrComputeUnavailable
	}
	f.stateCalls++
	f.lastState = req
	s := f.state
	return &s, nil
}

type fakeNazar struct{}

func (fakeNazar) NazarScore(context.Context, learn.Subject) (*float64, int, error) {
	v := 64.0
	return &v, 3, nil
}

func newService(st learn.Store) (*learn.Service, *fakeCompute, *servertime.Fixed) {
	fc, clk := &fakeCompute{state: StateFixture(78, 84, 6, false)}, servertime.NewFixed(T0)
	return &learn.Service{Store: st, Compute: fc, Nazar: fakeNazar{}, Clock: clk}, fc, clk
}

func ans(id, q, opt string) learn.Answer {
	return learn.Answer{ClientAnswerID: id, QRef: q, OptionID: opt, Confidence: "75", AnsweredAt: T0.Add(-time.Hour)}
}

// serviceReplay is TestAPI32_OfflineReplayNoDoubleCount, for the holder and a family member.
func serviceReplay(t *testing.T, f Fixture) {
	ctx := context.Background()
	for _, s := range []learn.Subject{f.Holder, f.Member} {
		svc, fc, _ := newService(f.Store)
		batch := []learn.Answer{ans("a1", "C-LL1-001:v1", "a"), ans("a2", "C-LL1-002:v1", "b"), ans("a3", "C-LL1-003:v2", "a")}
		first, err := svc.SubmitAnswers(ctx, s, batch)
		require.NoError(t, err)
		require.Len(t, first, 3)
		require.False(t, first[0].Duplicate)
		require.True(t, first[0].Correct)
		require.False(t, first[1].Correct)
		// The same batch again (the offline queue replayed): nothing new reaches compute or the log.
		again, err := svc.SubmitAnswers(ctx, s, batch)
		require.NoError(t, err)
		require.Len(t, fc.answerCalls, 1)
		for i := range batch {
			require.True(t, again[i].Duplicate)
			require.Equal(t, first[i].Rating, again[i].Rating)
			require.Equal(t, first[i].Correct, again[i].Correct)
			require.True(t, first[i].NextDueAt.Equal(again[i].NextDueAt))
		}
		n, err := f.Store.LogCount(ctx, s)
		require.NoError(t, err)
		require.Equal(t, 3, n)
		// The replay plus one new answer and an in-batch duplicate.
		replay := append(append([]learn.Answer{}, batch...), ans("a4", "C-LL1-004:v1", "a"), ans("a4", "C-LL1-004:v1", "a"))
		second, err := svc.SubmitAnswers(ctx, s, replay)
		require.NoError(t, err)
		require.Len(t, fc.answerCalls, 2)
		require.Len(t, fc.answerCalls[1], 1)
		require.Equal(t, "a4", fc.answerCalls[1][0].ClientAnswerID)
		require.False(t, second[3].Duplicate)
		require.True(t, second[4].Duplicate)
		n, err = f.Store.LogCount(ctx, s)
		require.NoError(t, err)
		require.Equal(t, 4, n)
		rated, err := f.Store.RecentRatedAnswers(ctx, s, learn.CalibrationWindow)
		require.NoError(t, err)
		require.Len(t, rated, 4)
	}
	// The holder and the member each have their own four answers; Other has none.
	n, err := f.Store.LogCount(ctx, f.Other)
	require.NoError(t, err)
	require.Zero(t, n)
}

// serviceSnapshot runs API-33/API-31 on the store: the snapshot is cached until new evidence
// arrives, and served (stale) when compute is down.
func serviceSnapshot(t *testing.T, f Fixture) {
	ctx := context.Background()
	svc, fc, clk := newService(f.Store)
	v, err := svc.Readiness(ctx, f.Member)
	require.NoError(t, err)
	require.Equal(t, 78, v.Score)
	require.Equal(t, 84, v.Knowledge)
	require.Equal(t, 6, v.CalibrationPenalty)
	require.Equal(t, "equal_default_topic_mix_unknown", v.WeightsSource)
	require.True(t, v.Gate.BookAnywayVisible)
	require.InDelta(t, 0.95, v.Topics[0].Coverage, 1e-9)
	require.False(t, v.Stale)
	q, err := svc.ReviewQueue(ctx, f.Member)
	require.NoError(t, err)
	require.Len(t, q.Items, 1)
	require.Equal(t, "LL1", q.Items[0].TopicID)
	require.Equal(t, 1, fc.stateCalls, "snapshot not reused")

	_, err = svc.AppendEvidence(ctx, f.Member, "sid-1", T0, []learn.Evidence{{CardID: "C-LL1-001", Rating: 3}})
	require.NoError(t, err)
	_, err = svc.ReviewQueue(ctx, f.Member)
	require.NoError(t, err)
	require.Equal(t, 2, fc.stateCalls, "new evidence must recompute")
	require.Len(t, fc.lastState.ReviewLog, 1)
	require.Equal(t, "learning", fc.lastState.PreviousNodeStates["SK-LL2"])

	fc.down = true
	clk.Advance(2 * time.Hour)
	v, err = svc.Readiness(ctx, f.Member)
	require.NoError(t, err)
	require.True(t, v.Stale)
	require.True(t, v.AsOf.Equal(T0))
	_, err = svc.Readiness(ctx, f.Holder)
	require.ErrorIs(t, err, learn.ErrComputeUnavailable)
}
