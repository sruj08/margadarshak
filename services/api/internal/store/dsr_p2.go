package store

// Data principal rights over the P2 tables (API-61 export, API-62 erasure, MD-137 retention):
// game.* (sessions and their items, clip exposures, the staircase, XP ledger, badges, streaks,
// squads and memberships, share cards), learn.*, study.nazar_participants and
// records.declarations. Every row is keyed by tenant_id, applicant_id and family_member_id, so
// an account's rows include its family members' rows.

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// p2ExportQueries are the export reads, one jsonb array each. $1 is the applicant; the caller's
// transaction is the tenant's (mg_app, RLS), and every query filters on the applicant as well.
// tenant_id and applicant_id are left out of every row (the bundle names the subject once).
var p2ExportQueries = []struct{ section, key, q string }{
	{"game", "sessions", `SELECT coalesce(jsonb_agg(
		  (to_jsonb(s) - 'tenant_id' - 'applicant_id' - 'replay_inputs' - 'nazar_eligible')
		  || jsonb_build_object(
		       'replay_inputs_base64', CASE WHEN s.replay_inputs IS NULL THEN NULL
		                                    ELSE translate(encode(s.replay_inputs, 'base64'), E'\n', '') END,
		       'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal', i.ordinal, 'item_ref', i.item_ref,
		                   'content_version', i.content_version, 'kind', i.kind) ORDER BY i.ordinal), '[]'::jsonb)
		                 FROM game.session_items i WHERE i.session_id = s.session_id))
		  ORDER BY s.started_at, s.session_id), '[]'::jsonb)
		FROM game.sessions s WHERE s.applicant_id = $1`},
	{"game", "clip_exposures", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id' - 'exposure_id'
		  ORDER BY t.first_seen_at, t.clip_id), '[]'::jsonb) FROM game.clip_exposures t WHERE t.applicant_id = $1`},
	{"game", "staircase", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id' - 'staircase_id'
		  ORDER BY t.game_id, t.skill_id), '[]'::jsonb) FROM game.staircase t WHERE t.applicant_id = $1`},
	{"game", "xp_ledger", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.created_at, t.entry_id), '[]'::jsonb) FROM game.xp_ledger t WHERE t.applicant_id = $1`},
	{"game", "streaks", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.updated_at), '[]'::jsonb) FROM game.streaks t WHERE t.applicant_id = $1`},
	{"game", "badges", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.awarded_at, t.badge_id), '[]'::jsonb) FROM game.badges t WHERE t.applicant_id = $1`},
	// Only the account's own memberships: the other members' display names are their data.
	{"game", "squads", `SELECT coalesce(jsonb_agg(jsonb_build_object('squad_id', 'sqd_' || q.squad_id::text, 'name', q.name,
		  'family_member_id', m.family_member_id, 'display_name', m.display_name, 'role', m.role, 'joined_at', m.joined_at,
		  'members', (SELECT count(*) FROM game.squad_members x WHERE x.squad_id = m.squad_id), 'disbanded_at', q.disbanded_at)
		  ORDER BY m.joined_at, q.squad_id), '[]'::jsonb)
		FROM game.squad_members m JOIN game.squads q ON q.squad_id = m.squad_id WHERE m.applicant_id = $1`},
	{"game", "share_cards", `SELECT coalesce(jsonb_agg(jsonb_build_object('share_card_id', 'shc_' || upper(t.short_id),
		  'family_member_id', t.family_member_id, 'kind', t.kind, 'display', t.display, 'display_text', t.display_text,
		  'badge_id', t.badge_id, 'kerala_line', t.kerala_line, 'created_at', t.created_at, 'expires_at', t.expires_at,
		  'withdrawn_at', t.withdrawn_at) ORDER BY t.created_at, t.short_id), '[]'::jsonb)
		FROM game.share_cards t WHERE t.applicant_id = $1`},
	{"learning", "answers", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.answer_id), '[]'::jsonb) FROM learn.answers t WHERE t.applicant_id = $1`},
	{"learning", "review_log", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.review_id), '[]'::jsonb) FROM learn.review_log t WHERE t.applicant_id = $1`},
	{"learning", "card_state", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.card_id), '[]'::jsonb) FROM learn.card_state t WHERE t.applicant_id = $1`},
	{"learning", "topic_mastery", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.topic), '[]'::jsonb) FROM learn.topic_mastery t WHERE t.applicant_id = $1`},
	{"learning", "readiness_snapshots", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.snapshot_id), '[]'::jsonb) FROM learn.readiness_snapshots t WHERE t.applicant_id = $1`},
	{"study", "nazar_participants", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.seq), '[]'::jsonb) FROM study.nazar_participants t WHERE t.applicant_id = $1`},
	{"records", "declarations", `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'tenant_id' - 'applicant_id'
		  ORDER BY t.declared_at), '[]'::jsonb) FROM records.declarations t WHERE t.applicant_id = $1`},
}

// P2Export returns the applicant's P2 rows grouped by section ("game", "learning", "study",
// "records"), each a map of table name to rows (JSON objects; family_member_id is the raw UUID).
func P2Export(ctx context.Context, tx pgx.Tx, applicant uuid.UUID) (map[string]map[string][]map[string]any, error) {
	out := map[string]map[string][]map[string]any{}
	for _, x := range p2ExportQueries {
		var raw []byte
		if err := tx.QueryRow(ctx, x.q, applicant).Scan(&raw); err != nil {
			return nil, fmt.Errorf("store: export %s.%s: %w", x.section, x.key, err)
		}
		rows := []map[string]any{}
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, fmt.Errorf("store: export %s.%s: %w", x.section, x.key, err)
		}
		if out[x.section] == nil {
			out[x.section] = map[string][]map[string]any{}
		}
		out[x.section][x.key] = rows
	}
	return out, nil
}

// p2EraseTables are hard-deleted on erasure, in this order (session items cascade with their
// session). The learning review log and the XP ledger are append-only for mg_app, and the study
// table refuses deletes from it, so P2Erase runs these as mg_jobs.
var p2EraseTables = []struct{ name, table string }{
	{"game_sessions_deleted", "game.sessions"},
	{"clip_exposures_deleted", "game.clip_exposures"},
	{"staircase_deleted", "game.staircase"},
	{"xp_ledger_deleted", "game.xp_ledger"},
	{"badges_deleted", "game.badges"},
	{"streaks_deleted", "game.streaks"},
	{"learn_answers_deleted", "learn.answers"},
	{"learn_review_log_deleted", "learn.review_log"},
	{"learn_card_state_deleted", "learn.card_state"},
	{"learn_topic_mastery_deleted", "learn.topic_mastery"},
	{"learn_readiness_deleted", "learn.readiness_snapshots"},
	{"declarations_deleted", "records.declarations"},
	{"study_participants_deleted", "study.nazar_participants"},
}

// P2Erase erases the applicant's P2 rows inside tx (API-62, EC-26), for the account and every
// family member in it:
//   - squad memberships are removed; a squad left without an owner gets its longest-standing
//     member as owner, and a squad left empty is disbanded. The squad score needs at least three
//     contributing members (gamify.MinScoreMembers), so a squad that drops below three stops
//     scoring on its next read;
//   - share cards are withdrawn at once (their links answer 410); the retention job hard-deletes
//     them 30 days later;
//   - every other P2 row (sessions with their items and replays, exposures, staircase, XP,
//     badges, streaks, learning state, declarations, the pseudonymous study participant rows;
//     the participant's study sessions are game.sessions rows of the same applicant) is deleted.
//
// It switches the transaction to mg_jobs for these statements (the append-only grants deny
// mg_app the deletes) and switches back to the caller's role; every statement names the tenant
// and the applicant explicitly.
func P2Erase(ctx context.Context, tx pgx.Tx, tenant string, applicant uuid.UUID, now time.Time) (counts map[string]int64, err error) {
	var role string
	if err := tx.QueryRow(ctx, `SELECT current_user`).Scan(&role); err != nil {
		return nil, fmt.Errorf("store: erase: role: %w", err)
	}
	if role != "mg_app" && role != "mg_jobs" {
		return nil, fmt.Errorf("store: erase: unexpected role %q", role)
	}
	if role == "mg_app" {
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE mg_jobs`); err != nil {
			return nil, fmt.Errorf("store: erase: set role: %w", err)
		}
		defer func() {
			if _, rerr := tx.Exec(ctx, `SET LOCAL ROLE mg_app`); rerr != nil && err == nil {
				err = fmt.Errorf("store: erase: restore role: %w", rerr)
			}
		}()
	}
	counts = map[string]int64{}

	// Squads: leave, hand over ownership, disband the empty ones.
	var left int64
	var squads []uuid.UUID
	if err := tx.QueryRow(ctx, `WITH gone AS (
			DELETE FROM game.squad_members WHERE tenant_id = $1 AND applicant_id = $2 RETURNING squad_id)
		SELECT count(*), coalesce(array_agg(DISTINCT squad_id), '{}') FROM gone`, tenant, applicant).Scan(&left, &squads); err != nil {
		return nil, fmt.Errorf("store: erase: squad members: %w", err)
	}
	counts["squad_memberships_removed"] = left
	if len(squads) > 0 {
		tag, err := tx.Exec(ctx, `UPDATE game.squads q SET disbanded_at = $2
			WHERE q.squad_id = ANY($1) AND q.disbanded_at IS NULL
			  AND NOT EXISTS (SELECT 1 FROM game.squad_members m WHERE m.squad_id = q.squad_id)`, squads, now)
		if err != nil {
			return nil, fmt.Errorf("store: erase: disband: %w", err)
		}
		counts["squads_disbanded"] = tag.RowsAffected()
		if _, err := tx.Exec(ctx, `UPDATE game.squad_members m SET role = 'owner' FROM (
				SELECT DISTINCT ON (c.squad_id) c.squad_id, c.applicant_id, c.family_member_id FROM game.squad_members c
				WHERE c.squad_id = ANY($1)
				  AND NOT EXISTS (SELECT 1 FROM game.squad_members o WHERE o.squad_id = c.squad_id AND o.role = 'owner')
				ORDER BY c.squad_id, c.joined_at, c.member_ord) p
			WHERE m.squad_id = p.squad_id AND m.applicant_id = p.applicant_id
			  AND m.family_member_id IS NOT DISTINCT FROM p.family_member_id`, squads); err != nil {
			return nil, fmt.Errorf("store: erase: squad owner: %w", err)
		}
	}

	tag, err := tx.Exec(ctx, `UPDATE game.share_cards SET withdrawn_at = $3
		WHERE tenant_id = $1 AND applicant_id = $2 AND withdrawn_at IS NULL`, tenant, applicant, now)
	if err != nil {
		return nil, fmt.Errorf("store: erase: share cards: %w", err)
	}
	counts["share_cards_withdrawn"] = tag.RowsAffected()

	for _, x := range p2EraseTables {
		tag, err := tx.Exec(ctx, `DELETE FROM `+x.table+` WHERE tenant_id = $1 AND applicant_id = $2`, tenant, applicant)
		if err != nil {
			return nil, fmt.Errorf("store: erase %s: %w", x.table, err)
		}
		counts[x.name] = tag.RowsAffected()
	}
	return counts, nil
}

// WithdrawStudyParticipants marks the applicant's active online-study participants withdrawn
// (the near-miss line is cleared at once). Exports leave them out from now on and the retention
// job deletes their pseudonymous rows (FIELD_STUDY §6.3: within 7 days).
func WithdrawStudyParticipants(ctx context.Context, tx pgx.Tx, tenant string, applicant uuid.UUID, now time.Time) (int64, error) {
	tag, err := tx.Exec(ctx, `UPDATE study.nazar_participants SET withdrawn_at = $3, near_miss_text = NULL
		WHERE tenant_id = $1 AND applicant_id = $2 AND withdrawn_at IS NULL`, tenant, applicant, now)
	if err != nil {
		return 0, fmt.Errorf("store: study withdraw: %w", err)
	}
	return tag.RowsAffected(), nil
}
