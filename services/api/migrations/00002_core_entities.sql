-- MD-047: initial entities. E-31 tenants, E-01 applicants + family members (family mode),
-- sessions and magic links (MD-048), E-02 cases (minimal; the journey agent extends it in P1),
-- E-12 timeline events, E-14 contacts (encrypted), E-15 consent artefacts, E-13 notifications,
-- payment intents (MD-041), OAuth/PKCE flows (MD-038), E-30 audit log (append-only, MD-050),
-- job runs (MD-052) and the HMAC replay cache (MD-053).
--
-- Conventions (DATA_MODEL §4.0): UUIDv7 keys from the application; tenant_id NOT NULL with RLS
-- on every tenant-owned table; timestamptz in UTC from the server clock; money in integer paise;
-- C3/C4 values are AES-256-GCM envelopes (bytea) with HMAC blind indexes for lookups.
-- D-13 revised: there is no AI gate. Accounts are held by adults; a minor is a family member
-- inside an adult account and needs a recorded parental-consent artefact.

-- +goose Up

-- E-31 Tenant ---------------------------------------------------------------------------------
CREATE TABLE core.tenants (
  tenant_id              text PRIMARY KEY CHECK (tenant_id ~ '^[A-Z]{2}$'),
  display_name           jsonb NOT NULL,
  display_name_key       text NOT NULL,
  hosting_mode           text NOT NULL DEFAULT 'independent' CHECK (hosting_mode IN ('independent', 'government_hosted')),
  languages              text[] NOT NULL,
  theme                  jsonb NOT NULL DEFAULT '{}',
  rule_pack_id           text NOT NULL,
  rule_pack_version      text NOT NULL,
  rule_pack_base_version text,
  features               jsonb NOT NULL DEFAULT '{}',
  grievance_officer      jsonb NOT NULL DEFAULT '{}',
  hosts                  text[] NOT NULL DEFAULT '{}',
  web_origins            text[] NOT NULL DEFAULT '{}',
  disclaimer_key         text NOT NULL DEFAULT 'footer.not_affiliated_simulated_data',
  kek_id                 text NOT NULL DEFAULT 'env:DATA_KEK',
  data_region            text NOT NULL DEFAULT 'render-singapore',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_touch BEFORE UPDATE ON core.tenants FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE core.tenant_adapter_config (
  tenant_id              text NOT NULL REFERENCES core.tenants (tenant_id),
  port                   text NOT NULL CHECK (port IN ('sarathi', 'digilocker', 'aadhaar_offline', 'bhashini', 'payment', 'notification', 'slot')),
  implementation         text NOT NULL,
  config                 jsonb NOT NULL DEFAULT '{}',
  contract_suite_version text NOT NULL,
  activated_at           timestamptz NOT NULL DEFAULT now(),
  activated_by           text NOT NULL DEFAULT 'migration',
  PRIMARY KEY (tenant_id, port)
);

-- E-01 Applicant (account holder) ---------------------------------------------------------------
CREATE TABLE core.applicants (
  applicant_id      uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  kind              text NOT NULL CHECK (kind IN ('device', 'account')),
  auth_subject_hash bytea,
  user_band         text NOT NULL DEFAULT 'unknown' CHECK (user_band IN ('u18', 'adult', 'unknown')),
  age_band          text CHECK (age_band IN ('under_16', '16_17', '18_25', '26_40', '41_60', '60_plus')),
  dob_enc           bytea,
  dob_precision     text CHECK (dob_precision IN ('day', 'year_only')),
  language          text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'doi')),
  a11y              jsonb NOT NULL DEFAULT '{}',
  quiet_hours       jsonb NOT NULL DEFAULT '{"start": "22:00", "end": "07:00"}',
  flags             text[] NOT NULL DEFAULT '{}',
  merged_into       uuid REFERENCES core.applicants (applicant_id),
  last_seen_at      timestamptz,
  deleted_at        timestamptz,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Accounts are held by adults (D-13 revised); a minor is a family member, never a holder.
  CONSTRAINT account_holder_is_adult CHECK (kind <> 'account' OR user_band <> 'u18')
);
CREATE UNIQUE INDEX applicants_subject_uq ON core.applicants (tenant_id, auth_subject_hash) WHERE auth_subject_hash IS NOT NULL;
CREATE INDEX applicants_seen_idx ON core.applicants (tenant_id, last_seen_at);
CREATE TRIGGER applicants_touch BEFORE UPDATE ON core.applicants FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- E-15 ConsentArtefact (DEPA-style, purpose-bound) ------------------------------------------------
CREATE TABLE privacy.consent_artefacts (
  consent_id            uuid PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id          uuid NOT NULL REFERENCES core.applicants (applicant_id),
  subject_member_id     uuid, -- FK added below (family member the consent is about)
  purpose               text NOT NULL CHECK (purpose IN ('ai_coach', 'ai_voice', 'whatsapp_updates', 'email_updates', 'web_push', 'analytics', 'field_study', 'helper_link', 'digilocker_pull', 'aadhaar_offline_check', 'school_share', 'parent_card', 'clip_contribution', 'parental_consent')),
  data_categories       text[] NOT NULL DEFAULT '{}',
  recipient             text,
  notice_version        text NOT NULL,
  language              text,
  granted_at            timestamptz NOT NULL,
  expires_at            timestamptz,
  revoked_at            timestamptz,
  guardian_applicant_id uuid REFERENCES core.applicants (applicant_id),
  signature             bytea,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CHECK (purpose <> 'parental_consent' OR (subject_member_id IS NOT NULL AND guardian_applicant_id IS NOT NULL))
);
CREATE UNIQUE INDEX consent_active_uq ON privacy.consent_artefacts
  (applicant_id, purpose, coalesce(recipient, ''), coalesce(subject_member_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

-- E-01 family members (family mode, F-17; P-03 Mohan-ji, P-07 Rahul) -----------------------------
CREATE TABLE core.family_members (
  member_id               uuid PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id            uuid NOT NULL REFERENCES core.applicants (applicant_id) ON DELETE CASCADE,
  relation                text NOT NULL CHECK (relation IN ('self', 'child', 'ward', 'parent', 'sibling', 'spouse', 'other')),
  label_enc               bytea,
  dob_enc                 bytea NOT NULL,
  dob_precision           text NOT NULL CHECK (dob_precision IN ('day', 'year_only')),
  age_band                text NOT NULL CHECK (age_band IN ('under_16', '16_17', '18_25', '26_40', '41_60', '60_plus')),
  is_minor                boolean NOT NULL,
  parental_consent_status text NOT NULL CHECK (parental_consent_status IN ('not_required', 'required', 'granted', 'revoked')),
  parental_consent_id     uuid REFERENCES privacy.consent_artefacts (consent_id),
  deleted_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (is_minor OR parental_consent_status = 'not_required'),
  CHECK (NOT is_minor OR parental_consent_status <> 'not_required'),
  CHECK (parental_consent_status <> 'granted' OR parental_consent_id IS NOT NULL)
);
CREATE INDEX family_members_applicant_idx ON core.family_members (applicant_id) WHERE deleted_at IS NULL;
CREATE TRIGGER family_members_touch BEFORE UPDATE ON core.family_members FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
ALTER TABLE privacy.consent_artefacts
  ADD CONSTRAINT consent_subject_member_fk FOREIGN KEY (subject_member_id) REFERENCES core.family_members (member_id);

-- Sessions (MD-048): opaque 256-bit tokens; only the SHA-256 is stored -------------------------------
CREATE TABLE core.sessions (
  session_id        uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  scope             text NOT NULL CHECK (scope IN ('anon', 'user', 'helper', 'school', 'console', 'admin')),
  token_hash        bytea NOT NULL UNIQUE,
  platform          text,
  app_version       text,
  device_public_key text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoke_reason     text
);
CREATE INDEX sessions_applicant_idx ON core.sessions (applicant_id) WHERE revoked_at IS NULL;

CREATE TABLE core.magic_links (
  link_id           uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  code_hash         bytea NOT NULL UNIQUE,
  email_enc         bytea NOT NULL,
  email_blind_index bytea NOT NULL,
  device_session_id uuid REFERENCES core.sessions (session_id),
  language          text,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_links_email_idx ON core.magic_links (tenant_id, email_blind_index, created_at DESC);

-- E-02 Case (minimal; journey state machine and event store arrive in P1) --------------------------
CREATE TABLE core.cases (
  case_id           uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id      uuid NOT NULL REFERENCES core.applicants (applicant_id),
  family_member_id  uuid REFERENCES core.family_members (member_id),
  for_family_member boolean GENERATED ALWAYS AS (family_member_id IS NOT NULL) STORED,
  state             text NOT NULL DEFAULT 'PLAN' CHECK (state IN ('PLAN', 'LL_APPLYING', 'HANDED_OFF', 'PAYMENT_PENDING', 'LL_TEST', 'BRIDGE', 'DL_BOOKABLE', 'TEST_BOOKED', 'TEST_FAILED', 'AWAITING_APPROVAL', 'DL_ISSUED', 'DL_HOLDER', 'LL_EXPIRED', 'RENEWAL_DUE')),
  path              text CHECK (path IN ('aadhaar_contactless', 'non_aadhaar_rto', 'adtc')),
  classes           text[] NOT NULL DEFAULT '{}',
  answers           jsonb NOT NULL DEFAULT '{}' CHECK (core.no_aadhaar_like_strings(answers) AND core.no_prohibited_keys(answers)),
  rule_pack_version text NOT NULL,
  key_dates         jsonb NOT NULL DEFAULT '{}',
  flags             text[] NOT NULL DEFAULT '{}',
  last_seq          integer NOT NULL DEFAULT 0,
  version           integer NOT NULL DEFAULT 1,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_applicant_idx ON core.cases (applicant_id) WHERE deleted_at IS NULL;
CREATE INDEX cases_state_idx ON core.cases (tenant_id, state);
CREATE TRIGGER cases_touch BEFORE UPDATE ON core.cases FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- E-12 TimelineEvent ------------------------------------------------------------------------------
CREATE TABLE core.timeline_events (
  timeline_event_id uuid PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES core.tenants (tenant_id),
  case_id           uuid NOT NULL REFERENCES core.cases (case_id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('fact', 'milestone', 'reminder', 'deadline')),
  code              text NOT NULL,
  due_at            timestamptz,
  occurred_at       timestamptz,
  status            text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'done', 'cancelled', 'superseded')),
  rule_id           text,
  idempotency_key   text NOT NULL UNIQUE,
  source_seq        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timeline_due_idx ON core.timeline_events (due_at) WHERE status = 'scheduled';
CREATE INDEX timeline_case_idx ON core.timeline_events (case_id, due_at);
CREATE TRIGGER timeline_touch BEFORE UPDATE ON core.timeline_events FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- Payment intents (MD-041). No card, UPI or bank data ever: the gateway collects. -----------------
CREATE TABLE core.payment_intents (
  payment_intent_id  uuid PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id       uuid NOT NULL REFERENCES core.applicants (applicant_id),
  case_id            uuid REFERENCES core.cases (case_id),
  adapter            text NOT NULL CHECK (adapter IN ('mock', 'sarathi_redirect', 'state_gateway')),
  redirect_url       text NOT NULL,
  return_path        text NOT NULL DEFAULT '/case/payment-return',
  amount_paise       integer NOT NULL CHECK (amount_paise > 0),
  status             text NOT NULL CHECK (status IN ('redirected', 'pending', 'success', 'failed', 'expired')),
  receipt_number_enc bytea,
  callback_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_intents_case_idx ON core.payment_intents (case_id, created_at DESC);
CREATE INDEX payment_intents_pending_idx ON core.payment_intents (status) WHERE status = 'pending';
CREATE TRIGGER payment_intents_touch BEFORE UPDATE ON core.payment_intents FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- E-14 Contact (encrypted, separate from the case) ------------------------------------------------
CREATE TABLE privacy.contacts (
  contact_id         uuid PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id       uuid NOT NULL REFERENCES core.applicants (applicant_id),
  kind               text NOT NULL CHECK (kind IN ('phone', 'email')),
  value_enc          bytea NOT NULL,
  blind_index        bytea NOT NULL,
  verified_at        timestamptz,
  opted_out_channels text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, blind_index)
);
CREATE TRIGGER contacts_touch BEFORE UPDATE ON privacy.contacts FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- E-13 Notification -------------------------------------------------------------------------------
CREATE TABLE msg.notifications (
  notification_id     uuid PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id        uuid REFERENCES core.applicants (applicant_id),
  contact_id          uuid REFERENCES privacy.contacts (contact_id),
  timeline_event_id   uuid REFERENCES core.timeline_events (timeline_event_id),
  channel             text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'web_push', 'sms', 'in_app')),
  template_id         text NOT NULL,
  template_vars       jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed_quiet_hours', 'suppressed_opt_out', 'suppressed_daily_cap', 'disabled_until_dlt')),
  provider            text,
  provider_message_id text,
  error_code          text,
  idempotency_key     text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_status_idx ON msg.notifications (status, created_at);
CREATE TRIGGER notifications_touch BEFORE UPDATE ON msg.notifications FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- OAuth 2.0 + PKCE flows (DigiLocker, MD-038). Single use, 10-minute life. ----------------------
CREATE TABLE ops.oauth_flows (
  state         text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES core.tenants (tenant_id),
  applicant_id  uuid NOT NULL REFERENCES core.applicants (applicant_id),
  provider      text NOT NULL,
  case_ref      text,
  doctypes      text[] NOT NULL DEFAULT '{}',
  code_verifier text NOT NULL,
  redirect_uri  text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- E-30 AuditLog: append-only, SHA-256 hash chain per tenant ------------------------------------
CREATE TABLE audit.audit_log (
  audit_id        uuid PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  tenant_id       text NOT NULL REFERENCES core.tenants (tenant_id),
  actor           text NOT NULL,
  actor_scope     text NOT NULL,
  action          text NOT NULL,
  target          text NOT NULL,
  purpose         text,
  consent_id      uuid,
  outcome         text NOT NULL DEFAULT 'ok',
  meta            jsonb NOT NULL DEFAULT '{}',
  ip_trunc        text,
  user_agent_hash bytea,
  trace_id        text,
  prev_hash       bytea,
  hash            bytea NOT NULL
);
CREATE INDEX audit_log_tenant_at_idx ON audit.audit_log (tenant_id, at DESC, audit_id DESC);

-- +goose StatementBegin
CREATE FUNCTION audit.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log is append-only (E-30, MD-050)' USING ERRCODE = 'insufficient_privilege';
END
$$;
-- +goose StatementEnd
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_log FROM mg_app, mg_jobs;

-- Platform tables (C1, not tenant-scoped) -------------------------------------------------------
CREATE TABLE ops.job_runs (
  run_id          uuid PRIMARY KEY,
  tenant_id       text REFERENCES core.tenants (tenant_id),
  job             text NOT NULL,
  runner          text NOT NULL CHECK (runner IN ('render_workflows', 'temporal', 'inline')),
  idempotency_key text NOT NULL UNIQUE,
  input_hash      bytea NOT NULL,
  args            jsonb NOT NULL DEFAULT '[]',
  status          text NOT NULL CHECK (status IN ('started', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  external_run_id text,
  result          jsonb,
  last_error      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER job_runs_touch BEFORE UPDATE ON ops.job_runs FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE ops.replay_cache (
  key        text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX replay_cache_exp_idx ON ops.replay_cache (expires_at);

CREATE TABLE ops.inbound_events (
  source      text NOT NULL,
  event       text NOT NULL,
  event_id    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, event, event_id)
);

-- Grants: tenants and adapter config are read-only for request traffic. --------------------------
REVOKE INSERT, UPDATE, DELETE ON core.tenants, core.tenant_adapter_config FROM mg_app;

-- Row-level security on every tenant-owned table (SECURITY_ARCHITECTURE §5). --------------------
-- +goose StatementBegin
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.applicants', 'core.family_members', 'core.sessions', 'core.magic_links', 'core.cases',
    'core.timeline_events', 'core.payment_intents', 'privacy.contacts', 'privacy.consent_artefacts',
    'msg.notifications', 'ops.oauth_flows', 'audit.audit_log'
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
DROP TABLE IF EXISTS ops.inbound_events, ops.replay_cache, ops.job_runs CASCADE;
DROP TABLE IF EXISTS audit.audit_log CASCADE;
DROP FUNCTION IF EXISTS audit.reject_mutation();
DROP TABLE IF EXISTS ops.oauth_flows, msg.notifications, privacy.contacts, core.payment_intents,
  core.timeline_events, core.cases, core.magic_links, core.sessions CASCADE;
ALTER TABLE IF EXISTS privacy.consent_artefacts DROP CONSTRAINT IF EXISTS consent_subject_member_fk;
DROP TABLE IF EXISTS core.family_members, privacy.consent_artefacts, core.applicants,
  core.tenant_adapter_config, core.tenants CASCADE;
