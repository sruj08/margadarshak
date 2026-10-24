-- P2 gamification (workstream B, MD-230..234, 236; GAMIFICATION_ENGINE §2–§10, §13; E-22, E-23).
-- Backs internal/gamify (Store interface; MemStore mirrors these guarantees):
--   - game.xp_ledger is append-only and its reason CHECK admits only session, review, lesson and
--     prediction, so the database itself refuses XP for opening the app, sharing or inviting;
--   - game.squad_members is capped at 5 members per squad by a trigger;
--   - core.family_members gains parental_extras (squads, share_cards, pair_mode) for a minor's
--     profile (decision D-09).
--
-- The game schema is created by p2_games.sql (N+1); this file only adds tables to it
-- (CREATE SCHEMA IF NOT EXISTS for safety) and its down step drops only its own tables.
-- Conventions: subject columns tenant_id, applicant_id, family_member_id NULL; FORCE RLS tenant
-- isolation on personal tables; no foreign keys to other P2 files.

-- +goose Up
CREATE SCHEMA IF NOT EXISTS game;
GRANT USAGE ON SCHEMA game TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA game GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;
CREATE SCHEMA IF NOT EXISTS records;
GRANT USAGE ON SCHEMA records TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA records GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;

-- Additive change to P0's core.family_members (00002): the parent's extra consents for a minor
-- member's squads, share cards and pair mode (MD-233, MD-236; GAMIFICATION_ENGINE §13; D-09). Empty by default,
-- so nothing changes for existing rows; RecordParentalConsent writes it at handover.
ALTER TABLE core.family_members
  ADD COLUMN parental_extras text[] NOT NULL DEFAULT '{}'
  CONSTRAINT family_members_parental_extras_check CHECK (parental_extras <@ ARRAY['squads', 'share_cards', 'pair_mode']::text[]);

-- E-22 XP ledger: one row per activity, with the multiplier breakdown.
CREATE TABLE game.xp_ledger (
  entry_id          uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id  uuid REFERENCES core.family_members (member_id),
  reason            text NOT NULL CONSTRAINT xp_ledger_reason_check CHECK (reason IN ('session', 'review', 'lesson', 'prediction')),
  source_id         text NOT NULL,                       -- session ID, review sitting ID, …
  xp                integer NOT NULL CHECK (xp >= 0),
  minutes           numeric(7, 2) NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  ist_day           date NOT NULL,
  week_key          text NOT NULL CHECK (week_key ~ '^\d{4}-W\d{2}$'),
  counts_for_streak boolean NOT NULL DEFAULT false,
  breakdown         jsonb,                               -- gamification XpAward
  created_at        timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, reason, source_id)
);
CREATE INDEX xp_ledger_day_idx ON game.xp_ledger (tenant_id, applicant_id, family_member_id, ist_day);
CREATE INDEX xp_ledger_week_idx ON game.xp_ledger (tenant_id, applicant_id, family_member_id, week_key) WHERE counts_for_streak;

-- E-22 progress cache: XP total, rank (never demoted: the compute service never returns less
-- than the held rank), streak state (gamification StreakState, verbatim) and view.
CREATE TABLE game.streaks (
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  xp_total         integer NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  rank             text CHECK (rank IN ('R1', 'R2', 'R3', 'R4', 'R5')),
  rank_next        jsonb,
  streak_goal      smallint NOT NULL DEFAULT 4 CHECK (streak_goal BETWEEN 2 AND 6),
  streak_state     jsonb,
  streak_view      jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id)
);
CREATE TRIGGER streaks_touch BEFORE UPDATE ON game.streaks FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- E-22 badges (nine, B1–B9). B1/B2 are self-declared ("Your word"); a revoked declaration
-- deletes the row silently.
CREATE TABLE game.badges (
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  badge_id         text NOT NULL CHECK (badge_id IN ('B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9')),
  awarded_at       timestamptz NOT NULL,
  self_declared    boolean NOT NULL DEFAULT false,
  CHECK (self_declared = (badge_id IN ('B1', 'B2'))),
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, badge_id)
);

-- E-23 squads (co-op only; invite-only link, stored as a hash, expires after 7 days).
CREATE TABLE game.squads (
  squad_id          uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  invite_code_hash  bytea NOT NULL UNIQUE CHECK (octet_length(invite_code_hash) = 32),
  invite_expires_at timestamptz NOT NULL,
  weekly_goal       smallint NOT NULL DEFAULT 15 CHECK (weekly_goal BETWEEN 3 AND 40),
  created_at        timestamptz NOT NULL DEFAULT now(),
  disbanded_at      timestamptz
);

CREATE TABLE game.squad_members (
  squad_id         uuid NOT NULL REFERENCES game.squads (squad_id) ON DELETE CASCADE,
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 24),
  role             text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at        timestamptz NOT NULL,
  member_ord       smallint NOT NULL DEFAULT 0 CHECK (member_ord >= 0), -- order of Squad.Members (joins can share a joined_at)
  UNIQUE NULLS NOT DISTINCT (squad_id, applicant_id, family_member_id)
);
CREATE INDEX squad_members_subject_idx ON game.squad_members (tenant_id, applicant_id, family_member_id);
CREATE UNIQUE INDEX squad_members_one_owner_uq ON game.squad_members (squad_id) WHERE role = 'owner';

-- Member cap (E-23: 3–5 members). Serialised per squad with a row lock on the squad.
-- +goose StatementBegin
CREATE FUNCTION game.squad_member_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  PERFORM 1 FROM game.squads WHERE squad_id = NEW.squad_id FOR UPDATE;
  SELECT count(*) INTO n FROM game.squad_members WHERE squad_id = NEW.squad_id;
  IF n >= 5 THEN
    RAISE EXCEPTION 'squad % already has 5 members', NEW.squad_id USING ERRCODE = 'check_violation', CONSTRAINT = 'squad_members_cap';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd
CREATE TRIGGER squad_members_cap BEFORE INSERT ON game.squad_members FOR EACH ROW EXECUTE FUNCTION game.squad_member_cap();

-- Share cards (§10): what the card shows is chosen by the user; the numbers are recomputed from
-- server data on every read, so no score is stored here. Link expires after 90 days.
CREATE TABLE game.share_cards (
  short_id         text PRIMARY KEY CHECK (short_id ~ '^[a-km-np-z2-9]{10}$'), -- gamify shortIDAlphabet (no l, o)
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  kind             text NOT NULL CHECK (kind IN ('nazar_score', 'rank', 'badge')),
  display          text NOT NULL CHECK (display IN ('initials', 'first_name')),
  display_text     text NOT NULL CHECK (char_length(display_text) BETWEEN 1 AND 20),
  badge_id         text CHECK (badge_id IN ('B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9')),
  kerala_line      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL CHECK (expires_at > created_at),
  withdrawn_at     timestamptz,
  CHECK (kind <> 'badge' OR badge_id IS NOT NULL)
);
CREATE INDEX share_cards_subject_idx ON game.share_cards (tenant_id, applicant_id, family_member_id);

-- API-44 Khud Licence self-declaration (always rendered as self-declared, never a government check).
CREATE TABLE records.declarations (
  tenant_id          text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id       uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id   uuid REFERENCES core.family_members (member_id),
  case_id            uuid,
  dl_issued_on       date NOT NULL CHECK (dl_issued_on >= DATE '1990-01-01'),
  no_agent_used      boolean NOT NULL CHECK (no_agent_used),
  first_attempt_pass boolean NOT NULL DEFAULT false,
  declared_at        timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id)
);

-- The ledger is append-only for request traffic (erasure runs as mg_jobs).
REVOKE UPDATE, DELETE ON game.xp_ledger FROM mg_app;

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'game.xp_ledger', 'game.streaks', 'game.badges', 'game.squads', 'game.squad_members', 'game.share_cards', 'records.declarations'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s USING (tenant_id = current_setting(''app.tenant_id'', true) OR current_user = ''mg_jobs'') WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true) OR current_user = ''mg_jobs'')',
      t);
  END LOOP;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS records.declarations, game.share_cards, game.squad_members, game.squads, game.badges, game.streaks, game.xp_ledger;
DROP FUNCTION IF EXISTS game.squad_member_cap();
DROP SCHEMA IF EXISTS records;
ALTER TABLE core.family_members DROP CONSTRAINT IF EXISTS family_members_parental_extras_check;
ALTER TABLE core.family_members DROP COLUMN IF EXISTS parental_extras;
-- The game schema belongs to p2_games.sql, whose down step drops it once it is empty.
