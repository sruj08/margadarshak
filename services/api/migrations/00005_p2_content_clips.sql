-- P2 Nazar clip bank (workstream F, MD-217..221; NAZAR §3–§7; E-20, E-21). Backs
-- internal/clips (Store interface; MemStore is the reference semantics).
--
-- The clip bank is not personal data: clips are blurred public-road footage, and people appear
-- only as pseudonyms (rater-07, auditor-01, curator-02; clip-pipeline PSEUDONYM_RE). So there is
-- no tenant RLS here; tenant applicability is the clip's tenantTags. Grants:
--   mg_app  (API-55 admin requests, API-37 reads): SELECT everywhere, writes only where an admin
--           request writes (clips, ratings, blur audits, the clip number counter);
--   mg_jobs (clip_ingest / clip_finalize job steps): everything, including raw deletions and
--           manifests. The raw-deletion log is append-only for both.
-- No foreign keys to other P2 files; consent IDs reference P0 privacy.consent_artefacts.
-- Deviations from DATA_MODEL §4.4, to fold into the doc:
--   - status uses the clip-pipeline vocabulary (raw … retired), not API-55's transcoding/…;
--   - doc jsonb holds clip.json verbatim, validated in Go against clip.schema.json (jsonschema v6);
--   - clip_review_tasks (plan §2.8) holds the W08 blind rater tasks; the Wait-node resume URL is
--     a bearer capability for the n8n execution, so it is stored encrypted with the privacy vault
--     (tenant = the clip's registering state, field content.clip_review_tasks.resume_url);
--   - clip_ratings.decision (windows_set | reject) is the API-55 rating decision relayed to W08;
--   - origin (ADR-0013): ai_generated clips have no contributor, filming or blur audit; a passing
--     synthetic_review replaces the audit for publishing, and generation_key dedupes clip_generate.

-- +goose Up
CREATE SCHEMA IF NOT EXISTS content;
GRANT USAGE ON SCHEMA content TO mg_app, mg_jobs;

-- Per-prefix clip numbers (JK-0001, JMU-0012).
CREATE TABLE content.clip_id_counters (
  prefix text PRIMARY KEY CHECK (prefix ~ '^[A-Z]{2,4}$'),
  last   integer NOT NULL CHECK (last >= 0)
);

-- E-20 clip, one row per version (clip_id@version).
CREATE TABLE content.clips (
  clip_id                text NOT NULL CHECK (clip_id ~ '^[A-Z]{2,4}-\d{4,6}$'),
  version                integer NOT NULL CHECK (version >= 1),
  status                 text NOT NULL CHECK (status IN ('raw', 'transcoded', 'blurred', 'audited', 'proposed', 'rated',
                           'adjudication', 'published', 'retired')),
  doc                    jsonb NOT NULL,
  tenant_tags            text[] NOT NULL CHECK (cardinality(tenant_tags) BETWEEN 1 AND 8),
  tenant                 text NOT NULL CHECK (tenant ~ '^[A-Z]{2,3}$'), -- registering state (Clip.Tenant; n8n envelopes, job tenant)
  origin                 text NOT NULL DEFAULT 'filmed' CHECK (origin IN ('filmed', 'ai_generated')), -- ADR-0013
  raw_object_key         text CHECK (raw_object_key !~ '://' AND position('?' in raw_object_key) = 0), -- NULL: AI clip before generation
  intermediate_keys      text[] NOT NULL DEFAULT '{}',
  filmed_by              text CHECK (filmed_by IN ('passenger', 'fixed_mount')), -- never the rider; NULL for AI clips
  filmed_on              date,
  licence                text NOT NULL CHECK (licence = 'CC-BY-4.0'),
  contributor_consent_id uuid REFERENCES privacy.consent_artefacts (consent_id), -- NULL for AI clips (no contributor)
  generation_key         text UNIQUE,                   -- AI clips: sceneId:revision:batchId (one clip per batch)
  synthetic_review       jsonb,                         -- AI clips: latest curator synthetic review, passing or not
  onset_hint             jsonb,                         -- AI clips: raters' approximate cue (±3 s); never in doc, never to learners
  registered_by          text NOT NULL CHECK (registered_by ~ '^[a-z][a-z0-9]*-[a-z0-9]{1,16}$'),
  registered_at          timestamptz NOT NULL,
  flash_passed           boolean,
  proposals              jsonb NOT NULL DEFAULT '[]',   -- M-06 proposals (none in P2: the propose step is a stub)
  blur_regions           jsonb,
  review_event_id        text,                          -- idempotency key of the md/clip-ready envelope sent
  adjudication_event_id  text,
  agreement              jsonb,                         -- last ClipAgreement from /clip/agreement, verbatim
  agreement_accepted     boolean NOT NULL DEFAULT false,
  needs_third_rater      boolean NOT NULL DEFAULT false,
  final_hazards          jsonb NOT NULL DEFAULT '[]',
  adjudication           jsonb,
  cue_texts              jsonb NOT NULL DEFAULT '{}',   -- curator cue per final hazard {hId: {en, hi}}
  blur_audit             text NOT NULL DEFAULT 'pending' CHECK (blur_audit IN ('pending', 'passed', 'failed')),
  audit_passed_at        timestamptz,
  raw_deleted_at         timestamptz,
  published_at           timestamptz,
  mock_eligible          boolean NOT NULL DEFAULT false,
  mock_reasons           text[] NOT NULL DEFAULT '{}',
  workflow_runs          text[] NOT NULL DEFAULT '{}',
  finalize_round         integer NOT NULL DEFAULT 0 CHECK (finalize_round >= 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(), -- set by Go from the injected clock (no touch trigger)
  PRIMARY KEY (clip_id, version),
  CHECK (doc ->> 'clipId' = clip_id AND (doc ->> 'version')::integer = version AND doc ->> 'status' = status),
  CHECK (coalesce(doc ->> 'origin', 'filmed') = origin),
  CHECK (origin = 'ai_generated' OR (raw_object_key IS NOT NULL AND filmed_by IS NOT NULL AND contributor_consent_id IS NOT NULL
    AND generation_key IS NULL AND synthetic_review IS NULL AND onset_hint IS NULL)),
  CHECK (origin = 'filmed' OR (generation_key IS NOT NULL AND filmed_by IS NULL AND blur_audit = 'pending')),
  CHECK (status <> 'published' OR (published_at IS NOT NULL AND (
    (origin = 'filmed' AND audit_passed_at IS NOT NULL AND blur_audit = 'passed') OR
    (origin = 'ai_generated' AND (synthetic_review ->> 'passed')::boolean IS TRUE AND doc ? 'syntheticReview')))),
  CHECK (blur_audit <> 'passed' OR audit_passed_at IS NOT NULL),
  CHECK (core.no_prohibited_keys(doc))
);
CREATE INDEX clips_status_idx ON content.clips (status);
CREATE INDEX clips_tenant_tags_idx ON content.clips USING gin (tenant_tags);

-- game-core NazarClip per published version (what /verify takes inline). Cache of the doc.
CREATE TABLE content.clip_scoring (
  clip_id    text NOT NULL,
  version    integer NOT NULL,
  doc        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clip_id, version),
  FOREIGN KEY (clip_id, version) REFERENCES content.clips (clip_id, version) ON DELETE CASCADE
);

-- E-21 blind ratings: one per rater per clip version; frozen once both are saved (Go rule).
CREATE TABLE content.clip_ratings (
  clip_id    text NOT NULL,
  version    integer NOT NULL,
  rater      text NOT NULL CHECK (rater ~ '^[a-z][a-z0-9]*-[a-z0-9]{1,16}$'),
  submission jsonb NOT NULL,                             -- clip-pipeline RaterSubmission
  decision   text NOT NULL DEFAULT 'windows_set' CHECK (decision IN ('windows_set', 'reject')), -- relayed to W08
  saved_at   timestamptz NOT NULL,
  seq        bigint GENERATED ALWAYS AS IDENTITY,       -- first-save order (kept on re-save): rater A, rater B
  PRIMARY KEY (clip_id, version, rater),
  FOREIGN KEY (clip_id, version) REFERENCES content.clips (clip_id, version) ON DELETE CASCADE,
  CHECK (jsonb_array_length(submission -> 'marks') <= 10)
);

-- Full human blur audits (clip-pipeline BlurAuditRecord); clip.json carries the summary.
CREATE TABLE content.clip_blur_audits (
  audit_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clip_id          text NOT NULL,
  version          integer NOT NULL,
  auditor          text NOT NULL CHECK (auditor ~ '^[a-z][a-z0-9]*-[a-z0-9]{1,16}$'),
  rendition_sha256 text NOT NULL CHECK (rendition_sha256 ~ '^[0-9a-f]{64}$'),
  frames_total     integer NOT NULL CHECK (frames_total > 0),
  frames_checked   integer NOT NULL CHECK (frames_checked >= 0),
  misses           integer NOT NULL CHECK (misses >= 0),
  miss_frames      jsonb NOT NULL DEFAULT '[]',
  passed           boolean GENERATED ALWAYS AS (frames_checked >= frames_total AND misses = 0) STORED,
  audited_at       timestamptz NOT NULL,
  FOREIGN KEY (clip_id, version) REFERENCES content.clips (clip_id, version) ON DELETE CASCADE,
  CHECK (jsonb_array_length(miss_frames) = misses)
);
CREATE INDEX clip_blur_audits_clip_idx ON content.clip_blur_audits (clip_id, version, audit_id DESC);

-- MD-218 raw-footage deletion log: object keys only (never URLs), append-only.
CREATE TABLE content.clip_raw_deletions (
  clip_id         text NOT NULL,
  version         integer NOT NULL,
  object_keys     text[] NOT NULL CHECK (cardinality(object_keys) >= 1),
  reason          text NOT NULL CHECK (reason IN ('audit_passed', 'retention_limit', 'takedown')),
  uploaded_at     timestamptz NOT NULL,
  audit_passed_at timestamptz,
  deleted_at      timestamptz NOT NULL,
  deleted_by      text NOT NULL,
  deadline        timestamptz NOT NULL,
  on_time         boolean NOT NULL,
  PRIMARY KEY (clip_id, version),
  FOREIGN KEY (clip_id, version) REFERENCES content.clips (clip_id, version),
  CHECK (array_to_string(object_keys, ' ') !~ '://' AND position('?' in array_to_string(object_keys, ' ')) = 0),
  CHECK (reason <> 'audit_passed' OR audit_passed_at IS NOT NULL)
);

-- Manifest versions (bank: CC-BY record with windows; client: API-37, no hazard information).
CREATE TABLE content.clip_manifests (
  manifest_version text PRIMARY KEY,
  generated_at     timestamptz NOT NULL,
  bank             jsonb NOT NULL,
  client           jsonb NOT NULL,
  mock_eligibility jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clip_manifests_generated_idx ON content.clip_manifests (generated_at DESC);

-- W08 blind rater tasks (API-55 internal review-tasks / status), one per stage per clip version.
-- assignee is NULL until a rater claims the task by saving a rating (never the excluded rater).
CREATE TABLE content.clip_review_tasks (
  review_task_id   uuid PRIMARY KEY,
  clip_id          text NOT NULL,
  version          integer NOT NULL,
  stage            text NOT NULL CHECK (stage IN ('rater_1', 'rater_2')),
  status           text NOT NULL CHECK (status IN ('open', 'submitted', 'rejected', 'timed_out', 'cancelled')),
  assignee         text CHECK (assignee ~ '^[a-z][a-z0-9]*-[a-z0-9]{1,16}$'),
  exclude_rater    text CHECK (exclude_rater ~ '^[a-z][a-z0-9]*-[a-z0-9]{1,16}$'),
  n8n_execution_id text NOT NULL CHECK (length(n8n_execution_id) BETWEEN 1 AND 64),
  resume_url_enc   bytea,                                -- vault envelope; never stored in clear
  due_at           timestamptz NOT NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  UNIQUE (clip_id, version, stage),
  FOREIGN KEY (clip_id, version) REFERENCES content.clips (clip_id, version) ON DELETE CASCADE,
  CHECK (status <> 'submitted' OR assignee IS NOT NULL),
  CHECK (assignee IS NULL OR exclude_rater IS NULL OR assignee <> exclude_rater)
);

GRANT SELECT ON ALL TABLES IN SCHEMA content TO mg_app;
GRANT INSERT, UPDATE ON content.clips, content.clip_ratings, content.clip_id_counters TO mg_app;
GRANT INSERT ON content.clip_blur_audits TO mg_app;
GRANT INSERT, UPDATE ON content.clip_review_tasks TO mg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO mg_jobs;
REVOKE UPDATE, DELETE ON content.clip_raw_deletions FROM mg_app, mg_jobs;

-- +goose Down
DROP TABLE IF EXISTS content.clip_review_tasks, content.clip_manifests, content.clip_raw_deletions, content.clip_blur_audits,
  content.clip_ratings, content.clip_scoring, content.clips, content.clip_id_counters;
DROP SCHEMA IF EXISTS content;
