package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Session is a device or account session. Only the SHA-256 of the token is stored.
type Session struct {
	ID              uuid.UUID
	TenantID        string
	ApplicantID     uuid.UUID
	Scope           string
	TokenHash       []byte
	Platform        *string
	AppVersion      *string
	DevicePublicKey *string
	CreatedAt       time.Time
	LastSeenAt      time.Time
	ExpiresAt       time.Time
	RevokedAt       *time.Time
}

// InsertSession stores a new session.
func InsertSession(ctx context.Context, tx pgx.Tx, s *Session) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO core.sessions (session_id, tenant_id, applicant_id, scope, token_hash, platform, app_version,
		  device_public_key, created_at, last_seen_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)`,
		s.ID, s.TenantID, s.ApplicantID, s.Scope, s.TokenHash, s.Platform, s.AppVersion, s.DevicePublicKey, s.CreatedAt, s.ExpiresAt)
	return mapErr(err)
}

// SessionByTokenHash returns an active session (not revoked, not expired at now).
func SessionByTokenHash(ctx context.Context, tx pgx.Tx, hash []byte, now time.Time) (*Session, error) {
	var s Session
	err := tx.QueryRow(ctx, `
		SELECT session_id, tenant_id, applicant_id, scope, token_hash, platform, app_version, device_public_key,
		       created_at, last_seen_at, expires_at, revoked_at
		FROM core.sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`, hash, now).Scan(
		&s.ID, &s.TenantID, &s.ApplicantID, &s.Scope, &s.TokenHash, &s.Platform, &s.AppVersion, &s.DevicePublicKey,
		&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt, &s.RevokedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &s, nil
}

// TouchSession slides the expiry (180-day sliding TTL) at most once a minute.
func TouchSession(ctx context.Context, tx pgx.Tx, id uuid.UUID, now time.Time, ttl time.Duration) error {
	_, err := tx.Exec(ctx, `UPDATE core.sessions SET last_seen_at = $2, expires_at = $3
		WHERE session_id = $1 AND last_seen_at < $2::timestamptz - interval '1 minute'`, id, now, now.Add(ttl))
	return mapErr(err)
}

// RevokeSession revokes one session.
func RevokeSession(ctx context.Context, tx pgx.Tx, id uuid.UUID, reason string) error {
	_, err := tx.Exec(ctx, `UPDATE core.sessions SET revoked_at = now(), revoke_reason = $2 WHERE session_id = $1 AND revoked_at IS NULL`, id, reason)
	return mapErr(err)
}

// RevokeAllSessions revokes every session of an applicant ("sign out everywhere").
func RevokeAllSessions(ctx context.Context, tx pgx.Tx, applicant uuid.UUID, reason string) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE core.sessions SET revoked_at = now(), revoke_reason = $2 WHERE applicant_id = $1 AND revoked_at IS NULL`, applicant, reason)
	if err != nil {
		return 0, mapErr(err)
	}
	return tag.RowsAffected(), nil
}

// MagicLink is a single-use sign-in code (only its hash is stored).
type MagicLink struct {
	ID              uuid.UUID
	TenantID        string
	CodeHash        []byte
	EmailEnc        []byte
	EmailBlindIndex []byte
	DeviceSessionID *uuid.UUID
	Language        *string
	ExpiresAt       time.Time
	UsedAt          *time.Time
}

// InsertMagicLink stores a link and invalidates older unused links for the same address.
func InsertMagicLink(ctx context.Context, tx pgx.Tx, m *MagicLink) error {
	if _, err := tx.Exec(ctx, `UPDATE core.magic_links SET used_at = now()
		WHERE email_blind_index = $1 AND used_at IS NULL`, m.EmailBlindIndex); err != nil {
		return mapErr(err)
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO core.magic_links (link_id, tenant_id, code_hash, email_enc, email_blind_index, device_session_id, language, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		m.ID, m.TenantID, m.CodeHash, m.EmailEnc, m.EmailBlindIndex, m.DeviceSessionID, m.Language, m.ExpiresAt)
	return mapErr(err)
}

// ConsumeMagicLink marks the link used and returns it, if it exists, is unused and unexpired.
// The UPDATE ... RETURNING makes it single-use even under concurrent redemption.
func ConsumeMagicLink(ctx context.Context, tx pgx.Tx, codeHash []byte, now time.Time) (*MagicLink, error) {
	var m MagicLink
	err := tx.QueryRow(ctx, `
		UPDATE core.magic_links SET used_at = $2
		WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2
		RETURNING link_id, tenant_id, code_hash, email_enc, email_blind_index, device_session_id, language, expires_at, used_at`,
		codeHash, now).Scan(&m.ID, &m.TenantID, &m.CodeHash, &m.EmailEnc, &m.EmailBlindIndex, &m.DeviceSessionID, &m.Language, &m.ExpiresAt, &m.UsedAt)
	if err != nil {
		return nil, mapErr(err)
	}
	return &m, nil
}
