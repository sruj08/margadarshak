package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/study"
)

// StudyStore is the pgx implementation of study.Store over study.* (00009_p2_study.sql) and the
// field_test game sessions (game.sessions, 00006_p2_games.sql). The tenant is passed explicitly;
// every query also filters on tenant_id, so a System transaction carried in ctx (mg_jobs sees
// every tenant) cannot leak another tenant's rows.
type StudyStore struct{ DB *DB }

var _ study.Store = (*StudyStore)(nil)

// NewStudyStore returns a StudyStore on db.
func NewStudyStore(db *DB) *StudyStore { return &StudyStore{DB: db} }

const studyParticipantCols = `participant_code, tenant_id, applicant_id, consent_id, age_band, licence_held, years_driving,
	age_ok, form, seq, coalesce(retake_of, ''), coalesce(near_miss_text, ''), created_at, withdrawn_at`

func studyScanParticipant(row pgx.Row) (*study.Participant, error) {
	var p study.Participant
	if err := row.Scan(&p.Code, &p.Tenant, &p.ApplicantID, &p.ConsentID, &p.AgeBand, &p.LicenceHeld, &p.YearsDriving,
		&p.AgeOK, &p.Form, &p.Seq, &p.RetakeOf, &p.NearMissText, &p.CreatedAt, &p.WithdrawnAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// studyNullText stores "" as NULL.
func studyNullText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// NextSeq implements study.Store: an upsert on study.nazar_arrivals returning the new value, so
// concurrent enrolments get distinct arrival numbers.
func (s *StudyStore) NextSeq(ctx context.Context, tenant string) (int, error) {
	var seq int
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO study.nazar_arrivals (tenant_id, last_seq) VALUES ($1, 1)
			ON CONFLICT (tenant_id) DO UPDATE SET last_seq = study.nazar_arrivals.last_seq + 1
			RETURNING last_seq`, tenant).Scan(&seq)
	})
	if err != nil {
		return 0, fmt.Errorf("store: study: next seq: %w", mapErr(err))
	}
	return seq, nil
}

// InsertParticipant implements study.Store. A duplicate code or seq is store.ErrConflict (the
// MemStore overwrites; the service never inserts an existing code because seq is fresh).
func (s *StudyStore) InsertParticipant(ctx context.Context, p *study.Participant) error {
	err := s.DB.InTenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO study.nazar_participants (tenant_id, participant_code, applicant_id, consent_id, seq,
			  age_band, licence_held, years_driving, age_ok, form, retake_of, near_miss_text, created_at, withdrawn_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			p.Tenant, p.Code, p.ApplicantID, p.ConsentID, p.Seq, p.AgeBand, p.LicenceHeld, p.YearsDriving, p.AgeOK, p.Form,
			studyNullText(p.RetakeOf), studyNullText(p.NearMissText), p.CreatedAt, p.WithdrawnAt)
		return err
	})
	if err != nil {
		return fmt.Errorf("store: study: insert participant: %w", mapErr(err))
	}
	return nil
}

// UpdateParticipant implements study.Store: it replaces every non-key column (as the MemStore
// replaces the row); an unknown code is study.ErrNotFound.
func (s *StudyStore) UpdateParticipant(ctx context.Context, p *study.Participant) error {
	var n int64
	err := s.DB.InTenant(ctx, p.Tenant, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE study.nazar_participants SET applicant_id = $3, consent_id = $4, seq = $5, age_band = $6,
			  licence_held = $7, years_driving = $8, age_ok = $9, form = $10, retake_of = $11, near_miss_text = $12,
			  created_at = $13, withdrawn_at = $14
			WHERE tenant_id = $1 AND participant_code = $2`,
			p.Tenant, p.Code, p.ApplicantID, p.ConsentID, p.Seq, p.AgeBand, p.LicenceHeld, p.YearsDriving, p.AgeOK, p.Form,
			studyNullText(p.RetakeOf), studyNullText(p.NearMissText), p.CreatedAt, p.WithdrawnAt)
		n = tag.RowsAffected()
		return err
	})
	if err != nil {
		return fmt.Errorf("store: study: update participant: %w", mapErr(err))
	}
	if n == 0 {
		return study.ErrNotFound
	}
	return nil
}

// GetParticipant implements study.Store (study.ErrNotFound when absent).
func (s *StudyStore) GetParticipant(ctx context.Context, tenant, code string) (*study.Participant, error) {
	var p *study.Participant
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		var err error
		p, err = studyScanParticipant(tx.QueryRow(ctx, `SELECT `+studyParticipantCols+` FROM study.nazar_participants
			WHERE tenant_id = $1 AND participant_code = $2`, tenant, code))
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, study.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: study: get participant: %w", mapErr(err))
	}
	return p, nil
}

func (s *StudyStore) participants(ctx context.Context, tenant, where string, args ...any) ([]*study.Participant, error) {
	var out []*study.Participant
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+studyParticipantCols+` FROM study.nazar_participants
			WHERE tenant_id = $1`+where+` ORDER BY seq, participant_code`, append([]any{tenant}, args...)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			p, err := studyScanParticipant(rows)
			if err != nil {
				return err
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: study: participants: %w", mapErr(err))
	}
	return out, nil
}

// ParticipantsByApplicant implements study.Store (oldest first, by arrival order).
func (s *StudyStore) ParticipantsByApplicant(ctx context.Context, tenant string, applicant uuid.UUID) ([]*study.Participant, error) {
	return s.participants(ctx, tenant, ` AND applicant_id = $2`, applicant)
}

// Participants implements study.Store (arrival order, withdrawn included).
func (s *StudyStore) Participants(ctx context.Context, tenant string) ([]*study.Participant, error) {
	return s.participants(ctx, tenant, "")
}

// Sessions implements study.Store: the tenant's verified (status checked) field_test game
// sessions with a phase, oldest verification first. Duration is submitted_at − started_at (0 when
// not submitted), the score is server_result.score.raw/max, and the analysis is the verifier's
// per-kind analysis (nil when the session has none, e.g. the LL mock).
func (s *StudyStore) Sessions(ctx context.Context, tenant string) ([]*study.Session, error) {
	out := []*study.Session{}
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT study_participant, study_phase, session_id, coalesce(trust, 0)::float8,
			  coalesce(round(extract(epoch FROM submitted_at - started_at) * 1000), 0)::bigint,
			  coalesce((server_result -> 'score' ->> 'raw')::float8, 0), coalesce((server_result -> 'score' ->> 'max')::float8, 0),
			  analysis, verified_at, coalesce(timing_mode, '')
			FROM game.sessions
			WHERE tenant_id = $1 AND cohort = 'field_test' AND status = 'checked' AND study_phase IS NOT NULL
			ORDER BY verified_at, session_id`, tenant)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var se study.Session
			var analysis []byte
			if err := rows.Scan(&se.ParticipantCode, &se.Phase, &se.SessionID, &se.Trust, &se.DurationMs, &se.ScoreRaw, &se.ScoreMax,
				&analysis, &se.VerifiedAt, &se.TimingMode); err != nil {
				return err
			}
			if len(analysis) > 0 && string(analysis) != "null" {
				if err := json.Unmarshal(analysis, &se.Analysis); err != nil {
					return fmt.Errorf("session %s analysis: %w", se.SessionID, err)
				}
			}
			out = append(out, &se)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: study: sessions: %w", mapErr(err))
	}
	return out, nil
}

// FormBlocks implements study.Store; it returns the bare study.ErrNotFound when the tenant has no
// blocks (Service.Export compares with ==, as for the MemStore).
func (s *StudyStore) FormBlocks(ctx context.Context, tenant string) (*study.Blocks, error) {
	var b study.Blocks
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT b1, b2, b3, ll_set FROM study.form_blocks WHERE tenant_id = $1`, tenant).
			Scan(&b.B1, &b.B2, &b.B3, &b.LLSet)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, study.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: study: form blocks: %w", mapErr(err))
	}
	return &b, nil
}

// SaveFormBlocks stores (or replaces) the tenant's form blocks, frozen at frozenAt. mg_app may not
// write study.form_blocks, so it always runs in its own System (mg_jobs) transaction; it is for
// seeding and tests.
func (s *StudyStore) SaveFormBlocks(ctx context.Context, tenant string, b *study.Blocks, frozenAt time.Time) error {
	if b == nil {
		return study.ErrBlocksNotReady
	}
	err := s.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO study.form_blocks (tenant_id, b1, b2, b3, ll_set, frozen_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (tenant_id) DO UPDATE SET b1 = EXCLUDED.b1, b2 = EXCLUDED.b2, b3 = EXCLUDED.b3,
			  ll_set = EXCLUDED.ll_set, frozen_at = EXCLUDED.frozen_at`,
			tenant, b.B1, b.B2, b.B3, b.LLSet, frozenAt)
		return err
	})
	if err != nil {
		return fmt.Errorf("store: study: save form blocks: %w", mapErr(err))
	}
	return nil
}

// SavePublicStats implements study.Store. mg_app may not write study.public_stats; the caller is
// the stats.field_study_publish job step, so it runs in the transaction carried by ctx or else
// in a new System (mg_jobs) transaction, with tenant_id set explicitly.
func (s *StudyStore) SavePublicStats(ctx context.Context, tenant string, st *study.PublicStats) error {
	payload, err := json.Marshal(st.Payload)
	if err != nil {
		return fmt.Errorf("store: study: public stats payload: %w", err)
	}
	if st.Payload == nil {
		payload = []byte("{}")
	}
	err = s.DB.InSystem(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO study.public_stats (tenant_id, as_of, payload, script_sha256, prereg_commit)
			VALUES ($1, $2, $3, $4, $5)`, tenant, st.AsOf, payload, st.ScriptSHA256, studyNullText(st.PreregCommit))
		return err
	})
	if err != nil {
		return fmt.Errorf("store: study: save public stats: %w", mapErr(err))
	}
	return nil
}

// LatestPublicStats returns the tenant's newest study.public_stats row (API-71), or nil, nil when
// none has been published.
func (s *StudyStore) LatestPublicStats(ctx context.Context, tenant string) (*study.PublicStats, error) {
	var st study.PublicStats
	var payload []byte
	var prereg *string
	err := s.DB.InTenant(ctx, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT as_of, payload, script_sha256, prereg_commit FROM study.public_stats
			WHERE tenant_id = $1 ORDER BY as_of DESC, stats_id DESC LIMIT 1`, tenant).Scan(&st.AsOf, &payload, &st.ScriptSHA256, &prereg)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: study: latest public stats: %w", mapErr(err))
	}
	if err := json.Unmarshal(payload, &st.Payload); err != nil {
		return nil, fmt.Errorf("store: study: public stats payload: %w", err)
	}
	if prereg != nil {
		st.PreregCommit = *prereg
	}
	return &st, nil
}
