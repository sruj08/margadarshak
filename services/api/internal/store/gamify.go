package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/sruj08/margadarshak/services/api/internal/gamify"
	"github.com/sruj08/margadarshak/services/api/internal/ids"
)

// GamifyStore is the pgx implementation of gamify.Store (game.xp_ledger, game.streaks,
// game.badges, game.squads, game.squad_members, game.share_cards, records.declarations).
//
// Subject-scoped calls run in DB.InTenant(subject tenant), so a transaction carried in ctx
// (ContextWithTx, a games award hook) is reused. Squads and share cards are looked up without a
// tenant (an invite join, the public share-card read over the internal network), so GetSquad,
// SquadByInviteHash and GetShareCard read through DB.InSystem, and writes run in the row's own
// tenant.
type GamifyStore struct{ DB *DB }

// NewGamifyStore returns a GamifyStore on db.
func NewGamifyStore(db *DB) *GamifyStore { return &GamifyStore{DB: db} }

var _ gamify.Store = (*GamifyStore)(nil)

// gamifySubjWhere matches a subject on columns tenant_id, applicant_id, family_member_id with
// arguments $1, $2, $3 (gamifySubjArgs).
const gamifySubjWhere = `tenant_id = $1 AND applicant_id = $2 AND family_member_id IS NOT DISTINCT FROM $3::uuid`

func gamifySubjArgs(s gamify.Subject, more ...any) []any {
	return append([]any{s.Tenant, s.ApplicantID, s.MemberID}, more...)
}

// gamifySubjectCols rebuilds a learner.Subject from a row aliased x with core.applicants a and
// core.family_members f joined, with the rules of accounts.LearnerOf / ResolveLearner: Account is
// a signed-in account; a family member's band is u18 when the member is a minor, adult
// otherwise; the holder's band is its user_band when that is u18 or adult.
const gamifySubjectCols = `x.tenant_id, x.applicant_id, x.family_member_id,
	coalesce(a.kind = 'account', false),
	CASE WHEN x.family_member_id IS NOT NULL THEN CASE WHEN coalesce(f.is_minor, false) THEN 'u18' ELSE 'adult' END
	     WHEN a.user_band IN ('u18', 'adult') THEN a.user_band ELSE '' END,
	CASE WHEN x.family_member_id IS NOT NULL THEN coalesce(f.is_minor, false) ELSE coalesce(a.user_band = 'u18', false) END`

const gamifySubjectJoins = `LEFT JOIN core.applicants a ON a.applicant_id = x.applicant_id
	LEFT JOIN core.family_members f ON f.member_id = x.family_member_id`

func gamifySubjectDest(s *gamify.Subject) []any {
	return []any{&s.Tenant, &s.ApplicantID, &s.MemberID, &s.Account, &s.UserBand, &s.Minor}
}

func gamifyJSON(raw json.RawMessage) any {
	if raw == nil {
		return nil
	}
	return []byte(raw)
}

func gamifyRaw(b []byte) json.RawMessage {
	if b == nil {
		return nil
	}
	return json.RawMessage(b)
}

func gamifyUTC(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func gamifyNullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func gamifyConstraint(err error) (code, constraint string) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Code, pg.ConstraintName
	}
	return "", ""
}

// ---- XP ledger ---------------------------------------------------------------------------------

// AppendXP implements gamify.Store: it inserts e unless (subject, reason, source_id) exists. The
// reason CHECK (xp_ledger_reason_check) refuses anything outside the four reasons.
func (g *GamifyStore) AppendXP(ctx context.Context, subj gamify.Subject, e *gamify.XPEntry) (bool, error) {
	inserted := false
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO game.xp_ledger (tenant_id, applicant_id, family_member_id, entry_id, reason, source_id, xp, minutes,
			  ist_day, week_key, counts_for_streak, breakdown, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13)
			ON CONFLICT DO NOTHING`,
			gamifySubjArgs(subj, e.ID, string(e.Reason), e.SourceID, e.XP, e.Minutes, e.ISTDay, e.WeekKey, e.CountsForStreak,
				gamifyJSON(e.Breakdown), e.At)...)
		if err != nil {
			return err
		}
		inserted = tag.RowsAffected() == 1
		return nil
	})
	if err != nil {
		if code, c := gamifyConstraint(err); code == "23514" && c == "xp_ledger_reason_check" {
			return false, fmt.Errorf("store: gamify: append xp: %w: %q (check constraint)", gamify.ErrXPReasonNotAllowed, e.Reason)
		}
		return false, fmt.Errorf("store: gamify: append xp: %w", mapErr(err))
	}
	return inserted, nil
}

// XPEntryBySource implements gamify.Store.
func (g *GamifyStore) XPEntryBySource(ctx context.Context, subj gamify.Subject, reason gamify.XPReason, sourceID string) (*gamify.XPEntry, error) {
	var e gamify.XPEntry
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var breakdown []byte
		var r string
		err := tx.QueryRow(ctx, `
			SELECT entry_id, reason, source_id, xp, minutes::float8, ist_day::text, week_key, counts_for_streak, breakdown, created_at
			FROM game.xp_ledger WHERE `+gamifySubjWhere+` AND reason = $4 AND source_id = $5`,
			gamifySubjArgs(subj, string(reason), sourceID)...).Scan(
			&e.ID, &r, &e.SourceID, &e.XP, &e.Minutes, &e.ISTDay, &e.WeekKey, &e.CountsForStreak, &breakdown, &e.At)
		e.Reason, e.Breakdown = gamify.XPReason(r), gamifyRaw(breakdown)
		e.At = e.At.UTC()
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("store: gamify: xp entry: %w", gamify.ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("store: gamify: xp entry: %w", mapErr(err))
	}
	return &e, nil
}

// MinutesOn implements gamify.Store.
func (g *GamifyStore) MinutesOn(ctx context.Context, subj gamify.Subject, istDay string) (float64, error) {
	var m float64
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT coalesce(sum(minutes), 0)::float8 FROM game.xp_ledger WHERE `+gamifySubjWhere+` AND ist_day = $4::date`,
			gamifySubjArgs(subj, istDay)...).Scan(&m)
	})
	if err != nil {
		return 0, fmt.Errorf("store: gamify: minutes on: %w", mapErr(err))
	}
	return m, nil
}

// XPOn implements gamify.Store.
func (g *GamifyStore) XPOn(ctx context.Context, subj gamify.Subject, istDay string) (int, error) {
	var n int
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT coalesce(sum(xp), 0)::int FROM game.xp_ledger WHERE `+gamifySubjWhere+` AND ist_day = $4::date`,
			gamifySubjArgs(subj, istDay)...).Scan(&n)
	})
	if err != nil {
		return 0, fmt.Errorf("store: gamify: xp on: %w", mapErr(err))
	}
	return n, nil
}

// WeekCounts implements gamify.Store (streak-counting entries per IST week; never nil).
func (g *GamifyStore) WeekCounts(ctx context.Context, subj gamify.Subject) (map[string]int, error) {
	out := map[string]int{}
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT week_key, count(*)::int FROM game.xp_ledger WHERE `+gamifySubjWhere+` AND counts_for_streak
			GROUP BY week_key`, gamifySubjArgs(subj)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var wk string
			var n int
			if err := rows.Scan(&wk, &n); err != nil {
				return err
			}
			out[wk] = n
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("store: gamify: week counts: %w", mapErr(err))
	}
	return out, nil
}

// ---- Progress (game.streaks + game.badges) -----------------------------------------------------

// GetProgress implements gamify.Store: gamify.ErrNotFound when the subject has no game.streaks
// row yet.
func (g *GamifyStore) GetProgress(ctx context.Context, subj gamify.Subject) (*gamify.Progress, error) {
	p := &gamify.Progress{Badges: map[string]gamify.BadgeRecord{}}
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var rank *string
		var next, state, view []byte
		var goal int16
		if err := tx.QueryRow(ctx, `SELECT xp_total, rank, rank_next, streak_goal, streak_state, streak_view, updated_at
			FROM game.streaks WHERE `+gamifySubjWhere, gamifySubjArgs(subj)...).Scan(
			&p.XPTotal, &rank, &next, &goal, &state, &view, &p.UpdatedAt); err != nil {
			return err
		}
		if rank != nil {
			p.Rank = *rank
		}
		p.RankNext, p.Streak, p.StreakView, p.StreakGoal = gamifyRaw(next), gamifyRaw(state), gamifyRaw(view), int(goal)
		p.UpdatedAt = p.UpdatedAt.UTC()
		rows, err := tx.Query(ctx, `SELECT badge_id, awarded_at, self_declared FROM game.badges WHERE `+gamifySubjWhere,
			gamifySubjArgs(subj)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b gamify.BadgeRecord
			if err := rows.Scan(&b.ID, &b.AwardedAt, &b.SelfDeclared); err != nil {
				return err
			}
			b.AwardedAt = b.AwardedAt.UTC()
			p.Badges[b.ID] = b
		}
		return rows.Err()
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("store: gamify: progress: %w", gamify.ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("store: gamify: progress: %w", mapErr(err))
	}
	return p, nil
}

// SaveProgress implements gamify.Store: it upserts the game.streaks row and makes game.badges
// equal to p.Badges (a revoked badge's row is deleted). A zero StreakGoal is stored as the
// default 4 (the CHECK admits 2..6; gamify reads 0 as 4). updated_at is p.UpdatedAt on the first
// save and the touch trigger's now() afterwards.
func (g *GamifyStore) SaveProgress(ctx context.Context, subj gamify.Subject, p *gamify.Progress) error {
	at := p.UpdatedAt
	if at.IsZero() {
		at = time.Now().UTC()
	}
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO game.streaks (tenant_id, applicant_id, family_member_id, xp_total, rank, rank_next, streak_goal, streak_state,
			  streak_view, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, coalesce(nullif($7::smallint, 0), 4), $8, $9, $10)
			ON CONFLICT (tenant_id, applicant_id, family_member_id) DO UPDATE SET xp_total = EXCLUDED.xp_total, rank = EXCLUDED.rank,
			  rank_next = EXCLUDED.rank_next, streak_goal = EXCLUDED.streak_goal, streak_state = EXCLUDED.streak_state,
			  streak_view = EXCLUDED.streak_view`,
			gamifySubjArgs(subj, p.XPTotal, gamifyNullString(p.Rank), gamifyJSON(p.RankNext), p.StreakGoal, gamifyJSON(p.Streak),
				gamifyJSON(p.StreakView), at)...); err != nil {
			return err
		}
		keep := make([]string, 0, len(p.Badges))
		for id := range p.Badges {
			keep = append(keep, id)
		}
		sort.Strings(keep)
		if _, err := tx.Exec(ctx, `DELETE FROM game.badges WHERE `+gamifySubjWhere+` AND NOT (badge_id = ANY($4))`,
			gamifySubjArgs(subj, keep)...); err != nil {
			return err
		}
		for _, id := range keep {
			b := p.Badges[id]
			if _, err := tx.Exec(ctx, `
				INSERT INTO game.badges (tenant_id, applicant_id, family_member_id, badge_id, awarded_at, self_declared)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (tenant_id, applicant_id, family_member_id, badge_id) DO UPDATE SET awarded_at = EXCLUDED.awarded_at,
				  self_declared = EXCLUDED.self_declared`,
				gamifySubjArgs(subj, id, b.AwardedAt, b.SelfDeclared)...); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("store: gamify: save progress: %w", mapErr(err))
	}
	return nil
}

// ---- Declarations (records.declarations) -------------------------------------------------------

// GetDeclaration implements gamify.Store. CaseID comes back as the wire cas_... id ("" when the
// declaration names no case).
func (g *GamifyStore) GetDeclaration(ctx context.Context, subj gamify.Subject) (*gamify.Declaration, error) {
	var d gamify.Declaration
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		var caseID *uuid.UUID
		err := tx.QueryRow(ctx, `SELECT case_id, dl_issued_on::text, no_agent_used, first_attempt_pass, declared_at
			FROM records.declarations WHERE `+gamifySubjWhere, gamifySubjArgs(subj)...).Scan(
			&caseID, &d.DLIssuedOn, &d.NoAgentUsed, &d.FirstAttemptPass, &d.DeclaredAt)
		if caseID != nil {
			d.CaseID = ids.Encode(ids.Case, *caseID)
		}
		d.DeclaredAt = d.DeclaredAt.UTC()
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("store: gamify: declaration: %w", gamify.ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("store: gamify: declaration: %w", mapErr(err))
	}
	return &d, nil
}

// SaveDeclaration implements gamify.Store (one per subject; a new one replaces it). CaseID is the
// wire cas_... id, stored as its uuid; "" is stored as NULL; anything else is a
// *gamify.ValidationError on /case_id.
func (g *GamifyStore) SaveDeclaration(ctx context.Context, subj gamify.Subject, d *gamify.Declaration) error {
	var caseID *uuid.UUID
	if d.CaseID != "" {
		id, err := ids.Decode(ids.Case, d.CaseID)
		if err != nil {
			return fmt.Errorf("store: gamify: save declaration: %w", &gamify.ValidationError{Pointer: "/case_id", Code: "invalid"})
		}
		caseID = &id
	}
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO records.declarations (tenant_id, applicant_id, family_member_id, case_id, dl_issued_on, no_agent_used,
			  first_attempt_pass, declared_at)
			VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)
			ON CONFLICT (tenant_id, applicant_id, family_member_id) DO UPDATE SET case_id = EXCLUDED.case_id,
			  dl_issued_on = EXCLUDED.dl_issued_on, no_agent_used = EXCLUDED.no_agent_used,
			  first_attempt_pass = EXCLUDED.first_attempt_pass, declared_at = EXCLUDED.declared_at`,
			gamifySubjArgs(subj, caseID, d.DLIssuedOn, d.NoAgentUsed, d.FirstAttemptPass, d.DeclaredAt)...)
		return err
	})
	if err != nil {
		return fmt.Errorf("store: gamify: save declaration: %w", mapErr(err))
	}
	return nil
}

// DeleteDeclaration implements gamify.Store (gamify.ErrNotFound when there is none).
func (g *GamifyStore) DeleteDeclaration(ctx context.Context, subj gamify.Subject) error {
	var n int64
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM records.declarations WHERE `+gamifySubjWhere, gamifySubjArgs(subj)...)
		n = tag.RowsAffected()
		return err
	})
	if err != nil {
		return fmt.Errorf("store: gamify: delete declaration: %w", mapErr(err))
	}
	if n == 0 {
		return fmt.Errorf("store: gamify: delete declaration: %w", gamify.ErrNotFound)
	}
	return nil
}

// ---- Squads (game.squads + game.squad_members) -------------------------------------------------

func gamifySquadErr(op string, err error) error {
	if code, c := gamifyConstraint(err); code == "23514" && c == "squad_members_cap" {
		return fmt.Errorf("store: gamify: %s: %w", op, gamify.ErrSquadFull)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("store: gamify: %s: %w", op, gamify.ErrNotFound)
	}
	return fmt.Errorf("store: gamify: %s: %w", op, mapErr(err))
}

const gamifySquadCols = `squad_id, tenant_id, name, invite_code_hash, invite_expires_at, weekly_goal, created_at, disbanded_at`

func gamifyScanSquad(row pgx.Row) (*gamify.Squad, error) {
	var s gamify.Squad
	var goal int16
	if err := row.Scan(&s.ID, &s.Tenant, &s.Name, &s.InviteCodeHash, &s.InviteExpiresAt, &goal, &s.CreatedAt, &s.DisbandedAt); err != nil {
		return nil, err
	}
	s.WeeklyGoal = int(goal)
	s.InviteExpiresAt, s.CreatedAt, s.DisbandedAt = s.InviteExpiresAt.UTC(), s.CreatedAt.UTC(), gamifyUTC(s.DisbandedAt)
	return &s, nil
}

// gamifyLoadMembers fills the members of squads, in Squad.Members order (member_ord).
func gamifyLoadMembers(ctx context.Context, tx pgx.Tx, squads []*gamify.Squad) error {
	if len(squads) == 0 {
		return nil
	}
	byID := make(map[uuid.UUID]*gamify.Squad, len(squads))
	keys := make([]uuid.UUID, 0, len(squads))
	for _, s := range squads {
		byID[s.ID] = s
		keys = append(keys, s.ID)
	}
	rows, err := tx.Query(ctx, `SELECT x.squad_id, `+gamifySubjectCols+`, x.display_name, x.role, x.joined_at
		FROM game.squad_members x `+gamifySubjectJoins+`
		WHERE x.squad_id = ANY($1) ORDER BY x.squad_id, x.member_ord, x.joined_at`, keys)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var m gamify.SquadMember
		dest := append([]any{&id}, gamifySubjectDest(&m.Subject)...)
		dest = append(dest, &m.DisplayName, &m.Role, &m.JoinedAt)
		if err := rows.Scan(dest...); err != nil {
			return err
		}
		m.JoinedAt = m.JoinedAt.UTC()
		s := byID[id]
		s.Members = append(s.Members, m)
	}
	return rows.Err()
}

func gamifyGetSquad(ctx context.Context, tx pgx.Tx, where string, arg any) (*gamify.Squad, error) {
	s, err := gamifyScanSquad(tx.QueryRow(ctx, `SELECT `+gamifySquadCols+` FROM game.squads WHERE `+where, arg))
	if err != nil {
		return nil, err
	}
	if err := gamifyLoadMembers(ctx, tx, []*gamify.Squad{s}); err != nil {
		return nil, err
	}
	return s, nil
}

func gamifyInsertMember(ctx context.Context, tx pgx.Tx, squad uuid.UUID, ord int, m gamify.SquadMember) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO game.squad_members (squad_id, tenant_id, applicant_id, family_member_id, display_name, role, joined_at, member_ord)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		squad, m.Subject.Tenant, m.Subject.ApplicantID, m.Subject.MemberID, m.DisplayName, m.Role, m.JoinedAt, ord)
	return err
}

// InsertSquad implements gamify.Store (in the squad's tenant). More than 5 members is
// gamify.ErrSquadFull (the member-cap trigger).
func (g *GamifyStore) InsertSquad(ctx context.Context, s *gamify.Squad) error {
	created := s.CreatedAt
	if created.IsZero() {
		created = time.Now().UTC()
	}
	err := g.DB.InTenant(ctx, s.Tenant, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO game.squads (`+gamifySquadCols+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			s.ID, s.Tenant, s.Name, s.InviteCodeHash, s.InviteExpiresAt, s.WeeklyGoal, created, s.DisbandedAt); err != nil {
			return err
		}
		for i, m := range s.Members {
			if err := gamifyInsertMember(ctx, tx, s.ID, i, m); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return gamifySquadErr("insert squad", err)
	}
	return nil
}

// GetSquad implements gamify.Store. It reads across tenants (InSystem).
func (g *GamifyStore) GetSquad(ctx context.Context, id uuid.UUID) (*gamify.Squad, error) {
	var s *gamify.Squad
	err := g.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var err error
		s, err = gamifyGetSquad(ctx, tx, `squad_id = $1`, id)
		return err
	})
	if err != nil {
		return nil, gamifySquadErr("get squad", err)
	}
	return s, nil
}

// SquadByInviteHash implements gamify.Store. It reads across tenants (InSystem): JoinSquad
// refuses a squad of another tenant.
func (g *GamifyStore) SquadByInviteHash(ctx context.Context, hash []byte) (*gamify.Squad, error) {
	var s *gamify.Squad
	err := g.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var err error
		s, err = gamifyGetSquad(ctx, tx, `invite_code_hash = $1`, hash)
		return err
	})
	if err != nil {
		return nil, gamifySquadErr("squad by invite", err)
	}
	return s, nil
}

type gamifyMemberKey struct {
	applicant uuid.UUID
	member    uuid.UUID // uuid.Nil for the holder
}

func gamifyKeyOf(s gamify.Subject) gamifyMemberKey {
	k := gamifyMemberKey{applicant: s.ApplicantID}
	if s.MemberID != nil {
		k.member = *s.MemberID
	}
	return k
}

// UpdateSquad implements gamify.Store, in the squad's tenant: it saves the squad columns and
// makes game.squad_members equal to s.Members (members who left are deleted, ownership and
// display names updated, new members inserted, order kept). Demotions run before the promotion
// so the one-owner index holds at every step; a 6th member is gamify.ErrSquadFull (trigger).
func (g *GamifyStore) UpdateSquad(ctx context.Context, s *gamify.Squad) error {
	err := g.DB.InTenant(ctx, s.Tenant, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE game.squads SET name = $2, invite_code_hash = $3, invite_expires_at = $4, weekly_goal = $5,
			disbanded_at = $6 WHERE squad_id = $1`, s.ID, s.Name, s.InviteCodeHash, s.InviteExpiresAt, s.WeeklyGoal, s.DisbandedAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		existing := map[gamifyMemberKey]bool{}
		rows, err := tx.Query(ctx, `SELECT applicant_id, family_member_id FROM game.squad_members WHERE squad_id = $1`, s.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var k gamifyMemberKey
			var member *uuid.UUID
			if err := rows.Scan(&k.applicant, &member); err != nil {
				rows.Close()
				return err
			}
			if member != nil {
				k.member = *member
			}
			existing[k] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		want := map[gamifyMemberKey]bool{}
		for _, m := range s.Members {
			want[gamifyKeyOf(m.Subject)] = true
		}
		for k := range existing {
			if want[k] {
				continue
			}
			var member *uuid.UUID
			if k.member != uuid.Nil {
				member = &k.member
			}
			if _, err := tx.Exec(ctx, `DELETE FROM game.squad_members WHERE squad_id = $1 AND applicant_id = $2
				AND family_member_id IS NOT DISTINCT FROM $3::uuid`, s.ID, k.applicant, member); err != nil {
				return err
			}
		}
		// Existing members: demotions and plain updates first, then the (new) owner.
		order := make([]int, 0, len(s.Members))
		for i := range s.Members {
			order = append(order, i)
		}
		sort.SliceStable(order, func(a, b int) bool {
			return s.Members[order[a]].Role != "owner" && s.Members[order[b]].Role == "owner"
		})
		for _, i := range order {
			m := s.Members[i]
			if !existing[gamifyKeyOf(m.Subject)] {
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE game.squad_members SET display_name = $4, role = $5, joined_at = $6, member_ord = $7
				WHERE squad_id = $1 AND applicant_id = $2 AND family_member_id IS NOT DISTINCT FROM $3::uuid`,
				s.ID, m.Subject.ApplicantID, m.Subject.MemberID, m.DisplayName, m.Role, m.JoinedAt, i); err != nil {
				return err
			}
		}
		for _, i := range order {
			m := s.Members[i]
			if existing[gamifyKeyOf(m.Subject)] {
				continue
			}
			if err := gamifyInsertMember(ctx, tx, s.ID, i, m); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return gamifySquadErr("update squad", err)
	}
	return nil
}

// SquadsOf implements gamify.Store: the squads the subject is a member of (disbanded ones
// included, as the MemStore), oldest first; nil when none.
func (g *GamifyStore) SquadsOf(ctx context.Context, subj gamify.Subject) ([]*gamify.Squad, error) {
	var out []*gamify.Squad
	err := g.DB.InTenant(ctx, subj.Tenant, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+gamifySquadCols+` FROM game.squads s
			WHERE EXISTS (SELECT 1 FROM game.squad_members x WHERE x.squad_id = s.squad_id AND x.tenant_id = $1 AND x.applicant_id = $2
			  AND x.family_member_id IS NOT DISTINCT FROM $3::uuid)
			ORDER BY created_at, squad_id`, gamifySubjArgs(subj)...)
		if err != nil {
			return err
		}
		for rows.Next() {
			s, err := gamifyScanSquad(rows)
			if err != nil {
				rows.Close()
				return err
			}
			out = append(out, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		return gamifyLoadMembers(ctx, tx, out)
	})
	if err != nil {
		return nil, gamifySquadErr("squads of", err)
	}
	return out, nil
}

// ---- Share cards (game.share_cards) ------------------------------------------------------------

// InsertShareCard implements gamify.Store (in the card subject's tenant). A short_id that
// exists already is store.ErrConflict (the MemStore overwrites; short IDs are random).
func (g *GamifyStore) InsertShareCard(ctx context.Context, c *gamify.ShareCard) error {
	err := g.DB.InTenant(ctx, c.Subject.Tenant, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO game.share_cards (tenant_id, applicant_id, family_member_id, short_id, kind, display, display_text, badge_id,
			  kerala_line, created_at, expires_at, withdrawn_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			gamifySubjArgs(c.Subject, c.ShortID, c.Kind, c.Display, c.DisplayText, gamifyNullString(c.BadgeID), c.KeralaLine,
				c.CreatedAt, c.ExpiresAt, c.WithdrawnAt)...)
		return err
	})
	if err != nil {
		return fmt.Errorf("store: gamify: insert share card: %w", mapErr(err))
	}
	return nil
}

// GetShareCard implements gamify.Store. It reads across tenants (InSystem): the public card read
// (API-57) carries no tenant.
func (g *GamifyStore) GetShareCard(ctx context.Context, shortID string) (*gamify.ShareCard, error) {
	var c gamify.ShareCard
	err := g.DB.InSystem(ctx, func(tx pgx.Tx) error {
		var badge *string
		dest := append([]any{&c.ShortID}, gamifySubjectDest(&c.Subject)...)
		dest = append(dest, &c.Kind, &c.Display, &c.DisplayText, &badge, &c.KeralaLine, &c.CreatedAt, &c.ExpiresAt, &c.WithdrawnAt)
		err := tx.QueryRow(ctx, `SELECT x.short_id, `+gamifySubjectCols+`, x.kind, x.display, x.display_text, x.badge_id, x.kerala_line,
			x.created_at, x.expires_at, x.withdrawn_at
			FROM game.share_cards x `+gamifySubjectJoins+` WHERE x.short_id = $1`, shortID).Scan(dest...)
		if badge != nil {
			c.BadgeID = *badge
		}
		c.CreatedAt, c.ExpiresAt, c.WithdrawnAt = c.CreatedAt.UTC(), c.ExpiresAt.UTC(), gamifyUTC(c.WithdrawnAt)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("store: gamify: share card: %w", gamify.ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("store: gamify: share card: %w", mapErr(err))
	}
	return &c, nil
}

// UpdateShareCard implements gamify.Store (in the card subject's tenant; gamify.ErrNotFound when
// there is no such card).
func (g *GamifyStore) UpdateShareCard(ctx context.Context, c *gamify.ShareCard) error {
	var n int64
	err := g.DB.InTenant(ctx, c.Subject.Tenant, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE game.share_cards SET kind = $2, display = $3, display_text = $4, badge_id = $5, kerala_line = $6,
			created_at = $7, expires_at = $8, withdrawn_at = $9 WHERE short_id = $1`,
			c.ShortID, c.Kind, c.Display, c.DisplayText, gamifyNullString(c.BadgeID), c.KeralaLine, c.CreatedAt, c.ExpiresAt, c.WithdrawnAt)
		n = tag.RowsAffected()
		return err
	})
	if err != nil {
		return fmt.Errorf("store: gamify: update share card: %w", mapErr(err))
	}
	if n == 0 {
		return fmt.Errorf("store: gamify: update share card: %w", gamify.ErrNotFound)
	}
	return nil
}
