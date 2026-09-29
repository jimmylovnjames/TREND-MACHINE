# External requirements to go live

Everything below needs a person: an account, a payment decision or real-world footage. The code is ready for each item. None of it can be created from inside the repository.

## 1. `HF_API_KEY_ID` + `HF_API_KEY_SECRET` (Higgsfield)

- **Purpose:** server-side authentication for Kling Motion Control on Higgsfield (primary generation provider).
- **Where to get it:** https://console.higgsfield.ai → API keys (a key ID and a secret). Fund the account with credits.
- **Verify model access:** in the console, confirm your account can use `kling-video/v3/motion-control/std` and `/pro`. Some models are access-restricted and return 404, 423 or 503.
- **Where to configure:** server environment only (hosting provider secrets, or `.env.local` for local dev).
- **Never place in:** any `NEXT_PUBLIC_*` variable, client code, the repository, logs or screenshots.
- **Also set:** `MAX_ACTIVE_JOBS_GLOBAL` ≤ the concurrency limit shown for your account.

## 2. `VIGGLE_API_KEY` (optional fallback)

- **Purpose:** server-side authentication for Viggle V1 renders (fallback provider).
- **Where to get it:** https://portal.viggle.ai → API keys.
- **Where to configure / never place in:** same rules as above.
- **Note:** Viggle is only used when the reference video has **no audio track**, because it can't drop reference audio.

## 3. Reference-motion videos: one per dance

These are owned performance recordings that drive the motion. Without them every dance stays `REFERENCE_MOTION_PENDING`. **Do not** use footage scraped from social platforms or any recording you don't own or have written permission for.

| Asset                                  | Template id                | Length               | Brief                                                                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLITCH_WALK_REFERENCE_VIDEO`          | `tpl_glitch_walk`          | ~7s (3–30s accepted) | Walk toward a locked-off camera over ~1.5m. Hard mid-stride freezes (dead still), torso "frame-drop" jerks, a 0.6s Buffer pose (lifted foot, 30° head tilt, mismatched arms), 3 double-speed backwards steps, head → shoulders → hips recalibration, end in the opening freeze. |
| `ZERO_GRAVITY_SHUFFLE_REFERENCE_VIDEO` | `tpl_zero_gravity_shuffle` | ~8s                  | Smooth floor, contrasting shoes, ankles visible. Lateral heel-toe glides with floating arms, a 0.8s one-leg off-axis float, an exaggerated upright gravity drop and bounce, a backward glide, end in the start stance.                                                          |
| `RUBBER_LEGS_REFERENCE_VIDEO`          | `tpl_rubber_legs`          | ~6s                  | Hands in pockets, deadpan face. Sudden inward knee buckles (~20cm drop, knees above 90°), sideways rebound, two-step noodle walk, collar adjust while legs wobble, double buckle, snap to attention.                                                                            |

The full briefs, with sequence timings, wardrobe and framing, are in `content/concepts/*.json` and on `/admin/references`.

**Technical requirements (all three):**

- MP4 (H.264), **3–30 seconds**, ideally **1080×1920 (9:16 portrait)**, 24–60 fps, ≤ 100 MB.
- One performer, **head to feet visible for the whole take**, limbs unobstructed, no other people.
- Single continuous take: no cuts, locked-off camera (tripod), no zoom or pan.
- Even lighting, plain background, fitted clothing; avoid very fast motion.
- **No audio track**, or only audio you own. Audio is never used in outputs, but Viggle can only be used for silent references.

**Rights paperwork for each asset:** a signed performer release (or work-for-hire agreement) granting TREND MACHINE the right to use the performance as a motion reference for AI-generated videos, commercially, worldwide. Record it with `--evidence "<release id/location>"`.

**Registering:** see README → _Reference motion & provenance_ (`npm run reference:add`, then review, then `npm run reference:approve`).

## 4. Production infrastructure decisions

| Item                                                                 | Needed for                  | Notes                                                                            |
| -------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Postgres (e.g. Supabase, Neon) → `DATABASE_URL`                      | production data             | Run `npm run db:migrate && npm run db:seed` on deploy                            |
| Private S3-compatible bucket (e.g. Cloudflare R2, S3) → `S3_*`       | media storage               | **Block all public access**; optionally add a 2-day lifecycle rule on `sources/` |
| Public HTTPS domain → `PUBLIC_BASE_URL`                              | webhooks, share links       | Without it, polling is used (works, just slower to notice completion)            |
| Scheduler hitting `/api/cron/tick` every minute, or `npm run worker` | unattended jobs + retention | `Authorization: Bearer $CRON_SECRET`                                             |
| `APP_SECRET`, `ADMIN_TOKEN`, `CRON_SECRET`, `TREND_INGEST_TOKEN`     | security                    | Generate with `openssl rand -base64 48`                                          |
| Spend limits: `GEN_LIMIT_*`, `DAILY_BUDGET_USD`                      | cost control                | A business decision: what daily spend is acceptable at launch?                   |

## 5. Before public launch (recommended)

- Legal review of `/privacy` and the rights-confirmation copy for your jurisdictions (e.g. GDPR/CCPA, likeness rights).
- Review each provider's terms on processing user photos and on commercial use of outputs.
- Decide on visible watermarking / C2PA Content Credentials (not implemented, see README).
