package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Case is the E-02 row: the projection of the case event store (DATA_MODEL §5).
type Case struct {
	ID              uuid.UUID
	TenantID        string
	ApplicantID     uuid.UUID
	FamilyMemberID  *uuid.UUID
	State           string
	Path            *string
	Classes         []string
	Answers         map[string]any
	RulePackID      string
	RulePackVersion string
	KeyDates        map[string]string
	Flags           []string
	Facts           map[string]any
	DOBEnc          []byte
	DOBPrecision    *string
	PlanID          *uuid.UUID
	AppRefEnc       []byte
	AppStatus       map[string]any
	LastSeq         int
	Version         int
	DeletedAt       *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// InsertCase creates a case. Seeds pass a deterministic ID; a repeat insert is a no-op.
func InsertCase(ctx context.Context, tx pgx.Tx, c *Case) error {
	answers, _ := json.Marshal(orEmpty(c.Answers))
	keyDates, _ := json.Marshal(orEmptyS(c.KeyDates))
	facts, _ := json.Marshal(orEmpty(c.Facts))
	if c.State == "" {
		c.State = "PLAN"
	}
	if c.Classes == nil {
		c.Classes = []string{}
	}
	if c.Flags == nil {
		c.Flags = []string{}
	}
	if c.RulePackID == "" {
		c.RulePackID = c.TenantID
	}
	var status []byte
	if c.AppStatus != nil {
		status, _ = json.Marshal(c.AppStatus)
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO core.cases (case_id, tenant_id, applicant_id, family_member_id, state, path, classes, answers,
		  rule_pack_version, key_dates, flags, rule_pack_id, facts, dob_enc, dob_precision, plan_id, app_ref_enc, app_status, last_seq)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
		ON CONFLICT (case_id) DO NOTHING`,
		c.ID, c.TenantID, c.ApplicantID, c.FamilyMemberID, c.State, c.Path, c.Classes, answers, c.RulePackVersion, keyDates, c.Flags,
		c.RulePackID, facts, c.DOBEnc, c.DOBPrecision, c.PlanID, c.AppRefEnc, nullJSON(status), c.LastSeq)
	return mapErr(err)
}

const caseCols = `case_id, tenant_id, applicant_id, family_member_id, state, path, classes, answers, rule_pack_version, key_dates,
	flags, rule_pack_id, facts, dob_enc, dob_precision, plan_id, app_ref_enc, app_status, last_seq, version, deleted_at, created_at, updated_at`

func scanCase(row pgx.Row) (*Case, error) {
	var c Case
	var answers, keyDates, facts, status []byte
	err := row.Scan(&c.ID, &c.TenantID, &c.ApplicantID, &c.FamilyMemberID, &c.State, &c.Path, &c.Classes, &answers, &c.RulePackVersion,
		&keyDates, &c.Flags, &c.RulePackID, &facts, &c.DOBEnc, &c.DOBPrecision, &c.PlanID, &c.AppRefEnc, &status, &c.LastSeq, &c.Version,
		&c.DeletedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal(answers, &c.Answers)
	_ = json.Unmarshal(keyDates, &c.KeyDates)
	_ = json.Unmarshal(facts, &c.Facts)
	if len(status) > 0 {
		_ = json.Unmarshal(status, &c.AppStatus)
	}
	if c.Answers == nil {
		c.Answers = map[string]any{}
	}
	if c.KeyDates == nil {
		c.KeyDates = map[string]string{}
	}
	if c.Facts == nil {
		c.Facts = map[string]any{}
	}
	return &c, nil
}

// GetCase loads a case visible to the tenant (not deleted).
func GetCase(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Case, error) {
	return scanCase(tx.QueryRow(ctx, `SELECT `+caseCols+` FROM core.cases WHERE case_id = $1 AND deleted_at IS NULL`, id))
}

// GetCaseAny loads a case including soft-deleted ones (410 vs 404, sweeps).
func GetCaseAny(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Case, error) {
	return scanCase(tx.QueryRow(ctx, `SELECT `+caseCols+` FROM core.cases WHERE case_id = $1`, id))
}

// GetCaseForUpdate locks the case row (gapless event seq, DATA_MODEL §5 rule 2).
func GetCaseForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Case, error) {
	return scanCase(tx.QueryRow(ctx, `SELECT `+caseCols+` FROM core.cases WHERE case_id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
}

// SaveCase writes the projection and bumps the version.
func SaveCase(ctx context.Context, tx pgx.Tx, c *Case) error {
	answers, _ := json.Marshal(orEmpty(c.Answers))
	keyDates, _ := json.Marshal(orEmptyS(c.KeyDates))
	facts, _ := json.Marshal(orEmpty(c.Facts))
	var status []byte
	if c.AppStatus != nil {
		status, _ = json.Marshal(c.AppStatus)
	}
	if c.Flags == nil {
		c.Flags = []string{}
	}
	err := tx.QueryRow(ctx, `UPDATE core.cases SET state = $2, path = $3, classes = $4, answers = $5, key_dates = $6, flags = $7,
		facts = $8, app_ref_enc = $9, app_status = $10, last_seq = $11, version = version + 1
		WHERE case_id = $1 AND deleted_at IS NULL RETURNING version, updated_at`,
		c.ID, c.State, c.Path, c.Classes, answers, keyDates, c.Flags, facts, c.AppRefEnc, nullJSON(status), c.LastSeq).Scan(&c.Version, &c.UpdatedAt)
	return mapErr(err)
}

// CaseRef is a case id with its owner (lists).
type CaseRef struct {
	ID             uuid.UUID
	FamilyMemberID *uuid.UUID
	State          string
	Classes        []string
}

// CasesFor lists an applicant's open cases.
func CasesFor(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `SELECT case_id FROM core.cases WHERE applicant_id = $1 AND deleted_at IS NULL ORDER BY created_at`, applicant)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// OpenCasesFor lists an applicant's open cases with their state and classes.
func OpenCasesFor(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]CaseRef, error) {
	rows, err := tx.Query(ctx, `SELECT case_id, family_member_id, state, classes FROM core.cases
		WHERE applicant_id = $1 AND deleted_at IS NULL ORDER BY created_at, case_id`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CaseRef
	for rows.Next() {
		var r CaseRef
		if err := rows.Scan(&r.ID, &r.FamilyMemberID, &r.State, &r.Classes); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SoftDeleteCase marks a case deleted (API-17; hard delete by the retention job within 30 days).
func SoftDeleteCase(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	tag, err := tx.Exec(ctx, `UPDATE core.cases SET deleted_at = now(), flags = array_append(flags, 'deleted_pending'), version = version + 1
		WHERE case_id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

// SetCaseMember reassigns a case to a family member (nil = the account holder) with that
// subject's date of birth (API-12 family_member_id). The caller's UpdateCase bumps the version.
func SetCaseMember(ctx context.Context, tx pgx.Tx, caseID uuid.UUID, member *uuid.UUID, dobEnc []byte, dobPrecision *string) error {
	tag, err := tx.Exec(ctx, `UPDATE core.cases SET family_member_id = $2, dob_enc = $3, dob_precision = $4
		WHERE case_id = $1 AND deleted_at IS NULL`, caseID, member, dobEnc, dobPrecision)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

// CaseEvent is one row of the event store.
type CaseEvent struct {
	CaseID          uuid.UUID
	Seq             int
	TenantID        string
	Type            string
	Payload         map[string]any
	OccurredOn      *string
	RecordedAt      time.Time
	ActorKind       string
	ActorID         *uuid.UUID
	IdempotencyKey  string
	RulePackVersion string
	FromState       *string
	ToState         *string
}

// InsertCaseEvent appends an event. created=false means the key was already recorded and ev is
// replaced by the stored event.
func InsertCaseEvent(ctx context.Context, tx pgx.Tx, ev *CaseEvent) (created bool, err error) {
	payload, _ := json.Marshal(orEmpty(ev.Payload))
	tag, err := tx.Exec(ctx, `INSERT INTO core.case_events (case_id, seq, tenant_id, type, payload, occurred_on, recorded_at, actor_kind,
		actor_id, idempotency_key, rule_pack_version, from_state, to_state)
		VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (case_id, idempotency_key) DO NOTHING`,
		ev.CaseID, ev.Seq, ev.TenantID, ev.Type, payload, dateArg(ev.OccurredOn), ev.RecordedAt, ev.ActorKind, ev.ActorID, ev.IdempotencyKey,
		ev.RulePackVersion, ev.FromState, ev.ToState)
	if err != nil {
		return false, mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return true, nil
	}
	existing, err := CaseEventByKey(ctx, tx, ev.CaseID, ev.IdempotencyKey)
	if err != nil {
		return false, err
	}
	*ev = *existing
	return false, nil
}

const eventCols = `case_id, seq, tenant_id, type, payload, occurred_on::text, recorded_at, actor_kind, actor_id, idempotency_key,
	rule_pack_version, from_state, to_state`

func scanEvent(row pgx.Row) (*CaseEvent, error) {
	var e CaseEvent
	var payload []byte
	if err := row.Scan(&e.CaseID, &e.Seq, &e.TenantID, &e.Type, &payload, &e.OccurredOn, &e.RecordedAt, &e.ActorKind, &e.ActorID,
		&e.IdempotencyKey, &e.RulePackVersion, &e.FromState, &e.ToState); err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal(payload, &e.Payload)
	return &e, nil
}

// CaseEventByKey loads an event by its idempotency key.
func CaseEventByKey(ctx context.Context, tx pgx.Tx, caseID uuid.UUID, key string) (*CaseEvent, error) {
	return scanEvent(tx.QueryRow(ctx, `SELECT `+eventCols+` FROM core.case_events WHERE case_id = $1 AND idempotency_key = $2`, caseID, key))
}

// ListCaseEvents returns a case's events in order.
func ListCaseEvents(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) ([]*CaseEvent, error) {
	rows, err := tx.Query(ctx, `SELECT `+eventCols+` FROM core.case_events WHERE case_id = $1 ORDER BY seq`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*CaseEvent
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ClassSelection is E-03.
type ClassSelection struct {
	ClassCode    string
	Status       string
	Attempts     int
	EligibleFrom *string
}

// ReplaceClassSelections writes the case's class rows (upsert + remove dropped classes).
func ReplaceClassSelections(ctx context.Context, tx pgx.Tx, tenant string, caseID uuid.UUID, sel []ClassSelection) error {
	codes := make([]string, 0, len(sel))
	for _, s := range sel {
		codes = append(codes, s.ClassCode)
		if _, err := tx.Exec(ctx, `INSERT INTO core.class_selections (case_id, class_code, tenant_id, status, attempts, eligible_from)
			VALUES ($1, $2, $3, $4, $5, $6::date) ON CONFLICT (case_id, class_code) DO UPDATE SET status = EXCLUDED.status,
			attempts = EXCLUDED.attempts, eligible_from = EXCLUDED.eligible_from`, caseID, s.ClassCode, tenant, s.Status, s.Attempts, dateArg(s.EligibleFrom)); err != nil {
			return mapErr(err)
		}
	}
	_, err := tx.Exec(ctx, `DELETE FROM core.class_selections WHERE case_id = $1 AND NOT (class_code = ANY($2))`, caseID, codes)
	return mapErr(err)
}

// ListClassSelections returns the class rows of a case.
func ListClassSelections(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) ([]ClassSelection, error) {
	rows, err := tx.Query(ctx, `SELECT class_code, status, attempts, eligible_from::text FROM core.class_selections WHERE case_id = $1 ORDER BY class_code`, caseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClassSelection
	for rows.Next() {
		var s ClassSelection
		if err := rows.Scan(&s.ClassCode, &s.Status, &s.Attempts, &s.EligibleFrom); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// LLMirror is E-04 (never the LL number in clear).
type LLMirror struct {
	IssuedOn       string
	ExpiresOn      string
	Classes        []string
	NumberLast4Enc []byte
	Source         string
}

// UpsertLLMirror writes the LL mirror of a case.
func UpsertLLMirror(ctx context.Context, tx pgx.Tx, tenant string, caseID uuid.UUID, m LLMirror) error {
	if m.Classes == nil {
		m.Classes = []string{}
	}
	_, err := tx.Exec(ctx, `INSERT INTO core.ll_mirrors (case_id, tenant_id, issued_on, expires_on, classes, number_last4_enc, source)
		VALUES ($1, $2, $3::date, $4::date, $5, $6, $7) ON CONFLICT (case_id) DO UPDATE SET issued_on = EXCLUDED.issued_on,
		expires_on = EXCLUDED.expires_on, classes = EXCLUDED.classes, number_last4_enc = coalesce(EXCLUDED.number_last4_enc, core.ll_mirrors.number_last4_enc),
		source = EXCLUDED.source, updated_at = now()`, caseID, tenant, m.IssuedOn, m.ExpiresOn, m.Classes, m.NumberLast4Enc, m.Source)
	return mapErr(err)
}

// GetLLMirror loads the LL mirror of a case (ErrNotFound when none).
func GetLLMirror(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) (*LLMirror, error) {
	var m LLMirror
	err := tx.QueryRow(ctx, `SELECT issued_on::text, expires_on::text, classes, number_last4_enc, source FROM core.ll_mirrors WHERE case_id = $1`, caseID).
		Scan(&m.IssuedOn, &m.ExpiresOn, &m.Classes, &m.NumberLast4Enc, &m.Source)
	if err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}

// DLMirror is E-05.
type DLMirror struct {
	IssuedOn           *string
	ValidToNT          string
	ValidToTR          *string
	Classes            []string
	NumberLast4Enc     []byte
	RenewalWindowOpens *string
	Source             string
}

// UpsertDLMirror writes the DL mirror of a case.
func UpsertDLMirror(ctx context.Context, tx pgx.Tx, tenant string, caseID uuid.UUID, m DLMirror) error {
	if m.Classes == nil {
		m.Classes = []string{}
	}
	_, err := tx.Exec(ctx, `INSERT INTO core.dl_mirrors (case_id, tenant_id, issued_on, valid_to_nt, valid_to_tr, classes, number_last4_enc,
		renewal_window_opens, source) VALUES ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8::date, $9)
		ON CONFLICT (case_id) DO UPDATE SET issued_on = EXCLUDED.issued_on, valid_to_nt = EXCLUDED.valid_to_nt, valid_to_tr = EXCLUDED.valid_to_tr,
		classes = EXCLUDED.classes, number_last4_enc = coalesce(EXCLUDED.number_last4_enc, core.dl_mirrors.number_last4_enc),
		renewal_window_opens = EXCLUDED.renewal_window_opens, source = EXCLUDED.source, updated_at = now()`,
		caseID, tenant, dateArg(m.IssuedOn), m.ValidToNT, dateArg(m.ValidToTR), m.Classes, m.NumberLast4Enc, dateArg(m.RenewalWindowOpens), m.Source)
	return mapErr(err)
}

// GetDLMirror loads the DL mirror of a case (ErrNotFound when none).
func GetDLMirror(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) (*DLMirror, error) {
	var m DLMirror
	err := tx.QueryRow(ctx, `SELECT issued_on::text, valid_to_nt::text, valid_to_tr::text, classes, number_last4_enc, renewal_window_opens::text, source
		FROM core.dl_mirrors WHERE case_id = $1`, caseID).
		Scan(&m.IssuedOn, &m.ValidToNT, &m.ValidToTR, &m.Classes, &m.NumberLast4Enc, &m.RenewalWindowOpens, &m.Source)
	if err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}
