package jobs_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/jobs"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// flakyTask fails on its first attempt (injected failure), then doubles its input.
func flakyTask(calls *atomic.Int64) jobs.TaskFunc {
	return func(_ context.Context, args json.RawMessage) (json.RawMessage, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("injected failure")
		}
		var in []int
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]int{"doubled": in[0] * 2})
	}
}

func noSleep(time.Duration) {}

func TestInlineRetryAndIdempotency(t *testing.T) {
	var calls atomic.Int64
	r := jobs.NewInline(map[string]jobs.TaskFunc{"double": flakyTask(&calls)}, ports.DefaultRetry)
	r.Sleep = noSleep
	ctx := context.Background()
	ref, err := r.Start(ctx, "double", []any{21}, "double:21")
	if err != nil {
		t.Fatal(err)
	}
	again, err := r.Start(ctx, "double", []any{21}, "double:21")
	if err != nil || again.RunID != ref.RunID {
		t.Fatalf("same idempotency key must return the same run: %v %v", again, err)
	}
	st, err := r.Await(ctx, ref.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != "succeeded" || st.Attempts != 2 || !strings.Contains(string(st.Result), `"doubled":42`) {
		t.Fatalf("retry not applied: %+v (%s)", st, st.Result)
	}
	if calls.Load() != 2 {
		t.Fatalf("task ran %d times, want 2 (one injected failure + one success)", calls.Load())
	}
}

func TestInlineGivesUpAfterMaxRetries(t *testing.T) {
	r := jobs.NewInline(map[string]jobs.TaskFunc{"boom": func(context.Context, json.RawMessage) (json.RawMessage, error) {
		return nil, errors.New("always")
	}}, ports.RetryPolicy{MaxRetries: 2, Wait: time.Millisecond, BackoffScaling: 2})
	r.Sleep = noSleep
	ref, _ := r.Start(context.Background(), "boom", nil, "")
	st, _ := r.Await(context.Background(), ref.RunID)
	if st.Status != "failed" || st.Attempts != 3 {
		t.Fatalf("%+v", st)
	}
	if _, err := r.Start(context.Background(), "nope", nil, ""); !errors.Is(err, jobs.ErrUnknownTask) {
		t.Fatalf("unknown task: %v", err)
	}
}

// fakeRender imitates the Render task-runs API and executes the SAME task functions the inline
// runner uses, with the same retry policy, so one task body is proven under both runners.
type fakeRender struct {
	tasks map[string]jobs.TaskFunc
	mu    sync.Mutex
	runs  map[string]map[string]any
	auth  string
	idem  string
	n     int
}

func (f *fakeRender) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.auth = r.Header.Get("Authorization")
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/task-runs":
		var body struct {
			Task  string          `json:"task"`
			Input json.RawMessage `json:"input"`
			Idem  string          `json:"idempotencyKey"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.idem = body.Idem
		slug, task, _ := strings.Cut(body.Task, "/")
		fn, ok := f.tasks[task]
		if slug != "mg-workflows" || !ok {
			http.Error(w, `{"message":"task not found"}`, http.StatusNotFound)
			return
		}
		f.n++
		id := "trn-" + string(rune('a'+f.n))
		run := map[string]any{"id": id, "status": "running"}
		retries := 0
		for attempt := 0; attempt <= ports.DefaultRetry.MaxRetries; attempt++ {
			res, err := fn(r.Context(), body.Input)
			if err == nil {
				run["status"], run["results"], run["retries"] = "completed", json.RawMessage(res), retries
				break
			}
			retries++
			run["status"], run["error"] = "failed", err.Error()
		}
		f.runs[id] = run
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": "pending"})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/task-runs/"):
		run, ok := f.runs[strings.TrimPrefix(r.URL.Path, "/v1/task-runs/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(run)
	default:
		http.NotFound(w, r)
	}
}

func TestSameTaskCodeUnderInlineAndRenderWorkflows(t *testing.T) {
	ctx := context.Background()
	var inlineCalls, renderCalls atomic.Int64
	inline := jobs.NewInline(map[string]jobs.TaskFunc{"double": flakyTask(&inlineCalls)}, ports.DefaultRetry)
	inline.Sleep = noSleep
	fake := &fakeRender{tasks: map[string]jobs.TaskFunc{"double": flakyTask(&renderCalls)}, runs: map[string]map[string]any{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	render := &jobs.RenderWorkflows{BaseURL: srv.URL, APIKey: "rnd_test", Slug: "mg-workflows", Poll: time.Millisecond}

	var results []string
	for _, runner := range []ports.JobRunner{inline, render} {
		ref, err := runner.Start(ctx, "double", []any{21}, "k")
		if err != nil {
			t.Fatalf("%s: %v", runner.Name(), err)
		}
		st, err := runner.Await(ctx, ref.RunID)
		if err != nil || st.Status != "succeeded" || st.Attempts != 2 {
			t.Fatalf("%s: %+v %v", runner.Name(), st, err)
		}
		results = append(results, string(st.Result))
	}
	if results[0] != results[1] {
		t.Fatalf("runners disagree: %s vs %s", results[0], results[1])
	}
	// SDK 1.4.0 supports idempotencyKey on start (24 h, per workflow): the runner sends ours.
	if fake.idem != "k" {
		t.Fatalf("idempotencyKey not sent: %q", fake.idem)
	}
	if fake.auth != "Bearer rnd_test" {
		t.Fatalf("render API key not sent: %q", fake.auth)
	}
	if _, err := render.Start(ctx, "missing", nil, ""); ports.KindOf(err) != ports.KindNotFound {
		t.Fatalf("unknown render task: %v", err)
	}
}
