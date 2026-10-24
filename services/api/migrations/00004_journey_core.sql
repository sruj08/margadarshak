-- P1 journey core (BE-journey): plan snapshots (API-01), the case event store and its
-- projections (E-02 cases, E-03 class selections, E-04/E-05 licence mirrors, E-12 timeline),
-- the fee quote store (E-07, API-19), HTTP idempotency keys (BACKEND §13), notification kinds
-- for nudge limits (MD-130), data exports (API-61), privacy-preserving analytics (API-63,
-- MD-136), the field-study lab (API-70) and public counters (API-71).
--
-- Conventions as 00002: UUIDv7 keys from the application, tenant_id + FORCE RLS on every
-- tenant-owned table, C3 values encrypted by the application (bytea), dates in the IST calendar.

-- +goose Up

-- E-02 Case: the columns the journey needs. `facts` holds only non-personal yes/no answers for the
-- blocker engine (F-04); DOB is C3 (encrypted); the Mode B application reference is encrypted too.
ALTER TABLE core.cases
  ADD COLUMN rule_pack_id  text,
  ADD COLUMN dob_enc       bytea,
  ADD COLUMN dob_precision text CHECK (dob_precision IN ('day', 'year_only')),
  ADD COLUMN facts         jsonb NOT NULL DEFAULT '{}' CHECK (core.no_aadhaar_like_strings(facts)),
  ADD COLUMN plan_id       uuid,
  ADD COLUMN app_ref_enc   bytea,
  ADD COLUMN app_status    jsonb;
UPDATE core.cases SET rule_pack_id = tenant_id WHERE rule_pack_id IS NULL;
ALTER TABLE core.cases ALTER COLUMN rule_pack_id SET NOT NULL;
CREATE INDEX cases_rule_pack_idx ON core.cases (tenant_id, rule_pack_version);

-- API-01 plan snapshots: 7-day life, no personal data in clear (the DOB is encrypted so a case
-- can be opened from the plan; it is deleted with the snapshot by the retention job, MD-137).
CREATE TABLE core.plans (
  plan_id           uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid REFERENCES core.applicants (applicant_id),
  state             text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  request           jsonb NOT NULL CHECK (core.no_aadhaar_like_strings(request)),
  dob_enc           bytea,
  dob_precision     text CHECK (dob_precision IN ('day', 'year_only')),
  age_band          text,
  rule_pack_version text NOT NULL,
  result            jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);
CREATE INDEX plans_expiry_idx ON core.plans (expires_at);
CREATE INDEX plans_applicant_idx ON core.plans (applicant_id) WHERE applicant_id IS NOT NULL;

-- Event store (DATA_MODEL §4.1, §5): append-only, gapless seq per case, idempotent per key.
CREATE TABLE core.case_events (
  case_id           uuid NOT NULL REFERENCES core.cases (case_id) ON DELETE CASCADE,
  seq               integer NOT NULL CHECK (seq > 0),
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  type              text NOT NULL,
  schema_version    smallint NOT NULL DEFAULT 1,
  payload           jsonb NOT NULL DEFAULT '{}' CHECK (core.no_aadhaar_like_strings(payload)),
  occurred_on       date,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  actor_kind        text NOT NULL CHECK (actor_kind IN ('applicant', 'helper', 'system', 'adapter', 'admin')),
  actor_id          uuid,
  idempotency_key   text NOT NULL,
  rule_pack_version text NOT NULL,
  from_state        text,
  to_state          text,
  PRIMARY KEY (case_id, seq),
  UNIQUE (case_id, idempotency_key)
);
CREATE INDEX case_events_type_idx ON core.case_events (tenant_id, type, recorded_at);

-- E-03 class selections.
CREATE TABLE core.class_selections (
  case_id       uuid NOT NULL REFERENCES core.cases (case_id) ON DELETE CASCADE,
  class_code    text NOT NULL CHECK (class_code IN ('MC50CC', 'MCWOG', 'MCWG', 'LMV-NT', 'LMV-TR', 'E-RICKSHAW', 'E-CART', 'MGV', 'HGMV', 'HPMV', 'HTV', 'ADAPTED')),
  tenant_id     text NOT NULL REFERENCES core.tenants (tenant_id),
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'll_applied', 'll_issued', 'dl_test_booked', 'dl_failed', 'dl_passed', 'dl_issued', 'withdrawn')),
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  eligible_from date,
  PRIMARY KEY (case_id, class_code)
);

-- E-04 / E-05 licence mirrors: never the licence number in clear (last 4 only, encrypted).
CREATE TABLE core.ll_mirrors (
  case_id          uuid PRIMARY KEY REFERENCES core.cases (case_id) ON DELETE CASCADE,
  tenant_id        text NOT NULL REFERENCES core.tenants (tenant_id),
  issued_on        date NOT NULL,
  expires_on       date NOT NULL CHECK (expires_on > issued_on),
  classes          text[] NOT NULL DEFAULT '{}',
  number_last4_enc bytea,
  source           text NOT NULL CHECK (source IN ('user_entered', 'digilocker', 'adapter', 'screenshot_confirmed')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core.dl_mirrors (
  case_id              uuid PRIMARY KEY REFERENCES core.cases (case_id) ON DELETE CASCADE,
  tenant_id            text NOT NULL REFERENCES core.tenants (tenant_id),
  issued_on            date,
  valid_to_nt          date NOT NULL,
  valid_to_tr          date,
  classes              text[] NOT NULL DEFAULT '{}',
  number_last4_enc     bytea,
  renewal_window_opens date,
  source               text NOT NULL CHECK (source IN ('user_entered', 'digilocker', 'adapter')),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- E-07 fee quote store (integer paise, computed from fees.json; API-19 prices from here).
CREATE TABLE core.fee_quotes (
  quote_id                uuid PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES core.tenants (tenant_id),
  case_id                 uuid REFERENCES core.cases (case_id) ON DELETE CASCADE,
  plan_id                 uuid,
  state                   text NOT NULL,
  rule_pack_version       text NOT NULL,
  classes                 text[] NOT NULL,
  lines                   jsonb NOT NULL,
  ll_stage_paise          integer NOT NULL CHECK (ll_stage_paise >= 0),
  subtotal_govt_fee_paise integer NOT NULL CHECK (subtotal_govt_fee_paise >= 0),
  total_paise             integer NOT NULL CHECK (total_paise >= subtotal_govt_fee_paise),
  excludes                text[] NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz
);
CREATE INDEX fee_quotes_case_idx ON core.fee_quotes (case_id, created_at DESC);
ALTER TABLE core.payment_intents ADD COLUMN quote_id uuid REFERENCES core.fee_quotes (quote_id) ON DELETE SET NULL, ADD COLUMN stage text;

-- E-12 timeline: the IST due date used in the idempotency key and by the sweep (keyset pages).
ALTER TABLE core.timeline_events ADD COLUMN due_on date;
CREATE INDEX timeline_sweep_idx ON core.timeline_events (due_on, timeline_event_id) WHERE status = 'scheduled';

-- E-13: nudge vs transactional vs fallback (≤ 1 nudge a day, MD-130), seen state (W02), cancelled.
ALTER TABLE msg.notifications
  ADD COLUMN kind    text NOT NULL DEFAULT 'transactional' CHECK (kind IN ('nudge', 'transactional', 'fallback')),
  ADD COLUMN seen_at timestamptz,
  ADD COLUMN nudge_day date;
ALTER TABLE msg.notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE msg.notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed',
  'suppressed_quiet_hours', 'suppressed_opt_out', 'suppressed_daily_cap', 'disabled_until_dlt', 'cancelled'));
-- At most one nudge per applicant per IST day (MD-130), enforced by the database as well.
CREATE UNIQUE INDEX notifications_one_nudge_a_day_uq ON msg.notifications (applicant_id, nudge_day) WHERE kind = 'nudge' AND nudge_day IS NOT NULL;
ALTER TABLE msg.notifications DROP CONSTRAINT notifications_contact_id_fkey;
ALTER TABLE msg.notifications ADD CONSTRAINT notifications_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES privacy.contacts (contact_id) ON DELETE SET NULL;

-- API-61 export bundles (encrypted, 24 h).
CREATE TABLE privacy.exports (
  export_id    uuid PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id uuid NOT NULL REFERENCES core.applicants (applicant_id),
  bundle_enc   bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

-- HTTP Idempotency-Key store (BACKEND §13, 24 h). Platform table; scope is pseudonymous.
CREATE TABLE ops.idempotency_keys (
  tenant_id        text NOT NULL,
  scope            text NOT NULL,
  key              text NOT NULL,
  method           text NOT NULL,
  path             text NOT NULL,
  request_sha256   bytea NOT NULL,
  status_code      integer,
  response_headers jsonb,
  response_body    bytea,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
CREATE INDEX idempotency_keys_created_idx ON ops.idempotency_keys (created_at);

-- API-63 analytics (MD-136): allowlisted names and props only, a daily-rotating pseudonym, no IP,
-- no identifiers; raw rows kept 30 days, aggregated with k >= 5 suppression.
CREATE TABLE ops.analytics_events (
  event_id   bigserial PRIMARY KEY,
  tenant_id  text NOT NULL,
  day        date NOT NULL,
  name       text NOT NULL CHECK (name ~ '^[a-z0-9_.]{3,64}$'),
  props      jsonb NOT NULL DEFAULT '{}' CHECK (core.no_aadhaar_like_strings(props)),
  pseudonym  bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_day_idx ON ops.analytics_events (tenant_id, day, name);
GRANT USAGE, SELECT ON SEQUENCE ops.analytics_events_event_id_seq TO mg_app, mg_jobs;

-- API-71 public counters (non-personal totals).
CREATE TABLE ops.counters (
  tenant_id text NOT NULL,
  name      text NOT NULL,
  value     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

-- API-70 field-study lab (RT-STUDY, pseudonymous participant codes).
CREATE SCHEMA IF NOT EXISTS study;
GRANT USAGE ON SCHEMA study TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA study GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;
CREATE TABLE study.lab_trials (
  trial_id          uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  participant_code  text NOT NULL CHECK (participant_code ~ '^P-[0-9]{3}$'),
  arm               text NOT NULL CHECK (arm IN ('portal_replica', 'margdarshak')),
  task_id           text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz NOT NULL CHECK (ended_at >= started_at),
  errors            integer NOT NULL DEFAULT 0 CHECK (errors >= 0),
  completed         boolean NOT NULL,
  sus_score         numeric(5, 2) CHECK (sus_score BETWEEN 0 AND 100),
  would_pay_agent   boolean,
  consent_id        uuid NOT NULL REFERENCES privacy.consent_artefacts (consent_id),
  screens_visited   integer,
  back_navigations  integer,
  validation_errors integer,
  selections        text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Append-only event store for request traffic (erasure runs as mg_jobs).
REVOKE UPDATE, DELETE ON core.case_events FROM mg_app;

-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.plans', 'core.case_events', 'core.class_selections', 'core.ll_mirrors', 'core.dl_mirrors',
    'core.fee_quotes', 'privacy.exports', 'study.lab_trials', 'ops.idempotency_keys', 'ops.analytics_events', 'ops.counters'
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

-- Demo tenant: the persona switcher (MD-122) is on for JK; the API also refuses it in
-- staging, production and field mode.
UPDATE core.tenants SET features = features || '{"persona_switcher": true}'::jsonb WHERE tenant_id = 'JK';

-- +goose Down
UPDATE core.tenants SET features = features - 'persona_switcher' WHERE tenant_id = 'JK';
DROP TABLE IF EXISTS study.lab_trials;
DROP SCHEMA IF EXISTS study CASCADE;
DROP TABLE IF EXISTS ops.counters, ops.analytics_events, ops.idempotency_keys, privacy.exports;
DROP INDEX IF EXISTS msg.notifications_one_nudge_a_day_uq;
ALTER TABLE msg.notifications DROP CONSTRAINT IF EXISTS notifications_contact_id_fkey;
ALTER TABLE msg.notifications ADD CONSTRAINT notifications_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES privacy.contacts (contact_id);
DELETE FROM msg.notifications WHERE status = 'cancelled';
ALTER TABLE msg.notifications DROP CONSTRAINT notifications_status_check;
ALTER TABLE msg.notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed',
  'suppressed_quiet_hours', 'suppressed_opt_out', 'suppressed_daily_cap', 'disabled_until_dlt'));
ALTER TABLE msg.notifications DROP COLUMN IF EXISTS nudge_day, DROP COLUMN IF EXISTS seen_at, DROP COLUMN IF EXISTS kind;
DROP INDEX IF EXISTS core.timeline_sweep_idx;
ALTER TABLE core.timeline_events DROP COLUMN IF EXISTS due_on;
ALTER TABLE core.payment_intents DROP COLUMN IF EXISTS stage, DROP COLUMN IF EXISTS quote_id;
DROP TABLE IF EXISTS core.fee_quotes, core.dl_mirrors, core.ll_mirrors, core.class_selections, core.case_events, core.plans;
DROP INDEX IF EXISTS core.cases_rule_pack_idx;
ALTER TABLE core.cases DROP COLUMN IF EXISTS app_status, DROP COLUMN IF EXISTS app_ref_enc, DROP COLUMN IF EXISTS plan_id,
  DROP COLUMN IF EXISTS facts, DROP COLUMN IF EXISTS dob_precision, DROP COLUMN IF EXISTS dob_enc, DROP COLUMN IF EXISTS rule_pack_id;
