-- P2 game sessions (workstream A, MD-206/207/221/223): E-16 game sessions with the server replay
-- result, their items, the per-subject clip exposures behind the unseen-clip rule for Nazar mocks
-- (E-20, GAME_SDK §6.4), and the difficulty staircase (GAME_SDK §7). DATA_MODEL §4.5 with the
-- plan §2.3 additions. The E-17 events table is deferred: the bounded replay blob (≤ 512 KB of
-- base64) is stored on the session instead.
--
-- Conventions as 00002/00004: UUIDv7 session keys from the application, tenant_id + FORCE RLS on
-- every table, subject columns tenant_id, applicant_id, family_member_id NULL, no foreign keys to
-- other P2 files (item refs are text). Deviations from DATA_MODEL §4.5, to fold into the doc:
--   - mode 'pair' (game-core GameMode), not 'duel';
--   - timing_mode adds 'none' (game-core IntegrityReport);
--   - trust is numeric(4,3): factors such as 0.9³ = 0.729 need three places;
--   - events_digest bytea → digest text 'sha256:<hex>' (the verifier's format);
--   - replay_object_key → replay_inputs bytea on the row (object storage later if needed).

-- +goose Up
CREATE SCHEMA IF NOT EXISTS game;
GRANT USAGE ON SCHEMA game TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA game GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;

-- E-16 Game session. The server result overwrites the client preview and is the one that counts
-- (D-11). eligibility is derived from the server result only (GAME_SDK §6.4) and stored, so the
-- Nazar Score is a plain indexed read.
CREATE TABLE game.sessions (
  session_id         uuid PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id       uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id   uuid REFERENCES core.family_members (member_id),
  game_id            text NOT NULL CHECK (game_id IN ('nazar', 'junction_scan', 'stopping_distance', 'blind_spot',
                       'track_twin', 'night_glare', 'hill_road', 'helmet_fit', 'golden_hour', 'll_sim')),
  mode               text NOT NULL CHECK (mode IN ('learn', 'practice', 'mock', 'pair')),
  game_version       text NOT NULL,
  scoring_version    text NOT NULL CHECK (scoring_version ~ '^\d+\.\d+$'),
  rule_pack_version  text NOT NULL,
  seed               bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  seed_origin        text NOT NULL CHECK (seed_origin IN ('server', 'client_offline')),
  difficulty         smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  status             text NOT NULL DEFAULT 'started'
                       CHECK (status IN ('started', 'submitted', 'checked', 'pending_verification', 'expired', 'voided')),
  -- Online field study (F-57): the cohort is only ever field_test; codes are pseudonymous (P-001).
  cohort             text CHECK (cohort IN ('field_test')),
  study_participant  text,
  study_phase        text CHECK (study_phase IN ('ll_mock', 'test', 'feedback', 'fresh')),
  -- The game-core SessionContext sent to the client (no PII by construction; includes the items).
  context            jsonb NOT NULL,
  started_at         timestamptz NOT NULL,
  expires_at         timestamptz NOT NULL CHECK (expires_at > started_at),
  submitted_at       timestamptz,
  verified_at        timestamptz,
  -- Replay package (GAME_SDK §5.3). replay_inputs holds the decoded base64 (≤ 384 KB raw).
  replay_inputs      bytea CHECK (octet_length(replay_inputs) <= 524288),
  replay_encoding    text CHECK (replay_encoding IN ('mdr1', 'mdr1+gzip')),
  replay_event_count integer CHECK (replay_event_count BETWEEN 0 AND 5000),
  telemetry_version  smallint CHECK (telemetry_version = 1),
  digest             text CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  hints              jsonb NOT NULL DEFAULT '{}',          -- {seenClip, sessionExpired} at submission
  client_result      jsonb,                                 -- the preview, kept for comparison
  server_result      jsonb,                                 -- the verifier's SessionResult
  analysis           jsonb,                                 -- {nazar_clips, nazar_clips_linear}
  client_score_pct   numeric(5, 2) CHECK (client_score_pct BETWEEN 0 AND 100),
  server_score_pct   numeric(5, 2) CHECK (server_score_pct BETWEEN 0 AND 100),
  trust              numeric(4, 3) CHECK (trust BETWEEN 0 AND 1),
  integrity_flags    text[] NOT NULL DEFAULT '{}',
  timing_mode        text CHECK (timing_mode IN ('rvfc', 'fallback', 'sim', 'none')),
  eligibility        jsonb NOT NULL DEFAULT '{}',          -- {xp, badges, counted, nazar_score, percentiles}
  nazar_eligible     boolean GENERATED ALWAYS AS (COALESCE((eligibility ->> 'nazar_score')::boolean, false)) STORED,
  rejected_type      text,                                  -- verifier problem slug when voided
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'checked' OR (server_result IS NOT NULL AND verified_at IS NOT NULL AND digest IS NOT NULL)),
  CHECK (status <> 'pending_verification' OR (replay_inputs IS NOT NULL AND digest IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK ((cohort IS NULL) = (study_participant IS NULL))
);
CREATE TRIGGER sessions_touch BEFORE UPDATE ON game.sessions FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
-- DATA_MODEL §4.5 indexes: history per game and mode; the Nazar Score read; the replay task.
CREATE INDEX sessions_subject_game_idx ON game.sessions (tenant_id, applicant_id, family_member_id, game_id, mode, verified_at DESC);
CREATE INDEX sessions_nazar_score_idx ON game.sessions (tenant_id, applicant_id, family_member_id, verified_at DESC)
  WHERE nazar_eligible AND status = 'checked';
CREATE INDEX sessions_pending_idx ON game.sessions (submitted_at) WHERE status = 'pending_verification';
CREATE INDEX sessions_study_idx ON game.sessions (tenant_id, study_participant) WHERE cohort = 'field_test';

-- Items dealt per session, in order (also answers "recent variants" for the LL selector).
CREATE TABLE game.session_items (
  session_id       uuid NOT NULL REFERENCES game.sessions (session_id) ON DELETE CASCADE,
  ordinal          smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 40),
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  item_ref         text NOT NULL CHECK (item_ref ~ '^[a-z]{1,8}:[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,54}$'),
  content_version  text NOT NULL,
  kind             text NOT NULL,
  PRIMARY KEY (session_id, ordinal)
);
CREATE INDEX session_items_ref_idx ON game.session_items (item_ref);

-- Clip exposures: one row per subject and clip, the first exposure wins (ON CONFLICT DO NOTHING).
-- Recorded at session start for mock and study, and for practice (reveal windows) and learn.
-- Keyed on clip_id, not the version: a new version of a seen clip is still seen.
CREATE TABLE game.clip_exposures (
  exposure_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id  uuid REFERENCES core.family_members (member_id),
  clip_id           text NOT NULL CHECK (clip_id ~ '^[A-Z]{2,4}-[A-Z0-9]{4,6}$'),
  via               text NOT NULL CHECK (via IN ('mock', 'practice', 'learn', 'replay', 'study')),
  session_id        uuid,
  first_seen_at     timestamptz NOT NULL,
  CONSTRAINT clip_exposures_subject_clip_uq UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, clip_id)
);

-- Difficulty staircase per subject, game and skill (2 passes up, 1 fail down; levels 1–5).
CREATE TABLE game.staircase (
  staircase_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id  uuid REFERENCES core.family_members (member_id),
  game_id           text NOT NULL,
  skill_id          text NOT NULL,
  level             smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  streak_pass       smallint NOT NULL DEFAULT 0 CHECK (streak_pass BETWEEN 0 AND 1),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staircase_subject_uq UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, game_id, skill_id)
);
CREATE TRIGGER staircase_touch BEFORE UPDATE ON game.staircase FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'game.sessions', 'game.session_items', 'game.clip_exposures', 'game.staircase'
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
DROP TABLE IF EXISTS game.staircase, game.clip_exposures, game.session_items, game.sessions;
-- This file creates the game schema; later P2 files (gamification) add tables to it and must drop
-- only their own tables, so the schema is empty again when this down step runs.
DROP SCHEMA IF EXISTS game;
