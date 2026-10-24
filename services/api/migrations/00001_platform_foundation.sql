-- MD-047 / MD-056: schemas, database roles and shared functions.
-- Roles: mg_app (API requests; subject to row-level security) and mg_jobs (cross-tenant jobs,
-- seeds; allowed through tenant policies explicitly and audit-logged by the caller). The API
-- connects with any login role that is a member of both and runs `SET LOCAL ROLE` per
-- transaction (internal/store), so RLS and the audit grants hold even for the table owner.

-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mg_app') THEN
    CREATE ROLE mg_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mg_jobs') THEN
    CREATE ROLE mg_jobs NOLOGIN;
  END IF;
END
$$;
-- +goose StatementEnd
GRANT mg_app TO CURRENT_USER;
GRANT mg_jobs TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS privacy;
CREATE SCHEMA IF NOT EXISTS msg;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ops;

GRANT USAGE ON SCHEMA core, privacy, msg, audit, ops TO mg_app, mg_jobs;

-- Tables created later by this role are usable by the app roles (audit is narrowed below).
ALTER DEFAULT PRIVILEGES IN SCHEMA core, privacy, msg, ops GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mg_app, mg_jobs;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT ON TABLES TO mg_app, mg_jobs;

-- +goose StatementBegin
CREATE FUNCTION core.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Defence in depth for free-form JSON (cases.answers): rejects CX keys and the personal-vault
-- keys (name, relation, address) that live only on the device (brief §15, DATA_MODEL §4.1).
-- +goose StatementBegin
CREATE FUNCTION core.no_prohibited_keys(doc jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT jsonb_path_exists(
    doc,
    '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(aadhaar|aadhar|uid|vid|otp|biometric|name|relation|address|password)" flag "i")'
  )
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION core.no_aadhaar_like_strings(doc jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT jsonb_path_exists(doc, '$.** ? (@.type() == "string" && @ like_regex "^[2-9][0-9]{11}$")')
$$;
-- +goose StatementEnd

-- +goose Down
DROP SCHEMA IF EXISTS ops CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;
DROP SCHEMA IF EXISTS msg CASCADE;
DROP SCHEMA IF EXISTS privacy CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
