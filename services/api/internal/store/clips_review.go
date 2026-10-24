package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
)

// ClipsStore also implements clips.ReviewStore: the W08 review tasks (content.clip_review_tasks)
// and the rating decision column (content.clip_ratings.decision).
var _ clips.ReviewStore = (*ClipsStore)(nil)

const reviewCols = `review_task_id, clip_id, version, stage, status, coalesce(assignee, ''), coalesce(exclude_rater, ''),
	n8n_execution_id, resume_url_enc, due_at, created_at, updated_at`

func reviewScan(row pgx.Row) (*clips.ReviewTask, error) {
	var t clips.ReviewTask
	if err := row.Scan(&t.ID, &t.ClipID, &t.Version, &t.Stage, &t.Status, &t.Assignee, &t.ExcludeRater, &t.ExecutionID,
		&t.ResumeURLSealed, &t.DueAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return nil, err
	}
	t.DueAt, t.CreatedAt, t.UpdatedAt = t.DueAt.UTC(), t.CreatedAt.UTC(), t.UpdatedAt.UTC()
	return &t, nil
}

// InsertReviewTask implements clips.ReviewStore (idempotent on clip, version, stage).
func (s *ClipsStore) InsertReviewTask(ctx context.Context, t *clips.ReviewTask) (*clips.ReviewTask, bool, error) {
	var out *clips.ReviewTask
	created := false
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO content.clip_review_tasks (review_task_id, clip_id, version, stage, status,
			  assignee, exclude_rater, n8n_execution_id, resume_url_enc, due_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, nullif($6, ''), nullif($7, ''), $8, $9, $10, $11, $12)
			ON CONFLICT (clip_id, version, stage) DO NOTHING`,
			t.ID, t.ClipID, t.Version, t.Stage, t.Status, t.Assignee, t.ExcludeRater, t.ExecutionID, t.ResumeURLSealed,
			t.DueAt, t.CreatedAt, t.UpdatedAt)
		if err != nil {
			return err
		}
		created = tag.RowsAffected() == 1
		out, err = reviewScan(tx.QueryRow(ctx, `SELECT `+reviewCols+` FROM content.clip_review_tasks
			WHERE clip_id = $1 AND version = $2 AND stage = $3`, t.ClipID, t.Version, t.Stage))
		return err
	})
	if err != nil {
		return nil, false, clipsErr("insert review task", err)
	}
	return out, created, nil
}

// ReviewTasks implements clips.ReviewStore (stage order).
func (s *ClipsStore) ReviewTasks(ctx context.Context, clipID string, version int) ([]*clips.ReviewTask, error) {
	var out []*clips.ReviewTask
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+reviewCols+` FROM content.clip_review_tasks
			WHERE clip_id = $1 AND version = $2 ORDER BY stage, created_at`, clipID, version)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			t, err := reviewScan(rows)
			if err != nil {
				return err
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, clipsErr("review tasks", err)
	}
	return out, nil
}

// UpdateReviewTask implements clips.ReviewStore (status, assignee, updated_at).
func (s *ClipsStore) UpdateReviewTask(ctx context.Context, t *clips.ReviewTask) error {
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE content.clip_review_tasks SET status = $2, assignee = nullif($3, ''), updated_at = $4
			WHERE review_task_id = $1`, t.ID, t.Status, t.Assignee, t.UpdatedAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	return clipsErr("update review task", err)
}

// SetRatingDecision implements clips.ReviewStore.
func (s *ClipsStore) SetRatingDecision(ctx context.Context, clipID string, version int, rater, decision string) error {
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE content.clip_ratings SET decision = $4 WHERE clip_id = $1 AND version = $2 AND rater = $3`,
			clipID, version, rater, decision)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
	return clipsErr("set rating decision", err)
}

// RatingDecisions implements clips.ReviewStore.
func (s *ClipsStore) RatingDecisions(ctx context.Context, clipID string, version int) (map[string]string, error) {
	out := map[string]string{}
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT rater, decision FROM content.clip_ratings WHERE clip_id = $1 AND version = $2`, clipID, version)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r, d string
			if err := rows.Scan(&r, &d); err != nil {
				return err
			}
			out[r] = d
		}
		return rows.Err()
	})
	if err != nil {
		return nil, clipsErr("rating decisions", err)
	}
	return out, nil
}

// ClipJobRun is the API view of a workflow run a clip started (ops.job_runs).
type ClipJobRun struct {
	Job    string
	RunID  string
	Runner string
	Status string
}

// ClipJobRuns looks up the job runs a clip recorded (clips.Clip.WorkflowRuns holds the runner's
// run IDs, or run_<ULID> when the runner returned none). Unknown IDs are skipped.
func ClipJobRuns(ctx context.Context, db *DB, runIDs []string) ([]ClipJobRun, error) {
	out := []ClipJobRun{}
	if len(runIDs) == 0 {
		return out, nil
	}
	err := db.System(ctx, func(tx pgx.Tx) error {
		for _, id := range runIDs {
			var r ClipJobRun
			var started time.Time
			err := tx.QueryRow(ctx, `SELECT job, runner, status, started_at FROM ops.job_runs
				WHERE external_run_id = $1 ORDER BY started_at DESC LIMIT 1`, id).Scan(&r.Job, &r.Runner, &r.Status, &started)
			if errors.Is(err, pgx.ErrNoRows) {
				if u, derr := ids.Decode(ids.Run, id); derr == nil {
					err = tx.QueryRow(ctx, `SELECT job, runner, status, started_at FROM ops.job_runs WHERE run_id = $1`, u).
						Scan(&r.Job, &r.Runner, &r.Status, &started)
				}
			}
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			r.RunID = id
			out = append(out, r)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("store: clip job runs: %w", err)
	}
	return out, nil
}
