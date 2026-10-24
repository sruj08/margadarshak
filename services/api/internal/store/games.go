package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/games"
	"github.com/sruj08/margadarshak/services/api/internal/learner"
)

// GamesStore is games.Store on game.sessions, game.session_items, game.clip_exposures and
// ops.counters (migration 00006). Every method runs in the caller's transaction: a Tenant
// transaction under RLS for API-34/35, the cross-tenant System transaction for the
// sessions.replay_pending step. Rows are always written with tenant_id from the Subject, never
// from app.tenant_id, so writes from a System transaction land in the right tenant.
//
// Read-back differences from games.MemStore, all deliberate:
//   - Session.Subject is rebuilt from core.applicants and core.family_members (the schema keeps
//     only tenant, applicant and member): UserBand "u18"/"adult" and Minor from the member's
//     is_minor, else from the holder's user_band ("unknown" gives ""), Account from the holder's
//     kind, the way accounts.ResolveLearner builds it.
//   - jsonb columns (context, client_result, server_result, analysis) come back semantically
//     equal, not byte-equal (jsonb reorders keys and drops whitespace).
//   - Replay.Inputs is stored decoded (replay_inputs bytea) and re-encoded with padded standard
//     base64; unpadded input is accepted and comes back padded.
//   - Empty Flags and Eligible come back as empty, non-nil values; Items is nil without items.
//   - Times come back in UTC with microsecond precision.
type GamesStore struct{}

var _ games.Store = GamesStore{}

const gamesSessionCols = `s.session_id, s.tenant_id, s.applicant_id, s.family_member_id,
	COALESCE(a.kind = 'account', false), COALESCE(a.user_band, 'unknown'), m.is_minor,
	s.game_id, s.mode, s.game_version, s.scoring_version, s.rule_pack_version, s.seed, s.seed_origin, s.difficulty,
	s.status, s.cohort, s.study_participant, s.study_phase, s.context, s.started_at, s.expires_at, s.submitted_at,
	s.verified_at, s.replay_inputs, s.replay_encoding, s.replay_event_count, s.telemetry_version, s.digest, s.hints,
	s.client_result, s.server_result, s.analysis, s.client_score_pct, s.server_score_pct, s.trust,
	s.integrity_flags, s.timing_mode, s.eligibility, s.rejected_type`

const gamesSessionFrom = ` FROM game.sessions s
	LEFT JOIN core.applicants a ON a.applicant_id = s.applicant_id
	LEFT JOIN core.family_members m ON m.member_id = s.family_member_id`

func gamesScanSession(row pgx.Row) (*games.Session, error) {
	var (
		s                                               games.Session
		account                                         bool
		band                                            string
		minor                                           *bool
		seed                                            int64
		cohort, participant, phase, enc, digest, timing *string
		rejected                                        *string
		events, telemetry                               *int32
		inputs, sc, hints, client, server, analysis     []byte
		eligibility                                     []byte
		submitted, verified                             *time.Time
	)
	err := row.Scan(&s.ID, &s.Subject.Tenant, &s.Subject.ApplicantID, &s.Subject.MemberID, &account, &band, &minor,
		&s.GameID, &s.Mode, &s.GameVersion, &s.ScoringVersion, &s.RulePackVersion, &seed, &s.SeedOrigin, &s.Difficulty,
		&s.Status, &cohort, &participant, &phase, &sc, &s.StartedAt, &s.ExpiresAt, &submitted,
		&verified, &inputs, &enc, &events, &telemetry, &digest, &hints,
		&client, &server, &analysis, &s.ClientPct, &s.ServerPct, &s.Trust,
		&s.Flags, &timing, &eligibility, &rejected)
	if err != nil {
		return nil, err
	}
	s.Subject.Account = account
	switch {
	case s.Subject.MemberID != nil:
		s.Subject.Minor = minor != nil && *minor
		s.Subject.UserBand = "adult"
		if s.Subject.Minor {
			s.Subject.UserBand = "u18"
		}
	case band == "u18" || band == "adult":
		s.Subject.UserBand, s.Subject.Minor = band, band == "u18"
	}
	s.Seed = uint32(seed)
	s.Cohort, s.StudyParticipant, s.StudyPhase = gamesStr(cohort), gamesStr(participant), gamesStr(phase)
	s.TimingMode, s.RejectedType = gamesStr(timing), gamesStr(rejected)
	s.Context, s.ClientResult, s.ServerResult, s.Analysis = sc, client, server, analysis
	s.StartedAt, s.ExpiresAt = s.StartedAt.UTC(), s.ExpiresAt.UTC()
	s.SubmittedAt, s.VerifiedAt = gamesUTC(submitted), gamesUTC(verified)
	if digest != nil {
		r := games.Replay{Digest: *digest, Encoding: gamesStr(enc), Inputs: base64.StdEncoding.EncodeToString(inputs)}
		if events != nil {
			r.EventCount = int(*events)
		}
		if telemetry != nil {
			r.TelemetryVersion = int(*telemetry)
		}
		s.Replay = &r
	}
	if err := json.Unmarshal(hints, &s.Hints); err != nil {
		return nil, fmt.Errorf("store: games: hints: %w", err)
	}
	if err := json.Unmarshal(eligibility, &s.Eligible); err != nil {
		return nil, fmt.Errorf("store: games: eligibility: %w", err)
	}
	if s.Eligible == nil {
		s.Eligible = map[string]bool{}
	}
	if s.Flags == nil {
		s.Flags = []string{}
	}
	return &s, nil
}

func gamesStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func gamesNullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func gamesNullInt(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

func gamesUTC(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// gamesJSON returns raw JSON for a nullable jsonb column (nil for SQL NULL).
func gamesJSON(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return []byte(raw)
}

func gamesMemberID(subj learner.Subject) *uuid.UUID { return subj.MemberID }

// gamesSubmission is the column values of the submission and outcome of a session.
type gamesSubmission struct {
	inputs                   []byte
	encoding, digest         *string
	events, telemetry        *int
	hints, eligibility       []byte
	flags                    []string
	timing, rejected, cohort *string
}

func gamesSubmissionOf(s *games.Session) (*gamesSubmission, error) {
	out := &gamesSubmission{flags: s.Flags, timing: gamesNullStr(s.TimingMode), rejected: gamesNullStr(s.RejectedType),
		cohort: gamesNullStr(s.Cohort)}
	if out.flags == nil {
		out.flags = []string{}
	}
	if r := s.Replay; r != nil {
		raw, err := base64.StdEncoding.DecodeString(r.Inputs)
		if err != nil {
			if raw, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(r.Inputs, "=")); err != nil {
				return nil, fmt.Errorf("store: games: %w: inputs are not base64", games.ErrInvalidReplay)
			}
		}
		if raw == nil {
			raw = []byte{}
		}
		out.inputs, out.encoding, out.digest = raw, gamesNullStr(r.Encoding), gamesNullStr(r.Digest)
		out.events, out.telemetry = &r.EventCount, gamesNullInt(r.TelemetryVersion)
	}
	var err error
	if out.hints, err = json.Marshal(s.Hints); err != nil {
		return nil, fmt.Errorf("store: games: hints: %w", err)
	}
	elig := s.Eligible
	if elig == nil {
		elig = map[string]bool{}
	}
	if out.eligibility, err = json.Marshal(elig); err != nil {
		return nil, fmt.Errorf("store: games: eligibility: %w", err)
	}
	return out, nil
}

// InsertSession inserts the session row (its items go through InsertSessionItems).
func (GamesStore) InsertSession(ctx context.Context, tx pgx.Tx, s *games.Session) error {
	sub, err := gamesSubmissionOf(s)
	if err != nil {
		return err
	}
	sc := []byte(s.Context)
	if len(sc) == 0 {
		sc = []byte(`{}`)
	}
	_, err = tx.Exec(ctx, `INSERT INTO game.sessions (session_id, tenant_id, applicant_id, family_member_id, game_id, mode,
		game_version, scoring_version, rule_pack_version, seed, seed_origin, difficulty, status, cohort, study_participant,
		study_phase, context, started_at, expires_at, submitted_at, verified_at, replay_inputs, replay_encoding,
		replay_event_count, telemetry_version, digest, hints, client_result, server_result, analysis, client_score_pct,
		server_score_pct, trust, integrity_flags, timing_mode, eligibility, rejected_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
		$24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)`,
		s.ID, s.Subject.Tenant, s.Subject.ApplicantID, gamesMemberID(s.Subject), s.GameID, s.Mode,
		s.GameVersion, s.ScoringVersion, s.RulePackVersion, int64(s.Seed), s.SeedOrigin, s.Difficulty, s.Status, sub.cohort,
		gamesNullStr(s.StudyParticipant), gamesNullStr(s.StudyPhase), sc, s.StartedAt, s.ExpiresAt, s.SubmittedAt, s.VerifiedAt,
		sub.inputs, sub.encoding, sub.events, sub.telemetry, sub.digest, sub.hints, gamesJSON(s.ClientResult),
		gamesJSON(s.ServerResult), gamesJSON(s.Analysis), s.ClientPct, s.ServerPct, s.Trust, sub.flags, sub.timing,
		sub.eligibility, sub.rejected)
	if err != nil {
		return fmt.Errorf("store: games: insert session: %w", mapErr(err))
	}
	return nil
}

// InsertSessionItems inserts the items of a session in one statement.
func (GamesStore) InsertSessionItems(ctx context.Context, tx pgx.Tx, sessionID uuid.UUID, items []games.Item) error {
	if len(items) == 0 {
		return nil
	}
	ords := make([]int32, len(items))
	refs := make([]string, len(items))
	versions := make([]string, len(items))
	kinds := make([]string, len(items))
	for i, it := range items {
		ords[i], refs[i], versions[i], kinds[i] = int32(it.Ordinal), it.Ref, it.ContentVersion, it.Kind
	}
	_, err := tx.Exec(ctx, `INSERT INTO game.session_items (session_id, ordinal, tenant_id, item_ref, content_version, kind)
		SELECT $1, i.ord, s.tenant_id, i.ref, i.ver, i.kind
		FROM game.sessions s, unnest($2::smallint[], $3::text[], $4::text[], $5::text[]) AS i(ord, ref, ver, kind)
		WHERE s.session_id = $1`, sessionID, ords, refs, versions, kinds)
	if err != nil {
		return fmt.Errorf("store: games: insert items: %w", mapErr(err))
	}
	return nil
}

// gamesLoadItems fills the items of sessions (ordered by ordinal).
func gamesLoadItems(ctx context.Context, tx pgx.Tx, sessions []*games.Session) error {
	if len(sessions) == 0 {
		return nil
	}
	byID := make(map[uuid.UUID]*games.Session, len(sessions))
	ids := make([]uuid.UUID, len(sessions))
	for i, s := range sessions {
		byID[s.ID], ids[i] = s, s.ID
	}
	rows, err := tx.Query(ctx, `SELECT session_id, ordinal, item_ref, content_version, kind FROM game.session_items
		WHERE session_id = ANY($1) ORDER BY session_id, ordinal`, ids)
	if err != nil {
		return fmt.Errorf("store: games: items: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var it games.Item
		if err := rows.Scan(&id, &it.Ordinal, &it.Ref, &it.ContentVersion, &it.Kind); err != nil {
			return fmt.Errorf("store: games: items: %w", err)
		}
		byID[id].Items = append(byID[id].Items, it)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("store: games: items: %w", err)
	}
	return nil
}

// GetSessionForUpdate locks the session row (FOR UPDATE) and returns it with its items, or
// games.ErrNotFound (also for another tenant's session under RLS).
func (GamesStore) GetSessionForUpdate(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*games.Session, error) {
	s, err := gamesScanSession(tx.QueryRow(ctx, `SELECT `+gamesSessionCols+gamesSessionFrom+
		` WHERE s.session_id = $1 FOR UPDATE OF s`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, games.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store: games: get session: %w", err)
	}
	if err := gamesLoadItems(ctx, tx, []*games.Session{s}); err != nil {
		return nil, err
	}
	return s, nil
}

// gamesUpdate writes the submission and outcome of a session (status included, as given).
func gamesUpdate(ctx context.Context, tx pgx.Tx, s *games.Session, what string) error {
	sub, err := gamesSubmissionOf(s)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE game.sessions SET status = $2, submitted_at = $3, verified_at = $4,
		replay_inputs = $5, replay_encoding = $6, replay_event_count = $7, telemetry_version = $8, digest = $9, hints = $10,
		client_result = $11, server_result = $12, analysis = $13, client_score_pct = $14, server_score_pct = $15, trust = $16,
		integrity_flags = $17, timing_mode = $18, eligibility = $19, rejected_type = $20
		WHERE session_id = $1`,
		s.ID, s.Status, s.SubmittedAt, s.VerifiedAt, sub.inputs, sub.encoding, sub.events, sub.telemetry, sub.digest,
		sub.hints, gamesJSON(s.ClientResult), gamesJSON(s.ServerResult), gamesJSON(s.Analysis), s.ClientPct, s.ServerPct,
		s.Trust, sub.flags, sub.timing, sub.eligibility, sub.rejected)
	if err != nil {
		return fmt.Errorf("store: games: %s: %w", what, mapErr(err))
	}
	if tag.RowsAffected() == 0 {
		return games.ErrNotFound
	}
	return nil
}

// CompleteSession writes a verified outcome.
func (GamesStore) CompleteSession(ctx context.Context, tx pgx.Tx, s *games.Session) error {
	return gamesUpdate(ctx, tx, s, "complete session")
}

// MarkPending stores a submission for a later replay.
func (GamesStore) MarkPending(ctx context.Context, tx pgx.Tx, s *games.Session) error {
	return gamesUpdate(ctx, tx, s, "mark pending")
}

// VoidSession records a rejected replay.
func (GamesStore) VoidSession(ctx context.Context, tx pgx.Tx, s *games.Session) error {
	return gamesUpdate(ctx, tx, s, "void session")
}

// ListPending locks and returns up to limit pending sessions of every tenant (System
// transaction), oldest submission first, skipping rows another run holds.
func (GamesStore) ListPending(ctx context.Context, tx pgx.Tx, limit int) ([]*games.Session, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx, `SELECT `+gamesSessionCols+gamesSessionFrom+`
		WHERE s.status = 'pending_verification' ORDER BY s.submitted_at, s.session_id LIMIT $1 FOR UPDATE OF s SKIP LOCKED`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: games: list pending: %w", err)
	}
	var out []*games.Session
	for rows.Next() {
		s, err := gamesScanSession(rows)
		if err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: games: list pending: %w", err)
		}
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: games: list pending: %w", err)
	}
	if err := gamesLoadItems(ctx, tx, out); err != nil {
		return nil, err
	}
	return out, nil
}

const gamesSubjectWhere = `tenant_id = $1 AND applicant_id = $2 AND family_member_id IS NOT DISTINCT FROM $3`

func gamesStrings(ctx context.Context, tx pgx.Tx, what, sql string, args ...any) ([]string, error) {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("store: games: %s: %w", what, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("store: games: %s: %w", what, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: games: %s: %w", what, err)
	}
	return out, nil
}

// SeenClipIDs returns every clip ID the subject was exposed to, sorted (byte order).
func (GamesStore) SeenClipIDs(ctx context.Context, tx pgx.Tx, subj games.Subject) ([]string, error) {
	return gamesStrings(ctx, tx, "seen clips", `SELECT clip_id FROM game.clip_exposures WHERE `+gamesSubjectWhere+
		` ORDER BY clip_id COLLATE "C"`, subj.Tenant, subj.ApplicantID, gamesMemberID(subj))
}

// ClipsSeenBefore returns, in the order of ids, those the subject first saw strictly before t.
func (GamesStore) ClipsSeenBefore(ctx context.Context, tx pgx.Tx, subj games.Subject, ids []string, t time.Time) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	found, err := gamesStrings(ctx, tx, "clips seen before", `SELECT clip_id FROM game.clip_exposures WHERE `+gamesSubjectWhere+
		` AND clip_id = ANY($4) AND first_seen_at < $5`, subj.Tenant, subj.ApplicantID, gamesMemberID(subj), ids, t)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(found))
	for _, id := range found {
		seen[id] = true
	}
	var out []string
	for _, id := range ids {
		if seen[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

// RecordExposures inserts exposures in order; a clip already recorded for the subject (or
// earlier in ex) is ignored, so the first exposure wins. Keyed by clip ID, not version.
func (GamesStore) RecordExposures(ctx context.Context, tx pgx.Tx, subj games.Subject, ex []games.Exposure) error {
	if len(ex) == 0 {
		return nil
	}
	clipIDs := make([]string, len(ex))
	vias := make([]string, len(ex))
	sids := make([]*uuid.UUID, len(ex))
	ats := make([]time.Time, len(ex))
	for i, e := range ex {
		clipIDs[i], vias[i], ats[i] = e.ClipID, e.Via, e.At
		if e.SessionID != uuid.Nil {
			sid := e.SessionID
			sids[i] = &sid
		}
	}
	_, err := tx.Exec(ctx, `INSERT INTO game.clip_exposures (tenant_id, applicant_id, family_member_id, clip_id, via, session_id, first_seen_at)
		SELECT $1, $2, $3, e.clip_id, e.via, e.sid, e.at
		FROM unnest($4::text[], $5::text[], $6::uuid[], $7::timestamptz[]) WITH ORDINALITY AS e(clip_id, via, sid, at, ord)
		ORDER BY e.ord
		ON CONFLICT ON CONSTRAINT clip_exposures_subject_clip_uq DO NOTHING`,
		subj.Tenant, subj.ApplicantID, gamesMemberID(subj), clipIDs, vias, sids, ats)
	if err != nil {
		return fmt.Errorf("store: games: record exposures: %w", mapErr(err))
	}
	return nil
}

// RecentItemRefs returns the item refs of the subject's sessions of gameID, newest session first
// (items in order), stopping before the next session once limit refs are collected: the last
// session is included whole (games.MemStore semantics).
func (GamesStore) RecentItemRefs(ctx context.Context, tx pgx.Tx, subj games.Subject, gameID string, limit int) ([]string, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx, `WITH recent AS (
			SELECT s.session_id, s.started_at FROM game.sessions s
			WHERE s.tenant_id = $1 AND s.applicant_id = $2 AND s.family_member_id IS NOT DISTINCT FROM $3 AND s.game_id = $4
			  AND EXISTS (SELECT 1 FROM game.session_items i WHERE i.session_id = s.session_id)
			ORDER BY s.started_at DESC, s.session_id DESC LIMIT $5)
		SELECT r.session_id, i.item_ref FROM recent r JOIN game.session_items i ON i.session_id = r.session_id
		ORDER BY r.started_at DESC, r.session_id DESC, i.ordinal`,
		subj.Tenant, subj.ApplicantID, gamesMemberID(subj), gameID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: games: recent items: %w", err)
	}
	defer rows.Close()
	var out []string
	var current uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		var ref string
		if err := rows.Scan(&id, &ref); err != nil {
			return nil, fmt.Errorf("store: games: recent items: %w", err)
		}
		if id != current {
			if len(out) >= limit {
				break
			}
			current = id
		}
		out = append(out, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: games: recent items: %w", err)
	}
	return out, nil
}

// EligibleMocks returns the server percentages of the subject's last n checked sessions with
// nazar_eligible (the generated column over eligibility.nazar_score), newest verified first.
func (GamesStore) EligibleMocks(ctx context.Context, tx pgx.Tx, subj games.Subject, n int) ([]float64, error) {
	if n == 0 {
		return nil, nil
	}
	var lim *int
	if n > 0 {
		lim = &n
	}
	rows, err := tx.Query(ctx, `SELECT server_score_pct::float8 FROM game.sessions
		WHERE `+gamesSubjectWhere+` AND status = 'checked' AND nazar_eligible AND server_score_pct IS NOT NULL
		ORDER BY verified_at DESC, session_id DESC LIMIT $4`, subj.Tenant, subj.ApplicantID, gamesMemberID(subj), lim)
	if err != nil {
		return nil, fmt.Errorf("store: games: eligible mocks: %w", err)
	}
	defer rows.Close()
	var out []float64
	for rows.Next() {
		var p float64
		if err := rows.Scan(&p); err != nil {
			return nil, fmt.Errorf("store: games: eligible mocks: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: games: eligible mocks: %w", err)
	}
	return out, nil
}

// IncrementCounter bumps an ops counter (store.IncrementCounter).
func (GamesStore) IncrementCounter(ctx context.Context, tx pgx.Tx, tenant, name string, by int64) error {
	if err := IncrementCounter(ctx, tx, tenant, name, by); err != nil {
		return fmt.Errorf("store: games: counter: %w", err)
	}
	return nil
}

// GamesStaircase is the difficulty staircase on game.staircase (GAME_SDK §7).
type GamesStaircase struct{}

var _ games.Staircase = GamesStaircase{}

// Level returns the subject's level for a game and skill, 1 when nothing was recorded.
func (GamesStaircase) Level(ctx context.Context, tx pgx.Tx, subj learner.Subject, gameID, skillID string) (int, error) {
	var level int
	err := tx.QueryRow(ctx, `SELECT level FROM game.staircase WHERE `+gamesSubjectWhere+` AND game_id = $4 AND skill_id = $5`,
		subj.Tenant, subj.ApplicantID, subj.MemberID, gameID, skillID).Scan(&level)
	if errors.Is(err, pgx.ErrNoRows) {
		return games.StaircaseMin, nil
	}
	if err != nil {
		return 0, fmt.Errorf("store: games: staircase level: %w", err)
	}
	return level, nil
}

// Record applies one item outcome (two consecutive passes step up, one fail steps down, levels
// 1–5; games.StaircaseStep) in a single upsert on the subject, game and skill, and returns the
// new level. Mock mode does not adapt: callers skip it there.
func (GamesStaircase) Record(ctx context.Context, tx pgx.Tx, subj learner.Subject, gameID, skillID string, passed bool) (int, error) {
	level0, streak0 := games.StaircaseStep(games.StaircaseMin, 0, passed)
	var level int
	err := tx.QueryRow(ctx, `INSERT INTO game.staircase AS st (tenant_id, applicant_id, family_member_id, game_id, skill_id, level, streak_pass)
		VALUES ($1, $2, $3, $4, $5, $7, $8)
		ON CONFLICT ON CONSTRAINT staircase_subject_uq DO UPDATE SET
		  level = CASE WHEN NOT $6 THEN GREATEST(1, st.level - 1)
		               WHEN st.streak_pass + 1 >= 2 THEN LEAST(5, st.level + 1)
		               ELSE st.level END,
		  streak_pass = CASE WHEN NOT $6 OR st.streak_pass + 1 >= 2 THEN 0 ELSE st.streak_pass + 1 END
		RETURNING level`,
		subj.Tenant, subj.ApplicantID, subj.MemberID, gameID, skillID, passed, level0, streak0).Scan(&level)
	if err != nil {
		return 0, fmt.Errorf("store: games: staircase record: %w", mapErr(err))
	}
	return level, nil
}

// GamesTakerStats is clips.TakerStats over verified sessions (clip.recompute_difficulty).
type GamesTakerStats struct{ DB *DB }

var _ clips.TakerStats = GamesTakerStats{}

// ClipTakerStats returns the mean points per hazard (0–5) and the taker count for a clip version.
// ref is the clip document ref ("JMU-0012@3", clips.Doc.Ref) or the item ref
// ("clip:JMU-0012@3", as the verifier's analysis carries it); both match.
//
// A taker is a subject (tenant, applicant, family member). Each taker counts once, with the
// earliest (verified_at) checked, nazar_eligible session whose analysis.nazar_clips.clips holds
// the ref; a clip that attempt voided (pattern, INT_TAB_HIDDEN, ...) drops that taker. Points per
// hazard come from the 5-band analysis (nazar_clips, rule kerala_5band): 6 − band when band is
// set (band is the index 1 = earliest … 5, not the points), otherwise credit, which under the
// 5-band rule already is 0–5 points (0 = not credited); under field_kit_linear, credit is a
// fraction and counts as credit × 5. The mean pools every hazard of every counted attempt (all
// takers of a clip version see the same hazards); 0 when there is none. Cross-tenant read.
func (g GamesTakerStats) ClipTakerStats(ctx context.Context, ref string) (meanPoints float64, nTakers int, err error) {
	docRef := strings.TrimPrefix(ref, "clip:")
	err = g.DB.InSystem(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `WITH firsts AS (
				SELECT DISTINCT ON (s.tenant_id, s.applicant_id, s.family_member_id)
				       c.clip, COALESCE(s.analysis -> 'nazar_clips' ->> 'rule', 'kerala_5band') AS rule
				FROM game.sessions s
				CROSS JOIN LATERAL jsonb_array_elements(
				  CASE WHEN jsonb_typeof(s.analysis -> 'nazar_clips' -> 'clips') = 'array'
				       THEN s.analysis -> 'nazar_clips' -> 'clips' ELSE '[]'::jsonb END) AS c(clip)
				WHERE s.status = 'checked' AND s.nazar_eligible
				  AND (c.clip ->> 'ref' = $1 OR c.clip ->> 'ref' = 'clip:' || $1)
				ORDER BY s.tenant_id, s.applicant_id, s.family_member_id, s.verified_at, s.session_id
			), takers AS (
				SELECT clip, rule FROM firsts WHERE COALESCE(jsonb_typeof(clip -> 'voided'), 'null') = 'null'
			), points AS (
				SELECT LEAST(5, GREATEST(0, CASE
				         WHEN jsonb_typeof(x.h -> 'band') = 'number' THEN 6 - (x.h ->> 'band')::numeric
				         WHEN jsonb_typeof(x.h -> 'credit') <> 'number' THEN 0
				         WHEN t.rule = 'field_kit_linear' THEN (x.h ->> 'credit')::numeric * 5
				         ELSE (x.h ->> 'credit')::numeric END)) AS p
				FROM takers t
				CROSS JOIN LATERAL jsonb_array_elements(
				  CASE WHEN jsonb_typeof(t.clip -> 'hazards') = 'array' THEN t.clip -> 'hazards' ELSE '[]'::jsonb END) AS x(h)
			)
			SELECT COALESCE((SELECT avg(p) FROM points), 0)::float8, (SELECT count(*) FROM takers)::int`, docRef).Scan(&meanPoints, &nTakers)
	})
	if err != nil {
		return 0, 0, fmt.Errorf("store: games: taker stats: %w", err)
	}
	return meanPoints, nTakers, nil
}
