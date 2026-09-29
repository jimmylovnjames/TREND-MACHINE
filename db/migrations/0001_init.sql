-- TREND MACHINE initial schema.
-- Plain PostgreSQL (>= 13). Runs identically on managed Postgres (Supabase, Neon, RDS)
-- and on the embedded PGlite used for zero-config local development and tests.

-- ---------------------------------------------------------------------------
-- Reference motion library
-- ---------------------------------------------------------------------------
create table reference_motion_assets (
  id                  uuid primary key default gen_random_uuid(),
  template_id         text,                               -- primary association (nullable: library asset)
  storage_key         text not null unique,
  content_type        text not null check (content_type = 'video/mp4'),
  bytes               bigint not null check (bytes > 0),
  sha256              text not null,
  duration_seconds    numeric(8,3),
  width               integer,
  height              integer,
  fps                 numeric(7,3),
  aspect_ratio        text,
  creator             text not null,
  owner               text not null,
  creation_method     text not null check (creation_method in ('STUDIO_CAPTURE','IN_HOUSE_CAPTURE','COMMISSIONED','LICENSED_STOCK')),
  license             text not null,
  permission_evidence text not null,
  captured_on         date,
  status              text not null default 'UPLOADED'
                      check (status in ('UPLOADED','READY','REJECTED','RETIRED')),
  suitability         jsonb not null default '{}'::jsonb,
  notes               text not null default '',
  has_audio           boolean,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         text
);

-- ---------------------------------------------------------------------------
-- Templates (mutable head) + immutable versions
-- ---------------------------------------------------------------------------
create table templates (
  id               text primary key check (id ~ '^tpl_[a-z0-9_]+$'),
  slug             text not null unique,
  status           text not null check (status in ('DRAFT','PREVIEW','LIVE','RETIRED')),
  category         text not null check (category in ('ORIGINAL','TREND','COUNTERTREND')),
  current_version  integer not null default 0,
  featured         boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table template_versions (
  id                          uuid primary key default gen_random_uuid(),
  template_id                 text not null references templates(id) on delete restrict,
  version                     integer not null check (version >= 1),
  spec                        jsonb not null,
  spec_hash                   text not null,
  reference_motion_asset_id   uuid references reference_motion_assets(id) on delete restrict,
  created_by                  text not null,
  change_note                 text not null default '',
  created_at                  timestamptz not null default now(),
  unique (template_id, version)
);

alter table reference_motion_assets
  add constraint reference_motion_assets_template_fk
  foreign key (template_id) references templates(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Original Dance Lab
-- ---------------------------------------------------------------------------
create table dance_concepts (
  id          text primary key check (id ~ '^con_[a-z0-9_]+$'),
  slug        text not null unique,
  name        text not null,
  status      text not null check (status in ('IDEA','DESIGNED','REFERENCE_PENDING','REFERENCE_READY','TESTING','LIVE','RETIRED')),
  spec        jsonb not null,
  template_id text references templates(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trend Lab + countertrend foundation
-- ---------------------------------------------------------------------------
create table trend_candidates (
  id                           uuid primary key default gen_random_uuid(),
  external_ref                 text unique,
  name                         text not null,
  source_platform              text not null,
  source_url                   text not null,
  first_observed_at            timestamptz not null,
  last_observed_at             timestamptz not null,
  movement_description         text not null default '',
  signature_movement           text not null default '',
  hook                         text not null default '',
  loopability                  smallint check (loopability between 1 and 5),
  motion_transfer_suitability  smallint check (motion_transfer_suitability between 1 and 5),
  single_photo_suitability     smallint check (single_photo_suitability between 1 and 5),
  reproduction_difficulty      smallint check (reproduction_difficulty between 1 and 5),
  notes                        text not null default '',
  status                       text not null default 'CANDIDATE'
                               check (status in ('CANDIDATE','REVIEWING','APPROVED','REJECTED','TEMPLATE_CREATED')),
  template_id                  text references templates(id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create table trend_evidence (
  id                uuid primary key default gen_random_uuid(),
  trend_id          uuid not null references trend_candidates(id) on delete cascade,
  url               text not null,
  platform          text not null,
  observed_at       timestamptz not null,
  note              text not null default '',
  -- Only metrics actually captured by the scanner at observed_at. Never computed here.
  observed_metrics  jsonb,
  created_at        timestamptz not null default now(),
  unique (trend_id, url, observed_at)
);

create table trend_mechanics (
  id              uuid primary key default gen_random_uuid(),
  trend_id        uuid not null references trend_candidates(id) on delete cascade,
  characteristic  text not null,
  score           smallint check (score between 0 and 5),
  rationale       text not null,
  assessed_by     text not null check (assessed_by in ('HUMAN','MODEL')),
  assessor        text not null,
  created_at      timestamptz not null default now()
);

create table countertrends (
  id                   uuid primary key default gen_random_uuid(),
  trend_id             uuid not null references trend_candidates(id) on delete cascade,
  concept_id           text not null references dance_concepts(id) on delete cascade,
  mechanics_exploited  text[] not null,
  differentiation      text not null,
  status               text not null default 'PROPOSED' check (status in ('PROPOSED','ACCEPTED','REJECTED')),
  created_at           timestamptz not null default now(),
  unique (trend_id, concept_id)
);

-- ---------------------------------------------------------------------------
-- Uploads (source photos) — private, short retention
-- ---------------------------------------------------------------------------
create table uploads (
  id            uuid primary key default gen_random_uuid(),
  owner_hash    text not null,
  storage_key   text not null unique,
  content_type  text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  bytes         integer not null check (bytes > 0),
  width         integer not null,
  height        integer not null,
  sha256        text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  deleted_at    timestamptz
);
create index uploads_owner_idx on uploads (owner_hash, created_at desc);
create index uploads_expiry_idx on uploads (expires_at) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Generation jobs
-- ---------------------------------------------------------------------------
create table generation_jobs (
  id                    uuid primary key default gen_random_uuid(),
  owner_hash            text not null,
  ip_hash               text,
  idempotency_key       text not null,
  template_id           text not null references templates(id) on delete restrict,
  template_version_id   uuid not null references template_versions(id) on delete restrict,
  template_version      integer not null,
  upload_id             uuid references uploads(id) on delete set null,
  regenerate_of         uuid references generation_jobs(id) on delete set null,
  status                text not null check (status in ('QUEUED','PROCESSING','COMPLETED','FAILED','CANCELED')),
  error_code            text,
  error_detail          text,          -- internal only; never returned to clients
  provider_id           text,
  provider_model        text,
  provider_job_id       text,
  provider_status       text,
  progress              smallint,
  submit_attempts       smallint not null default 0,
  poll_count            integer not null default 0,
  finalize_attempts     smallint not null default 0,
  dispatch_lease_until  timestamptz,
  poll_lease_until      timestamptz,
  next_poll_at          timestamptz,
  provider_output_url   text,          -- short-lived provider URL, cleared after copy
  submitted_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  failed_at             timestamptz,
  deadline_at           timestamptz,
  result_storage_key    text,
  result_content_type   text,
  result_bytes          bigint,
  result_expires_at     timestamptz,
  result_deleted_at     timestamptz,
  cost_usd              numeric(10,4),
  cost_source           text check (cost_source in ('PROVIDER_ESTIMATE','PRICE_TABLE','PROVIDER_REPORTED')),
  routing               jsonb not null default '{}'::jsonb,
  provenance            jsonb not null default '{}'::jsonb,
  device_class          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (owner_hash, idempotency_key)
);
create index generation_jobs_owner_idx on generation_jobs (owner_hash, created_at desc);
create index generation_jobs_active_idx on generation_jobs (status, next_poll_at) where status in ('QUEUED','PROCESSING');
create index generation_jobs_provider_idx on generation_jobs (provider_id, provider_job_id);
create index generation_jobs_ip_idx on generation_jobs (ip_hash, created_at desc);
create index generation_jobs_created_idx on generation_jobs (created_at desc);

create table generation_job_transitions (
  id           bigserial primary key,
  job_id       uuid not null references generation_jobs(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  code         text,
  at           timestamptz not null default now()
);
create index generation_job_transitions_job_idx on generation_job_transitions (job_id, at);

-- ---------------------------------------------------------------------------
-- Share links (result only; never the source photo)
-- ---------------------------------------------------------------------------
create table shares (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  job_id      uuid not null references generation_jobs(id) on delete cascade,
  owner_hash  text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index shares_active_job_idx on shares (job_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Analytics (append-only, pseudonymous)
-- ---------------------------------------------------------------------------
create table analytics_events (
  id                bigserial primary key,
  name              text not null,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  source            text not null check (source in ('client','server')),
  anon_id           text,
  session_id        text,
  template_id       text,
  template_version  integer,
  job_id            uuid,
  provider_id       text,
  provider_model    text,
  error_code        text,
  latency_ms        integer,
  cost_usd          numeric(10,4),
  device_class      text,
  props             jsonb not null default '{}'::jsonb
);
create index analytics_events_name_time_idx on analytics_events (name, occurred_at desc);
create index analytics_events_template_idx on analytics_events (template_id, name);

-- ---------------------------------------------------------------------------
-- Operational tables
-- ---------------------------------------------------------------------------
create table rate_limit_buckets (
  bucket        text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (bucket, window_start)
);

create table admin_audit_log (
  id      bigserial primary key,
  actor   text not null,
  action  text not null,
  target  text not null,
  detail  jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now()
);

create table data_deletions (
  id            uuid primary key default gen_random_uuid(),
  owner_hash    text not null,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  summary       jsonb not null default '{}'::jsonb
);
