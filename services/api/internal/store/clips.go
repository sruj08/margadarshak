package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
)

// ClipsStore implements clips.Store on the content schema (00005_p2_content_clips.sql). The clip
// bank is not personal data and has no RLS; every call runs as mg_jobs through InSystem (or in
// the transaction carried by ctx, see ContextWithTx). Semantics follow clips.MemStore.
//
// Column mapping notes:
//   - blur_audit (pending | passed | failed) is derived from the record: passed when
//     AuditPassedAt is set, failed when an audit summary is in clip.json but did not pass,
//     pending otherwise; this keeps the table's published/blur_audit CHECKs consistent.
//   - filmed_on is a date; FilmedOn "" is NULL and reads back as "YYYY-MM-DD".
//   - contributor_consent_id is a uuid FK to privacy.consent_artefacts: a non-uuid ID is a
//     *clips.ValidationError and an unknown one wraps clips.ErrConsentRequired.
//   - origin is the doc's origin (filmed when unset); ai_generated clips store NULL for an empty
//     raw object key, filming and contributor consent, and their synthetic review as jsonb.
//   - content.clip_scoring is written in the same transaction whenever a published (or retired)
//     version is inserted or updated: clips.ScoringDoc, the game-core NazarClip the verifier
//     takes inline. clips.Service.ScoringDocs still projects it from the clip row on every call
//     (same function, so the two never differ); the table is the queryable cache of what every
//     published version scores against (audits, offline verifier content).
type ClipsStore struct{ DB *DB }

// NewClipsStore returns the pgx clip store.
func NewClipsStore(db *DB) *ClipsStore { return &ClipsStore{DB: db} }

var _ clips.Store = (*ClipsStore)(nil)

const clipsCols = `clip_id, version, status, doc, tenant, coalesce(raw_object_key, ''), intermediate_keys, coalesce(filmed_by, ''),
	coalesce(to_char(filmed_on, 'YYYY-MM-DD'), ''), contributor_consent_id, registered_by, registered_at, flash_passed,
	proposals, blur_regions, coalesce(review_event_id, ''), coalesce(adjudication_event_id, ''), agreement,
	agreement_accepted, needs_third_rater, final_hazards, adjudication, cue_texts, audit_passed_at, raw_deleted_at,
	published_at, mock_eligible, mock_reasons, workflow_runs, finalize_round, updated_at, coalesce(generation_key, ''),
	synthetic_review, onset_hint`

func clipsErr(op string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return clips.ErrNotFound
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23503" && pg.ConstraintName == "clips_contributor_consent_id_fkey" {
		return fmt.Errorf("store: clips: %s: %w", op, clips.ErrConsentRequired)
	}
	return fmt.Errorf("store: clips: %s: %w", op, mapErr(err))
}

func clipsUTC(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// clipsJSON marshals v for a NOT NULL jsonb column, writing empty instead of null.
func clipsJSON(v any, empty string) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	if string(raw) == "null" {
		return []byte(empty), nil
	}
	return raw, nil
}

// clipsRaw is a nullable jsonb parameter: nil or JSON null is SQL NULL.
func clipsRaw(m json.RawMessage) *string {
	if len(m) == 0 || string(m) == "null" {
		return nil
	}
	s := string(m)
	return &s
}

func clipsStrings(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

// clipsBlurAudit derives the blur_audit column.
func clipsBlurAudit(c *clips.Clip) string {
	switch {
	case c.AuditPassedAt != nil:
		return "passed"
	case c.Doc.BlurAudit != nil:
		return "failed"
	default:
		return "pending"
	}
}

// clipsParams holds the encoded columns shared by insert and update.
type clipsParams struct {
	doc, proposals, finalHazards, cueTexts []byte
	adjudication, syntheticReview          *string
	consent                                *uuid.UUID
}

func clipsEncode(c *clips.Clip) (*clipsParams, error) {
	if c.Doc.ClipID != c.ClipID || c.Doc.Version != c.Version || c.Doc.Status != c.Status {
		return nil, fmt.Errorf("store: clips: %s@%d: doc clipId/version/status must equal the record", c.ClipID, c.Version)
	}
	p := &clipsParams{}
	if c.ContributorConsentID != "" || !c.Doc.IsAI() {
		consent, err := uuid.Parse(c.ContributorConsentID)
		if err != nil {
			return nil, fmt.Errorf("store: clips: %w", &clips.ValidationError{Pointer: "/contributor_consent_id", Code: "invalid"})
		}
		p.consent = &consent
	}
	var err error
	if p.doc, err = c.Doc.JSON(); err != nil {
		return nil, fmt.Errorf("store: clips: encode doc: %w", err)
	}
	if p.proposals, err = clipsJSON(c.Proposals, "[]"); err != nil {
		return nil, fmt.Errorf("store: clips: encode proposals: %w", err)
	}
	if p.finalHazards, err = clipsJSON(c.FinalHazards, "[]"); err != nil {
		return nil, fmt.Errorf("store: clips: encode final hazards: %w", err)
	}
	if p.cueTexts, err = clipsJSON(c.CueTexts, "{}"); err != nil {
		return nil, fmt.Errorf("store: clips: encode cue texts: %w", err)
	}
	if c.Adjudication != nil {
		raw, err := json.Marshal(c.Adjudication)
		if err != nil {
			return nil, fmt.Errorf("store: clips: encode adjudication: %w", err)
		}
		s := string(raw)
		p.adjudication = &s
	}
	if c.SyntheticReview != nil {
		raw, err := json.Marshal(c.SyntheticReview)
		if err != nil {
			return nil, fmt.Errorf("store: clips: encode synthetic review: %w", err)
		}
		s := string(raw)
		p.syntheticReview = &s
	}
	return p, nil
}

func clipsScan(row pgx.Row) (*clips.Clip, error) {
	var c clips.Clip
	var status string
	var doc, proposals, blurRegions, agreement, finalHazards, adjudication, cueTexts, synthetic, onset []byte
	var consent *uuid.UUID
	if err := row.Scan(&c.ClipID, &c.Version, &status, &doc, &c.Tenant, &c.RawObjectKey, &c.IntermediateKeys, &c.FilmedBy,
		&c.FilmedOn, &consent, &c.RegisteredBy, &c.RegisteredAt, &c.FlashPassed,
		&proposals, &blurRegions, &c.ReviewEventID, &c.AdjudicationEventID, &agreement,
		&c.AgreementAccepted, &c.NeedsThirdRater, &finalHazards, &adjudication, &cueTexts, &c.AuditPassedAt, &c.RawDeletedAt,
		&c.PublishedAt, &c.MockEligible, &c.MockReasons, &c.WorkflowRuns, &c.Round, &c.UpdatedAt, &c.GenerationKey, &synthetic, &onset); err != nil {
		return nil, err
	}
	c.Status = clips.Status(status)
	if consent != nil {
		c.ContributorConsentID = consent.String()
	}
	if onset != nil {
		c.OnsetHint = json.RawMessage(onset)
	}
	if synthetic != nil {
		c.SyntheticReview = &clips.SyntheticReviewRecord{}
		if err := json.Unmarshal(synthetic, c.SyntheticReview); err != nil {
			return nil, fmt.Errorf("decode synthetic review: %w", err)
		}
		c.SyntheticReview.ReviewedAt = c.SyntheticReview.ReviewedAt.UTC()
	}
	c.RegisteredAt, c.UpdatedAt = c.RegisteredAt.UTC(), c.UpdatedAt.UTC()
	c.AuditPassedAt, c.RawDeletedAt, c.PublishedAt = clipsUTC(c.AuditPassedAt), clipsUTC(c.RawDeletedAt), clipsUTC(c.PublishedAt)
	if err := json.Unmarshal(doc, &c.Doc); err != nil {
		return nil, fmt.Errorf("decode doc: %w", err)
	}
	if err := json.Unmarshal(proposals, &c.Proposals); err != nil {
		return nil, fmt.Errorf("decode proposals: %w", err)
	}
	if err := json.Unmarshal(finalHazards, &c.FinalHazards); err != nil {
		return nil, fmt.Errorf("decode final hazards: %w", err)
	}
	if err := json.Unmarshal(cueTexts, &c.CueTexts); err != nil {
		return nil, fmt.Errorf("decode cue texts: %w", err)
	}
	if adjudication != nil {
		c.Adjudication = &clips.Adjudication{}
		if err := json.Unmarshal(adjudication, c.Adjudication); err != nil {
			return nil, fmt.Errorf("decode adjudication: %w", err)
		}
		c.Adjudication.At = c.Adjudication.At.UTC()
	}
	if blurRegions != nil {
		c.BlurRegions = json.RawMessage(blurRegions)
	}
	if agreement != nil {
		c.Agreement = json.RawMessage(agreement)
	}
	return &c, nil
}

// NextClipNumber implements clips.Store: an atomic per-prefix counter (upsert).
func (s *ClipsStore) NextClipNumber(ctx context.Context, prefix string) (int, error) {
	var n int
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO content.clip_id_counters (prefix, last) VALUES ($1, 1)
			ON CONFLICT (prefix) DO UPDATE SET last = content.clip_id_counters.last + 1
			RETURNING last`, prefix).Scan(&n)
	})
	if err != nil {
		return 0, clipsErr("next clip number", err)
	}
	return n, nil
}

// InsertClip implements clips.Store. A second insert of the same clip_id@version is a conflict.
func (s *ClipsStore) InsertClip(ctx context.Context, c *clips.Clip) error {
	p, err := clipsEncode(c)
	if err != nil {
		return err
	}
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO content.clips (clip_id, version, status, doc, tenant_tags, tenant, raw_object_key, intermediate_keys,
			  filmed_by, filmed_on, licence, contributor_consent_id, registered_by, registered_at, flash_passed, proposals,
			  blur_regions, review_event_id, adjudication_event_id, agreement, agreement_accepted, needs_third_rater,
			  final_hazards, adjudication, cue_texts, blur_audit, audit_passed_at, raw_deleted_at, published_at,
			  mock_eligible, mock_reasons, workflow_runs, finalize_round, updated_at, origin, generation_key, synthetic_review,
			  onset_hint)
			VALUES ($1, $2, $3, $4, $5, $6, nullif($7, ''), $8, nullif($9, ''), nullif($10, '')::date, $11, $12, $13, $14, $15, $16,
			  $17::jsonb, nullif($18, ''), nullif($19, ''), $20::jsonb, $21, $22, $23, $24::jsonb, $25, $26, $27, $28, $29,
			  $30, $31, $32, $33, $34, $35, nullif($36, ''), $37::jsonb, $38::jsonb)`,
			c.ClipID, c.Version, string(c.Status), p.doc, clipsStrings(c.Doc.TenantTags), c.Tenant, c.RawObjectKey,
			clipsStrings(c.IntermediateKeys), c.FilmedBy, c.FilmedOn, c.Doc.Licence, p.consent, c.RegisteredBy, c.RegisteredAt,
			c.FlashPassed, p.proposals, clipsRaw(c.BlurRegions), c.ReviewEventID, c.AdjudicationEventID, clipsRaw(c.Agreement),
			c.AgreementAccepted, c.NeedsThirdRater, p.finalHazards, p.adjudication, p.cueTexts, clipsBlurAudit(c),
			c.AuditPassedAt, c.RawDeletedAt, c.PublishedAt, c.MockEligible, clipsStrings(c.MockReasons),
			clipsStrings(c.WorkflowRuns), c.Round, c.UpdatedAt, c.Doc.OriginOrDefault(), c.GenerationKey, p.syntheticReview, clipsRaw(c.OnsetHint))
		if err != nil {
			return err
		}
		return clipsSyncScoring(ctx, tx, c)
	})
	return clipsErr("insert "+c.Ref(), err)
}

// GetClip implements clips.Store; version 0 is the latest version.
func (s *ClipsStore) GetClip(ctx context.Context, clipID string, version int) (*clips.Clip, error) {
	var c *clips.Clip
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var err error
		if version == 0 {
			c, err = clipsScan(tx.QueryRow(ctx, `SELECT `+clipsCols+` FROM content.clips WHERE clip_id = $1
				ORDER BY version DESC LIMIT 1`, clipID))
		} else {
			c, err = clipsScan(tx.QueryRow(ctx, `SELECT `+clipsCols+` FROM content.clips WHERE clip_id = $1 AND version = $2`,
				clipID, version))
		}
		return err
	})
	if err != nil {
		return nil, clipsErr("get", err)
	}
	return c, nil
}

// ClipByGenerationKey implements clips.Store.
func (s *ClipsStore) ClipByGenerationKey(ctx context.Context, key string) (*clips.Clip, error) {
	var c *clips.Clip
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var err error
		c, err = clipsScan(tx.QueryRow(ctx, `SELECT `+clipsCols+` FROM content.clips WHERE generation_key = $1`, key))
		return err
	})
	if err != nil {
		return nil, clipsErr("get by generation key", err)
	}
	return c, nil
}

// UpdateClip implements clips.Store: replaces every mutable column of clip_id@version.
func (s *ClipsStore) UpdateClip(ctx context.Context, c *clips.Clip) error {
	p, err := clipsEncode(c)
	if err != nil {
		return err
	}
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE content.clips SET status = $3, doc = $4, tenant_tags = $5, tenant = $6, raw_object_key = nullif($7, ''),
			  intermediate_keys = $8, filmed_by = nullif($9, ''), filmed_on = nullif($10, '')::date, licence = $11,
			  contributor_consent_id = $12, registered_by = $13, registered_at = $14, flash_passed = $15, proposals = $16,
			  blur_regions = $17::jsonb, review_event_id = nullif($18, ''), adjudication_event_id = nullif($19, ''),
			  agreement = $20::jsonb, agreement_accepted = $21, needs_third_rater = $22, final_hazards = $23,
			  adjudication = $24::jsonb, cue_texts = $25, blur_audit = $26, audit_passed_at = $27, raw_deleted_at = $28,
			  published_at = $29, mock_eligible = $30, mock_reasons = $31, workflow_runs = $32, finalize_round = $33,
			  updated_at = $34, origin = $35, generation_key = nullif($36, ''), synthetic_review = $37::jsonb,
			  onset_hint = $38::jsonb
			WHERE clip_id = $1 AND version = $2`,
			c.ClipID, c.Version, string(c.Status), p.doc, clipsStrings(c.Doc.TenantTags), c.Tenant, c.RawObjectKey,
			clipsStrings(c.IntermediateKeys), c.FilmedBy, c.FilmedOn, c.Doc.Licence, p.consent, c.RegisteredBy, c.RegisteredAt,
			c.FlashPassed, p.proposals, clipsRaw(c.BlurRegions), c.ReviewEventID, c.AdjudicationEventID, clipsRaw(c.Agreement),
			c.AgreementAccepted, c.NeedsThirdRater, p.finalHazards, p.adjudication, p.cueTexts, clipsBlurAudit(c),
			c.AuditPassedAt, c.RawDeletedAt, c.PublishedAt, c.MockEligible, clipsStrings(c.MockReasons),
			clipsStrings(c.WorkflowRuns), c.Round, c.UpdatedAt, c.Doc.OriginOrDefault(), c.GenerationKey, p.syntheticReview, clipsRaw(c.OnsetHint))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return clipsSyncScoring(ctx, tx, c)
	})
	return clipsErr("update "+c.Ref(), err)
}

// clipsSyncScoring caches the scoring document of a published or retired version in
// content.clip_scoring (upsert); other statuses have none.
func clipsSyncScoring(ctx context.Context, tx pgx.Tx, c *clips.Clip) error {
	if c.Status != clips.StatusPublished && c.Status != clips.StatusRetired {
		return nil
	}
	doc, err := clips.ScoringDoc(c)
	if errors.Is(err, clips.ErrNotScorable) {
		return nil // no speed estimate: ScoringDocs refuses it the same way
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO content.clip_scoring (clip_id, version, doc) VALUES ($1, $2, $3)
		ON CONFLICT (clip_id, version) DO UPDATE SET doc = EXCLUDED.doc`, c.ClipID, c.Version, doc)
	return err
}

// ListClips implements clips.Store: sorted by clip ID, then version. Tenant matches a tenant tag.
func (s *ClipsStore) ListClips(ctx context.Context, f clips.ListFilter) ([]*clips.Clip, error) {
	statuses := make([]string, 0, len(f.Status))
	for _, st := range f.Status {
		statuses = append(statuses, string(st))
	}
	var out []*clips.Clip
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+clipsCols+` FROM content.clips
			WHERE (cardinality($1::text[]) = 0 OR status = ANY ($1))
			  AND ($2 = '' OR tenant_tags @> ARRAY[$2]::text[])
			ORDER BY clip_id, version`, statuses, f.Tenant)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			c, err := clipsScan(rows)
			if err != nil {
				return err
			}
			out = append(out, c)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, clipsErr("list", err)
	}
	return out, nil
}

// UpsertRating implements clips.Store (one rating per rater per clip version; a re-save keeps
// the rater's place in the save order).
func (s *ClipsStore) UpsertRating(ctx context.Context, r *clips.Rating) error {
	sub := r.Submission
	if sub.Marks == nil {
		sub.Marks = []clips.RaterMark{}
	}
	raw, err := json.Marshal(sub)
	if err != nil {
		return fmt.Errorf("store: clips: encode rating: %w", err)
	}
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO content.clip_ratings (clip_id, version, rater, submission, saved_at)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (clip_id, version, rater) DO UPDATE SET submission = EXCLUDED.submission, saved_at = EXCLUDED.saved_at`,
			r.ClipID, r.Version, r.Rater, raw, r.SavedAt)
		return err
	})
	return clipsErr("upsert rating", err)
}

// Ratings implements clips.Store (in first-save order; nil when there are none).
func (s *ClipsStore) Ratings(ctx context.Context, clipID string, version int) ([]*clips.Rating, error) {
	var out []*clips.Rating
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT clip_id, version, rater, submission, saved_at FROM content.clip_ratings
			WHERE clip_id = $1 AND version = $2 ORDER BY seq`, clipID, version)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r clips.Rating
			var raw []byte
			if err := rows.Scan(&r.ClipID, &r.Version, &r.Rater, &raw, &r.SavedAt); err != nil {
				return err
			}
			if err := json.Unmarshal(raw, &r.Submission); err != nil {
				return fmt.Errorf("decode rating: %w", err)
			}
			r.SavedAt = r.SavedAt.UTC()
			out = append(out, &r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, clipsErr("ratings", err)
	}
	return out, nil
}

// InsertBlurAudit implements clips.Store (append-only per clip version).
func (s *ClipsStore) InsertBlurAudit(ctx context.Context, a *clips.BlurAudit) error {
	miss, err := clipsJSON(a.MissFrames, "[]")
	if err != nil {
		return fmt.Errorf("store: clips: encode miss frames: %w", err)
	}
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO content.clip_blur_audits (clip_id, version, auditor, rendition_sha256,
			  frames_total, frames_checked, misses, miss_frames, audited_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			a.ClipID, a.Version, a.Auditor, a.RenditionSHA256, a.FramesTotal, a.FramesChecked, a.Misses, miss, a.AuditedAt)
		return err
	})
	return clipsErr("insert blur audit", err)
}

// LatestBlurAudit implements clips.Store (the last inserted audit).
func (s *ClipsStore) LatestBlurAudit(ctx context.Context, clipID string, version int) (*clips.BlurAudit, error) {
	var a clips.BlurAudit
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var miss []byte
		if err := tx.QueryRow(ctx, `SELECT clip_id, version, auditor, rendition_sha256, frames_total, frames_checked, misses,
			  miss_frames, audited_at
			FROM content.clip_blur_audits WHERE clip_id = $1 AND version = $2 ORDER BY audit_id DESC LIMIT 1`,
			clipID, version).Scan(&a.ClipID, &a.Version, &a.Auditor, &a.RenditionSHA256, &a.FramesTotal, &a.FramesChecked,
			&a.Misses, &miss, &a.AuditedAt); err != nil {
			return err
		}
		return json.Unmarshal(miss, &a.MissFrames)
	})
	if err != nil {
		return nil, clipsErr("latest blur audit", err)
	}
	a.AuditedAt = a.AuditedAt.UTC()
	return &a, nil
}

// InsertRawDeletion implements clips.Store (one record per clip version; the log is append-only).
func (s *ClipsStore) InsertRawDeletion(ctx context.Context, d *clips.RawDeletion) error {
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO content.clip_raw_deletions (clip_id, version, object_keys, reason, uploaded_at,
			  audit_passed_at, deleted_at, deleted_by, deadline, on_time)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			d.ClipID, d.Version, clipsStrings(d.ObjectKeys), d.Reason, d.UploadedAt, d.AuditPassedAt, d.DeletedAt, d.DeletedBy,
			d.Deadline, d.OnTime)
		return err
	})
	return clipsErr("insert raw deletion", err)
}

// RawDeletion implements clips.Store.
func (s *ClipsStore) RawDeletion(ctx context.Context, clipID string, version int) (*clips.RawDeletion, error) {
	var d clips.RawDeletion
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT clip_id, version, object_keys, reason, uploaded_at, audit_passed_at, deleted_at,
			  deleted_by, deadline, on_time
			FROM content.clip_raw_deletions WHERE clip_id = $1 AND version = $2`, clipID, version).Scan(
			&d.ClipID, &d.Version, &d.ObjectKeys, &d.Reason, &d.UploadedAt, &d.AuditPassedAt, &d.DeletedAt, &d.DeletedBy,
			&d.Deadline, &d.OnTime)
	})
	if err != nil {
		return nil, clipsErr("raw deletion", err)
	}
	d.UploadedAt, d.DeletedAt, d.Deadline = d.UploadedAt.UTC(), d.DeletedAt.UTC(), d.Deadline.UTC()
	d.AuditPassedAt = clipsUTC(d.AuditPassedAt)
	return &d, nil
}

// SaveManifest implements clips.Store. Saving a manifest version again replaces it and makes it
// the latest (MemStore appends; the latest is the last saved). created_at records save order.
func (s *ClipsStore) SaveManifest(ctx context.Context, m *clips.Manifest) error {
	elig, err := clipsJSON(m.MockEligibility, "{}")
	if err != nil {
		return fmt.Errorf("store: clips: encode mock eligibility: %w", err)
	}
	bank, client := clipsRaw(m.Bank), clipsRaw(m.Client)
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO content.clip_manifests (manifest_version, generated_at, bank, client,
			  mock_eligibility, created_at)
			VALUES ($1, $2, coalesce($3::jsonb, 'null'), coalesce($4::jsonb, 'null'), $5, clock_timestamp())
			ON CONFLICT (manifest_version) DO UPDATE SET generated_at = EXCLUDED.generated_at, bank = EXCLUDED.bank,
			  client = EXCLUDED.client, mock_eligibility = EXCLUDED.mock_eligibility, created_at = EXCLUDED.created_at`,
			m.Version, m.GeneratedAt, bank, client, elig)
		return err
	})
	return clipsErr("save manifest", err)
}

// LatestManifest implements clips.Store (the last saved manifest).
func (s *ClipsStore) LatestManifest(ctx context.Context) (*clips.Manifest, error) {
	var m clips.Manifest
	err := s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var bank, client, elig []byte
		if err := tx.QueryRow(ctx, `SELECT manifest_version, generated_at, bank, client, mock_eligibility
			FROM content.clip_manifests ORDER BY created_at DESC, generated_at DESC LIMIT 1`).Scan(
			&m.Version, &m.GeneratedAt, &bank, &client, &elig); err != nil {
			return err
		}
		m.Bank, m.Client = json.RawMessage(bank), json.RawMessage(client)
		return json.Unmarshal(elig, &m.MockEligibility)
	})
	if err != nil {
		return nil, clipsErr("latest manifest", err)
	}
	m.GeneratedAt = m.GeneratedAt.UTC()
	return &m, nil
}
