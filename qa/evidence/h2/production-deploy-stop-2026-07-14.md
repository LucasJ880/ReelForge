# H2 production deployment stop audit

Date: 2026-07-14 (America/Toronto)

## Release candidate

- Branch: `codex/h2-ui-unification`
- Sanitized release head before this evidence-only commit: `242d90f`
- Vercel Preview: `dpl_9UY2b1A8rGbAHdjXf2iPgVERSdmN` — Ready
- Preview health through authenticated Vercel access: `ok=false`, database failed, video provider not configured, environment validation failed with four missing entries. This Preview proves the optimized build completed; it is not suitable for internal generation testing.

## Current production rollback point

- Deployment: `dpl_Bd4JLiVg3ajqVSSQh5hAkPm4nXGj`
- Production alias remains on that deployment.
- Filtered health evidence: HTTP success, `ok=true`, region `na`, database connected, provider `byteplus`, provider status `mock`, environment validation true.
- No alias, deployment, environment, database, or provider mutation was made during this audit.

## Matched stop conditions

1. Production migration status reports these four migrations pending:
   - `20260713_phase2_ack_unknown_backfill`
   - `20260713_phase2_provider_submission_integrity`
   - `20260714_final_video_stitch_attempt_token`
   - `20260714_phase2_batch_quota_guard`
2. The first pending RF-003 migration depends on objects created by the second. Ordinary `prisma migrate deploy` would therefore fail in the known RF-019 order.
3. The locally supplied `NEON_PRODUCTION_OWNER_DATABASE_URL` resolves to a `-pooler` host. It cannot satisfy the checklist's direct-owner, single-transaction bootstrap requirement.
4. Vercel Production still has `VIDEO_ENGINE_MOCK=true`. The code defaults to BytePlus, but the new canonical `BYTEPLUS_ARK_API_KEY` variable is absent; only the legacy key name exists. The configured ARK base URL is the approved BytePlus international endpoint.
5. The current project setting reports Node 24.x while `package.json` requires Node 22.x.
6. The existing `shuyu_api_key` entry is not a configured provider in the current enum and was not read, copied, or exercised.

## Required next production action

Create a fresh Neon branch from the exact production head, provide a direct unpooled owner connection, complete checklist sections 2–6 on that branch, create a verified production restore point, then repeat the observed-state bootstrap in production. Only after schema acceptance and zero eligible provider rows may the exact release SHA be deployed/promoted. The first post-deploy action remains a no-provider observation window.
