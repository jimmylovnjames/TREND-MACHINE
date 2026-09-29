# TREND MACHINE

**Pick a move. Add your photo. Become the video.**

TREND MACHINE is a mobile-first AI dance-video platform. A person picks a dance template, uploads one full-body photo, and gets a short vertical video of themselves performing that movement. It is built to grow into a viral-movement engine: trend intelligence, original choreography, generation, audience measurement, and a feedback loop between them.

This repository is the working v1: the consumer app, the generation architecture, the template, reference-motion, Dance Lab and Trend Lab data model, analytics, and the admin area.

> **Truth first.** Nothing in this product is faked. There are no invented views, likes, trends or generated videos. If a dance has no recorded reference performance, or no video engine is connected, the user is told exactly that.

---

## Contents

- [Status](#status)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Database & migrations](#database--migrations)
- [Storage](#storage)
- [Generation providers](#generation-providers)
- [Templates, versions & adding a dance](#templates-versions--adding-a-dance)
- [Reference motion & provenance](#reference-motion--provenance)
- [Original Dance Lab, Trend Lab & countertrends](#original-dance-lab-trend-lab--countertrends)
- [Analytics & the learning loop](#analytics--the-learning-loop)
- [Privacy, retention & deletion](#privacy-retention--deletion)
- [AI media transparency](#ai-media-transparency)
- [Security](#security)
- [Cost controls](#cost-controls)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

---

## Status

| Area                                                                                  | State                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Consumer flow: home → dance → photo → crop → rights → generate → job → result/failure | ✅ working, e2e tested                                                     |
| Higgsfield · Kling Motion Control adapter                                             | ✅ implemented against current docs; **not yet run with live credentials** |
| Viggle V1 adapter (fallback)                                                          | ✅ implemented against current docs; **not yet run with live credentials** |
| Reference motion for the 3 launch dances                                              | ⛔ `REFERENCE_MOTION_PENDING`: needs real, owned performance footage       |
| Admin (templates, reference review, Dance Lab, Trend Lab, jobs, analytics)            | ✅ token-gated                                                             |
| Postgres (prod) / PGlite (zero-config dev + tests)                                    | ✅                                                                         |

Until a provider credential **and** an approved reference video exist for a dance, requesting that dance creates a job that fails immediately and truthfully, with `REFERENCE_MOTION_NOT_READY` and/or `PROVIDER_NOT_CONFIGURED`. The photo is never sent anywhere and nothing is charged. See [`docs/EXTERNAL_REQUIREMENTS.md`](docs/EXTERNAL_REQUIREMENTS.md) for what's needed to go live.

---

## Architecture

```
Browser (Next.js client, PWA)
  │  crop + re-encode photo (EXIF stripped) ─► POST /api/uploads ─────────► private storage (sources/)
  │  POST /api/generations ──► generation service ──► router ──► provider adapter ──► Higgsfield / Viggle
  │  GET  /api/generations/:id (poll) ─► refreshJob (leased, rate-bounded) ──┘            │
  │                                                                                        ▼
  │  result signed URL ◄─────────── private storage (results/) ◄── finalize: copy output ─┘
  ▼
Postgres: templates + immutable versions · reference assets · jobs + transitions · analytics · labs
```

**Technology choices**

| Choice                                                                   | Why                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Next.js 16 (App Router) + React 19 + TypeScript**                      | One deployable for UI + API, with server components for fast first paint on mobile and server-only modules for secrets. |
| **Tailwind CSS v4**                                                      | Fast, consistent mobile UI; design tokens in `globals.css`.                                                             |
| **Postgres via `pg`, plain SQL migrations**                              | Production-grade, portable (Supabase, Neon, RDS). No ORM: the migrations are the schema.                                |
| **PGlite** (embedded Postgres/WASM)                                      | `npm run dev` and the test suite work with zero setup, on the _same_ SQL.                                               |
| **Zod**                                                                  | One schema per domain object (templates, concepts, trends, events, env).                                                |
| **Private object storage** (local disk or S3-compatible via `aws4fetch`) | No public buckets; all media access goes through short-lived signed URLs.                                               |
| **Vitest + Playwright**                                                  | Fast unit/integration tests on real SQL; e2e against a production build and real Postgres.                              |

**Key design decisions**

- **Provider abstraction + router.** The app only talks to `GenerationProvider` (`src/server/providers/types.ts`). The router (`router.ts`) turns a template's provider preferences into ordered candidates, considering capability, configuration, reference-asset constraints, audio handling, health (circuit breaker), tier, priors and measured stats.
- **Server-owned job state machine.** `QUEUED → PROCESSING → COMPLETED | FAILED | CANCELED`, with transitions applied atomically in SQL (`WHERE status = ANY(allowed)`) and audited in `generation_job_transitions`. The client adds `IDLE → VALIDATING → UPLOADING` on top (`src/client/flow.ts`). Refreshing the page, closing the tab or switching devices never loses a job.
- **No double spending.** Submission is single-flight via a DB lease. A submission whose outcome is ambiguous (network timeout after sending, or a crash mid-request) is **never** automatically resubmitted. Higgsfield has no idempotency key, so a blind retry could double-bill.
- **Bounded polling.** Many callers can "refresh" a job (client polling, cron, worker, webhook), but a lease plus `next_poll_at` backoff (2s → 10s, with jitter) means at most one provider status call per interval.
- **Results are copied** into our private storage on completion, because provider URLs expire (Higgsfield ≥ 7 days, Viggle short-lived signed URLs).

---

## Repository structure

```
content/
  templates/*.json       Dance templates (source of truth, validated, versioned on sync)
  concepts/*.json        Original Dance Lab concepts (+ reference-capture briefs)
db/migrations/*.sql      Ordered, immutable SQL migrations
docs/                    External requirements checklist, provider notes
scripts/                 CLI: migrate, seed, worker, cleanup, reference:add/approve, e2e-prepare
src/
  app/                   Next.js routes: pages (/, /d/[slug], /d/[slug]/make, /g/[id], /s/[slug], /me, /admin/*)
    api/                 Route handlers (uploads, generations, media, webhooks, cron, events, …)
  client/                Browser-only logic: API client, analytics queue, flow state machine, image crop
  components/            UI components (MotionSketch artwork, cards, make flow, job/result screens)
  domain/                Pure, shared types + Zod schemas (generation, template, analytics, labs)
  server/                Server-only code
    config.ts            Env parsing (secrets never reach the client)
    db/                  pg / PGlite adapter, migration runner, content sync + template versioning
    generation/          Job repo, generation service (request/dispatch/refresh/finalize), health
    providers/           Provider interface, Higgsfield + Viggle adapters, router, registry
    storage/             Local + S3 drivers, signed URLs
    uploads/             Image validation/metadata stripping, MP4 inspection
    security/            Device identity, CSRF/origin checks, admin sessions, crypto helpers
    reference.ts         Reference-motion registration + approval
    retention.ts         Retention enforcement + user data deletion
tests/
  unit/                  Vitest: domain, router, providers (mocked HTTP), service integration (PGlite)
  e2e/                   Playwright: production build + real Postgres
```

---

## Local development

Requirements: Node ≥ 22.12. Postgres is optional.

```bash
npm install
cp .env.example .env.local   # optional; everything has a dev default
npm run dev                  # http://localhost:3000
```

With no `DATABASE_URL`, the app uses embedded **PGlite** at `.data/pglite`, runs migrations automatically and syncs `content/` on boot. Uploads and results go to `.data/storage` (private).

To develop against real Postgres:

```bash
docker compose up -d postgres
echo 'DATABASE_URL=postgres://tm:tm@localhost:5432/trend_machine' >> .env.local
npm run db:setup             # migrate + seed
npm run dev
```

Useful scripts:

| Script                                                   | Purpose                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                        | Next.js                                                                                                    |
| `npm run lint` / `typecheck` / `format` / `format:check` | Code quality                                                                                               |
| `npm test`                                               | Unit + integration tests (Vitest, PGlite)                                                                  |
| `npm run test:e2e`                                       | Playwright against a production build (run `npm run build` first; needs Postgres, see [Testing](#testing)) |
| `npm run verify`                                         | format check + lint + typecheck + tests + build                                                            |
| `npm run db:migrate` / `db:seed` / `db:setup`            | Apply migrations / sync content / both                                                                     |
| `npm run worker`                                         | Background worker: advances unattended jobs + retention                                                    |
| `npm run cleanup`                                        | One-off retention run                                                                                      |
| `npm run reference:add` / `reference:approve`            | Register / approve reference-motion assets                                                                 |

Admin: set `ADMIN_TOKEN` (≥ 32 chars) and open `/admin`.

---

## Environment variables

All documented in [`.env.example`](.env.example). The important ones:

| Variable                                                                     | Purpose                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `APP_SECRET`                                                                 | ≥ 32 chars. Signs media URLs, device ids, webhook and admin tokens. **Required in production.** |
| `DATABASE_URL`                                                               | Postgres connection string. Required in production.                                             |
| `STORAGE_DRIVER` + `S3_*`                                                    | `local` or `s3` (private bucket).                                                               |
| `HF_API_KEY_ID` / `HF_API_KEY_SECRET`                                        | Higgsfield credentials (server-side only).                                                      |
| `VIGGLE_API_KEY`                                                             | Viggle credentials (server-side only).                                                          |
| `PUBLIC_BASE_URL`                                                            | Public HTTPS origin; enables provider webhooks. Without it, polling is used.                    |
| `TRUST_PROXY_HEADERS`                                                        | Trust `X-Forwarded-For` only behind a proxy that overwrites it.                                 |
| `GENERATION_ENABLED`, `GEN_LIMIT_*`, `MAX_ACTIVE_JOBS_*`, `DAILY_BUDGET_USD` | Cost controls.                                                                                  |
| `SOURCE_RETENTION_HOURS`, `RESULT_RETENTION_DAYS`                            | Retention.                                                                                      |
| `ADMIN_TOKEN`, `CRON_SECRET`, `TREND_INGEST_TOKEN`                           | Operations endpoints (each disabled when unset).                                                |

There are **no** `NEXT_PUBLIC_*` variables. Server modules import `server-only`, so importing one into a client component fails the build.

---

## Database & migrations

- Migrations live in `db/migrations/NNNN_name.sql` and are applied in order by `npm run db:migrate`. Each runs in a transaction and is recorded with its checksum in `schema_migrations`. Editing an applied migration aborts: add a new one instead.
- A fresh developer or environment only needs `npm run db:setup`. In development (and with PGlite) migrations run automatically on boot. In production they run **only** via `npm run db:migrate`, as a deploy step.

Main tables:

| Table                                                                    | Holds                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `templates` / `template_versions`                                        | Mutable head + immutable, numbered spec snapshots (with spec hash and the pinned reference asset) |
| `reference_motion_assets`                                                | Reference videos + provenance, rights, suitability review                                         |
| `dance_concepts`                                                         | Original Dance Lab concepts and lifecycle                                                         |
| `trend_candidates`, `trend_evidence`, `trend_mechanics`, `countertrends` | Trend Lab + countertrend foundation                                                               |
| `uploads`                                                                | Private source photos (with expiry)                                                               |
| `generation_jobs`, `generation_job_transitions`                          | Jobs (pinned template version, provider, routing attempts, cost, provenance) + audit trail        |
| `shares`                                                                 | Revocable result-only share links                                                                 |
| `analytics_events`                                                       | Append-only pseudonymous events                                                                   |
| `rate_limit_buckets`, `admin_audit_log`, `data_deletions`                | Operations                                                                                        |

Views (`0002_learning_views.sql`): `template_funnel`, `provider_reliability`, `generation_errors`, `characteristic_performance`.

---

## Storage

| Prefix       | Content                                  | Access                                                                           | Retention                      |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| `sources/`   | Cropped, metadata-stripped source photos | **Never** served to browsers. Read server-side only, to pass to the provider.    | `SOURCE_RETENTION_HOURS` (24h) |
| `results/`   | Generated videos                         | Short-lived (1h) signed URLs for the owner; share pages sign fresh URLs per view | `RESULT_RETENTION_DAYS` (30d)  |
| `reference/` | Reference-motion videos                  | Admin-only, 15-minute signed URLs                                                | Until retired                  |

- **local** driver: files under `LOCAL_STORAGE_DIR` with `0600` permissions, served only by `/api/media/*` after verifying an expiring HMAC signature. HTTP Range is supported (required for iOS video). Keys are generated server-side and validated against a strict pattern, so path traversal is impossible.
- **s3** driver: any S3-compatible _private_ bucket; presigned GET URLs. Configure the bucket with **no public access** (and optionally a lifecycle rule on `sources/` as a backstop).

**How providers get the photo.** For Higgsfield we upload through Higgsfield's own presigned-upload endpoint (`/files/generate-upload-url`, tagged `retention=temporary` by Higgsfield) and pass the resulting URL. For Viggle we send a multipart upload directly. Our own buckets never become public, and the app doesn't need to be publicly reachable to generate.

---

## Generation providers

### Interface

```ts
interface GenerationProvider {
  id: string;
  label: string;
  isConfigured(): Promise<boolean>;
  getCapabilities(): ProviderCapabilities; // capabilities, models (+ priors, pricing), constraints, cancel/webhook/audio support
  createJob(req: GenerationRequest): Promise<ProviderSubmission>; // providerJobId, state, cost estimate
  getJob(providerJobId: string): Promise<ProviderJobStatus>; // normalized state/progress/outputUrl/error
  cancelJob?(providerJobId: string): Promise<void>;
  webhookJobId?(body: unknown): string | null; // untrusted hint only
}
```

Errors are normalized to `ProviderError { code, retryable, accepted: "NO" | "UNKNOWN", providerUnavailable }`. `accepted: "UNKNOWN"` means "may have been billed", and it is never retried.

### Implemented

**Higgsfield: Kling Motion Control (primary).** Verified against https://docs.higgsfield.ai in Sept 2026:
`POST /kling-video/v3/motion-control/{std|pro}` (Kling 3.0) and `/kling-video/motion-control/{std|pro}` (Kling 2.6), with `{ image_url, video_url, prompt, keep_original_sound: "no", character_orientation }`. Status comes from `GET /requests/{id}/status`, cost from `POST /estimate/{model}`, cancellation from `POST /requests/{id}/cancel`, and optional `hf_webhook` callbacks. Auth is `Authorization: Key {id}:{secret}`. Reference video must be 3–30s, and the image ≤ 10 MB with each side ≥ 300px.

**Viggle V1: Mix (fallback).** Verified against https://docs.viggle.ai in Sept 2026:
`POST /v1/renders` (multipart: `image`, `motion_video`, `background_mode=original`), then `GET /v1/videos/{id}` with statuses `queued|processing|ready|failed|cancelled`. Priced at $0.01 per output second (documented). Viggle has no documented way to drop the reference video's audio, so **the router only uses Viggle with silent reference videos.**

Why Higgsfield/Kling first: the brief named it, its current API explicitly supports image + reference-video motion control with Standard/Pro tiers and a cost-estimate endpoint, and it lets us drop reference audio. Viggle is a strong, cheaper second option for character motion transfer.

### Webhooks

When `PUBLIC_BASE_URL` is HTTPS, Higgsfield submissions include `hf_webhook=/api/webhooks/higgsfield/{jobId}?t={HMAC(jobId)}`. Higgsfield webhook bodies are not signed, so the body is treated only as a hint: we re-fetch the authoritative status via the authenticated API. Polling remains the recovery path.

### Adding a provider

1. Implement `GenerationProvider` in `src/server/providers/<name>.ts`. Map vendor statuses to `QUEUED|PROCESSING|COMPLETED|FAILED|CANCELED`, and vendor errors to `ProviderError` (be honest about `accepted`).
2. Declare capabilities, models (with priors and pricing), constraints, and whether it can drop reference audio.
3. Register it in `src/server/providers/registry.ts` with its config from `src/server/config.ts` (secrets server-side).
4. Add it to templates' `providerPreferences` (and optionally `fallbackProviderId`).
5. Add mocked-HTTP tests like `tests/unit/providers.test.ts`.

No consumer UI change is needed.

---

## Templates, versions & adding a dance

A template is pure data (`content/templates/<slug>.json`, schema in `src/domain/template.ts`). It includes: identity/status/category/origin, copy (tagline, hook, description), duration, 9:16, energy, difficulty, tags, artwork, media keys, a **movement spec** (first second, signature, timed sequence, loop point, body focus, designed characteristic scores, camera guidance, transfer considerations), a **generation recipe** (capability, scene prompt, character orientation, audio policy, timeout), provider preferences and fallback, provider-specific config, provenance and rights.

**Versioning.** `npm run db:seed` validates every file and computes a hash of the spec plus the attached reference asset. When the hash changes, it writes a new immutable `template_versions` row (v1, v2, …) and moves the head. Every generation job stores `template_version_id`, so you always know exactly which spec and which reference footage produced a video.

**To add a dance:**

1. Copy an existing JSON file to `content/templates/<new-slug>.json` (the file name must equal the slug) and edit it. Use `"status": "PREVIEW"` until it can render.
2. Optionally add a Dance Lab concept in `content/concepts/`.
3. `npm run db:seed` (or restart dev). The dance appears on Home, with no frontend changes.
4. Record and register its reference motion (below). Once approved, and with a provider configured, it renders.

The launch dances (**Glitch Walk**, **Zero Gravity Shuffle**, **Rubber Legs**) are original concepts. Their card artwork is a code-drawn _motion sketch_, clearly labelled as such. It is not footage and not a generated result.

---

## Reference motion & provenance

Reference motion is a first-class asset (`reference_motion_assets`). Each one records: template, creator, owner, creation method, license/permission and **permission evidence**, capture date, duration, resolution, aspect, FPS, audio presence, a SHA-256 hash, suitability review (who, when, which checks) and notes.

```bash
# 1. Register an OWNED MP4 (3–30s, portrait 9:16 recommended). Starts as UPLOADED.
npm run reference:add -- --file glitch-walk.mp4 --template tpl_glitch_walk \
  --creator "Performer Name" --owner "TREND MACHINE" --method STUDIO_CAPTURE \
  --license "Work-for-hire; all rights assigned to TREND MACHINE" \
  --evidence "Signed performer release #2026-014" --captured 2026-10-02

# 2. Review the footage (admin → Reference motion shows it), then approve, affirming every check:
npm run reference:approve -- --id <asset-id> --reviewer "Your Name" --confirm-all
```

Approval requires affirming every suitability check: single performer, full body visible, continuous single take, limited occlusion, stable locked-off camera, moderate speed, no unlicensed audio. Approval creates a **new template version** pinned to the asset and moves the Dance Lab concept to `REFERENCE_READY`. Rejecting or retiring an asset makes the template non-generatable again immediately.

Rules: never copy viral choreography footage into the product, and never bundle commercial music. Audio is separate from movement: templates cannot keep reference audio (`keepReferenceAudio: false` is enforced by the schema). Higgsfield is called with `keep_original_sound: "no"`, and providers that can't drop audio are excluded for references that contain audio.

---

## Original Dance Lab, Trend Lab & countertrends

- **Dance Lab** (`dance_concepts`, `content/concepts/`): concept, hook, first-second movement, sequence, signature, loop point, duration, energy, difficulty, camera guidance, motion-transfer considerations, generation guidance, a **reference-capture brief** (performer brief, wardrobe, framing, tempo), provenance and status. Lifecycle: `IDEA → DESIGNED → REFERENCE_PENDING → REFERENCE_READY → TESTING → LIVE → RETIRED`, with transitions enforced.
- **Trend Lab** (`trend_candidates`, `trend_evidence`): the external scanner posts observed facts to `POST /api/admin/trends/ingest` (Bearer `TREND_INGEST_TOKEN`; idempotent by `externalRef`). Evidence may carry metrics the scanner _actually observed_, with a timestamp. TREND MACHINE computes none. Humans review in `/admin/trends`: status (`CANDIDATE → REVIEWING → APPROVED/REJECTED → TEMPLATE_CREATED`), loopability, motion-transfer and single-photo suitability, reproduction difficulty, notes.
- **Countertrends** (`trend_mechanics`, `countertrends`): record _why_ a trend works (per characteristic: score, rationale, human/model assessor), then link it to an original concept that exploits those mechanics, with an explicit **differentiation** statement explaining how it avoids copying the choreography. No automated trend analysis exists yet; the schema is the foundation for it.

---

## Analytics & the learning loop

Events (`src/domain/analytics.ts`):

- **Client:** `app_open`, `template_impression`, `template_view`, `template_selected`, `upload_started`, `upload_completed`, `regenerate`, `result_play`, `download`, `share`.
- **Server (authoritative, clients can't send these):** `generation_requested`, `generation_queued`, `generation_processing`, `generation_completed`, `generation_failed`, `share_link_opened`.

Dimensions: template, template version, provider, provider model, latency, cost (with source), error code, device class, timestamp, plus a small whitelist of props. Client events use a closed schema. There is no free text, no URLs and no PII, and ingestion is rate limited.

The admin overview computes impression→view, view→generation, success, regeneration, download and share rates, plus latency, cost and provider reliability. **Every rate is shown with its sample size and flagged "low n" when small.** Designed movement characteristics (choreographer intent, 0–5) are joined to observed behaviour in `characteristic_performance`, so the relationship can be studied once there is data. No conclusions are generated automatically.

---

## Privacy, retention & deletion

What is uploaded, why, for how long, and who receives it:

| Data                                                                                  | Why                                                     | Retention                                                                             | Recipients                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Source photo (cropped client-side, EXIF/XMP/GPS stripped on device **and** on server) | To render the video; kept for 24h so "Regenerate" works | Deleted automatically after `SOURCE_RETENTION_HOURS` (24h), or immediately on request | Our private storage; the selected provider (Higgsfield: temporary upload; Viggle: multipart upload), under their terms |
| Generated video                                                                       | To show, download and share                             | Deleted after `RESULT_RETENTION_DAYS` (30d), or on request; share links die with it   | Our private storage; anyone the user shares a link with                                                                |
| Anonymous device cookie (`tm_did`, httpOnly)                                          | To show "My videos" without an account                  | 1 year                                                                                | — (only HMAC-derived hashes are stored)                                                                                |
| Pseudonymous analytics                                                                | Product measurement                                     | Kept                                                                                  | —                                                                                                                      |
| Daily-rotating IP hash                                                                | Abuse / cost limits                                     | Rotates daily                                                                         | —                                                                                                                      |

**Deletion:** "My videos → Delete my data" (`DELETE /api/me`) deletes every photo, video and share link for the device immediately and logs the request in `data_deletions`. Single videos can be deleted via `DELETE /api/generations/:id`. Retention runs from `/api/cron/tick` or `npm run worker`/`cleanup`. Provider-side copies follow the provider's own retention (Higgsfield documents outputs retained ≥ 7 days and inputs as temporary).

The in-app policy is at `/privacy`.

---

## AI media transparency

- Every result is labelled **AI-generated** on the result screen and the share page, and the download filename ends in `-ai.mp4`.
- Each job stores a provenance record: generator, template id and version, provider, model, completion time, and the reference asset through the pinned version.
- **Not implemented, and not claimed:** visible watermarking and embedded C2PA/Content Credentials. The job's `provenance` field records `watermark: "none"` and `contentCredentials: "not_implemented"`. The post-processing point for adding these is `finalizeJob` in `src/server/generation/service.ts`.

---

## Security

Implemented protections (see also `tests/unit/*` and `tests/e2e/security.spec.ts`):

- **Secrets** are server-only (`server-only` imports, no `NEXT_PUBLIC_*`). Env parse errors report variable names, never values. Credentials are never sent to presigned storage URLs.
- **No public source images.** Private storage, source photos are never served, and results use 1h signed URLs.
- **Uploads:** raw-body size cap enforced while streaming, magic-byte type detection (MIME spoofing rejected), header-only dimension parsing (no decode bombs), limits on size, pixels and aspect, animated images rejected, metadata stripped.
- **Job enumeration:** random UUIDs, and every read is scoped to the device owner hash. Unknown, malformed and not-yours all return the same 404. Share links are separate 96-bit random slugs that expose only the result.
- **CSRF:** state-changing endpoints require same-origin `Origin`/`Sec-Fetch-Site`, plus `SameSite` cookies. Admin uses server actions (origin-checked) and a `SameSite=Strict` session.
- **Admin:** fully disabled without `ADMIN_TOKEN`. Signed 12h session bound to the token (rotating the token revokes sessions), rate-limited login, audit log, and a guard on every admin page (layouts don't protect pages in Next.js).
- **Machine endpoints** (`/api/cron/tick`, trend ingest) need bearer tokens compared in constant time, and return 404 when unset.
- **Webhooks** need a per-job HMAC capability token, and the body is untrusted (status is re-fetched).
- **SSRF:** provider output downloads must be HTTPS to non-IP, non-internal hosts, size-capped, and verified as MP4 before storing. Provider model ids are allow-listed, which blocks path injection.
- **Headers:** CSP (production), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP; `X-Powered-By` removed.
- **Logging:** URLs in logged and stored provider errors are redacted to origin + path.
- **Injection/XSS:** parameterized SQL only, React escaping, no `dangerouslySetInnerHTML`.
- **Dependencies:** `npm audit`: 0 known vulnerabilities at the time of writing.

---

## Cost controls

- **Kill switch:** `GENERATION_ENABLED=false`.
- **Limits** (checked atomically with job creation under a Postgres advisory lock): per device per hour and per day, per IP per day (only when the IP is known), global per day, concurrent per device and global (keep ≤ your provider concurrency), and an optional `DAILY_BUDGET_USD` over recorded cost estimates. Blocked requests (not ready) don't consume limits; refused requests are recorded in analytics.
- **Deduplication:** per-device idempotency keys, so double taps and retries return the same job.
- **No retry loops:** at most 2 submission attempts, and only when the provider definitely did not accept. Ambiguous submissions are never retried. Content rejections aren't shopped around to other providers. A provider that errors isn't retried on its other models.
- **Controlled polling** (lease + backoff), a **hard deadline** per template (`timeoutSeconds` + 3 min) with a best-effort provider cancel, and bounded result-copy retries.
- **Cost recording** per job: Higgsfield `estimate` (USD) or Viggle's documented price × duration, labelled by source (`PROVIDER_ESTIMATE`/`PRICE_TABLE`).

---

## Testing

```bash
npm test          # 72 unit + integration tests (~6s) on in-memory Postgres (PGlite)
npm run build
npm run test:e2e  # 10 Playwright tests: production build + real Postgres
```

Coverage focuses on the dangerous paths: template validation and versioning, router decisions, provider-not-configured and reference-not-ready behaviour, job state machines (server + client), upload validation and metadata stripping, MP4 inspection, provider HTTP contracts and error normalization, single-flight dispatch, no-resubmit on ambiguous submissions, fallback, timeouts, bounded polling, result verification, limits and concurrency, retention and deletion.

E2E needs a Postgres database whose name contains `e2e` (the prepare script refuses anything else, because it drops the schema). The default is `postgres://tm:tm@127.0.0.1:5432/trend_machine_e2e`; override it with `E2E_DATABASE_URL`. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a system Chromium.

The **successful** generation path is covered by integration tests using a scripted test-only provider and mocked HTTP against the real adapters. It has **not** yet been exercised against live Higgsfield or Viggle.

---

## Deployment

Any Node host works (Vercel, Fly.io, Render, a VM).

1. Provision Postgres and a **private** S3-compatible bucket.
2. Set the env vars (`APP_SECRET`, `DATABASE_URL`, `STORAGE_DRIVER=s3` + `S3_*`, provider keys, `PUBLIC_BASE_URL`, `TRUST_PROXY_HEADERS=true` behind your proxy, `ADMIN_TOKEN`, `CRON_SECRET`, limits).
3. Run `npm run db:migrate && npm run db:seed` as a release step.
4. `npm run build && npm start`.
5. Schedule `GET /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET` (e.g. Vercel Cron), **or** run `npm run worker` as a long-lived process. This advances jobs nobody is watching and enforces retention.

With `STORAGE_DRIVER=s3`, add a bucket **CORS** rule allowing `GET` from your app origin so native file-sharing can fetch the video. Without it, sharing falls back to a link.

Notes: the `local` storage driver is for single-instance deployments only. On serverless platforms, dispatch runs in `after()` (post-response), and the status endpoint and cron recover anything interrupted.

---

## Known limitations

- **No real generation yet:** no provider credentials and no owned reference footage exist in this environment. Both adapters are built to current docs but are unverified live.
- **No preview videos:** cards use labelled motion sketches until real footage exists.
- **Photo suitability** checks are cheap heuristics (resolution, brightness, contrast). They can't tell whether a full body is visible. Pose-based checks are a future pluggable step.
- **Anonymous device identity** means "My videos" is per browser. There are no accounts.
- **Admin auth** is a single shared token. Replace it with SSO or per-user accounts before a larger team uses it.
- **No watermark / C2PA** (see transparency).
- **Viggle** is only routed for silent reference videos, and its cancel isn't supported.
- **Local storage** doesn't scale horizontally; use S3 in production.
- **Trend Lab** has no scanner in this repo, only the ingest API. There is no automated mechanics analysis yet.
- The browser test environment (Playwright Chromium) can't decode H.264, so video _playback_ itself isn't asserted in e2e.
