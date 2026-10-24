package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Plan is an API-01 snapshot (7 days; no personal data in clear).
type Plan struct {
	ID              uuid.UUID
	TenantID        string
	ApplicantID     *uuid.UUID
	State           string
	Request         map[string]any
	DOBEnc          []byte
	DOBPrecision    *string
	AgeBand         *string
	RulePackVersion string
	Result          json.RawMessage
	CreatedAt       time.Time
	ExpiresAt       time.Time
}

// InsertPlan stores a plan snapshot.
func InsertPlan(ctx context.Context, tx pgx.Tx, p *Plan) error {
	req, _ := json.Marshal(orEmpty(p.Request))
	_, err := tx.Exec(ctx, `INSERT INTO core.plans (plan_id, tenant_id, applicant_id, state, request, dob_enc, dob_precision, age_band,
		rule_pack_version, result, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		p.ID, p.TenantID, p.ApplicantID, p.State, req, p.DOBEnc, p.DOBPrecision, p.AgeBand, p.RulePackVersion, []byte(p.Result), p.CreatedAt, p.ExpiresAt)
	return mapErr(err)
}

// GetPlan loads an unexpired plan.
func GetPlan(ctx context.Context, tx pgx.Tx, id uuid.UUID, now time.Time) (*Plan, error) {
	var p Plan
	var req, res []byte
	err := tx.QueryRow(ctx, `SELECT plan_id, tenant_id, applicant_id, state, request, dob_enc, dob_precision, age_band, rule_pack_version,
		result, created_at, expires_at FROM core.plans WHERE plan_id = $1 AND expires_at > $2`, id, now).Scan(
		&p.ID, &p.TenantID, &p.ApplicantID, &p.State, &req, &p.DOBEnc, &p.DOBPrecision, &p.AgeBand, &p.RulePackVersion, &res, &p.CreatedAt, &p.ExpiresAt)
	if err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal(req, &p.Request)
	p.Result = res
	return &p, nil
}

// PlansForApplicant lists the plan ids an applicant made (export, erasure).
func PlansForApplicant(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*Plan, error) {
	rows, err := tx.Query(ctx, `SELECT plan_id, state, request, created_at, expires_at FROM core.plans WHERE applicant_id = $1 ORDER BY created_at`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Plan
	for rows.Next() {
		var p Plan
		var req []byte
		if err := rows.Scan(&p.ID, &p.State, &req, &p.CreatedAt, &p.ExpiresAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(req, &p.Request)
		out = append(out, &p)
	}
	return out, rows.Err()
}

// FeeQuote is E-07 (integer paise, computed from fees.json).
type FeeQuote struct {
	ID                   uuid.UUID
	TenantID             string
	CaseID               *uuid.UUID
	PlanID               *uuid.UUID
	State                string
	RulePackVersion      string
	Classes              []string
	Lines                json.RawMessage
	LLStagePaise         int64
	SubtotalGovtFeePaise int64
	TotalPaise           int64
	Excludes             []string
	CreatedAt            time.Time
	ExpiresAt            *time.Time
}

// InsertFeeQuote stores a quote.
func InsertFeeQuote(ctx context.Context, tx pgx.Tx, q *FeeQuote) error {
	if q.Excludes == nil {
		q.Excludes = []string{}
	}
	_, err := tx.Exec(ctx, `INSERT INTO core.fee_quotes (quote_id, tenant_id, case_id, plan_id, state, rule_pack_version, classes, lines,
		ll_stage_paise, subtotal_govt_fee_paise, total_paise, excludes, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (quote_id) DO NOTHING`,
		q.ID, q.TenantID, q.CaseID, q.PlanID, q.State, q.RulePackVersion, q.Classes, []byte(q.Lines), q.LLStagePaise, q.SubtotalGovtFeePaise,
		q.TotalPaise, q.Excludes, q.CreatedAt, q.ExpiresAt)
	return mapErr(err)
}

const quoteCols = `quote_id, tenant_id, case_id, plan_id, state, rule_pack_version, classes, lines, ll_stage_paise, subtotal_govt_fee_paise,
	total_paise, excludes, created_at, expires_at`

func scanQuote(row pgx.Row) (*FeeQuote, error) {
	var q FeeQuote
	var lines []byte
	if err := row.Scan(&q.ID, &q.TenantID, &q.CaseID, &q.PlanID, &q.State, &q.RulePackVersion, &q.Classes, &lines, &q.LLStagePaise,
		&q.SubtotalGovtFeePaise, &q.TotalPaise, &q.Excludes, &q.CreatedAt, &q.ExpiresAt); err != nil {
		return nil, mapErr(err)
	}
	q.Lines = lines
	return &q, nil
}

// GetFeeQuote loads a quote.
func GetFeeQuote(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*FeeQuote, error) {
	return scanQuote(tx.QueryRow(ctx, `SELECT `+quoteCols+` FROM core.fee_quotes WHERE quote_id = $1`, id))
}

// LatestCaseQuote returns the newest quote of a case.
func LatestCaseQuote(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) (*FeeQuote, error) {
	return scanQuote(tx.QueryRow(ctx, `SELECT `+quoteCols+` FROM core.fee_quotes WHERE case_id = $1 ORDER BY created_at DESC, quote_id DESC LIMIT 1`, caseID))
}

// ---- Idempotency keys (BACKEND §13) --------------------------------------------------------

// IdemRecord is a stored response for an Idempotency-Key.
type IdemRecord struct {
	Method        string
	Path          string
	RequestSHA256 []byte
	StatusCode    *int
	Headers       map[string]string
	Body          []byte
	CreatedAt     time.Time
}

// ClaimIdempotencyKey claims (tenant, scope, key). claimed=false returns the existing record.
// Records older than ttl are replaced.
func ClaimIdempotencyKey(ctx context.Context, tx pgx.Tx, tenant, scope, key, method, path string, sum []byte, ttl time.Duration) (claimed bool, rec *IdemRecord, err error) {
	if _, err := tx.Exec(ctx, `DELETE FROM ops.idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3 AND created_at < now() - make_interval(secs => $4)`,
		tenant, scope, key, ttl.Seconds()); err != nil {
		return false, nil, mapErr(err)
	}
	tag, err := tx.Exec(ctx, `INSERT INTO ops.idempotency_keys (tenant_id, scope, key, method, path, request_sha256)
		VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, tenant, scope, key, method, path, sum)
	if err != nil {
		return false, nil, mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return true, nil, nil
	}
	var r IdemRecord
	var hdr []byte
	err = tx.QueryRow(ctx, `SELECT method, path, request_sha256, status_code, response_headers, response_body, created_at
		FROM ops.idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3`, tenant, scope, key).Scan(
		&r.Method, &r.Path, &r.RequestSHA256, &r.StatusCode, &hdr, &r.Body, &r.CreatedAt)
	if err != nil {
		return false, nil, mapErr(err)
	}
	if len(hdr) > 0 {
		_ = json.Unmarshal(hdr, &r.Headers)
	}
	return false, &r, nil
}

// CompleteIdempotencyKey stores the response of a claimed key.
func CompleteIdempotencyKey(ctx context.Context, tx pgx.Tx, tenant, scope, key string, status int, headers map[string]string, body []byte) error {
	hdr, _ := json.Marshal(headers)
	_, err := tx.Exec(ctx, `UPDATE ops.idempotency_keys SET status_code = $4, response_headers = $5, response_body = $6
		WHERE tenant_id = $1 AND scope = $2 AND key = $3`, tenant, scope, key, status, hdr, body)
	return mapErr(err)
}

// ReleaseIdempotencyKey drops a claim (the request failed with a 5xx and may be retried).
func ReleaseIdempotencyKey(ctx context.Context, tx pgx.Tx, tenant, scope, key string) error {
	_, err := tx.Exec(ctx, `DELETE FROM ops.idempotency_keys WHERE tenant_id = $1 AND scope = $2 AND key = $3 AND status_code IS NULL`, tenant, scope, key)
	return mapErr(err)
}

// ---- Analytics (MD-136) --------------------------------------------------------------------

// AnalyticsEvent is one stored, allowlisted, pseudonymous event.
type AnalyticsEvent struct {
	TenantID  string
	Day       string
	Name      string
	Props     map[string]any
	Pseudonym []byte
}

// InsertAnalyticsEvents stores events (System tx; platform table).
func InsertAnalyticsEvents(ctx context.Context, tx pgx.Tx, evs []AnalyticsEvent) error {
	for _, e := range evs {
		props, _ := json.Marshal(orEmpty(e.Props))
		if _, err := tx.Exec(ctx, `INSERT INTO ops.analytics_events (tenant_id, day, name, props, pseudonym) VALUES ($1, $2::date, $3, $4, $5)`,
			e.TenantID, e.Day, e.Name, props, e.Pseudonym); err != nil {
			return mapErr(err)
		}
	}
	return nil
}

// ---- Counters (API-71) ---------------------------------------------------------------------

// IncrementCounter adds delta to a public counter (System tx).
func IncrementCounter(ctx context.Context, tx pgx.Tx, tenant, name string, delta int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO ops.counters (tenant_id, name, value) VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id, name) DO UPDATE SET value = ops.counters.value + EXCLUDED.value`, tenant, name, delta)
	return mapErr(err)
}

// Counters returns the counters of a tenant.
func Counters(ctx context.Context, tx pgx.Tx, tenant string) (map[string]int64, error) {
	rows, err := tx.Query(ctx, `SELECT name, value FROM ops.counters WHERE tenant_id = $1`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var n string
		var v int64
		if err := rows.Scan(&n, &v); err != nil {
			return nil, err
		}
		out[n] = v
	}
	return out, rows.Err()
}

// ---- Exports (API-61) ----------------------------------------------------------------------

// InsertExport stores an encrypted export bundle.
func InsertExport(ctx context.Context, tx pgx.Tx, id uuid.UUID, tenant string, applicant uuid.UUID, bundle []byte, created, expires time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO privacy.exports (export_id, tenant_id, applicant_id, bundle_enc, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)`, id, tenant, applicant, bundle, created, expires)
	return mapErr(err)
}

// ErrExpired is returned for an export past its link life.
var ErrExpired = errors.New("store: expired")

// GetExport loads an export of applicant.
func GetExport(ctx context.Context, tx pgx.Tx, id, applicant uuid.UUID, now time.Time) ([]byte, time.Time, error) {
	var b []byte
	var exp time.Time
	err := tx.QueryRow(ctx, `SELECT bundle_enc, expires_at FROM privacy.exports WHERE export_id = $1 AND applicant_id = $2`, id, applicant).Scan(&b, &exp)
	if err != nil {
		return nil, time.Time{}, mapErr(err)
	}
	if !exp.After(now) {
		return nil, exp, ErrExpired
	}
	return b, exp, nil
}

// ---- Field-study lab (API-70) ----------------------------------------------------------------

// LabTrial is a study.lab_trials row.
type LabTrial struct {
	ID               uuid.UUID
	TenantID         string
	ParticipantCode  string
	Arm              string
	TaskID           string
	StartedAt        time.Time
	EndedAt          time.Time
	Errors           int
	Completed        bool
	SUSScore         *float64
	WouldPayAgent    *bool
	ConsentID        uuid.UUID
	ScreensVisited   *int
	BackNavigations  *int
	ValidationErrors *int
	Selections       []string
}

// InsertLabTrial stores a trial.
func InsertLabTrial(ctx context.Context, tx pgx.Tx, t *LabTrial) error {
	if t.Selections == nil {
		t.Selections = []string{}
	}
	_, err := tx.Exec(ctx, `INSERT INTO study.lab_trials (trial_id, tenant_id, participant_code, arm, task_id, started_at, ended_at, errors,
		completed, sus_score, would_pay_agent, consent_id, screens_visited, back_navigations, validation_errors, selections)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		t.ID, t.TenantID, t.ParticipantCode, t.Arm, t.TaskID, t.StartedAt, t.EndedAt, t.Errors, t.Completed, t.SUSScore, t.WouldPayAgent,
		t.ConsentID, t.ScreensVisited, t.BackNavigations, t.ValidationErrors, t.Selections)
	return mapErr(err)
}

// LabArmStats is the per-arm aggregate of one task.
type LabArmStats struct {
	Arm           string
	Participants  int
	MedianSeconds float64
}

// LabStats aggregates completed trials of a task per arm (System tx).
func LabStats(ctx context.Context, tx pgx.Tx, tenant, task string) ([]LabArmStats, error) {
	rows, err := tx.Query(ctx, `SELECT arm, count(DISTINCT participant_code),
		coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ended_at - started_at)), 0)
		FROM study.lab_trials WHERE tenant_id = $1 AND task_id = $2 AND completed GROUP BY arm ORDER BY arm`, tenant, task)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LabArmStats
	for rows.Next() {
		var s LabArmStats
		if err := rows.Scan(&s.Arm, &s.Participants, &s.MedianSeconds); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// LabParticipants counts distinct participants of a tenant.
func LabParticipants(ctx context.Context, tx pgx.Tx, tenant string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(DISTINCT participant_code) FROM study.lab_trials WHERE tenant_id = $1`, tenant).Scan(&n)
	return n, mapErr(err)
}
