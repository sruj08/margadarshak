-- P2 learning (workstream B, MD-211/212/213; GAMIFICATION_ENGINE §4–§6; E-18 TopicMastery).
-- Backs internal/learn (Store interface; MemStore is the reference semantics): API-32 answers,
-- the append-only FSRS review log, and the caches of the compute service's /learn/state output
-- (card states, topic mastery, readiness snapshots) that API-31/33 serve, also when the compute
-- service is down.
--
-- Conventions as 00002/00004: subject columns tenant_id, applicant_id, family_member_id NULL;
-- FORCE RLS tenant isolation on every table; no foreign keys to other P2 files. A minor family
-- member's rows exist only after parental consent (accounts.RequireMemberAllowed in the handler;
-- D-13 revised, replacing DATA_MODEL's older "minors: no rows written").

-- +goose Up
CREATE SCHEMA IF NOT EXISTS learn;
GRANT USAGE ON SCHEMA learn TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA learn GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;

-- API-32 answers, deduplicated on client_answer_id per subject (offline sync replays).
CREATE TABLE learn.answers (
  answer_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  client_answer_id text NOT NULL CHECK (char_length(client_answer_id) BETWEEN 1 AND 64),
  qref             text NOT NULL CHECK (qref ~ '^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,54}$'),
  card_id          text NOT NULL,
  topic            text NOT NULL,
  correct          boolean NOT NULL,                     -- from the compute service's server key only
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  overconfident    boolean NOT NULL,
  confidence       text CHECK (confidence IN ('50', '75', '100')),
  answered_at      timestamptz NOT NULL,                 -- device time (EC-15)
  reviewed_at      timestamptz NOT NULL,                 -- accepted review time
  next_due_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, client_answer_id)
);
CREATE INDEX answers_subject_rated_idx ON learn.answers (tenant_id, applicant_id, family_member_id, answer_id DESC)
  WHERE confidence IS NOT NULL;

-- Append-only FSRS review log (replayed by the compute service; one row per review).
CREATE TABLE learn.review_log (
  review_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  card_id          text NOT NULL CHECK (char_length(card_id) BETWEEN 1 AND 48),
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at      timestamptz NOT NULL,
  source_kind      text NOT NULL CHECK (source_kind IN ('answer', 'session', 'prediction')),
  source_id        text NOT NULL,                        -- client_answer_id or session ID
  confidence       text CHECK (confidence IN ('50', '75', '100')),
  correct          boolean,
  overconfident    boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, source_kind, source_id, card_id)
);
CREATE INDEX review_log_subject_idx ON learn.review_log (tenant_id, applicant_id, family_member_id, reviewed_at);

-- Cache: gamification CardState per card (verbatim from /learn/answers or /learn/state).
CREATE TABLE learn.card_state (
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  card_id          text NOT NULL,
  state            jsonb NOT NULL,
  due_at           timestamptz NOT NULL,
  computed_at      timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, card_id)
);
CREATE INDEX card_state_due_idx ON learn.card_state (tenant_id, applicant_id, family_member_id, due_at);

-- Cache: mastery per topic and skill-node state (E-18).
CREATE TABLE learn.topic_mastery (
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  topic            text NOT NULL CHECK (topic ~ '^[A-Z]{1,4}[0-9]{1,2}$'),
  mastery          numeric(6, 5) NOT NULL CHECK (mastery BETWEEN 0 AND 1),
  coverage         numeric(6, 5) NOT NULL CHECK (coverage BETWEEN 0 AND 1),
  brier            numeric(6, 5) CHECK (brier BETWEEN 0 AND 1),
  node_state       text NOT NULL CHECK (node_state IN ('locked', 'learning', 'mastered', 'fading')),
  computed_at      timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, applicant_id, family_member_id, topic)
);

-- Readiness snapshots: the full /learn/state output with the review-log length it was computed
-- from (stale when the log grew). Kept for the readiness-vs-outcome pairing (§5.3).
CREATE TABLE learn.readiness_snapshots (
  snapshot_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id  uuid REFERENCES core.family_members (member_id),
  computed_at       timestamptz NOT NULL,
  log_count         integer NOT NULL CHECK (log_count >= 0),
  readiness         smallint NOT NULL CHECK (readiness BETWEEN 0 AND 100),
  knowledge         smallint NOT NULL CHECK (knowledge BETWEEN 0 AND 100),
  cal_penalty       smallint NOT NULL CHECK (cal_penalty BETWEEN 0 AND 100),
  gate_met          boolean NOT NULL,
  nazar_score       numeric(5, 2),
  nazar_sessions    integer NOT NULL DEFAULT 0,
  state             jsonb NOT NULL
);
CREATE INDEX readiness_snapshots_subject_idx ON learn.readiness_snapshots (tenant_id, applicant_id, family_member_id, computed_at DESC);

-- Append-only for request traffic (erasure runs as mg_jobs).
REVOKE UPDATE, DELETE ON learn.review_log FROM mg_app;

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'learn.answers', 'learn.review_log', 'learn.card_state', 'learn.topic_mastery', 'learn.readiness_snapshots'
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
DROP TABLE IF EXISTS learn.readiness_snapshots, learn.topic_mastery, learn.card_state, learn.review_log, learn.answers;
DROP SCHEMA IF EXISTS learn;
