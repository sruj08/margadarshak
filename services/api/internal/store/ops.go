package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// JobRun is a row of ops.job_runs (MD-052).
type JobRun struct {
	ID             uuid.UUID
	TenantID       *string
	Job            string
	Runner         string
	IdempotencyKey string
	InputHash      []byte
	Args           json.RawMessage
	Status         string
	Attempts       int
	ExternalRunID  *string
	Result         json.RawMessage
	LastError      *string
	StartedAt      time.Time
	FinishedAt     *time.Time
}

// InsertJobRun records a run; when the idempotency key exists the existing run is returned with
// replay=true.
func InsertJobRun(ctx context.Context, tx pgx.Tx, r *JobRun) (replay bool, err error) {
	if len(r.Args) == 0 {
		r.Args = json.RawMessage("[]")
	}
	tag, err := tx.Exec(ctx, `INSERT INTO ops.job_runs (run_id, tenant_id, job, runner, idempotency_key, input_hash, args, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (idempotency_key) DO NOTHING`,
		r.ID, r.TenantID, r.Job, r.Runner, r.IdempotencyKey, r.InputHash, []byte(r.Args), r.Status)
	if err != nil {
		return false, mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return false, nil
	}
	existing, err := JobRunByKey(ctx, tx, r.IdempotencyKey)
	if err != nil {
		return false, err
	}
	*r = *existing
	return true, nil
}

const jobCols = `run_id, tenant_id, job, runner, idempotency_key, input_hash, args, status, attempts, external_run_id,
	result, last_error, started_at, finished_at`

func scanJob(row pgx.Row) (*JobRun, error) {
	var r JobRun
	var args, result []byte
	if err := row.Scan(&r.ID, &r.TenantID, &r.Job, &r.Runner, &r.IdempotencyKey, &r.InputHash, &args, &r.Status, &r.Attempts,
		&r.ExternalRunID, &result, &r.LastError, &r.StartedAt, &r.FinishedAt); err != nil {
		return nil, mapErr(err)
	}
	r.Args, r.Result = args, result
	return &r, nil
}

// JobRunByKey loads a run by idempotency key.
func JobRunByKey(ctx context.Context, tx pgx.Tx, key string) (*JobRun, error) {
	return scanJob(tx.QueryRow(ctx, `SELECT `+jobCols+` FROM ops.job_runs WHERE idempotency_key = $1`, key))
}

// GetJobRun loads a run by id.
func GetJobRun(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*JobRun, error) {
	return scanJob(tx.QueryRow(ctx, `SELECT `+jobCols+` FROM ops.job_runs WHERE run_id = $1`, id))
}

// UpdateJobRun writes the latest status of a run.
func UpdateJobRun(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, attempts int, external *string, result json.RawMessage, lastErr *string) error {
	var finished *time.Time
	if status == "succeeded" || status == "failed" || status == "cancelled" {
		now := time.Now().UTC()
		finished = &now
	}
	var res []byte
	if len(result) > 0 {
		res = result
	}
	_, err := tx.Exec(ctx, `UPDATE ops.job_runs SET status = $2, attempts = greatest(attempts, $3),
		external_run_id = coalesce($4, external_run_id), result = coalesce($5, result), last_error = $6,
		finished_at = coalesce($7, finished_at) WHERE run_id = $1`, id, status, attempts, external, res, lastErr, finished)
	return mapErr(err)
}

// ReplayCache is a Postgres-backed hmacsig.ReplayCache shared by all API instances.
type ReplayCache struct{ DB *DB }

// Seen implements hmacsig.ReplayCache.
func (c ReplayCache) Seen(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	var seen bool
	err := c.DB.System(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM ops.replay_cache WHERE expires_at < now()`); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO ops.replay_cache (key, expires_at) VALUES ($1, now() + make_interval(secs => $2))
			ON CONFLICT (key) DO NOTHING`, key, ttl.Seconds())
		if err != nil {
			return err
		}
		seen = tag.RowsAffected() == 0
		return nil
	})
	return seen, err
}
