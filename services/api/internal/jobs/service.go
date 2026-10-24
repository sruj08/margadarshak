package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/store"
)

// Jobs n8n may start through API-67 (allowlist; api/openapi.yaml startInternalJob).
var InternalJobs = map[string]bool{
	"case_clock_sweep": true, "clip_finalize": true, "nightly_stats": true, "debrief_backfill": true, "replay_pending_sessions": true,
	"retention_sweep": true,
}

// StepFunc is a business step that a Render Workflows task (TypeScript) calls back into the API
// for through POST /internal/job-steps/{step}: the task orchestrates, the Go core decides.
type StepFunc func(ctx context.Context, args map[string]any) (map[string]any, error)

// Service starts jobs on the configured runner and records them in ops.job_runs.
type Service struct {
	DB     *store.DB
	Runner ports.JobRunner
	Log    *slog.Logger
	Steps  map[string]StepFunc
}

// Run is the API view of a job run.
type Run struct {
	Job      string
	RunID    string
	Runner   string
	Status   string
	Replayed bool
}

// Start starts job with args under idemKey (derived from the input when empty). A repeated key
// returns the original run with Replayed=true.
func (s *Service) Start(ctx context.Context, tenant *string, job string, args []any, idemKey string) (Run, error) {
	raw, err := json.Marshal(argsOrEmpty(args))
	if err != nil {
		return Run{}, err
	}
	sum := sha256.Sum256(append([]byte(job+":"), raw...))
	if idemKey == "" {
		idemKey = fmt.Sprintf("%s:%x", job, sum[:12])
	}
	row := &store.JobRun{ID: ids.New(), TenantID: tenant, Job: job, Runner: s.Runner.Name(), IdempotencyKey: idemKey,
		InputHash: sum[:], Args: raw, Status: "started"}
	var replay bool
	if err := s.DB.System(ctx, func(tx pgx.Tx) error {
		replay, err = store.InsertJobRun(ctx, tx, row)
		return err
	}); err != nil {
		return Run{}, err
	}
	if replay {
		ext := ""
		if row.ExternalRunID != nil {
			ext = *row.ExternalRunID
		}
		return Run{Job: job, RunID: pick(ext, ids.Encode(ids.Run, row.ID)), Runner: row.Runner, Status: row.Status, Replayed: true}, nil
	}
	ref, err := s.Runner.Start(ctx, job, args, idemKey)
	if err != nil {
		msg := err.Error()
		_ = s.DB.System(context.WithoutCancel(ctx), func(tx pgx.Tx) error {
			return store.UpdateJobRun(ctx, tx, row.ID, "failed", 0, nil, nil, &msg)
		})
		return Run{}, err
	}
	ext := ref.RunID
	if err := s.DB.System(ctx, func(tx pgx.Tx) error {
		return store.UpdateJobRun(ctx, tx, row.ID, "started", 0, &ext, nil, nil)
	}); err != nil {
		return Run{}, err
	}
	s.Log.InfoContext(ctx, "job started", "job", job, "runner", s.Runner.Name(), "run_id", ref.RunID, "idempotency_key", idemKey)
	go s.track(context.WithoutCancel(ctx), row.ID, ref.RunID)
	return Run{Job: job, RunID: ref.RunID, Runner: s.Runner.Name(), Status: "started"}, nil
}

// track waits for the run (Workflows has no completion webhook) and records the outcome.
func (s *Service) track(ctx context.Context, rowID uuid.UUID, runID string) {
	ctx, cancel := context.WithTimeout(ctx, 24*time.Hour)
	defer cancel()
	st, err := s.Runner.Await(ctx, runID)
	if err != nil && !st.Terminal() {
		s.Log.WarnContext(ctx, "job tracking stopped", "run_id", runID, "err", err)
		return
	}
	var lastErr *string
	if st.Error != "" {
		lastErr = &st.Error
	}
	if err := s.DB.System(ctx, func(tx pgx.Tx) error {
		return store.UpdateJobRun(ctx, tx, rowID, st.Status, st.Attempts, nil, st.Result, lastErr)
	}); err != nil {
		s.Log.WarnContext(ctx, "job status write failed", "run_id", runID, "err", err)
		return
	}
	s.Log.InfoContext(ctx, "job finished", "run_id", runID, "status", st.Status, "attempts", st.Attempts)
}

// Status returns the recorded status of a run by idempotency key.
func (s *Service) Status(ctx context.Context, idemKey string) (*store.JobRun, error) {
	var out *store.JobRun
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = store.JobRunByKey(ctx, tx, idemKey)
		return err
	})
	return out, err
}

// ErrUnknownStep is returned for a step that is not registered.
var ErrUnknownStep = errors.New("jobs: unknown step")

// RunStep executes a registered business step.
func (s *Service) RunStep(ctx context.Context, step string, args map[string]any) (map[string]any, error) {
	fn, ok := s.Steps[step]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownStep, step)
	}
	return fn(ctx, args)
}

func pick(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// ---- Task and step catalogue ---------------------------------------------------------------

// Tasks returns the task bodies the inline runner executes. Under Render Workflows the same
// tasks are TypeScript (services/workflows) and call the steps through
// /internal/job-steps/{step}, so the logic lives once, in Go. extra holds the real task bodies
// (case_clock_sweep, retention_sweep) supplied by the composition root; the others are stubs.
func Tasks(extra map[string]TaskFunc) map[string]TaskFunc {
	stub := func(job string) TaskFunc {
		return func(context.Context, json.RawMessage) (json.RawMessage, error) {
			return json.Marshal(map[string]any{"job": job, "status": "stub", "note": "implemented in a later phase"})
		}
	}
	out := map[string]TaskFunc{
		"clip_finalize":           stub("clip_finalize"),
		"nightly_stats":           stub("nightly_stats"),
		"debrief_backfill":        stub("debrief_backfill"),
		"replay_pending_sessions": stub("replay_pending_sessions"),
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// TaskFromStep wraps a step as a task whose input is [args].
func TaskFromStep(step StepFunc) TaskFunc {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var a []map[string]any
		_ = json.Unmarshal(raw, &a)
		in := map[string]any{}
		if len(a) > 0 && a[0] != nil {
			in = a[0]
		}
		out, err := step(ctx, in)
		if err != nil {
			return nil, err
		}
		return json.Marshal(out)
	}
}

// Steps returns the business steps Workflows tasks may call (POST /internal/job-steps/{step}).
// extra (clock.plan_pages, clock.fire_batch, retention.sweep) comes from the composition root.
func Steps(db *store.DB, now func() time.Time, extra map[string]StepFunc) map[string]StepFunc {
	stub := func(step string) StepFunc {
		return func(context.Context, map[string]any) (map[string]any, error) {
			return map[string]any{"step": step, "status": "stub"}, nil
		}
	}
	out := map[string]StepFunc{
		// clock.due_page (legacy, P0): counts timeline events due by the server's IST date.
		"clock.due_page": func(ctx context.Context, args map[string]any) (map[string]any, error) {
			var tenants []string
			if ts, ok := args["tenants"].([]any); ok {
				for _, t := range ts {
					if s, ok := t.(string); ok {
						tenants = append(tenants, s)
					}
				}
			}
			asOf := now().In(istZone).Format(time.DateOnly)
			var due int64
			err := db.System(ctx, func(tx pgx.Tx) error {
				var err error
				due, err = store.CountDueTimelineEvents(ctx, tx, asOf, tenants)
				return err
			})
			if err != nil {
				return nil, err
			}
			return map[string]any{"as_of": asOf, "due": due, "fired": 0, "skipped_opt_out": 0, "failed": 0}, nil
		},
		"stats.nightly":           stub("stats.nightly"),
		"rulepack.reevaluate":     stub("rulepack.reevaluate"),
		"user.export_collect":     stub("user.export_collect"),
		"user.delete_purge":       stub("user.delete_purge"),
		"sessions.replay_pending": stub("sessions.replay_pending"),
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

var istZone = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return l
	}
	return time.FixedZone("IST", 5*3600+30*60)
}()
