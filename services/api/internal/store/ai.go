package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/learner"
)

// GetDebrief returns the stored card of a session in a locale, or ErrNotFound.
func GetDebrief(ctx context.Context, tx pgx.Tx, sessionID uuid.UUID, locale string) (json.RawMessage, error) {
	var card json.RawMessage
	err := tx.QueryRow(ctx, `SELECT card FROM game.debriefs WHERE session_id = $1 AND locale = $2`, sessionID, locale).Scan(&card)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: get debrief: %w", err)
	}
	return card, nil
}

// PutDebrief stores an AI-worded or AI-failed card once (the first writer wins).
func PutDebrief(ctx context.Context, tx pgx.Tx, tenant string, sessionID uuid.UUID, locale, source, status string, card any, at time.Time) error {
	raw, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("store: put debrief: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO game.debriefs (tenant_id, session_id, locale, source, status, card, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id, locale) DO NOTHING`,
		tenant, sessionID, locale, source, status, raw, at)
	if err != nil {
		return fmt.Errorf("store: put debrief: %w", err)
	}
	return nil
}

// PrevFindingIDs returns the finding IDs of the subject's checked session of gameID verified just
// before sessionID (for improved_since_last), or nil.
func PrevFindingIDs(ctx context.Context, tx pgx.Tx, subj learner.Subject, gameID string, sessionID uuid.UUID) ([]string, error) {
	var raw json.RawMessage
	err := tx.QueryRow(ctx, `SELECT s.server_result FROM game.sessions s
		WHERE s.tenant_id = $1 AND s.applicant_id = $2 AND s.family_member_id IS NOT DISTINCT FROM $3::uuid
		  AND s.game_id = $4 AND s.status = 'checked' AND s.session_id <> $5 AND s.server_result IS NOT NULL
		  AND s.verified_at < (SELECT verified_at FROM game.sessions WHERE session_id = $5)
		ORDER BY s.verified_at DESC LIMIT 1`, subj.Tenant, subj.ApplicantID, subj.MemberID, gameID, sessionID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: previous findings: %w", err)
	}
	var doc struct {
		Findings []struct {
			FindingID string `json:"findingId"`
		} `json:"findings"`
	}
	_ = json.Unmarshal(raw, &doc) // a malformed result has no findings
	var out []string
	for _, f := range doc.Findings {
		out = append(out, f.FindingID)
	}
	return out, nil
}

// PendingDebrief is a checked session whose holder allows AI and that has no stored card (RW-3).
type PendingDebrief struct {
	Tenant    string
	SessionID uuid.UUID
	Locale    string
}

// ListPendingDebriefs returns up to limit such sessions verified after since, oldest first, across
// tenants (System transaction). The holder's language picks the locale; Dogri is template-only.
func ListPendingDebriefs(ctx context.Context, tx pgx.Tx, since time.Time, limit int) ([]PendingDebrief, error) {
	rows, err := tx.Query(ctx, `SELECT s.tenant_id, s.session_id, a.language FROM game.sessions s
		JOIN core.tenants t ON t.tenant_id = s.tenant_id
		JOIN core.applicants a ON a.applicant_id = s.applicant_id
		WHERE s.status = 'checked' AND s.verified_at > $1 AND a.language IN ('en', 'hi')
		  AND coalesce((t.features->>'ai_coach')::boolean, false)
		  AND NOT EXISTS (SELECT 1 FROM game.debriefs d WHERE d.session_id = s.session_id)
		  AND EXISTS (SELECT 1 FROM privacy.consent_artefacts c WHERE c.applicant_id = s.applicant_id
		      AND c.purpose = 'ai_coach' AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()))
		ORDER BY s.verified_at, s.session_id LIMIT $2`, since, limit)
	if err != nil {
		return nil, fmt.Errorf("store: pending debriefs: %w", err)
	}
	defer rows.Close()
	var out []PendingDebrief
	for rows.Next() {
		var p PendingDebrief
		if err := rows.Scan(&p.Tenant, &p.SessionID, &p.Locale); err != nil {
			return nil, fmt.Errorf("store: pending debriefs: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: pending debriefs: %w", err)
	}
	return out, nil
}

// ReviewItem is an AI-worded card offered to a human rater.
type ReviewItem struct {
	ItemID string
	Card   json.RawMessage
}

// SampleDebriefsForReview returns up to n AI-worded cards of the tenant the rater has not rated,
// newest first.
func SampleDebriefsForReview(ctx context.Context, tx pgx.Tx, tenant, rater string, n int) ([]ReviewItem, error) {
	rows, err := tx.Query(ctx, `SELECT d.session_id::text || ':' || d.locale, d.card FROM game.debriefs d
		WHERE d.tenant_id = $1 AND d.source = 'ai'
		  AND NOT EXISTS (SELECT 1 FROM ai.reviews r WHERE r.tenant_id = d.tenant_id AND r.agent = 'debrief'
		      AND r.item_id = d.session_id::text || ':' || d.locale AND r.rater = $2)
		ORDER BY d.created_at DESC LIMIT $3`, tenant, rater, n)
	if err != nil {
		return nil, fmt.Errorf("store: review sample: %w", err)
	}
	defer rows.Close()
	var out []ReviewItem
	for rows.Next() {
		var it ReviewItem
		if err := rows.Scan(&it.ItemID, &it.Card); err != nil {
			return nil, fmt.Errorf("store: review sample: %w", err)
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: review sample: %w", err)
	}
	return out, nil
}

// Review is one human rating.
type Review struct {
	Tenant, Agent, ItemID, Rater string
	Grounding, Tone, Usefulness  int
	At                           time.Time
}

// InsertReview stores a rating; a second rating of the same item by the same rater is ErrConflict.
func InsertReview(ctx context.Context, tx pgx.Tx, r Review) error {
	_, err := tx.Exec(ctx, `INSERT INTO ai.reviews (tenant_id, agent, item_id, rater, grounding, tone, usefulness, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, r.Tenant, r.Agent, r.ItemID, r.Rater, r.Grounding, r.Tone, r.Usefulness, r.At)
	if err != nil {
		return mapErr(err)
	}
	return nil
}

// ListReviews returns every rating of an agent in the tenant, by item then rater.
func ListReviews(ctx context.Context, tx pgx.Tx, tenant, agent string) ([]Review, error) {
	rows, err := tx.Query(ctx, `SELECT item_id, rater, grounding, tone, usefulness, created_at FROM ai.reviews
		WHERE tenant_id = $1 AND agent = $2 ORDER BY item_id, rater`, tenant, agent)
	if err != nil {
		return nil, fmt.Errorf("store: reviews: %w", err)
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		r := Review{Tenant: tenant, Agent: agent}
		if err := rows.Scan(&r.ItemID, &r.Rater, &r.Grounding, &r.Tone, &r.Usefulness, &r.At); err != nil {
			return nil, fmt.Errorf("store: reviews: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: reviews: %w", err)
	}
	return out, nil
}

// UpsertIntention stores the learner's intention for a drill this week (a second one replaces it).
func UpsertIntention(ctx context.Context, tx pgx.Tx, subj learner.Subject, weekOf time.Time, day, timeOfDay, drillID string, at time.Time) error {
	_, err := tx.Exec(ctx, `DELETE FROM ai.intentions WHERE tenant_id = $1 AND applicant_id = $2
		AND family_member_id IS NOT DISTINCT FROM $3::uuid AND week_of = $4 AND drill_id = $5`,
		subj.Tenant, subj.ApplicantID, subj.MemberID, weekOf, drillID)
	if err != nil {
		return fmt.Errorf("store: intention: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO ai.intentions (tenant_id, applicant_id, family_member_id, week_of, day, time_of_day, drill_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, subj.Tenant, subj.ApplicantID, subj.MemberID, weekOf, day, timeOfDay, drillID, at)
	if err != nil {
		return fmt.Errorf("store: intention: %w", err)
	}
	return nil
}

// InsertFeedback stores a thumbs up/down on an AI answer.
func InsertFeedback(ctx context.Context, tx pgx.Tx, tenant string, applicant uuid.UUID, agent, itemID string, helpful bool, reason *string, at time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO ai.feedback (tenant_id, applicant_id, agent, item_id, helpful, reason, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, tenant, applicant, agent, itemID, helpful, reason, at)
	if err != nil {
		return fmt.Errorf("store: feedback: %w", err)
	}
	return nil
}
