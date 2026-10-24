package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Applicant is E-01 (the account holder or an anonymous device).
type Applicant struct {
	ID              uuid.UUID
	TenantID        string
	Kind            string // device | account
	AuthSubjectHash []byte
	UserBand        string // u18 | adult | unknown
	AgeBand         *string
	DOBEnc          []byte
	DOBPrecision    *string
	Language        string
	A11y            map[string]bool
	QuietHours      map[string]string
	Flags           []string
	MergedInto      *uuid.UUID
	DeletedAt       *time.Time
	Version         int
	CreatedAt       time.Time
}

const applicantCols = `applicant_id, tenant_id, kind, auth_subject_hash, user_band, age_band, dob_enc,
	dob_precision, language, a11y, quiet_hours, flags, merged_into, deleted_at, version, created_at`

func scanApplicant(row pgx.Row) (*Applicant, error) {
	var a Applicant
	var a11y, quiet []byte
	if err := row.Scan(&a.ID, &a.TenantID, &a.Kind, &a.AuthSubjectHash, &a.UserBand, &a.AgeBand, &a.DOBEnc,
		&a.DOBPrecision, &a.Language, &a11y, &quiet, &a.Flags, &a.MergedInto, &a.DeletedAt, &a.Version, &a.CreatedAt); err != nil {
		return nil, mapErr(err)
	}
	_ = json.Unmarshal(a11y, &a.A11y)
	_ = json.Unmarshal(quiet, &a.QuietHours)
	return &a, nil
}

// InsertApplicant creates an applicant.
func InsertApplicant(ctx context.Context, tx pgx.Tx, a *Applicant) error {
	if a.Language == "" {
		a.Language = "en"
	}
	if a.UserBand == "" {
		a.UserBand = "unknown"
	}
	if a.Flags == nil {
		a.Flags = []string{}
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO core.applicants (applicant_id, tenant_id, kind, auth_subject_hash, user_band, age_band,
		  dob_enc, dob_precision, language, flags, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
		a.ID, a.TenantID, a.Kind, a.AuthSubjectHash, a.UserBand, a.AgeBand, a.DOBEnc, a.DOBPrecision, a.Language, a.Flags)
	return mapErr(err)
}

// GetApplicant loads one applicant visible to the tenant.
func GetApplicant(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Applicant, error) {
	return scanApplicant(tx.QueryRow(ctx, `SELECT `+applicantCols+` FROM core.applicants WHERE applicant_id = $1`, id))
}

// GetApplicantBySubject finds an account by its auth subject hash.
func GetApplicantBySubject(ctx context.Context, tx pgx.Tx, hash []byte) (*Applicant, error) {
	return scanApplicant(tx.QueryRow(ctx, `SELECT `+applicantCols+` FROM core.applicants
		WHERE auth_subject_hash = $1 AND deleted_at IS NULL`, hash))
}

// ApplicantUpdate holds the mutable profile fields (nil = unchanged).
type ApplicantUpdate struct {
	Language     *string
	A11y         map[string]bool
	QuietHours   map[string]string
	DOBEnc       []byte
	DOBPrecision *string
	AgeBand      *string
	UserBand     *string
}

// UpdateApplicant applies a partial update and bumps the version.
func UpdateApplicant(ctx context.Context, tx pgx.Tx, id uuid.UUID, u ApplicantUpdate) error {
	var a11y, quiet []byte
	if u.A11y != nil {
		a11y, _ = json.Marshal(u.A11y)
	}
	if u.QuietHours != nil {
		quiet, _ = json.Marshal(u.QuietHours)
	}
	tag, err := tx.Exec(ctx, `
		UPDATE core.applicants SET
		  language = coalesce($2, language),
		  a11y = coalesce($3::jsonb, a11y),
		  quiet_hours = coalesce($4::jsonb, quiet_hours),
		  dob_enc = coalesce($5, dob_enc),
		  dob_precision = coalesce($6, dob_precision),
		  age_band = coalesce($7, age_band),
		  user_band = coalesce($8, user_band),
		  version = version + 1
		WHERE applicant_id = $1 AND deleted_at IS NULL`,
		id, u.Language, nullJSON(a11y), nullJSON(quiet), u.DOBEnc, u.DOBPrecision, u.AgeBand, u.UserBand)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func nullJSON(b []byte) *string {
	if b == nil {
		return nil
	}
	s := string(b)
	return &s
}

// UpgradeToAccount turns a device applicant into an account (first sign-in on this device).
func UpgradeToAccount(ctx context.Context, tx pgx.Tx, id uuid.UUID, subjectHash []byte) error {
	tag, err := tx.Exec(ctx, `UPDATE core.applicants SET kind = 'account', auth_subject_hash = $2,
		user_band = CASE WHEN user_band = 'unknown' THEN 'adult' ELSE user_band END, version = version + 1
		WHERE applicant_id = $1 AND kind = 'device'`, id, subjectHash)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MergeDeviceInto moves a device applicant's data (cases) to an existing account and marks the
// device applicant merged. "Account linking keeps the case" (MD-048).
func MergeDeviceInto(ctx context.Context, tx pgx.Tx, device, account uuid.UUID) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE core.cases SET applicant_id = $2, version = version + 1 WHERE applicant_id = $1`, device, account)
	if err != nil {
		return 0, mapErr(err)
	}
	// Plans, payment intents and notifications follow the cases (P1).
	for _, q := range []string{`UPDATE core.plans SET applicant_id = $2 WHERE applicant_id = $1`,
		`UPDATE core.payment_intents SET applicant_id = $2 WHERE applicant_id = $1`,
		`UPDATE msg.notifications SET applicant_id = $2 WHERE applicant_id = $1`} {
		if _, err := tx.Exec(ctx, q, device, account); err != nil {
			return 0, mapErr(err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE core.applicants SET merged_into = $2, version = version + 1 WHERE applicant_id = $1`, device, account); err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// SoftDeleteApplicant marks an applicant deleted (DPDP erasure; hard delete by a job ≤ 30 days).
func SoftDeleteApplicant(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE core.applicants SET deleted_at = now(), flags = array_append(flags, 'deletion_pending') WHERE applicant_id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return mapErr(err)
	}
	_, err = tx.Exec(ctx, `UPDATE core.cases SET deleted_at = now() WHERE applicant_id = $1 AND deleted_at IS NULL`, id)
	return mapErr(err)
}

// FamilyMember is E-01 family mode: a person whose journey the adult account manages.
type FamilyMember struct {
	ID                    uuid.UUID
	TenantID              string
	ApplicantID           uuid.UUID
	Relation              string
	LabelEnc              []byte
	DOBEnc                []byte
	DOBPrecision          string
	AgeBand               string
	IsMinor               bool
	ParentalConsentStatus string
	ParentalConsentID     *uuid.UUID
	CreatedAt             time.Time
	// ParentalExtras are the parent's extra consents (squads, share_cards, pair_mode; P2).
	ParentalExtras []string
}

const familyCols = `member_id, tenant_id, applicant_id, relation, label_enc, dob_enc, dob_precision, age_band,
	is_minor, parental_consent_status, parental_consent_id, created_at, parental_extras`

func scanFamily(row pgx.Row) (*FamilyMember, error) {
	var m FamilyMember
	if err := row.Scan(&m.ID, &m.TenantID, &m.ApplicantID, &m.Relation, &m.LabelEnc, &m.DOBEnc, &m.DOBPrecision,
		&m.AgeBand, &m.IsMinor, &m.ParentalConsentStatus, &m.ParentalConsentID, &m.CreatedAt, &m.ParentalExtras); err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}

// InsertFamilyMember adds a member.
func InsertFamilyMember(ctx context.Context, tx pgx.Tx, m *FamilyMember) error {
	err := tx.QueryRow(ctx, `
		INSERT INTO core.family_members (member_id, tenant_id, applicant_id, relation, label_enc, dob_enc,
		  dob_precision, age_band, is_minor, parental_consent_status, parental_consent_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (member_id) DO UPDATE SET member_id = EXCLUDED.member_id
		RETURNING created_at`,
		m.ID, m.TenantID, m.ApplicantID, m.Relation, m.LabelEnc, m.DOBEnc, m.DOBPrecision, m.AgeBand, m.IsMinor,
		m.ParentalConsentStatus, m.ParentalConsentID).Scan(&m.CreatedAt)
	return mapErr(err)
}

// ListFamilyMembers returns the account's members, oldest first.
func ListFamilyMembers(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*FamilyMember, error) {
	rows, err := tx.Query(ctx, `SELECT `+familyCols+` FROM core.family_members
		WHERE applicant_id = $1 AND deleted_at IS NULL ORDER BY created_at, member_id`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*FamilyMember
	for rows.Next() {
		m, err := scanFamily(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetFamilyMember loads one member owned by applicant.
func GetFamilyMember(ctx context.Context, tx pgx.Tx, applicant, member uuid.UUID) (*FamilyMember, error) {
	return scanFamily(tx.QueryRow(ctx, `SELECT `+familyCols+` FROM core.family_members
		WHERE member_id = $1 AND applicant_id = $2 AND deleted_at IS NULL`, member, applicant))
}

// SetParentalConsent records the consent state of a minor member.
func SetParentalConsent(ctx context.Context, tx pgx.Tx, member uuid.UUID, status string, consentID *uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE core.family_members SET parental_consent_status = $2,
		parental_consent_id = coalesce($3, parental_consent_id) WHERE member_id = $1`, member, status, consentID)
	return mapErr(err)
}

// Contact is E-14 (encrypted at the application layer).
type Contact struct {
	ID               uuid.UUID
	TenantID         string
	ApplicantID      uuid.UUID
	Kind             string
	ValueEnc         []byte
	BlindIndex       []byte
	OptedOutChannels []string
}

// UpsertContact stores a contact; an existing (kind, blind index) row is reused.
func UpsertContact(ctx context.Context, tx pgx.Tx, c *Contact) error {
	err := tx.QueryRow(ctx, `
		INSERT INTO privacy.contacts (contact_id, tenant_id, applicant_id, kind, value_enc, blind_index, verified_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (tenant_id, kind, blind_index) DO UPDATE SET applicant_id = EXCLUDED.applicant_id, verified_at = now()
		RETURNING contact_id, opted_out_channels`,
		c.ID, c.TenantID, c.ApplicantID, c.Kind, c.ValueEnc, c.BlindIndex).Scan(&c.ID, &c.OptedOutChannels)
	return mapErr(err)
}

// OptOutByBlindIndex records a channel opt-out (STOP, EC-30). Returns rows changed.
func OptOutByBlindIndex(ctx context.Context, tx pgx.Tx, kind string, blind []byte, channel string) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE privacy.contacts SET opted_out_channels = array_append(opted_out_channels, $3)
		WHERE kind = $1 AND blind_index = $2 AND NOT ($3 = ANY(opted_out_channels))`, kind, blind, channel)
	if err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// ContactsFor lists an applicant's contacts.
func ContactsFor(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) ([]*Contact, error) {
	rows, err := tx.Query(ctx, `SELECT contact_id, tenant_id, applicant_id, kind, value_enc, blind_index, opted_out_channels
		FROM privacy.contacts WHERE applicant_id = $1 ORDER BY created_at`, applicant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Contact
	for rows.Next() {
		var c Contact
		if err := rows.Scan(&c.ID, &c.TenantID, &c.ApplicantID, &c.Kind, &c.ValueEnc, &c.BlindIndex, &c.OptedOutChannels); err != nil {
			return nil, err
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}

// ParentalExtras returns the parent's extra consents for a member (squads, share_cards,
// pair_mode; core.family_members.parental_extras, P2).
func ParentalExtras(ctx context.Context, tx pgx.Tx, applicant, member uuid.UUID) ([]string, error) {
	var out []string
	err := tx.QueryRow(ctx, `SELECT parental_extras FROM core.family_members
		WHERE member_id = $1 AND applicant_id = $2 AND deleted_at IS NULL`, member, applicant).Scan(&out)
	return out, mapErr(err)
}

// SetParentalExtras replaces the parent's extra consents for a member.
func SetParentalExtras(ctx context.Context, tx pgx.Tx, member uuid.UUID, extras []string) error {
	if extras == nil {
		extras = []string{}
	}
	_, err := tx.Exec(ctx, `UPDATE core.family_members SET parental_extras = $2 WHERE member_id = $1`, member, extras)
	return mapErr(err)
}
