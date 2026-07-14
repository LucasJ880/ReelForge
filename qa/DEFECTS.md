# ReelForge Ship Defect Ledger

- Audit revision: `337f7796ef90560904b341e620b44028af3f3f74`
- Last updated: 2026-07-13 (America/Toronto)
- Current phase: Phase 2 backend hardening
- Counts: **P0 OPEN 6 · P0 FIXED 1 · P0 VERIFIED 3 · P1 OPEN 5 · P1 VERIFIED 2 · P2 OPEN 0 · P3 OPEN 0**

## Status rules

`OPEN` reproduced or proven by current code/runtime evidence · `FIXED` product change made but full regression pending · `VERIFIED` reproduction + relevant suite + golden path are green · `CANNOT_REPRO` hypothesis not observed with stated evidence · `ESCALATED` three failed repair attempts recorded.

## Open defects

### RF-001 — Production reports mock video runtime

- Severity: **P0 — delivery blocker**
- Status: **OPEN**
- Seed: none; production invariant
- Reproduction: `GET https://reelforge-delta.vercel.app/api/health` on 2026-07-13 returned `videoProvider: "byteplus"` and `videoProviderStatus: "mock"`.
- Evidence: `qa/evidence/production-health-2026-07-13.json`
- Impact: a production customer can enter a path that produces rehearsal output rather than paid provider output. This violates the ship-loop rule that mock is available only under an explicit test/rehearsal deployment.
- Required regression: production configuration test must reject mock mode; preview/rehearsal must remain explicitly allowed.
- Repair attempts: **1/3 rolled back**. Attempt 1 added health/runtime guards and passed 31 focused tests, but the mandatory golden-path run ended with one provider job FAILED. Per the golden-path invariant the entire product/test change was immediately rolled back before any other defect work. Evidence: `qa/evidence/phase1/golden-path-gp-1784001035053-52c5af59.json`. The subsequent baseline run exposed separate rehearsal rate-limit pollution (RF-017), so attempt 2 must rerun against the now-isolated fixture before assigning causality.
- Repair commit: —

### RF-002 — Cron and external-runner endpoints fail open when `CRON_SECRET` is absent

- Severity: **P0 — security/data-integrity blocker**
- Status: **OPEN**
- Reproduction: remove `CRON_SECRET` in an isolated test environment and call any machine endpoint without authorization; the guard body is skipped.
- Root cause: conditional authentication in `src/app/api/cron/process-batches/route.ts:7`, `poll-videos/route.ts:14`, `stitch-videos/route.ts:21`, `sweep-stuck-tasks/route.ts:13`, `src/app/api/internal/stitch/claim/route.ts:18`, `complete/route.ts:27`, and the two sealed digital-human runner routes.
- Impact: one missing deployment secret turns queue mutation and runner completion endpoints public.
- Required regression: every machine endpoint returns a sanitized non-2xx response when the secret is missing and 401 when it is wrong; no queue service is invoked.
- Repair commit: —

### RF-003 — Ambiguous provider failures can resubmit and duplicate billable work

- Severity: **P0 — billing/data-integrity blocker**
- Status: **OPEN**
- Reproduction A: make provider submission accept the job, then make the client receive a timeout. `submitClaimedJob` catches every exception and returns the same row to `QUEUED` for up to three submissions.
- Reproduction B: on manual retry, make `fetchVideoJobStatus` throw a temporary transport error. The catch at `src/lib/services/video-service.ts:777` falls through to a new paid submission.
- Root cause: `src/lib/services/batch-service.ts:497-605` does not distinguish definitely-unbilled from ambiguous acknowledgement and does not pass/provider-persist an idempotency key; `src/lib/services/video-service.ts:731-827` treats status lookup failure as “provider failed/not found.”
- Impact: duplicate videos and duplicate provider charges during ordinary network faults.
- Required regression: concurrent/timeout contract tests proving ambiguous failures go to manual reconciliation and never invoke `createVideoJob` twice; provider idempotency behavior must be explicit.
- Repair commit: —

### RF-004 — Stale stitch callback can overwrite a newer FinalVideo attempt

- Severity: **P0 — final asset integrity blocker**
- Status: **OPEN**
- Reproduction: runner A claims `PENDING → STITCHING`; sweeper times it out to `PENDING`; runner B claims and completes; runner A then posts a late failure/success. The late callback updates by `id` and overwrites the current result.
- Root cause: `finishStitchTask` reads by id and uses unconditional `db.finalVideo.update` at `src/lib/services/stitch-service.ts:393-427`; completion payload has no attempt/claim token and no `status=STITCHING` CAS.
- Impact: a valid customer final video can revert to FAILED or be replaced with an older asset.
- Required regression: two-attempt race test in which stale callbacks are rejected and only the active claim can finalize.
- Repair commit: —

### RF-005 — Queue schedules declare 5 minutes but run roughly 55–107 minutes apart

- Severity: **P0 — unattended batch completion blocker**
- Status: **OPEN**
- Reproduction: compare `.github/workflows/{process-batches,poll-videos,stitch-videos}.yml` (`*/5`) with GitHub Actions start timestamps on 2026-07-13/14. `vercel.json` has no crons.
- Evidence: `qa/evidence/github-scheduler-observation.md`
- Impact: jobs can remain queued/running/stitching far beyond customer expectations after the user leaves the monitoring page; watchdog convergence is equally delayed.
- Required regression: deploy a scheduler with measured maximum delay, capture at least one 30-minute cadence trace, and prove queue/poller/stitch/sweep each execute within the agreed SLO.
- Repair commit: —

### RF-006 — Existing final-acceptance Playwright run exits nonzero in global teardown

- Severity: **P0 — release evidence blocker**
- Status: **FIXED — full final-acceptance suite verification remains**
- Reproduction: run the final-acceptance configuration with its global teardown. Importing constants from `tests/final-acceptance/framework.ts` registers `test.beforeEach` outside a test module and Playwright aborts.
- Root cause: `tests/final-acceptance/global-teardown.ts:6-9` imports `./framework`; that module calls `test.beforeEach` at `framework.ts:294`.
- Evidence: `qa/evidence/final-acceptance-teardown-error.txt`
- Impact: the existing end-to-end acceptance suite cannot supply a green release record even if its test body passes.
- Required regression: final-acceptance config completes test and teardown with exit 0; teardown constants live in a side-effect-free module.
- Repair: moved teardown constants into side-effect-free `tests/final-acceptance/fixture-data.ts`; added `tests/final-acceptance-global-teardown-import.test.ts`.
- Verification: direct teardown import regression, full unit suite, typecheck, lint, and the independent golden-path suite pass. The full existing final-acceptance configuration has not been rerun in Phase 1, so this item is not yet marked VERIFIED.
- Repair commit: `e863c8e`

### RF-007 — Stuck-task sweeper bypasses the historical dispatch quarantine decision

- Severity: **P0 — protected historical task integrity blocker**
- Status: **OPEN**
- Reproduction: create/retain a pre-cutoff `QUEUED` VideoJob with `dispatchQuarantineDecision=null` and an expired/missing timeout, then run `sweepStuckTasks`; it is moved to `FAILED` without a human `RELEASED`/`EXPIRED` decision.
- Root cause: `src/lib/services/sweep-service.ts:90-117` selects all old `QUEUED/RUNNING` jobs and performs a status CAS but does not filter `createdAt`, `dispatchQuarantineDecision`, or call `isHistoricalDispatchQuarantined`. The dedicated guard in `historical-dispatch-quarantine.ts:34-54` protects provider calls only.
- Impact: contradicts the approved GATE 0 rule that historical tasks may only be explicitly released or marked expired through the human CAS operation.
- Required regression: in real-provider mode, sweep leaves pre-cutoff undecided jobs untouched; explicit EXPIRED/RELEASED paths retain CAS semantics.
- Repair commit: —

### RF-008 — Staff role can be locked out by a legacy customer persona

- Severity: **P1 — operator-visible**
- Status: **OPEN**
- Reproduction: use the known seeded account whose role is `SUPER_ADMIN` and `userType` is `BUSINESS`; visit `/internal`.
- Root cause: `normalizeUserType` preserves BUSINESS/PERSONAL before staff role fallback (`src/lib/auth.ts:100-108`), and `requireInternalPage` redirects those personas before `requireOperator` (`src/lib/api-auth.ts:221-236`).
- Impact: a valid admin credential can be redirected away from internal operations.
- Required regression: role/persona matrix test for pages and APIs, including legacy combinations; customer roles must still never acquire staff access.
- Repair commit: —

### RF-009 — Login success flashes a blank white viewport

- Severity: **P1 — customer-visible onboarding defect**
- Status: **OPEN**
- Seed: S-02
- Reproduction: sign in from the supplied recording and inspect the login-to-workspace transition; one full white frame is visible for roughly 0.5 seconds with no progress feedback.
- Evidence: `qa/screenshots/baseline/recording/login-transition.jpg`
- Impact: first-run users perceive a crash or broken redirect.
- Required regression: golden-path navigation asserts a persistent branded/loading surface and no white full-viewport frame between submit and `/app/create`.
- Repair commit: —

### RF-010 — Current theme topology conflicts with the new Light-first instruction

- Severity: **P1 — customer-visible, human decision required**
- Status: **VERIFIED — human decision, 2026-07-13**
- Seed: S-03
- Reproduction: compare `/app/create` (dark Studio) with `/internal/orders`, auth, and public pages (light Editorial).
- Evidence: `qa/screenshots/baseline/routes/app-create.png`, `internal-orders.png`, `login.png`
- Impact: the current ship instruction calls this an incomplete Light-first migration, while the earlier approved design constitution explicitly requires dark `/app` plus light public/auth. Either implementation choice would violate one active instruction.
- Human decision: preserve the current color topology — dark Studio `/app`, light public/auth and existing light operational surfaces. Phase 4 may unify tokens/components within those surfaces but must not perform an all-site recolor.
- Verification: current screenshots match the accepted topology; no product change required.
- Repair commit: —

### RF-011 — Template filters and round actions overflow; template cards have unstable geometry

- Severity: **P1 — customer/operator-visible**
- Status: **OPEN**
- Seed: S-04
- Reproduction: cold-load at 1440×1000. `/app/templates` filter buttons extend to x=1942 inside a clipped row; `/internal/rounds/[id]` has an action ending at x=1498. Cards without a sample preview collapse vertically relative to preview cards.
- Evidence: `qa/evidence/phase0-route-scan.json`, `qa/screenshots/baseline/routes/app-templates.png`, `internal-rounds-id.png`
- Impact: controls are unreachable/clipped and template browsing looks structurally inconsistent.
- Required regression: overflow detector at 1280/1440/1920; template cards preserve a consistent information grid with or without sample media.
- Repair commit: —

### RF-012 — Customer pages collapse server failures into empty/not-found states

- Severity: **P1 — customer-visible correctness defect**
- Status: **OPEN**
- Seed: S-05
- Reproduction: force the data loader on create, batch list/detail, racing, library, or templates to reject. The page catches the exception and returns `[]`/`null`; there are no route-level `loading.tsx` or `error.tsx` files.
- Root cause: silent catches in `src/app/(platform)/app/create/page.tsx:24`, `batches/page.tsx:23`, `batches/[id]/page.tsx:18`, `racing/page.tsx:20`, `library/page.tsx:26`, `templates/page.tsx:16`; only `src/app/error.tsx` exists.
- Impact: outages masquerade as “no data” or 404 and offer no retry/recovery path.
- Required regression: each customer route is exercised under slow, empty, and 500 responses with distinct, accessible states.
- Repair commit: —

### RF-013 — Chinese locale surfaces contain untranslated English operational copy

- Severity: **P1 — customer/operator-visible**
- Status: **OPEN**
- Seed: S-06
- Reproduction: set locale to Chinese and open creation, templates, auth, and internal navigation.
- Evidence/root cause: hard-coded `QUALITY-LOCKED`, `QUALITY LOCK`, `PRODUCTION BRIEF`, `JOB ID`, `Content reports`, `Legacy`, and `Internal Ops` in the sources listed by the Phase 0 scan.
- Impact: same-screen language mixing reduces comprehension and undermines production polish.
- Required regression: locale audit asserting customer-visible copy resolves through the i18n layer; IDs/provider names remain exempt technical tokens.
- Repair commit: —

### RF-014 — Completed customer video had no download action

- Severity: **P1 — customer-visible delivery gap**
- Status: **VERIFIED**
- Reproduction: open an owner-scoped READY item at `/app/library/[id]`; before this repair the header offered refresh/report actions and a player but no way to download the asset.
- Root cause: the unified library detail never rendered a download control, even though the product journey promises review and download.
- Repair: added a bilingual download action that uses `@vercel/blob.getDownloadUrl`, preserves existing query parameters, requests attachment disposition, and supplies a stable `.mp4` filename.
- Regression: `tests/video-download-link.test.ts`; four independent golden runs verify the browser download event and a non-empty local file.
- Repair commit: `e863c8e`

### RF-015 — Local optimized server rejected the cookie issued by NextAuth

- Severity: **P0 — release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: run an optimized build over `http://localhost`; NextAuth issues `next-auth.session-token`, while middleware previously forced lookup of `__Secure-next-auth.session-token` whenever `NODE_ENV=production`.
- Root cause: middleware overrode NextAuth's own URL/Vercel secure-cookie decision with `NODE_ENV === "production"`. Existing acceptance code masked the mismatch by manually cloning the cookie.
- Repair: remove the override so `getToken` follows the same rule as NextAuth. HTTPS still requires the secure-prefixed cookie.
- Regression: `tests/middleware-auth-cookie.test.ts` signs real JWTs for HTTP/HTTPS; the three golden runs register and log in naturally with no cookie bridge.
- Repair commit: `e863c8e`

### RF-016 — Unified Seedance mock could write real Blob storage during E2E

- Severity: **P0 — test-isolation/release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: enable `VIDEO_ENGINE_MOCK=true` while `.env.local` contains a Blob token; `getStatusMock` always calls `generateMockClip`, whose configured storage path can upload the generated fixture.
- Root cause: the unified Seedance mock did not honor the deterministic `MOCK_OUTPUT_VIDEO_URL` seam already used by the batch mock provider.
- Repair: in mock-only status handling, accept an explicit HTTP(S) fixture URL and bypass clip rendering/storage; invalid non-HTTP(S) fixtures fail the mock task.
- Regression: `tests/seedance-mock-hints.test.ts`; all golden runs blank Blob/real-provider secrets and prove every job output equals the local static MP4.
- Repair commit: `e863c8e`

### RF-017 — Independent golden-path runs shared a persistent registration rate-limit bucket

- Severity: **P0 — release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: after the Phase 1 pass series and two Phase 2 diagnostic starts, another clean optimized-server run received HTTP 429 from `/api/auth/register` before account creation.
- Root cause: every local browser run used the same implicit `unknown`/loopback registration IP, while `RateLimitBucket` correctly persists across server restarts; account cleanup intentionally did not erase security audit buckets.
- Repair: derive a deterministic, run-unique RFC 3849 documentation IPv6 address and send it through the rehearsal browser context; explicitly label that server as `VERCEL_ENV=preview`. Production rate-limit code and assertions are unchanged.
- Regression: `tests/golden-path-network-identity.test.ts` proves stable-per-run and distinct-between-run identities. The next independent golden run `gp-1784001316316-a8fd60a5` completed register → generate → preview → download with no retry.
- Evidence: `qa/evidence/phase2/iteration-2.0-golden-invariant.md`.
- Repair commit: `825efe9`

## Seed hypotheses not opened as defects

| Seed | Status | Evidence |
|---|---|---|
| S-01 login whitespace/hierarchy | `CANNOT_REPRO` | Current `/login` and recording both have a complete hero/form composition; `qa/screenshots/baseline/routes/login.png` |
| S-07 stale mutation views | `CANNOT_REPRO` in read-only Phase 0 | Mutation code contains polling/`router.refresh()`; Phase 3 must still exercise all mutations before release |

## PROPOSED_DELETIONS

None. No existing test was deleted, disabled, skipped, or weakened in Phase 0.
