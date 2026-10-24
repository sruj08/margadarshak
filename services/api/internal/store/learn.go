package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/learn"
)

// LearnStore is the PostgreSQL learn.Store (migration 00007: learn.answers, learn.review_log,
// learn.card_state, learn.topic_mastery, learn.readiness_snapshots). learn.MemStore is the
// reference semantics. The interface has no transaction parameter: every method runs in the
// transaction carried by ctx (ContextWithTx, a games award hook) or in a new Tenant transaction
// for the subject's tenant, so RLS applies either way.
type LearnStore struct{ DB *DB }

// NewLearnStore returns a LearnStore on db.
func NewLearnStore(db *DB) *LearnStore { return &LearnStore{DB: db} }

var _ learn.Store = (*LearnStore)(nil)

// learnSubj matches the subject's rows; $1 tenant, $2 applicant, $3 member (NULL for the holder).
const learnSubj = `tenant_id = $1 AND applicant_id = $2 AND family_member_id IS NOT DISTINCT FROM $3::uuid`

const learnAnswerCols = `client_answer_id, qref, card_id, topic, correct, rating, overconfident, confidence,
	answered_at, reviewed_at, next_due_at, received_at`

// learnTopicRe is the learn.topic_mastery topic CHECK.
var learnTopicRe = regexp.MustCompile(`^[A-Z]{1,4}[0-9]{1,2}$`)

var learnNodeStates = map[string]bool{"locked": true, "learning": true, "mastered": true, "fading": true}

func learnNullText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func learnText(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// learnLock serialises the writers of one subject until the transaction ends (pg_advisory_xact_lock):
// two offline syncs inserting overlapping answers in different orders would otherwise deadlock,
// and the cache replacements would interleave.
func learnLock(ctx context.Context, tx pgx.Tx, subj learn.Subject) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "learn:"+subj.Key())
	return err
}

// AnswersByClientID implements learn.Store.
func (s *LearnStore) AnswersByClientID(ctx context.Context, subj learn.Subject, ids []string) (map[string]*learn.StoredAnswer, error) {
	out := map[string]*learn.StoredAnswer{}
	if len(ids) == 0 {
		return out, nil
	}
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+learnAnswerCols+` FROM learn.answers WHERE `+learnSubj+` AND client_answer_id = ANY($4::text[])`,
			subj.Tenant, subj.ApplicantID, subj.MemberID, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a learn.StoredAnswer
			var conf *string
			if err := rows.Scan(&a.ClientAnswerID, &a.QRef, &a.CardID, &a.Topic, &a.Correct, &a.Rating, &a.Overconfident, &conf,
				&a.AnsweredAt, &a.ReviewedAt, &a.NextDueAt, &a.ReceivedAt); err != nil {
				return err
			}
			a.Confidence = learnText(conf)
			a.AnsweredAt, a.ReviewedAt, a.NextDueAt, a.ReceivedAt = a.AnsweredAt.UTC(), a.ReviewedAt.UTC(), a.NextDueAt.UTC(), a.ReceivedAt.UTC()
			out[a.ClientAnswerID] = &a
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: learn: answers by client id: %w", mapErr(err))
	}
	return out, nil
}

// learnInsertAnswer inserts one answer and, when $16 is true, its review-log row, in one
// statement. ON CONFLICT DO NOTHING skips an answer whose client_answer_id the subject already
// has (a concurrent sync, or a repeat inside the batch): no row comes back and no log row is
// written. The log insert also ignores an existing (source_kind, source_id, card_id).
const learnInsertAnswer = `
WITH a AS (
  INSERT INTO learn.answers (tenant_id, applicant_id, family_member_id, client_answer_id, qref, card_id, topic, correct,
    rating, overconfident, confidence, answered_at, reviewed_at, next_due_at, received_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  ON CONFLICT DO NOTHING
  RETURNING tenant_id, applicant_id, family_member_id, client_answer_id
), l AS (
  INSERT INTO learn.review_log (tenant_id, applicant_id, family_member_id, card_id, rating, reviewed_at, source_kind,
    source_id, confidence, correct, overconfident)
  SELECT a.tenant_id, a.applicant_id, a.family_member_id, $17::text, $18::smallint, $19::timestamptz, $20::text,
    $21::text, $22::text, $23::boolean, $24::boolean
  FROM a WHERE $16::boolean
  ON CONFLICT DO NOTHING
)
SELECT client_answer_id FROM a`

// SaveAnswers implements learn.Store: atomically inserts the answers not yet stored with their
// review-log rows, returns the IDs it inserted (input order) and replaces the cached card states.
func (s *LearnStore) SaveAnswers(ctx context.Context, subj learn.Subject, answers []*learn.StoredAnswer, logs map[string]learn.LogRow, cards []json.RawMessage) ([]string, error) {
	var ins []string
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		ins = nil
		if err := learnLock(ctx, tx, subj); err != nil {
			return err
		}
		if len(answers) > 0 {
			b := &pgx.Batch{}
			for _, a := range answers {
				l, hasLog := logs[a.ClientAnswerID]
				b.Queue(learnInsertAnswer, subj.Tenant, subj.ApplicantID, subj.MemberID, a.ClientAnswerID, a.QRef, a.CardID, a.Topic,
					a.Correct, a.Rating, a.Overconfident, learnNullText(a.Confidence), a.AnsweredAt, a.ReviewedAt, a.NextDueAt, a.ReceivedAt,
					hasLog, l.CardID, l.Rating, l.ReviewedAt, l.SourceKind, l.SourceID, learnNullText(l.Confidence), l.Correct, l.Overconfident)
			}
			br := tx.SendBatch(ctx, b)
			for range answers {
				var id string
				err := br.QueryRow().Scan(&id)
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				if err != nil {
					_ = br.Close()
					return err
				}
				ins = append(ins, id)
			}
			if err := br.Close(); err != nil {
				return err
			}
		}
		computed := time.Time{}
		if len(answers) > 0 {
			computed = answers[0].ReceivedAt
		}
		return learnReplaceCards(ctx, tx, subj, cards, computed)
	})
	if err != nil {
		return nil, fmt.Errorf("store: learn: save answers: %w", mapErr(err))
	}
	return ins, nil
}

// learnReplaceCards replaces the subject's learn.card_state rows with cards (gamification
// CardState JSON, stored verbatim; card id from cardId, due_at from due in epoch ms). A card
// without a cardId or a numeric due cannot be keyed and is not cached; a repeated cardId keeps
// the last one. A zero computed means the transaction time. Upsert, then delete the cards not in
// the list: a plain DELETE + INSERT would fail with a unique violation when two syncs of the same
// subject run concurrently (neither DELETE sees the other's uncommitted rows).
func learnReplaceCards(ctx context.Context, tx pgx.Tx, subj learn.Subject, cards []json.RawMessage, computed time.Time) error {
	idx := map[string]int{}
	ids, states := []string{}, []string{}
	var dues []time.Time
	for _, raw := range cards {
		var c struct {
			CardID string   `json:"cardId"`
			Due    *float64 `json:"due"`
		}
		if err := json.Unmarshal(raw, &c); err != nil || c.CardID == "" || c.Due == nil || math.IsNaN(*c.Due) || math.IsInf(*c.Due, 0) {
			continue
		}
		due := time.UnixMilli(int64(*c.Due)).UTC()
		if i, ok := idx[c.CardID]; ok {
			states[i], dues[i] = string(raw), due
			continue
		}
		idx[c.CardID] = len(ids)
		ids, states, dues = append(ids, c.CardID), append(states, string(raw)), append(dues, due)
	}
	if len(ids) > 0 {
		var at *time.Time
		if !computed.IsZero() {
			at = &computed
		}
		if _, err := tx.Exec(ctx, `INSERT INTO learn.card_state (tenant_id, applicant_id, family_member_id, card_id, state, due_at, computed_at)
			SELECT $1, $2, $3, c.card_id, c.state::jsonb, c.due_at, COALESCE($7::timestamptz, now())
			FROM unnest($4::text[], $5::text[], $6::timestamptz[]) AS c (card_id, state, due_at)
			ON CONFLICT (tenant_id, applicant_id, family_member_id, card_id)
			DO UPDATE SET state = EXCLUDED.state, due_at = EXCLUDED.due_at, computed_at = EXCLUDED.computed_at`,
			subj.Tenant, subj.ApplicantID, subj.MemberID, ids, states, dues, at); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `DELETE FROM learn.card_state WHERE `+learnSubj+` AND card_id <> ALL($4::text[])`,
		subj.Tenant, subj.ApplicantID, subj.MemberID, ids)
	return err
}

// AppendLog implements learn.Store: rows whose (source_kind, source_id, card_id) the subject
// already has (also earlier in rows) are ignored; it returns how many were appended.
func (s *LearnStore) AppendLog(ctx context.Context, subj learn.Subject, rows []learn.LogRow) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	n := 0
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		n = 0
		if err := learnLock(ctx, tx, subj); err != nil {
			return err
		}
		b := &pgx.Batch{}
		for _, r := range rows {
			b.Queue(`INSERT INTO learn.review_log (tenant_id, applicant_id, family_member_id, card_id, rating, reviewed_at, source_kind,
				source_id, confidence, correct, overconfident) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				ON CONFLICT DO NOTHING`,
				subj.Tenant, subj.ApplicantID, subj.MemberID, r.CardID, r.Rating, r.ReviewedAt, r.SourceKind, r.SourceID,
				learnNullText(r.Confidence), r.Correct, r.Overconfident)
		}
		br := tx.SendBatch(ctx, b)
		for range rows {
			tag, err := br.Exec()
			if err != nil {
				_ = br.Close()
				return err
			}
			n += int(tag.RowsAffected())
		}
		return br.Close()
	})
	if err != nil {
		return 0, fmt.Errorf("store: learn: append log: %w", mapErr(err))
	}
	return n, nil
}

// ReviewLog implements learn.Store (insertion order; an empty, non-nil slice when there is none).
func (s *LearnStore) ReviewLog(ctx context.Context, subj learn.Subject) ([]learn.LogRow, error) {
	out := []learn.LogRow{}
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		out = out[:0]
		rows, err := tx.Query(ctx, `SELECT card_id, rating, reviewed_at, source_kind, source_id, confidence, correct, overconfident
			FROM learn.review_log WHERE `+learnSubj+` ORDER BY review_id`, subj.Tenant, subj.ApplicantID, subj.MemberID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r learn.LogRow
			var conf *string
			if err := rows.Scan(&r.CardID, &r.Rating, &r.ReviewedAt, &r.SourceKind, &r.SourceID, &conf, &r.Correct, &r.Overconfident); err != nil {
				return err
			}
			r.Confidence, r.ReviewedAt = learnText(conf), r.ReviewedAt.UTC()
			out = append(out, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: learn: review log: %w", mapErr(err))
	}
	return out, nil
}

// LogCount implements learn.Store.
func (s *LearnStore) LogCount(ctx context.Context, subj learn.Subject) (int, error) {
	var n int
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM learn.review_log WHERE `+learnSubj, subj.Tenant, subj.ApplicantID, subj.MemberID).Scan(&n)
	})
	if err != nil {
		return 0, fmt.Errorf("store: learn: log count: %w", mapErr(err))
	}
	return n, nil
}

// RecentRatedAnswers implements learn.Store: the last n answers with a confidence rating, oldest
// first (nil when there is none).
func (s *LearnStore) RecentRatedAnswers(ctx context.Context, subj learn.Subject, n int) ([]learn.RatedAnswer, error) {
	if n <= 0 {
		return nil, nil
	}
	var out []learn.RatedAnswer
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		out = nil
		rows, err := tx.Query(ctx, `SELECT correct, confidence FROM (
			SELECT answer_id, correct, confidence FROM learn.answers WHERE `+learnSubj+` AND confidence IS NOT NULL
			ORDER BY answer_id DESC LIMIT $4) r ORDER BY answer_id`, subj.Tenant, subj.ApplicantID, subj.MemberID, n)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r learn.RatedAnswer
			if err := rows.Scan(&r.Correct, &r.Confidence); err != nil {
				return err
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: learn: recent rated answers: %w", mapErr(err))
	}
	return out, nil
}

// LatestSnapshot implements learn.Store: the newest snapshot by computed_at (then by insertion),
// or learn.ErrNotFound.
func (s *LearnStore) LatestSnapshot(ctx context.Context, subj learn.Subject) (*learn.Snapshot, error) {
	var snap learn.Snapshot
	err := s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var state []byte
		if err := tx.QueryRow(ctx, `SELECT computed_at, log_count, nazar_score::float8, nazar_sessions, state
			FROM learn.readiness_snapshots WHERE `+learnSubj+` ORDER BY computed_at DESC, snapshot_id DESC LIMIT 1`,
			subj.Tenant, subj.ApplicantID, subj.MemberID).Scan(&snap.ComputedAt, &snap.LogCount, &snap.NazarScore, &snap.NazarSessions, &state); err != nil {
			return err
		}
		snap.ComputedAt = snap.ComputedAt.UTC()
		return json.Unmarshal(state, &snap.State)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, learn.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: learn: latest snapshot: %w", mapErr(err))
	}
	return &snap, nil
}

// learnPct rounds a 0–100 score to a whole number and clamps it into the smallint CHECK range.
func learnPct(f float64) int16 {
	if math.IsNaN(f) {
		return 0
	}
	return int16(math.Max(0, math.Min(100, math.Round(f))))
}

// learnUnit clamps a 0–1 value (numeric(6,5) rounds to five decimals on insert).
func learnUnit(f float64) float64 {
	if math.IsNaN(f) {
		return 0
	}
	return math.Max(0, math.Min(1, f))
}

// SaveSnapshot implements learn.Store. It inserts a learn.readiness_snapshots row (state = the
// full /learn/state output; readiness, knowledge and cal_penalty = Readiness.Readiness,
// .Knowledge and .CalPenalty rounded to whole numbers and clamped to 0–100, gate_met =
// Readiness.Gate.Met, nazar_score rounded to 2 decimals) and refreshes the caches from the same
// output: learn.topic_mastery from MasteryByTopic (+ NodeStates["SK-<topic>"]) and
// learn.card_state from Cards, each only when the output carries that block.
func (s *LearnStore) SaveSnapshot(ctx context.Context, subj learn.Subject, snap *learn.Snapshot) error {
	state, err := json.Marshal(snap.State)
	if err != nil {
		return fmt.Errorf("store: learn: save snapshot: encode state: %w", err)
	}
	var nazar *float64
	if snap.NazarScore != nil && !math.IsNaN(*snap.NazarScore) {
		v := math.Max(-999.99, math.Min(999.99, math.Round(*snap.NazarScore*100)/100))
		nazar = &v
	}
	r := snap.State.Readiness
	err = s.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		if err := learnLock(ctx, tx, subj); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO learn.readiness_snapshots (tenant_id, applicant_id, family_member_id, computed_at, log_count,
			readiness, knowledge, cal_penalty, gate_met, nazar_score, nazar_sessions, state)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			subj.Tenant, subj.ApplicantID, subj.MemberID, snap.ComputedAt, snap.LogCount, learnPct(r.Readiness), learnPct(r.Knowledge),
			learnPct(r.CalPenalty), r.Gate.Met, nazar, snap.NazarSessions, string(state)); err != nil {
			return err
		}
		if snap.State.MasteryByTopic != nil {
			if err := learnReplaceMastery(ctx, tx, subj, snap); err != nil {
				return err
			}
		}
		if snap.State.Cards != nil {
			return learnReplaceCards(ctx, tx, subj, snap.State.Cards, snap.ComputedAt)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("store: learn: save snapshot: %w", mapErr(err))
	}
	return nil
}

// learnReplaceMastery replaces the subject's learn.topic_mastery rows. Topics outside the CHECK
// pattern are skipped; mastery and coverage are clamped to 0–1; brier is NULL (the compute
// service reports Brier overall, not per topic); node_state is the skill node SK-<topic>, or
// locked when the output has no (valid) state for it.
func learnReplaceMastery(ctx context.Context, tx pgx.Tx, subj learn.Subject, snap *learn.Snapshot) error {
	if _, err := tx.Exec(ctx, `DELETE FROM learn.topic_mastery WHERE `+learnSubj, subj.Tenant, subj.ApplicantID, subj.MemberID); err != nil {
		return err
	}
	var topics, nodes []string
	var mastery, coverage []float64
	for topic, m := range snap.State.MasteryByTopic {
		if !learnTopicRe.MatchString(topic) {
			continue
		}
		node := snap.State.NodeStates["SK-"+topic]
		if !learnNodeStates[node] {
			node = "locked"
		}
		topics, nodes = append(topics, topic), append(nodes, node)
		mastery, coverage = append(mastery, learnUnit(m.Mastery)), append(coverage, learnUnit(m.Coverage))
	}
	if len(topics) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO learn.topic_mastery (tenant_id, applicant_id, family_member_id, topic, mastery, coverage, brier,
			node_state, computed_at)
		SELECT $1, $2, $3, t.topic, t.mastery, t.coverage, NULL, t.node_state, $8
		FROM unnest($4::text[], $5::float8[], $6::float8[], $7::text[]) AS t (topic, mastery, coverage, node_state)`,
		subj.Tenant, subj.ApplicantID, subj.MemberID, topics, mastery, coverage, nodes, snap.ComputedAt)
	return err
}
