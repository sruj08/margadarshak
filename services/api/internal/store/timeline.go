package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TimelineEvent is E-12.
type TimelineEvent struct {
	ID             uuid.UUID
	TenantID       string
	CaseID         uuid.UUID
	Kind           string
	Code           string
	DueAt          *time.Time
	DueOn          *string // IST calendar date
	OccurredAt     *time.Time
	Status         string
	RuleID         *string
	IdempotencyKey string
	SourceSeq      *int
	CreatedAt      time.Time
}

// UpsertTimelineEvent inserts by idempotency key; a repeat with the same key is a no-op.
func UpsertTimelineEvent(ctx context.Context, tx pgx.Tx, e *TimelineEvent) (bool, error) {
	if e.Status == "" {
		e.Status = "scheduled"
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO core.timeline_events (timeline_event_id, tenant_id, case_id, kind, code, due_at, due_on, status, rule_id, idempotency_key, source_seq)
		VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11) ON CONFLICT (idempotency_key) DO NOTHING`,
		e.ID, e.TenantID, e.CaseID, e.Kind, e.Code, e.DueAt, dateArg(e.DueOn), e.Status, e.RuleID, e.IdempotencyKey, e.SourceSeq)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

const timelineCols = `timeline_event_id, tenant_id, case_id, kind, code, due_at, due_on::text, occurred_at, status, rule_id, idempotency_key,
	source_seq, created_at`

func scanTimeline(row pgx.Row) (*TimelineEvent, error) {
	var e TimelineEvent
	if err := row.Scan(&e.ID, &e.TenantID, &e.CaseID, &e.Kind, &e.Code, &e.DueAt, &e.DueOn, &e.OccurredAt, &e.Status, &e.RuleID,
		&e.IdempotencyKey, &e.SourceSeq, &e.CreatedAt); err != nil {
		return nil, mapErr(err)
	}
	return &e, nil
}

func collectTimeline(rows pgx.Rows, err error) ([]*TimelineEvent, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*TimelineEvent
	for rows.Next() {
		e, err := scanTimeline(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListTimeline returns all timeline rows of a case, by due date.
func ListTimeline(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) ([]*TimelineEvent, error) {
	return collectTimeline(tx.Query(ctx, `SELECT `+timelineCols+` FROM core.timeline_events WHERE case_id = $1
		ORDER BY coalesce(due_at, occurred_at), code`, caseID))
}

// TimelineByKey loads one row by idempotency key.
func TimelineByKey(ctx context.Context, tx pgx.Tx, key string) (*TimelineEvent, error) {
	return scanTimeline(tx.QueryRow(ctx, `SELECT `+timelineCols+` FROM core.timeline_events WHERE idempotency_key = $1`, key))
}

// LockTimelineByKey loads and locks one row (sweep, FOR UPDATE SKIP LOCKED is not used: a row
// another batch is firing waits, then sees the new status).
func LockTimelineByKey(ctx context.Context, tx pgx.Tx, key string) (*TimelineEvent, error) {
	return scanTimeline(tx.QueryRow(ctx, `SELECT `+timelineCols+` FROM core.timeline_events WHERE idempotency_key = $1 FOR UPDATE`, key))
}

// SetTimelineStatus changes a row's status.
func SetTimelineStatus(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string) error {
	_, err := tx.Exec(ctx, `UPDATE core.timeline_events SET status = $2 WHERE timeline_event_id = $1`, id, status)
	return mapErr(err)
}

// CancelScheduledTimeline cancels every scheduled row of a case (EC-26). Returns rows changed.
func CancelScheduledTimeline(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE core.timeline_events SET status = 'cancelled' WHERE case_id = $1 AND status = 'scheduled'`, caseID)
	if err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// DueRef is one due timeline row as the sweep sees it.
type DueRef struct {
	ID       uuid.UUID
	TenantID string
	CaseID   uuid.UUID
	Code     string
	DueOn    string
	Key      string
}

// DueTimelinePage returns scheduled rows due on or before asOf for live cases of live applicants,
// keyset-paginated by (due_on, id) after the cursor (System tx; all tenants or the listed ones).
func DueTimelinePage(ctx context.Context, tx pgx.Tx, asOf string, tenants []string, afterDue string, afterID uuid.UUID, limit int) ([]DueRef, error) {
	if tenants == nil {
		tenants = []string{}
	}
	rows, err := tx.Query(ctx, `SELECT t.timeline_event_id, t.tenant_id, t.case_id, t.code, t.due_on::text, t.idempotency_key
		FROM core.timeline_events t
		JOIN core.cases c ON c.case_id = t.case_id AND c.deleted_at IS NULL
		JOIN core.applicants a ON a.applicant_id = c.applicant_id AND a.deleted_at IS NULL
		WHERE t.status = 'scheduled' AND t.due_on IS NOT NULL AND t.due_on <= $1::date
		  AND (cardinality($2::text[]) = 0 OR t.tenant_id = ANY($2))
		  AND ($3 = '' OR (t.due_on, t.timeline_event_id) > ($3::date, $4::uuid))
		ORDER BY t.due_on, t.timeline_event_id
		LIMIT $5`, asOf, tenants, afterDue, afterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DueRef
	for rows.Next() {
		var r DueRef
		if err := rows.Scan(&r.ID, &r.TenantID, &r.CaseID, &r.Code, &r.DueOn, &r.Key); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountDueTimelineEvents counts scheduled rows due on or before the IST date asOf (System tx).
func CountDueTimelineEvents(ctx context.Context, tx pgx.Tx, asOf string, tenants []string) (int64, error) {
	if tenants == nil {
		tenants = []string{}
	}
	var n int64
	err := tx.QueryRow(ctx, `SELECT count(*) FROM core.timeline_events
		WHERE status = 'scheduled' AND due_on <= $1::date AND (cardinality($2::text[]) = 0 OR tenant_id = ANY($2))`, asOf, tenants).Scan(&n)
	return n, mapErr(err)
}
