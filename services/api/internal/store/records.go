package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Consent is E-15.
type Consent struct {
	ID                  uuid.UUID
	TenantID            string
	ApplicantID         uuid.UUID
	SubjectMemberID     *uuid.UUID
	Purpose             string
	DataCategories      []string
	Recipient           *string
	NoticeVersion       string
	Language            *string
	GrantedAt           time.Time
	ExpiresAt           *time.Time
	RevokedAt           *time.Time
	GuardianApplicantID *uuid.UUID
	Signature           []byte
}

const consentCols = `consent_id, tenant_id, applicant_id, subject_member_id, purpose, data_categories, recipient,
	notice_version, language, granted_at, expires_at, revoked_at, guardian_applicant_id, signature`

func scanConsent(row pgx.Row) (*Consent, error) {
	var c Consent
	if err := row.Scan(&c.ID, &c.TenantID, &c.ApplicantID, &c.SubjectMemberID, &c.Purpose, &c.DataCategories, &c.Recipient,
		&c.NoticeVersion, &c.Language, &c.GrantedAt, &c.ExpiresAt, &c.RevokedAt, &c.GuardianApplicantID, &c.Signature); err != nil {
		return nil, mapErr(err)
	}
	return &c, nil
}

// InsertConsent stores a granted artefact.
func InsertConsent(ctx context.Context, tx pgx.Tx, c *Consent) error {
	if c.DataCategories == nil {
		c.DataCategories = []string{}
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO privacy.consent_artefacts (consent_id, tenant_id, applicant_id, subject_member_id, purpose, data_categories,
		  recipient, notice_version, language, granted_at, expires_at, guardian_applicant_id, signature)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		c.ID, c.TenantID, c.ApplicantID, c.SubjectMemberID, c.Purpose, c.DataCategories, c.Recipient, c.NoticeVersion,
		c.Language, c.GrantedAt, c.ExpiresAt, c.GuardianApplicantID, c.Signature)
	return mapErr(err)
}

// ActiveConsent returns the active artefact for (applicant, purpose, recipient, subject).
func ActiveConsent(ctx context.Context, tx pgx.Tx, applicant uuid.UUID, purpose string, recipient *string, subject *uuid.UUID) (*Consent, error) {
	return scanConsent(tx.QueryRow(ctx, `SELECT `+consentCols+` FROM privacy.consent_artefacts
		WHERE applicant_id = $1 AND purpose = $2 AND coalesce(recipient, '') = coalesce($3, '')
		  AND subject_member_id IS NOT DISTINCT FROM $4 AND revoked_at IS NULL`, applicant, purpose, recipient, subject))
}

// RevokeConsent marks an artefact revoked.
func RevokeConsent(ctx context.Context, tx pgx.Tx, id uuid.UUID, at time.Time) error {
	_, err := tx.Exec(ctx, `UPDATE privacy.consent_artefacts SET revoked_at = $2 WHERE consent_id = $1 AND revoked_at IS NULL`, id, at)
	return mapErr(err)
}

// GetConsent loads one artefact.
func GetConsent(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Consent, error) {
	return scanConsent(tx.QueryRow(ctx, `SELECT `+consentCols+` FROM privacy.consent_artefacts WHERE consent_id = $1`, id))
}

// ListConsents returns all artefacts (active and revoked) of an applicant, newest first.
func ListConsents(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*Consent, error) {
	rows, err := tx.Query(ctx, `SELECT `+consentCols+` FROM privacy.consent_artefacts WHERE applicant_id = $1
		ORDER BY granted_at DESC, consent_id DESC`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Consent
	for rows.Next() {
		c, err := scanConsent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// (E-02 Case lives in cases.go.)

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orEmptyS(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

// ReconcilePaymentIntent applies a verified callback.
func ReconcilePaymentIntent(ctx context.Context, tx pgx.Tx, id uuid.UUID, status string, receiptEnc []byte, at time.Time) error {
	tag, err := tx.Exec(ctx, `UPDATE core.payment_intents SET status = $2, receipt_number_enc = coalesce($3, receipt_number_enc),
		callback_at = $4 WHERE payment_intent_id = $1`, id, status, receiptEnc, at)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// OAuthFlow is a pending OAuth 2.0 + PKCE authorisation (MD-038).
type OAuthFlow struct {
	State        string
	TenantID     string
	ApplicantID  uuid.UUID
	Provider     string
	CaseRef      *string
	Doctypes     []string
	CodeVerifier string
	RedirectURI  string
	ExpiresAt    time.Time
}

// InsertOAuthFlow stores a flow.
func InsertOAuthFlow(ctx context.Context, tx pgx.Tx, f *OAuthFlow) error {
	_, err := tx.Exec(ctx, `INSERT INTO ops.oauth_flows (state, tenant_id, applicant_id, provider, case_ref, doctypes,
		code_verifier, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		f.State, f.TenantID, f.ApplicantID, f.Provider, f.CaseRef, f.Doctypes, f.CodeVerifier, f.RedirectURI, f.ExpiresAt)
	return mapErr(err)
}

// ConsumeOAuthFlow marks a flow used and returns it (single use, unexpired).
func ConsumeOAuthFlow(ctx context.Context, tx pgx.Tx, state string, now time.Time) (*OAuthFlow, error) {
	var f OAuthFlow
	err := tx.QueryRow(ctx, `UPDATE ops.oauth_flows SET used_at = $2 WHERE state = $1 AND used_at IS NULL AND expires_at > $2
		RETURNING state, tenant_id, applicant_id, provider, case_ref, doctypes, code_verifier, redirect_uri, expires_at`, state, now).Scan(
		&f.State, &f.TenantID, &f.ApplicantID, &f.Provider, &f.CaseRef, &f.Doctypes, &f.CodeVerifier, &f.RedirectURI, &f.ExpiresAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &f, nil
}

// SeenInbound records an inbound event id; it returns true if it was already processed.
func SeenInbound(ctx context.Context, tx pgx.Tx, source, event, id string) (bool, error) {
	tag, err := tx.Exec(ctx, `INSERT INTO ops.inbound_events (source, event, event_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, source, event, id)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 0, nil
}
