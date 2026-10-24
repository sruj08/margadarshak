-- P3 AI (MD-308, MD-311, MD-312, MD-327). Debrief cards are stored once per session and locale so a card
-- never costs a second model call (a page reload, the RW-3 fan-out and the API share it). Human
-- review ratings and in-app feedback back the review loop (AI_EVALS §8). No prompt, transcript,
-- audio or image is stored anywhere (AGENTS.md §5).
-- Conventions: tenant_id + FORCE RLS on every table.

-- +goose Up
CREATE TABLE game.debriefs (
  tenant_id  text NOT NULL REFERENCES core.tenants (tenant_id),
  session_id uuid NOT NULL REFERENCES game.sessions (session_id) ON DELETE CASCADE,
  locale     text NOT NULL CHECK (locale IN ('en', 'hi', 'hinglish')),
  source     text NOT NULL CHECK (source IN ('template', 'ai')),
  status     text NOT NULL CHECK (status IN ('ai_ready', 'ai_failed')),
  card       jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, locale)
);
CREATE INDEX debriefs_review_idx ON game.debriefs (tenant_id, source, created_at DESC);

CREATE SCHEMA IF NOT EXISTS ai;
GRANT USAGE ON SCHEMA ai TO mg_app, mg_jobs;

-- One rating per rater and item: a 0-2 score on each axis of the AI_EVALS §8 rubric.
CREATE TABLE ai.reviews (
  review_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES core.tenants (tenant_id),
  agent      text NOT NULL CHECK (agent IN ('debrief', 'tutor', 'coach', 'voice', 'decoder', 'signsnap')),
  item_id    text NOT NULL CHECK (char_length(item_id) <= 80),
  rater      text NOT NULL CHECK (rater ~ '^[a-z]+-\d{2,}$'),
  grounding  smallint NOT NULL CHECK (grounding BETWEEN 0 AND 2),
  tone       smallint NOT NULL CHECK (tone BETWEEN 0 AND 2),
  usefulness smallint NOT NULL CHECK (usefulness BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, agent, item_id, rater)
);

-- A thumbs up/down on an AI answer, with a closed reason (never free text).
CREATE TABLE ai.feedback (
  feedback_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id uuid NOT NULL REFERENCES core.applicants (applicant_id),
  agent        text NOT NULL CHECK (agent IN ('debrief', 'tutor', 'coach', 'voice', 'decoder', 'signsnap', 'scam')),
  item_id      text NOT NULL CHECK (char_length(item_id) <= 80),
  helpful      boolean NOT NULL,
  reason       text CHECK (reason IN ('wrong', 'unclear', 'tone', 'other')),
  created_at   timestamptz NOT NULL
);
CREATE INDEX feedback_agent_idx ON ai.feedback (tenant_id, agent, created_at DESC);

-- The learner's implementation intention for the week (CoachAgent, MD-312): one per drill and week.
CREATE TABLE ai.intentions (
  intention_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id uuid REFERENCES core.family_members (member_id),
  week_of          date NOT NULL,
  day              text NOT NULL CHECK (day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  time_of_day      text NOT NULL CHECK (time_of_day ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  drill_id         text NOT NULL CHECK (drill_id ~ '^DR-[A-Z0-9-]{2,40}$'),
  created_at       timestamptz NOT NULL
);
CREATE UNIQUE INDEX intentions_week_idx ON ai.intentions (tenant_id, applicant_id, coalesce(family_member_id, '00000000-0000-0000-0000-000000000000'::uuid), week_of, drill_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON game.debriefs TO mg_app, mg_jobs;
GRANT SELECT, INSERT ON ai.reviews, ai.feedback TO mg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.intentions TO mg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.reviews, ai.feedback, ai.intentions TO mg_jobs;
GRANT DELETE ON ai.feedback TO mg_app; -- DSR erasure runs on request traffic

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game.debriefs', 'ai.reviews', 'ai.feedback', 'ai.intentions'] LOOP
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
DROP TABLE IF EXISTS ai.intentions, ai.feedback, ai.reviews, game.debriefs;
DROP SCHEMA IF EXISTS ai;
