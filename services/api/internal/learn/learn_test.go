package learn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
)

var t0 = time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)

type fakeCompute struct {
	answerCalls [][]ComputeAnswer
	stateCalls  int
	lastState   StateRequest
	state       StateResponse
	down        bool
}

func (f *fakeCompute) Answers(_ context.Context, req AnswersRequest) (*AnswersResponse, error) {
	if f.down {
		return nil, ErrComputeUnavailable
	}
	f.answerCalls = append(f.answerCalls, req.Answers)
	out := &AnswersResponse{Cards: []json.RawMessage{}}
	for _, a := range req.Answers {
		card, _, _ := strings.Cut(a.QRef, ":")
		correct := a.SelectedOptionID != nil && *a.SelectedOptionID == "a"
		rating := 1
		if correct {
			rating = 3
		}
		out.Results = append(out.Results, ComputeAnswerResult{ClientAnswerID: a.ClientAnswerID, QRef: a.QRef, CardID: card,
			Topic: TopicOfCard(card), Correct: correct, Rating: rating, Overconfident: !correct && a.Confidence == "100",
			ReviewedAt: a.AnsweredAt, NextDueAt: a.AnsweredAt + 86_400_000})
	}
	return out, nil
}

func (f *fakeCompute) State(_ context.Context, req StateRequest) (*StateResponse, error) {
	if f.down {
		return nil, ErrComputeUnavailable
	}
	f.stateCalls++
	f.lastState = req
	s := f.state
	return &s, nil
}

func stateWith(readiness, knowledge, pen float64, met bool, reasons ...string) StateResponse {
	var s StateResponse
	s.Readiness.Readiness, s.Readiness.Knowledge, s.Readiness.CalPenalty = readiness, knowledge, pen
	s.Readiness.WeightsSource = "equal"
	s.Readiness.Gate.Met, s.Readiness.Gate.Reasons, s.Readiness.Gate.WeakTopics = met, reasons, []string{}
	s.Readiness.Topics = []ReadinessTopic{{Topic: "LL1", Mastery: 0.91, Weight: 0.25}}
	s.MasteryByTopic = map[string]TopicMastery{"LL1": {Mastery: 0.91, Coverage: 0.95}}
	s.ReviewQueue = ReviewQueueOut{Due: []DueCard{{CardID: "C-LL1-002", Retrievability: 0.71, Due: t0.UnixMilli()}}, Fresh: []string{"C-LL1-009"}}
	s.NodeStates = map[string]string{"SK-LL1": "learning"}
	return s
}

type fakeNazar struct{}

func (fakeNazar) NazarScore(context.Context, Subject) (*float64, int, error) {
	v := 64.0
	return &v, 3, nil
}

func newSvc() (*Service, *MemStore, *fakeCompute, *servertime.Fixed) {
	st, fc, clk := NewMemStore(), &fakeCompute{state: stateWith(78, 84, 6, false, "readiness_below_85")}, servertime.NewFixed(t0)
	return &Service{Store: st, Compute: fc, Nazar: fakeNazar{}, Clock: clk}, st, fc, clk
}

func subj() Subject { return Subject{Tenant: "JK", ApplicantID: uuid.New()} }

func ans(id, q, opt string) Answer {
	return Answer{ClientAnswerID: id, QRef: q, OptionID: opt, Confidence: "75", AnsweredAt: t0.Add(-time.Hour)}
}

func TestAPI32_OfflineReplayNoDoubleCount(t *testing.T) {
	svc, st, fc, _ := newSvc()
	ctx, s := context.Background(), subj()
	batch := []Answer{ans("a1", "C-LL1-001:v1", "a"), ans("a2", "C-LL1-002:v1", "b"), ans("a3", "C-LL1-003:v2", "a")}
	first, err := svc.SubmitAnswers(ctx, s, batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 3 || first[0].Duplicate || !first[0].Correct || first[1].Correct {
		t.Fatalf("first sync %+v", first)
	}
	// The device was offline and replays the whole queue, plus one new answer, and a duplicate
	// inside the batch.
	replay := append(append([]Answer{}, batch...), ans("a4", "C-LL1-004:v1", "a"), ans("a4", "C-LL1-004:v1", "a"))
	second, err := svc.SubmitAnswers(ctx, s, replay)
	if err != nil {
		t.Fatal(err)
	}
	if len(fc.answerCalls) != 2 || len(fc.answerCalls[1]) != 1 || fc.answerCalls[1][0].ClientAnswerID != "a4" {
		t.Fatalf("compute saw replayed answers: %+v", fc.answerCalls)
	}
	for i := 0; i < 3; i++ {
		if !second[i].Duplicate || second[i].Rating != first[i].Rating || second[i].Correct != first[i].Correct {
			t.Fatalf("replayed result %d: %+v vs %+v", i, second[i], first[i])
		}
	}
	if second[3].Duplicate || !second[4].Duplicate {
		t.Fatalf("in-batch duplicate: %+v %+v", second[3], second[4])
	}
	n, _ := st.LogCount(ctx, s)
	if n != 4 {
		t.Fatalf("review log has %d rows, want 4 (one per distinct answer)", n)
	}
	// A third replay of everything changes nothing and does not call compute.
	if _, err := svc.SubmitAnswers(ctx, s, replay); err != nil {
		t.Fatal(err)
	}
	if n2, _ := st.LogCount(ctx, s); n2 != 4 || len(fc.answerCalls) != 2 {
		t.Fatalf("third replay: log %d, compute calls %d", n2, len(fc.answerCalls))
	}
	// The review log sent to compute carried the stored rows (for the cards touched).
	big := make([]Answer, MaxBatch+1)
	if _, err := svc.SubmitAnswers(ctx, s, big); !errors.Is(err, ErrBatchTooLarge) {
		t.Fatalf("201 answers: %v", err)
	}
}

func TestAppendEvidence_Idempotent(t *testing.T) {
	svc, st, _, _ := newSvc()
	ctx, s := context.Background(), subj()
	ev := []Evidence{{CardID: "C-LL1-001", Rating: 3}, {CardID: "C-LL1-002", Rating: 1, Overconfident: true}}
	if n, err := svc.AppendEvidence(ctx, s, "sid-1", t0, ev); err != nil || n != 2 {
		t.Fatalf("%d %v", n, err)
	}
	if n, _ := svc.AppendEvidence(ctx, s, "sid-1", t0, ev); n != 0 {
		t.Fatalf("re-append added %d", n)
	}
	if c, _ := st.LogCount(ctx, s); c != 2 {
		t.Fatalf("log %d", c)
	}
}

func TestAPI33_BookAnywayConst(t *testing.T) {
	svc, _, fc, clk := newSvc()
	ctx, s := context.Background(), subj()
	cases := []struct {
		name  string
		state StateResponse
	}{
		{"gate not met", stateWith(40, 40, 0, false, "readiness_below_85", "no_mock_data")},
		{"gate met", stateWith(90, 92, 2, true)},
		{"compute claims false", func() StateResponse {
			s := stateWith(0, 0, 0, false)
			s.Readiness.Gate.BookAnywayVisible = false
			return s
		}()},
	}
	for _, c := range cases {
		fc.state = c.state
		clk.Advance(2 * time.Hour) // force a recompute
		v, err := svc.Readiness(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		if !v.Gate.BookAnywayVisible || !v.Gate.Advisory || v.Gate.Threshold != 85 {
			t.Fatalf("%s: gate %+v", c.name, v.Gate)
		}
		raw, _ := json.Marshal(v)
		if !strings.Contains(string(raw), `"book_anyway_visible":true`) {
			t.Fatalf("%s: JSON %s", c.name, raw)
		}
	}
	// Compute down: the last snapshot is served with its timestamp, still with book anyway.
	fc.down = true
	clk.Advance(2 * time.Hour)
	v, err := svc.Readiness(ctx, s)
	if err != nil || !v.Stale || !v.Gate.BookAnywayVisible || v.AsOf.IsZero() {
		t.Fatalf("down: %+v %v", v, err)
	}
	// No snapshot at all and compute down: 503 territory.
	if _, err := svc.Readiness(ctx, subj()); !errors.Is(err, ErrComputeUnavailable) {
		t.Fatalf("no snapshot: %v", err)
	}
}

func TestAPI33_FieldsComeOnlyFromCompute(t *testing.T) {
	svc, _, fc, _ := newSvc()
	// Deliberately inconsistent numbers (70 − 9 ≠ 50): Go must not recompute any of them.
	fc.state = stateWith(50, 70, 9, false, "topic_below_0_7")
	fc.state.Readiness.WeightsSource = "rule_pack_JK_2026"
	v, err := svc.Readiness(context.Background(), subj())
	if err != nil {
		t.Fatal(err)
	}
	if v.Score != 50 || v.Knowledge != 70 || v.CalibrationPenalty != 9 {
		t.Fatalf("numbers changed: %d %d %d", v.Score, v.Knowledge, v.CalibrationPenalty)
	}
	if v.DisplayKey != "readiness.formula" || v.WeightsSource != "rule_pack_JK_2026" || len(v.Gate.Reasons) != 1 || v.Gate.Reasons[0] != "topic_below_0_7" {
		t.Fatalf("strings: %+v", v)
	}
	if v.Topics[0].TopicID != "LL1" || v.Topics[0].Coverage != 0.95 {
		t.Fatalf("topics %+v", v.Topics)
	}
	// "equal" maps to the documented API value.
	fc.state.Readiness.WeightsSource = "equal"
	v2, _ := svc.Readiness(context.Background(), subj())
	if v2.WeightsSource != "equal_default_topic_mix_unknown" {
		t.Fatalf("weights source %q", v2.WeightsSource)
	}
	// Road readiness carries the injected Nazar Score, which was also sent to compute.
	if v.RoadReadiness["nazar_score"].(*float64) == nil || *fc.lastState.NazarScore != 64 || fc.lastState.StateCode != "JK" {
		t.Fatalf("nazar %v %v", v.RoadReadiness, fc.lastState.NazarScore)
	}
}

func TestReviewQueue_FromCacheUntilStale(t *testing.T) {
	svc, _, fc, clk := newSvc()
	ctx, s := context.Background(), subj()
	q, err := svc.ReviewQueue(ctx, s)
	if err != nil || len(q.Items) != 1 || q.Items[0].TopicID != "LL1" || q.New[0] != "C-LL1-009" {
		t.Fatalf("queue %+v %v", q, err)
	}
	_, _ = svc.ReviewQueue(ctx, s)
	if fc.stateCalls != 1 {
		t.Fatalf("cache not used: %d calls", fc.stateCalls)
	}
	// New evidence makes the snapshot stale.
	_, _ = svc.AppendEvidence(ctx, s, "sid", t0, []Evidence{{CardID: "C-LL1-001", Rating: 3}})
	_, _ = svc.ReviewQueue(ctx, s)
	clk.Advance(61 * time.Minute)
	_, _ = svc.ReviewQueue(ctx, s)
	if fc.stateCalls != 3 {
		t.Fatalf("stale snapshot reused: %d calls", fc.stateCalls)
	}
}

func repoContent(t *testing.T) string {
	t.Helper()
	dir, _ := os.Getwd()
	for {
		p := filepath.Join(dir, "content", "curriculum")
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return filepath.Join(dir, "content")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("content/curriculum not found")
		}
		dir = parent
	}
}

func TestModules_FromContentDirWithETag(t *testing.T) {
	c, err := LoadCatalog(repoContent(t))
	if err != nil {
		t.Fatal(err)
	}
	list, etag := c.List("MCWG", "JK")
	if len(list) == 0 || list[0].ModuleID != "LL0" || !strings.HasPrefix(etag, `W/"`) {
		t.Fatalf("list %d first %v etag %s", len(list), list[0], etag)
	}
	for _, m := range list {
		if m.ModuleID == "M12" { // car-only module
			t.Fatal("car-only module listed for MCWG")
		}
	}
	if cc := c.ConceptCounts(); cc["LL1"] == 0 {
		t.Fatalf("concept counts %v", cc)
	}
	// The ETag follows the bytes.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "curriculum"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(title string) string {
		doc := fmt.Sprintf(`{"module_id":"M1","title":{"en":%q},"phase_1_2_depth":"Deep","available_to":"all","vehicle_scope":"Both","concepts":{"authored":[]}}`, title)
		if err := os.WriteFile(filepath.Join(dir, "curriculum", "M1.json"), []byte(doc), 0o600); err != nil {
			t.Fatal(err)
		}
		c, err := LoadCatalog(dir)
		if err != nil {
			t.Fatal(err)
		}
		_, e := c.List("", "JK")
		return e
	}
	if a, b := write("one"), write("two"); a == b {
		t.Fatal("ETag did not change with the content")
	}
}
