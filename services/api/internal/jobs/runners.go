// Package jobs implements the JobRunner port (MD-052, D-15) and the job service that records
// runs in ops.job_runs:
//
//   - Inline: runs registered task functions in-process with the Workflows retry policy (dev,
//     CI, and the degraded demo mode if Render Workflows is unavailable, risk R-11).
//   - RenderWorkflows: starts runs of the TypeScript tasks in services/workflows through the
//     Render API (POST /v1/task-runs, GET /v1/task-runs/{id}). The real call is UNTESTED against
//     Render: it is exercised only against a local fake in tests (see runners_test.go).
//   - Temporal: production design only (INFRASTRUCTURE §4.5); not built.
//
// Task code is the same under every runner: tasks are idempotent by input and read state from
// Postgres, so a retry or duplicate trigger never double-fires an effect.
package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// TaskFunc is a task body. args is the JSON array of task arguments.
type TaskFunc func(ctx context.Context, args json.RawMessage) (json.RawMessage, error)

// ErrUnknownTask is returned for a task that is not registered.
var ErrUnknownTask = errors.New("jobs: unknown task")

// ---- Inline ------------------------------------------------------------------------------------

type inlineRun struct {
	status ports.RunStatus
	done   chan struct{}
}

// Inline runs tasks in-process.
type Inline struct {
	Tasks map[string]TaskFunc
	Retry ports.RetryPolicy
	// Sleep is replaceable in tests.
	Sleep func(time.Duration)

	mu    sync.Mutex
	runs  map[string]*inlineRun
	byKey map[string]string
}

// NewInline returns an inline runner for tasks.
func NewInline(tasks map[string]TaskFunc, retry ports.RetryPolicy) *Inline {
	return &Inline{Tasks: tasks, Retry: retry, Sleep: time.Sleep, runs: map[string]*inlineRun{}, byKey: map[string]string{}}
}

// Name implements ports.JobRunner.
func (r *Inline) Name() string { return "inline" }

// Start implements ports.JobRunner.
func (r *Inline) Start(ctx context.Context, task string, args []any, idemKey string) (ports.RunRef, error) {
	fn, ok := r.Tasks[task]
	if !ok {
		return ports.RunRef{}, fmt.Errorf("%w: %s", ErrUnknownTask, task)
	}
	raw, err := json.Marshal(argsOrEmpty(args))
	if err != nil {
		return ports.RunRef{}, err
	}
	r.mu.Lock()
	if id, ok := r.byKey[idemKey]; ok && idemKey != "" {
		run := r.runs[id]
		r.mu.Unlock()
		return run.status.RunRef, nil
	}
	ref := ports.RunRef{RunID: ids.Encode(ids.Run, ids.New()), Runner: "inline"}
	ref.ExternalRunID = ref.RunID
	run := &inlineRun{status: ports.RunStatus{RunRef: ref, Status: "started"}, done: make(chan struct{})}
	r.runs[ref.RunID] = run
	if idemKey != "" {
		r.byKey[idemKey] = ref.RunID
	}
	r.mu.Unlock()

	go r.execute(context.WithoutCancel(ctx), run, fn, raw)
	return ref, nil
}

func (r *Inline) execute(ctx context.Context, run *inlineRun, fn TaskFunc, args json.RawMessage) {
	defer close(run.done)
	wait := r.Retry.Wait
	for attempt := 1; ; attempt++ {
		r.set(run, func(s *ports.RunStatus) { s.Status, s.Attempts = "running", attempt })
		res, err := safeCall(ctx, fn, args)
		if err == nil {
			r.set(run, func(s *ports.RunStatus) { s.Status, s.Result, s.Error = "succeeded", res, "" })
			return
		}
		if attempt > r.Retry.MaxRetries {
			r.set(run, func(s *ports.RunStatus) { s.Status, s.Error = "failed", err.Error() })
			return
		}
		r.set(run, func(s *ports.RunStatus) { s.Error = err.Error() })
		r.Sleep(wait)
		if r.Retry.BackoffScaling > 0 {
			wait = time.Duration(float64(wait) * r.Retry.BackoffScaling)
		}
	}
}

func safeCall(ctx context.Context, fn TaskFunc, args json.RawMessage) (res json.RawMessage, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("task panic: %v", p)
		}
	}()
	return fn(ctx, args)
}

func (r *Inline) set(run *inlineRun, f func(*ports.RunStatus)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(&run.status)
}

// Get implements ports.JobRunner.
func (r *Inline) Get(_ context.Context, runID string) (ports.RunStatus, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.runs[runID]
	if !ok {
		return ports.RunStatus{}, ports.E("jobs", "Get", ports.KindNotFound, runID)
	}
	return run.status, nil
}

// Await implements ports.JobRunner.
func (r *Inline) Await(ctx context.Context, runID string) (ports.RunStatus, error) {
	r.mu.Lock()
	run, ok := r.runs[runID]
	r.mu.Unlock()
	if !ok {
		return ports.RunStatus{}, ports.E("jobs", "Await", ports.KindNotFound, runID)
	}
	select {
	case <-run.done:
		return r.Get(ctx, runID)
	case <-ctx.Done():
		return r.Get(ctx, runID)
	}
}

func argsOrEmpty(a []any) []any {
	if a == nil {
		return []any{}
	}
	return a
}

// ---- Render Workflows -----------------------------------------------------------------------

// RenderWorkflows starts runs of services/workflows tasks via the Render REST API.
//
// UNTESTED against Render: request shape per Render's "Triggering task runs" docs
// (POST https://api.render.com/v1/task-runs {"task": "<workflow-slug>/<task>", "input": [...],
// "idempotencyKey": "<our key>"}, 202; GET /v1/task-runs/{id}); Workflows is in public beta and
// the API may change. Render has no completion webhook, so status is polled. Starting a run does
// take an idempotency key (SDK @renderinc/sdk 1.4.0: idempotencyKey, kept 24 h, scoped per
// workflow): we send our input-derived key, and the job service also dedupes by the same key in
// ops.job_runs before calling Start, so a key older than Render's 24 h is still not re-run.
type RenderWorkflows struct {
	BaseURL string // https://api.render.com, or the local task server with RENDER_USE_LOCAL_DEV
	APIKey  string
	Slug    string
	HTTP    *http.Client
	Poll    time.Duration
}

// Name implements ports.JobRunner.
func (r *RenderWorkflows) Name() string { return "render_workflows" }

type renderRun struct {
	ID      string          `json:"id"`
	Status  string          `json:"status"`
	Results json.RawMessage `json:"results,omitempty"`
	Output  json.RawMessage `json:"output,omitempty"`
	Error   string          `json:"error,omitempty"`
	Retries int             `json:"retries,omitempty"`
}

func (r *RenderWorkflows) client() *http.Client {
	if r.HTTP != nil {
		return r.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (r *RenderWorkflows) do(ctx context.Context, method, path string, body any) (*renderRun, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(r.BaseURL, "/")+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if r.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+r.APIKey)
	}
	resp, err := r.client().Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, ports.E("jobs", "render", ports.KindTimeout, "render api timeout")
		}
		return nil, ports.E("jobs", "render", ports.KindUnavailable, "render api unreachable")
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, ports.E("jobs", "render", ports.KindNotFound, "task run not found")
	case resp.StatusCode >= 500:
		return nil, ports.E("jobs", "render", ports.KindUnavailable, fmt.Sprintf("render api %d", resp.StatusCode))
	case resp.StatusCode >= 400:
		return nil, ports.E("jobs", "render", ports.KindInvalid, fmt.Sprintf("render api %d", resp.StatusCode))
	}
	var out renderRun
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, ports.E("jobs", "render", ports.KindInvalid, "unexpected render api response")
	}
	return &out, nil
}

// Start implements ports.JobRunner.
func (r *RenderWorkflows) Start(ctx context.Context, task string, args []any, idemKey string) (ports.RunRef, error) {
	body := map[string]any{"task": r.Slug + "/" + task, "input": argsOrEmpty(args)}
	if idemKey != "" {
		body["idempotencyKey"] = idemKey
	}
	run, err := r.do(ctx, http.MethodPost, "/v1/task-runs", body)
	if err != nil {
		return ports.RunRef{}, err
	}
	if run.ID == "" {
		return ports.RunRef{}, ports.E("jobs", "render", ports.KindInvalid, "render api returned no run id")
	}
	return ports.RunRef{RunID: run.ID, ExternalRunID: run.ID, Runner: "render_workflows"}, nil
}

// Get implements ports.JobRunner.
func (r *RenderWorkflows) Get(ctx context.Context, runID string) (ports.RunStatus, error) {
	run, err := r.do(ctx, http.MethodGet, "/v1/task-runs/"+runID, nil)
	if err != nil {
		return ports.RunStatus{}, err
	}
	res := run.Results
	if len(res) == 0 {
		res = run.Output
	}
	return ports.RunStatus{
		RunRef:   ports.RunRef{RunID: runID, ExternalRunID: runID, Runner: "render_workflows"},
		Status:   mapRenderStatus(run.Status),
		Attempts: run.Retries + 1,
		Result:   res,
		Error:    run.Error,
	}, nil
}

// Await implements ports.JobRunner by polling (Workflows has no completion webhook).
func (r *RenderWorkflows) Await(ctx context.Context, runID string) (ports.RunStatus, error) {
	poll := r.Poll
	if poll == 0 {
		poll = 2 * time.Second
	}
	for {
		st, err := r.Get(ctx, runID)
		if err != nil || st.Terminal() {
			return st, err
		}
		select {
		case <-ctx.Done():
			return st, ctx.Err()
		case <-time.After(poll):
		}
	}
}

func mapRenderStatus(s string) string {
	switch strings.ToLower(s) {
	case "completed", "succeeded", "success", "successful":
		return "succeeded"
	case "failed", "error", "errored":
		return "failed"
	case "canceled", "cancelled":
		return "cancelled"
	case "running", "in_progress":
		return "running"
	default:
		return "started"
	}
}
