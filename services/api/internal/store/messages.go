package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// dateArg passes an IST calendar date ("YYYY-MM-DD") as a Postgres date, or NULL.
func dateArg(d *string) any {
	if d == nil || *d == "" {
		return nil
	}
	return *d
}

// Notification is E-13.
type Notification struct {
	ID                uuid.UUID
	TenantID          string
	ApplicantID       *uuid.UUID
	ContactID         *uuid.UUID
	TimelineEventID   *uuid.UUID
	Channel           string
	TemplateID        string
	TemplateVars      map[string]any
	Status            string
	Provider          *string
	ProviderMessageID *string
	ErrorCode         *string
	IdempotencyKey    string
	Kind              string  // nudge | transactional | fallback
	NudgeDay          *string // IST date of a nudge (one per applicant per day, MD-130)
	SeenAt            *time.Time
	CreatedAt         time.Time
}

// InsertNotification queues a notification; a duplicate idempotency key returns the existing row
// and created=false.
func InsertNotification(ctx context.Context, tx pgx.Tx, n *Notification) (created bool, err error) {
	vars, _ := json.Marshal(orEmpty(n.TemplateVars))
	if n.Kind == "" {
		n.Kind = "transactional"
	}
	var id uuid.UUID
	var status string
	err = tx.QueryRow(ctx, `
		WITH ins AS (
		  INSERT INTO msg.notifications (notification_id, tenant_id, applicant_id, contact_id, timeline_event_id, channel,
		    template_id, template_vars, status, idempotency_key, kind, nudge_day)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date)
		  ON CONFLICT (idempotency_key) DO NOTHING
		  RETURNING notification_id, status
		)
		SELECT notification_id, status FROM ins
		UNION ALL
		SELECT notification_id, status FROM msg.notifications WHERE idempotency_key = $10 AND NOT EXISTS (SELECT 1 FROM ins)`,
		n.ID, n.TenantID, n.ApplicantID, n.ContactID, n.TimelineEventID, n.Channel, n.TemplateID, vars, n.Status, n.IdempotencyKey,
		n.Kind, dateArg(n.NudgeDay)).Scan(&id, &status)
	if err != nil {
		return false, mapErr(err)
	}
	created = id == n.ID
	n.ID, n.Status = id, status
	return created, nil
}

// UpdateNotificationStatus records a delivery state change.
func UpdateNotificationStatus(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, provider, providerMsgID, errCode *string) error {
	tag, err := tx.Exec(ctx, `UPDATE msg.notifications SET status = $2, provider = coalesce($3, provider),
		provider_message_id = coalesce($4, provider_message_id), error_code = $5,
		seen_at = CASE WHEN $2 = 'read' THEN coalesce(seen_at, now()) ELSE seen_at END WHERE notification_id = $1`,
		id, status, provider, providerMsgID, errCode)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const notificationCols = `notification_id, tenant_id, applicant_id, contact_id, timeline_event_id, channel, template_id,
	template_vars, status, provider, provider_message_id, error_code, idempotency_key, kind, nudge_day::text, seen_at, created_at`

func scanNotification(row pgx.Row) (*Notification, error) {
	var n Notification
	var vars []byte
	err := row.Scan(&n.ID, &n.TenantID, &n.ApplicantID, &n.ContactID, &n.TimelineEventID, &n.Channel, &n.TemplateID, &vars, &n.Status,
		&n.Provider, &n.ProviderMessageID, &n.ErrorCode, &n.IdempotencyKey, &n.Kind, &n.NudgeDay, &n.SeenAt, &n.CreatedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal(vars, &n.TemplateVars)
	return &n, nil
}

func collectNotifications(rows pgx.Rows, err error) ([]*Notification, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Notification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// GetNotification loads one notification.
func GetNotification(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Notification, error) {
	return scanNotification(tx.QueryRow(ctx, `SELECT `+notificationCols+` FROM msg.notifications WHERE notification_id = $1`, id))
}

// NotificationByKey loads a notification by its idempotency key.
func NotificationByKey(ctx context.Context, tx pgx.Tx, key string) (*Notification, error) {
	return scanNotification(tx.QueryRow(ctx, `SELECT `+notificationCols+` FROM msg.notifications WHERE idempotency_key = $1`, key))
}

// NotificationsForTimelineEvent lists the notifications sent for a timeline event.
func NotificationsForTimelineEvent(ctx context.Context, tx pgx.Tx, id uuid.UUID) ([]*Notification, error) {
	return collectNotifications(tx.Query(ctx, `SELECT `+notificationCols+` FROM msg.notifications WHERE timeline_event_id = $1 ORDER BY created_at`, id))
}

// NotificationsForApplicant lists an applicant's notifications (export).
func NotificationsForApplicant(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*Notification, error) {
	return collectNotifications(tx.Query(ctx, `SELECT `+notificationCols+` FROM msg.notifications WHERE applicant_id = $1 ORDER BY created_at`, applicant))
}

// NudgeSentOn reports whether the applicant already got a nudge on the IST day (MD-130).
func NudgeSentOn(ctx context.Context, tx pgx.Tx, applicant uuid.UUID, day string) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM msg.notifications WHERE applicant_id = $1 AND kind = 'nudge' AND nudge_day = $2::date`,
		applicant, day).Scan(&n)
	return n > 0, mapErr(err)
}

// CancelQueuedNotifications cancels the queued notifications of an applicant, optionally only
// those of one case (EC-26: nothing is sent after a delete).
func CancelQueuedNotifications(ctx context.Context, tx pgx.Tx, applicant uuid.UUID, caseID *uuid.UUID) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE msg.notifications SET status = 'cancelled' WHERE applicant_id = $1 AND status = 'queued'
		AND ($2::uuid IS NULL OR timeline_event_id IN (SELECT timeline_event_id FROM core.timeline_events WHERE case_id = $2))`, applicant, caseID)
	if err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// PaymentIntent supports MD-041 / API-19.
type PaymentIntent struct {
	ID          uuid.UUID
	TenantID    string
	ApplicantID uuid.UUID
	CaseID      *uuid.UUID
	QuoteID     *uuid.UUID
	Stage       *string
	Adapter     string
	RedirectURL string
	ReturnPath  string
	AmountPaise int
	Status      string
	CallbackAt  *time.Time
	CreatedAt   time.Time
}

// InsertPaymentIntent stores an intent.
func InsertPaymentIntent(ctx context.Context, tx pgx.Tx, p *PaymentIntent) error {
	if p.ReturnPath == "" {
		p.ReturnPath = "/case/payment-return"
	}
	_, err := tx.Exec(ctx, `INSERT INTO core.payment_intents (payment_intent_id, tenant_id, applicant_id, case_id, adapter,
		redirect_url, return_path, amount_paise, status, quote_id, stage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (payment_intent_id) DO NOTHING`,
		p.ID, p.TenantID, p.ApplicantID, p.CaseID, p.Adapter, p.RedirectURL, p.ReturnPath, p.AmountPaise, p.Status, p.QuoteID, p.Stage)
	return mapErr(err)
}

const paymentCols = `payment_intent_id, tenant_id, applicant_id, case_id, quote_id, stage, adapter, redirect_url, return_path,
	amount_paise, status, callback_at, created_at`

func scanPayment(row pgx.Row) (*PaymentIntent, error) {
	var p PaymentIntent
	if err := row.Scan(&p.ID, &p.TenantID, &p.ApplicantID, &p.CaseID, &p.QuoteID, &p.Stage, &p.Adapter, &p.RedirectURL, &p.ReturnPath,
		&p.AmountPaise, &p.Status, &p.CallbackAt, &p.CreatedAt); err != nil {
		return nil, mapErr(err)
	}
	return &p, nil
}

// GetPaymentIntent loads an intent.
func GetPaymentIntent(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*PaymentIntent, error) {
	return scanPayment(tx.QueryRow(ctx, `SELECT `+paymentCols+` FROM core.payment_intents WHERE payment_intent_id = $1`, id))
}

// PaymentIntentsForApplicant lists an applicant's intents (export).
func PaymentIntentsForApplicant(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*PaymentIntent, error) {
	rows, err := tx.Query(ctx, `SELECT `+paymentCols+` FROM core.payment_intents WHERE applicant_id = $1 ORDER BY created_at`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*PaymentIntent
	for rows.Next() {
		p, err := scanPayment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// OpenPaymentForCase returns the newest intent of a case that is still pending at the gateway
// (EC-09: money debited, status pending - never send the user to pay twice).
func OpenPaymentForCase(ctx context.Context, tx pgx.Tx, caseID uuid.UUID) (*PaymentIntent, error) {
	return scanPayment(tx.QueryRow(ctx, `SELECT `+paymentCols+` FROM core.payment_intents WHERE case_id = $1 AND status = 'pending'
		ORDER BY created_at DESC LIMIT 1`, caseID))
}
