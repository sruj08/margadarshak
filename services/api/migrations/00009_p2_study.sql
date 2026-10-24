-- P2 online Nazar field study (workstream H, MD-237..240; FIELD_STUDY §4, §6, §7). Backs
-- internal/study (Store interface; MemStore is the reference semantics). The study schema exists
-- since 00004 (study.lab_trials).
--
-- Only what the consent screen lists is stored (FIELD_STUDY §6.1): an anonymous participant code,
-- age band, licence held, years driving, the form, and an optional near-miss line. Scores and
-- tap times live in game.sessions (p2_games.sql: study_participant, study_phase, trust, analysis),
-- joined by participant code at export time; no foreign key crosses the P2 files. A declined
-- consent writes nothing (the API refuses before any query).
-- Conventions: tenant_id + FORCE RLS on every table.

-- +goose Up
CREATE SCHEMA IF NOT EXISTS study;
GRANT USAGE ON SCHEMA study TO mg_app, mg_jobs;

-- Arrival counter per tenant: forms rotate A → B → C by arrival order (P-001 = A, P-002 = B, …).
CREATE TABLE study.nazar_arrivals (
  tenant_id text PRIMARY KEY REFERENCES core.tenants (tenant_id),
  last_seq  integer NOT NULL CHECK (last_seq >= 0)
);

CREATE TABLE study.nazar_participants (
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  participant_code text NOT NULL CHECK (participant_code ~ '^P-\d{3,}$'),
  applicant_id     uuid NOT NULL REFERENCES core.applicants (applicant_id),
  consent_id       uuid NOT NULL REFERENCES privacy.consent_artefacts (consent_id), -- purpose field_study
  seq              integer NOT NULL CHECK (seq >= 1),
  age_band         text NOT NULL CHECK (age_band IN ('18_20', '21_24', '25_34', '35_plus')),
  licence_held     text NOT NULL CHECK (licence_held IN ('ll', '2w', '4w', 'both')),
  years_driving    text NOT NULL CHECK (years_driving IN ('0_1', '1_3', '3_plus')),
  age_ok           boolean NOT NULL CHECK (age_ok),      -- the flow never starts under 18
  form             text NOT NULL CHECK (form IN ('A', 'B', 'C')),
  retake_of        text CHECK (retake_of ~ '^P-\d{3,}$'),
  near_miss_text   text CHECK (char_length(near_miss_text) <= 140),
  created_at       timestamptz NOT NULL,
  withdrawn_at     timestamptz,
  PRIMARY KEY (tenant_id, participant_code),
  UNIQUE (tenant_id, seq),
  CHECK (form = (ARRAY['A', 'B', 'C'])[((seq - 1) % 3) + 1]),
  CHECK (retake_of IS NULL OR retake_of <> participant_code),
  CHECK (withdrawn_at IS NULL OR near_miss_text IS NULL)
);
CREATE INDEX nazar_participants_applicant_idx ON study.nazar_participants (tenant_id, applicant_id);

-- Three blocks of 5 clip refs balanced on curator difficulty, and the fixed 15-question LL set.
CREATE TABLE study.form_blocks (
  tenant_id  text PRIMARY KEY REFERENCES core.tenants (tenant_id),
  b1         text[] NOT NULL CHECK (cardinality(b1) = 5),
  b2         text[] NOT NULL CHECK (cardinality(b2) = 5),
  b3         text[] NOT NULL CHECK (cardinality(b3) = 5),
  ll_set     text[] NOT NULL CHECK (cardinality(ll_set) = 15),
  frozen_at  timestamptz NOT NULL,                       -- before the first participant (HYPOTHESES.md)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- API-71 Nazar figures from the pre-registered script (stats.field_study_publish), with its hash.
CREATE TABLE study.public_stats (
  stats_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES core.tenants (tenant_id),
  as_of         timestamptz NOT NULL,
  payload       jsonb NOT NULL,
  script_sha256 text NOT NULL CHECK (script_sha256 ~ '^[0-9a-f]{64}$'),
  prereg_commit text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_stats_latest_idx ON study.public_stats (tenant_id, as_of DESC);

-- 00004's default privileges give both roles full DML on new study tables; narrow mg_app
-- (request traffic): it enrols and updates participants, and only reads blocks and stats.
GRANT SELECT, INSERT, UPDATE ON study.nazar_arrivals, study.nazar_participants TO mg_app;
GRANT SELECT ON study.form_blocks, study.public_stats TO mg_app;
REVOKE DELETE ON study.nazar_arrivals, study.nazar_participants FROM mg_app;
REVOKE INSERT, UPDATE, DELETE ON study.form_blocks, study.public_stats FROM mg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON study.nazar_arrivals, study.nazar_participants, study.form_blocks, study.public_stats TO mg_jobs;

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study.nazar_arrivals', 'study.nazar_participants', 'study.form_blocks', 'study.public_stats'
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
DROP TABLE IF EXISTS study.public_stats, study.form_blocks, study.nazar_participants, study.nazar_arrivals;
-- The study schema belongs to 00004 (study.lab_trials) and stays.
