package httpapi_test

// P2 data principal rights: API-61 export and API-62 erasure over game.*, learn.*, study.* and
// records.declarations (scoped per applicant and family member), and the P2 retention steps.
// TestExportContainsOnlyMyRows and TestEC26AccountDeletedMidCase call the helpers here.

import (
	"context"
	"crypto/sha256"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
)

// meApplicant returns the client's applicant UUID (GET /v1/me subject).
func meApplicant(t *testing.T, c *client) uuid.UUID {
	t.Helper()
	r := c.do("GET", "/v1/me", nil, nil)
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	sub := r.json(t)["subject"].(string)
	prefix, _, _ := strings.Cut(sub, "_")
	id, err := ids.Decode(prefix, sub)
	require.NoError(t, err)
	return id
}

// addMinor adds a consented minor family member and returns its UUID.
func addMinor(t *testing.T, c *client) uuid.UUID {
	t.Helper()
	r := c.do("POST", "/v1/me/family-members", map[string]any{"relation": "child", "label": "Rahul", "dob": "2009-03-14", "dob_precision": "day"}, nil)
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	ref := r.json(t)["member_id"].(string)
	r = c.do("POST", "/v1/me/family-members/"+ref+"/parental-consent", map[string]any{"action": "grant", "notice_version": "notice-2026.10.23-hi"}, nil)
	require.Containsf(t, []int{http.StatusOK, http.StatusCreated}, r.Status, "%s", r.Body)
	id, err := ids.Decode(ids.FamilyMember, ref)
	require.NoError(t, err)
	return id
}

// shortIDFor is a valid share-card short ID derived from tag (alphabet without l and o).
func shortIDFor(tag string) string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	sum := sha256.Sum256([]byte(tag))
	b := make([]byte, 10)
	for i := range b {
		b[i] = alphabet[int(sum[i])%len(alphabet)]
	}
	return string(b)
}

// p2SeedRows writes one row in every per-subject P2 table for (applicant, member), marked with
// tag, at time at. It returns the game session ID.
func p2SeedRows(t *testing.T, e *env, applicant uuid.UUID, member *uuid.UUID, tag string, at time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	sid := ids.New()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		stmts := []struct {
			q    string
			args []any
		}{
			{`INSERT INTO game.sessions (session_id, tenant_id, applicant_id, family_member_id, game_id, mode, game_version, scoring_version,
			    rule_pack_version, seed, seed_origin, difficulty, status, context, started_at, expires_at, submitted_at, verified_at, digest,
			    server_result, replay_inputs, replay_encoding)
			  VALUES ($1, 'JK', $2, $3, 'nazar', 'practice', '1.0.0', '1.0', '2026.10.0', 7, 'server', 1, 'checked', '{}', $4, $5, $4, $4,
			    'sha256:' || repeat('0', 64), '{}', $6, 'mdr1')`,
				[]any{sid, applicant, member, at, at.Add(time.Hour), []byte("replay-" + tag)}},
			{`INSERT INTO game.session_items (session_id, ordinal, tenant_id, item_ref, content_version, kind) VALUES ($1, 1, 'JK', 'clip:KL-0001@1', '1', 'clip')`,
				[]any{sid}},
			{`INSERT INTO game.clip_exposures (tenant_id, applicant_id, family_member_id, clip_id, via, session_id, first_seen_at)
			  VALUES ('JK', $1, $2, 'KL-0001', 'practice', $3, $4)`, []any{applicant, member, sid, at}},
			{`INSERT INTO game.staircase (tenant_id, applicant_id, family_member_id, game_id, skill_id, level) VALUES ('JK', $1, $2, 'nazar', 'nazar', 2)`,
				[]any{applicant, member}},
			{`INSERT INTO game.xp_ledger (entry_id, tenant_id, applicant_id, family_member_id, reason, source_id, xp, ist_day, week_key, created_at)
			  VALUES ($1, 'JK', $2, $3, 'session', $4, 10, '2026-10-24', '2026-W43', $5)`, []any{ids.New(), applicant, member, "xp-" + tag, at}},
			{`INSERT INTO game.streaks (tenant_id, applicant_id, family_member_id, xp_total) VALUES ('JK', $1, $2, 10)`, []any{applicant, member}},
			{`INSERT INTO game.badges (tenant_id, applicant_id, family_member_id, badge_id, awarded_at) VALUES ('JK', $1, $2, 'B3', $3)`,
				[]any{applicant, member, at}},
			{`INSERT INTO game.share_cards (short_id, tenant_id, applicant_id, family_member_id, kind, display, display_text, created_at, expires_at)
			  VALUES ($1, 'JK', $2, $3, 'nazar_score', 'first_name', 'Card', $4, $5)`, []any{shortIDFor(tag), applicant, member, at, at.Add(90 * 24 * time.Hour)}},
			{`INSERT INTO learn.answers (tenant_id, applicant_id, family_member_id, client_answer_id, qref, card_id, topic, correct, rating, overconfident,
			    answered_at, reviewed_at, next_due_at, received_at)
			  VALUES ('JK', $1, $2, $3, 'q:Q1:v1', 'C-M1-001', 'M1', true, 3, false, $4, $4, $4, $4)`, []any{applicant, member, "ans-" + tag, at}},
			{`INSERT INTO learn.review_log (tenant_id, applicant_id, family_member_id, card_id, rating, reviewed_at, source_kind, source_id)
			  VALUES ('JK', $1, $2, 'C-M1-001', 3, $3, 'answer', $4)`, []any{applicant, member, at, "ans-" + tag}},
			{`INSERT INTO learn.card_state (tenant_id, applicant_id, family_member_id, card_id, state, due_at, computed_at)
			  VALUES ('JK', $1, $2, 'C-M1-001', '{}', $3, $3)`, []any{applicant, member, at}},
			{`INSERT INTO learn.topic_mastery (tenant_id, applicant_id, family_member_id, topic, mastery, coverage, node_state, computed_at)
			  VALUES ('JK', $1, $2, 'M1', 0.5, 0.5, 'learning', $3)`, []any{applicant, member, at}},
			{`INSERT INTO learn.readiness_snapshots (tenant_id, applicant_id, family_member_id, computed_at, log_count, readiness, knowledge,
			    cal_penalty, gate_met, state) VALUES ('JK', $1, $2, $3, 1, 50, 50, 0, false, '{}')`, []any{applicant, member, at}},
			{`INSERT INTO records.declarations (tenant_id, applicant_id, family_member_id, dl_issued_on, no_agent_used, declared_at)
			  VALUES ('JK', $1, $2, '2025-01-01', true, $3)`, []any{applicant, member, at}},
		}
		for _, s := range stmts {
			if _, err := tx.Exec(ctx, s.q, s.args...); err != nil {
				return err
			}
		}
		return nil
	}))
	return sid
}

// insertSquad creates a squad whose first member is the owner; it returns the squad ID.
func insertSquad(t *testing.T, e *env, name string, members ...uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := ids.New()
	hash := sha256.Sum256([]byte("invite:" + name))
	now := e.clock.Now()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO game.squads (squad_id, tenant_id, name, invite_code_hash, invite_expires_at) VALUES ($1, 'JK', $2, $3, $4)`,
			id, name, hash[:], now.Add(7*24*time.Hour)); err != nil {
			return err
		}
		for i, m := range members {
			role := "member"
			if i == 0 {
				role = "owner"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO game.squad_members (squad_id, tenant_id, applicant_id, display_name, role, joined_at, member_ord)
				VALUES ($1, 'JK', $2, $3, $4, $5, $6)`, id, m, name+"-m"+string(rune('a'+i)), role, now.Add(time.Duration(i)*time.Minute), i); err != nil {
				return err
			}
		}
		return nil
	}))
	return id
}

// p2PerSubjectTables are the tables keyed by applicant_id (share cards are withdrawn, not deleted).
var p2PerSubjectTables = []string{"game.sessions", "game.clip_exposures", "game.staircase", "game.xp_ledger", "game.streaks", "game.badges",
	"game.squad_members", "learn.answers", "learn.review_log", "learn.card_state", "learn.topic_mastery", "learn.readiness_snapshots",
	"records.declarations", "study.nazar_participants"}

// p2Counts counts the applicant's rows in every per-subject P2 table (as mg_jobs).
func p2Counts(t *testing.T, e *env, applicant uuid.UUID) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, tbl := range append(append([]string{}, p2PerSubjectTables...), "game.share_cards") {
		out[tbl] = e.count(`SELECT count(*) FROM `+tbl+` WHERE applicant_id = $1`, applicant)
	}
	out["game.share_cards active"] = e.count(`SELECT count(*) FROM game.share_cards WHERE applicant_id = $1 AND withdrawn_at IS NULL`, applicant)
	return out
}

// studyEnrolUser grants the field_study consent and enrols the client; it returns the code.
func studyEnrolUser(t *testing.T, c *client) string {
	t.Helper()
	studyGrantConsent(t, c)
	r := c.do("POST", studyEnrolPath, studyOKBody(), idem())
	require.Equalf(t, http.StatusCreated, r.Status, "%s", r.Body)
	return r.json(t)["participant_code"].(string)
}

// MD-137 for the P2 tables (DATA_MODEL §1.2, §4.4, §4.5; FIELD_STUDY §6.3).
func TestRetentionP2(t *testing.T) {
	e := newEnv(t)
	a := e.userClient("retention.p2@example.com")
	app := meApplicant(t, a)
	now := e.clock.Now()
	oldSID := p2SeedRows(t, e, app, nil, "old", now.Add(-100*24*time.Hour))
	member := addMinor(t, a)
	freshSID := p2SeedRows(t, e, app, &member, "fresh", now.Add(-time.Hour))
	ctx := context.Background()
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		// The old card was withdrawn 31 days ago; a squad was disbanded 31 days ago.
		if _, err := tx.Exec(ctx, `UPDATE game.share_cards SET withdrawn_at = $2 WHERE short_id = $1`, shortIDFor("old"), now.Add(-31*24*time.Hour)); err != nil {
			return err
		}
		return nil
	}))
	gone := insertSquad(t, e, "Old squad", app)
	kept := insertSquad(t, e, "Live squad", app)
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE game.squads SET disbanded_at = $2 WHERE squad_id = $1`, gone, now.Add(-31*24*time.Hour))
		return err
	}))
	// A study participant withdraws by revoking the field_study consent ("Delete my data").
	code := studyEnrolUser(t, a)
	require.NoError(t, e.app.DB.System(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO game.sessions (session_id, tenant_id, applicant_id, game_id, mode, game_version, scoring_version,
			  rule_pack_version, seed, seed_origin, difficulty, status, cohort, study_participant, study_phase, context, started_at, expires_at)
			VALUES ($1, 'JK', $2, 'nazar', 'mock', '1.0.0', '1.0', '2026.10.0', 1, 'server', 3, 'started', 'field_test', $3, 'test', '{}', $4, $5)`,
			ids.New(), app, code, now, now.Add(time.Hour))
		return err
	}))
	a.revoke(t, "field_study")
	require.Equal(t, 1, e.count(`SELECT count(*) FROM study.nazar_participants WHERE participant_code = $1 AND withdrawn_at IS NOT NULL`, code))

	r := e.step("retention.sweep", map[string]any{})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	res := r.json(t)
	require.EqualValues(t, 1, res["game_replay_inputs"], "replay inputs older than 90 days")
	require.EqualValues(t, 1, res["learn_answers"], "raw answers older than 90 days")
	require.EqualValues(t, 1, res["share_cards"], "withdrawn more than 30 days ago")
	require.EqualValues(t, 1, res["squads_disbanded"])
	require.EqualValues(t, 1, res["study_withdrawn_sessions"])
	require.EqualValues(t, 1, res["study_withdrawn_participants"])
	require.Equal(t, 1, e.count(`SELECT count(*) FROM game.sessions WHERE session_id = $1 AND replay_inputs IS NULL AND server_result IS NOT NULL`, oldSID),
		"the score stays (RT-ACCOUNT); only the replay goes")
	require.Equal(t, 1, e.count(`SELECT count(*) FROM game.sessions WHERE session_id = $1 AND replay_inputs IS NOT NULL`, freshSID))
	require.Equal(t, 1, e.count(`SELECT count(*) FROM learn.answers WHERE client_answer_id = 'ans-fresh'`))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM game.squads WHERE squad_id = $1`, gone))
	require.Equal(t, 1, e.count(`SELECT count(*) FROM game.squads WHERE squad_id = $1`, kept))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM study.nazar_participants`))
	require.Equal(t, 0, e.count(`SELECT count(*) FROM game.sessions WHERE cohort = 'field_test'`))

	// A year on, the revoked consent proof goes too (nothing references it any more).
	e.clock.Advance(366 * 24 * time.Hour)
	r = e.step("retention.sweep", map[string]any{})
	require.Equalf(t, http.StatusOK, r.Status, "%s", r.Body)
	require.Equal(t, 0, e.count(`SELECT count(*) FROM privacy.consent_artefacts WHERE purpose = 'field_study'`))
}
