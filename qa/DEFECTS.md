# ReelForge Ship Defect Ledger

- Audit revision: product/test baseline `440c91f`
- Last updated: 2026-07-14 (America/Toronto)
- Current phase: Phase 3/4 UI closure on isolated branch (commercial certification remains higher priority)
- Counts: **P0 OPEN 1 · P0 FIXED 1 · P0 VERIFIED 14 · P1 OPEN 0 · P1 VERIFIED 8 · P2 OPEN 0 · P3 OPEN 0**

## Status rules

`OPEN` reproduced or proven by current code/runtime evidence · `FIXED` product change made but full regression pending · `VERIFIED` reproduction + relevant suite + golden path are green · `CANNOT_REPRO` hypothesis not observed with stated evidence · `ESCALATED` three failed repair attempts recorded.

## Open defects

### RF-001 — Production reports mock video runtime

- Severity: **P0 — delivery blocker**
- Status: **VERIFIED**
- Seed: none; production invariant
- Reproduction: `GET https://reelforge-delta.vercel.app/api/health` on 2026-07-13 returned `videoProvider: "byteplus"` and `videoProviderStatus: "mock"`.
- Evidence: `qa/evidence/production-health-2026-07-13.json`
- Impact: a production customer can enter a path that produces rehearsal output rather than paid provider output. This violates the ship-loop rule that mock is available only under an explicit test/rehearsal deployment.
- Required regression: production configuration test must reject mock mode; preview/rehearsal must remain explicitly allowed.
- Repair attempts: Attempt 1 was rolled back when its mandatory golden run ended with one FAILED provider job. That run was later shown to share polluted rehearsal identity state (RF-017). Attempt 2 ran against an isolated preview identity and passed.
- Repair: production runtime detection now rejects every effective video-mock configuration in deployment validation and directly in both unified and legacy mock task paths. Vercel Production can never be reclassified as rehearsal by `AIVORA_DRY_RUN`; Vercel Preview and explicit local dry-run remain available.
- Verification: 31/31 focused safety tests, typecheck, lint, optimized build, and golden run `gp-1784001583006-1ca10477` pass. Production redeploy/health evidence remains a final release-gate check, not a code-regression gap.
- Evidence: `qa/evidence/phase2/iteration-2.1-production-mock-guard.md`.
- Repair commit: `14d6c9b`

### RF-002 — Cron and external-runner endpoints fail open when `CRON_SECRET` is absent

- Severity: **P0 — security/data-integrity blocker**
- Status: **VERIFIED**
- Reproduction: remove `CRON_SECRET` in an isolated test environment and call any machine endpoint without authorization; the guard body is skipped.
- Root cause: conditional authentication in `src/app/api/cron/process-batches/route.ts:7`, `poll-videos/route.ts:14`, `stitch-videos/route.ts:21`, `sweep-stuck-tasks/route.ts:13`, `src/app/api/internal/stitch/claim/route.ts:18`, `complete/route.ts:27`, and the two sealed digital-human runner routes.
- Impact: one missing deployment secret turns queue mutation and runner completion endpoints public.
- Required regression: every machine endpoint returns a sanitized non-2xx response when the secret is missing and 401 when it is wrong; no queue service is invoked.
- Repair: all eight cron/runner endpoints now call one constant-time, fail-closed guard before feature checks, body parsing, database access, or service invocation. Missing configuration returns sanitized 503; absent/wrong bearer returns 401.
- Verification: before repair, missing secret reached Prisma and sealed digital-human routes returned 404 before checking wrong credentials. After repair, all 16 missing/wrong endpoint cases pass, along with digital-human sealed tests, stitch runtime tests, typecheck, lint, optimized build, and golden run `gp-1784001858660-004e8b31`.
- Evidence: `qa/evidence/phase2/iteration-2.2-machine-auth.md`.
- Repair commit: `7bf8372`

### RF-003 — Ambiguous provider failures can resubmit and duplicate billable work

- Severity: **P0 — billing/data-integrity blocker**
- Status: **VERIFIED**
- Reproduction A: make provider submission accept the job, then make the client receive a timeout. `submitClaimedJob` catches every exception and returns the same row to `QUEUED` for up to three submissions.
- Reproduction B: on manual retry, make `fetchVideoJobStatus` throw a temporary transport error. The catch at `src/lib/services/video-service.ts:777` falls through to a new paid submission.
- Root cause: `src/lib/services/batch-service.ts:497-605` does not distinguish definitely-unbilled from ambiguous acknowledgement and does not pass/provider-persist an idempotency key; `src/lib/services/video-service.ts:731-827` treats status lookup failure as “provider failed/not found.”
- Impact: duplicate videos and duplicate provider charges during ordinary network faults.
- Required regression: concurrent/timeout contract tests proving ambiguous failures go to manual reconciliation and never invoke `createVideoJob` twice; provider idempotency behavior must be explicit.
- Repair: persisted request-level idempotency and a provider submission state machine (`NOT_STARTED → SUBMITTING → ACCEPTED / REJECTED / ACK_UNKNOWN`). Real-provider timeout, 5xx, decode, status-lookup, and acknowledgement-persistence gaps now fail closed as `ACK_UNKNOWN`; only positive “no job created” evidence permits replay. Initial logical segment keys and retry CAS prevent concurrent duplicate submissions. Customer dispatch clients reuse a stable idempotency key, and the route replays the exact stored response without consuming quota or creating jobs again.
- Verification: 16/16 focused billing-safety tests pass, including provider timeout, accepted-but-not-persisted, status lookup timeout with zero new submit calls, concurrent manual retry with exactly one submit, logical segment replay, and concurrent request claims. Optimized build passes. Golden run `gp-1784004092244-2a4be693` replays the captured customer dispatch request with the same key and proves identical order/brief IDs plus unchanged VideoJob count; the full journey then completes playback/download.
- Database evidence: both expand-only migrations applied successfully on the Neon rehearsal branch; historical attempted rows without an external id were conservatively backfilled to `ACK_UNKNOWN`. No production migration was run.
- Evidence: `qa/evidence/phase2/iteration-2.3-provider-billing-safety.md`.
- Repair commit: `076cf1d`

### RF-004 — Stale stitch callback can overwrite a newer FinalVideo attempt

- Severity: **P0 — final asset integrity blocker**
- Status: **VERIFIED**
- Reproduction: runner A claims `PENDING → STITCHING`; sweeper times it out to `PENDING`; runner B claims and completes; runner A then posts a late failure/success. The late callback updates by `id` and overwrites the current result.
- Root cause: `finishStitchTask` reads by id and uses unconditional `db.finalVideo.update` at `src/lib/services/stitch-service.ts:393-427`; completion payload has no attempt/claim token and no `status=STITCHING` CAS.
- Impact: a valid customer final video can revert to FAILED or be replaced with an older asset.
- Required regression: two-attempt race test in which stale callbacks are rejected and only the active claim can finalize.
- Repair: every claim now writes a UUID attempt token; success/failure completion uses `id + STITCHING + token` CAS and stale callbacks return `STALE_STITCH_ATTEMPT`/HTTP 409. A missing token is accepted only for a pre-migration in-flight row whose stored token is still null, so an old runner can drain during rolling deployment but cannot overwrite any newly claimed attempt. Dispatch and claim also paginate past older incomplete candidates, preventing stitch starvation.
- Verification: 30/30 focused stitch, stale-callback, rolling-compatibility, starvation, scheduler-dispatch, and runtime tests pass. The serial Final Acceptance run `fa-1784011167411-04cf5e45` passes 23/23 with teardown exit 0, and the post-repair golden run `gp-1784011670688-32bda3f8` passes. The full unit suite passes 727/728 with only the intentionally conditional DB integration test skipped; that integration test was then run explicitly against `NEON_REHEARSAL_DATABASE_URL` and passed 1/1. Typecheck, lint, optimized build, and diff check pass.
- Evidence: `qa/evidence/phase2/gate-c0-final-acceptance.md`.
- Repair commit: `0fc863d`

### RF-005 — Queue schedules declare 5 minutes but run roughly 55–107 minutes apart

- Severity: **P0 — unattended batch completion blocker**
- Status: **FIXED — production cadence evidence remains**
- Reproduction: compare `.github/workflows/{process-batches,poll-videos,stitch-videos}.yml` (`*/5`) with GitHub Actions start timestamps on 2026-07-13/14. `vercel.json` has no crons.
- Evidence: `qa/evidence/github-scheduler-observation.md`
- Impact: jobs can remain queued/running/stitching far beyond customer expectations after the user leaves the monitoring page; watchdog convergence is equally delayed.
- Required regression: deploy a scheduler with measured maximum delay, capture at least one 30-minute cadence trace, and prove queue/poller/stitch/sweep each execute within the agreed SLO.
- Repair: `vercel.json` now declares minute crons for batch processing, video polling/sweeping, and stitch dispatch. The old GitHub schedules are manual-only; each scheduler emits structured heartbeat data. External stitch dispatch is guarded by a PostgreSQL advisory lock, active-run de-duplication, and fail-closed GitHub configuration.
- Verification: 25/25 focused scheduler/auth/dispatch tests and the full unit suite pass. This code has not been deployed and no 30–60 minute production heartbeat trace or ready-stitch end-to-end dispatch observation exists; therefore the dependency is not VERIFIED.
- Repair commit: `761baec`

### RF-006 — Existing final-acceptance Playwright run exits nonzero in global teardown

- Severity: **P0 — release evidence blocker**
- Status: **VERIFIED**
- Reproduction: run the final-acceptance configuration with its global teardown. Importing constants from `tests/final-acceptance/framework.ts` registers `test.beforeEach` outside a test module and Playwright aborts.
- Root cause: `tests/final-acceptance/global-teardown.ts:6-9` imports `./framework`; that module calls `test.beforeEach` at `framework.ts:294`.
- Evidence: `qa/evidence/final-acceptance-teardown-error.txt`
- Impact: the existing end-to-end acceptance suite cannot supply a green release record even if its test body passes.
- Required regression: final-acceptance config completes test and teardown with exit 0; teardown constants live in a side-effect-free module.
- Repair: moved teardown constants into side-effect-free `tests/final-acceptance/fixture-data.ts`; added `tests/final-acceptance-global-teardown-import.test.ts`.
- Verification: the direct teardown import regression passes. The clean serial Final Acceptance run `fa-1784011167411-04cf5e45` passes 23/23 in 8.1 minutes; global teardown exits 0 after deleting 22 rehearsal batches and 4 product images and archiving the run-scoped template. The post-run `.last-run.json` reports `passed` with no failed tests. The post-repair golden path, full unit suite, explicit rehearsal DB integration, typecheck, lint, optimized build, and diff check also pass.
- Evidence: `qa/evidence/phase2/gate-c0-final-acceptance.md`.
- Repair commit: `e863c8e`

### RF-007 — Stuck-task sweeper bypasses the historical dispatch quarantine decision

- Severity: **P0 — protected historical task integrity blocker**
- Status: **VERIFIED**
- Reproduction: create/retain a pre-cutoff `QUEUED` VideoJob with `dispatchQuarantineDecision=null` and an expired/missing timeout, then run `sweepStuckTasks`; it is moved to `FAILED` without a human `RELEASED`/`EXPIRED` decision.
- Root cause: `src/lib/services/sweep-service.ts:90-117` selects all old `QUEUED/RUNNING` jobs and performs a status CAS but does not filter `createdAt`, `dispatchQuarantineDecision`, or call `isHistoricalDispatchQuarantined`. The dedicated guard in `historical-dispatch-quarantine.ts:34-54` protects provider calls only.
- Impact: contradicts the approved GATE 0 rule that historical tasks may only be explicitly released or marked expired through the human CAS operation.
- Required regression: in real-provider mode, sweep leaves pre-cutoff undecided jobs untouched; explicit EXPIRED/RELEASED paths retain CAS semantics.
- Repair: sweeper selection and update CAS now share the same real-mode eligibility predicate (explicit `RELEASED`, or undecided and created after the cutoff), while `EXPIRED` is always excluded. A second in-process guard protects against stale/incorrect query results. Reconcile and manual retry also stop before provider access or DB mutation for historical undecided rows.
- Verification: 23/23 quarantine, sweeper, and watchdog tests pass. With mock disabled and a placeholder credential present, the historical reconcile/retry regression records provider calls = 0 and DB writes = 0. Typecheck, focused lint, optimized build, and the mandatory golden path pass.
- Evidence: `qa/evidence/phase2/iteration-2.4-historical-quarantine-closure.md`.
- Repair commit: `076cf1d`

### RF-008 — Staff role can be locked out by a legacy customer persona

- Severity: **P1 — operator-visible**
- Status: **VERIFIED**
- Reproduction: use the known seeded account whose role is `SUPER_ADMIN` and `userType` is `BUSINESS`; visit `/internal`.
- Root cause: `normalizeUserType` preserves BUSINESS/PERSONAL before staff role fallback (`src/lib/auth.ts:100-108`), and `requireInternalPage` redirects those personas before `requireOperator` (`src/lib/api-auth.ts:221-236`).
- Impact: a valid admin credential can be redirected away from internal operations.
- Required regression: role/persona matrix test for pages and APIs, including legacy combinations; customer roles must still never acquire staff access.
- Repair: extracted a pure role policy shared by session normalization and internal-page routing. `SUPER_ADMIN`/`OPERATOR` role now wins over stale BUSINESS/PERSONAL persona values; CUSTOMER/REVIEWER role can never be promoted by a stored OPERATOR/SUPER_ADMIN persona. Internal API guards use the same role authority.
- Verification: source role/persona matrices pass 9/9. The optimized browser suite passes 11/11, including a `SUPER_ADMIN + BUSINESS` session reaching `/internal/orders` and a seeded CUSTOMER being denied for each BUSINESS/PERSONAL/OPERATOR/SUPER_ADMIN stored persona. Typecheck, focused lint, optimized build, and golden `gp-1784038873993-71bd69a3` pass.
- Evidence: `qa/evidence/phase34/iteration-3.5-rf008-role-persona-authority.md`, `qa/evidence/phase1/golden-path-gp-1784038873993-71bd69a3.json`.
- Repair commit: `0929fbb`

### RF-009 — Login success flashes a blank white viewport

- Severity: **P0 — golden-path continuity blocker (upgraded after repair attempt 1 made the golden path red)**
- Status: **VERIFIED**
- Seed: S-02
- Reproduction: sign in from the supplied recording and inspect the login-to-workspace transition; one full white frame is visible for roughly 0.5 seconds with no progress feedback.
- Evidence: `qa/screenshots/baseline/recording/login-transition.jpg`
- Impact: first-run users perceive a crash or broken redirect.
- Required regression: golden-path navigation asserts a persistent branded/loading surface and no white full-viewport frame between submit and `/app/create`.
- Repair attempts: Attempt 1 added an unauthenticated prefetch for `/app/create`; it caused the protected prefetch to redirect back to login and later abort during successful navigation. Strict golden run `gp-1784037382766-208c3e9d` failed on that request. The entire attempt was immediately rolled back; baseline run `gp-1784037506214-f921e4b0` then passed. Attempt 2 removed prefetch entirely.
- Repair: safe internal `from` handling now defaults directly to `/app/create`; successful login performs one `router.replace` without an immediate refresh or redirect hop. A full-viewport, light-auth-theme Aivora status surface remains mounted from credential submission until the dark Studio shell is visible. Credential/network failures restore the form and preserve a readable error.
- Verification: source regression 3/3, typecheck, focused lint, optimized build, and diff check pass. Golden run `gp-1784037627201-fa3fc7fb` passes the entire customer journey with zero console errors, 5xx responses, or failed requests; the in-page animation-frame sampler observed 27 transition frames and 0 blank viewport frames.
- Evidence: `qa/evidence/phase34/iteration-3.2-rf009-login-continuity.md`, `qa/evidence/phase1/golden-path-gp-1784037627201-fa3fc7fb.json`.
- Repair commit: `0fe2896`

### RF-010 — Current theme topology conflicts with the new Light-first instruction

- Severity: **P1 — customer-visible, human decision required**
- Status: **VERIFIED — human decision, 2026-07-13**
- Seed: S-03
- Reproduction: compare `/app/create` (dark Studio) with `/internal/orders`, auth, and public pages (light Editorial).
- Evidence: `qa/screenshots/baseline/routes/app-create.png`, `internal-orders.png`, `login.png`
- Impact: the current ship instruction calls this an incomplete Light-first migration, while the earlier approved design constitution explicitly requires dark `/app` plus light public/auth. Either implementation choice would violate one active instruction.
- Human decision: preserve the current color topology — dark Studio `/app`, light public/auth and existing light operational surfaces. Phase 4 may unify tokens/components within those surfaces but must not perform an all-site recolor.
- Repair: removed an accidental copied dark-token block from `.auth-studio-theme`; auth now inherits the light root token set and only declares `color-scheme: light`, while `.studio-theme` remains the sole dark workspace override.
- Verification: the design-system closure audit passes 3/3 (topology, single literal-color source, tokenized fonts/motion); corrected settled route screenshots show light auth/internal and dark Studio; the 99-scan route matrix and golden `gp-1784043470993-88e292ff` pass.
- Evidence: `qa/evidence/phase34/iteration-3.17-design-system-closure.md`, `qa/evidence/phase34/design-token-exemptions.md`, `qa/screenshots/redesign/phase34-current/`.
- Repair commit: `4d15380`

### RF-011 — Template filters and round actions overflow; template cards have unstable geometry

- Severity: **P1 — customer/operator-visible**
- Status: **VERIFIED**
- Seed: S-04
- Reproduction: cold-load at 1440×1000. `/app/templates` filter buttons extend to x=1942 inside a clipped row; `/internal/rounds/[id]` has an action ending at x=1498. Cards without a sample preview collapse vertically relative to preview cards.
- Evidence: `qa/evidence/phase0-route-scan.json`, `qa/screenshots/baseline/routes/app-templates.png`, `internal-rounds-id.png`
- Impact: controls are unreachable/clipped and template browsing looks structurally inconsistent.
- Required regression: overflow detector at 1280/1440/1920; template cards preserve a consistent information grid with or without sample media.
- Repair: category filters now wrap inside the filter panel instead of placing later controls outside the viewport. Template grid rows stretch cards to one height and pin recipe/actions consistently while cards without verified samples render no fake preview. Shared page headers defer side-by-side actions to large screens, and round actions own a full-width wrapping container constrained to the content column.
- Verification: source guards 3/3 and the complete Phase 3/4 browser suite 9/9 pass. `/app/templates` and a seeded `/internal/rounds/[id]` were checked at 1280/1440/1920: document width never exceeded viewport, overflowing element count was 0, and same-row template card height variance was at most 1px. Golden run `gp-1784038024462-f5dadb44` passes with 28 transition samples and 0 blank frames.
- Evidence: `qa/evidence/phase34/iteration-3.3-rf011-layout-containment.md`, `qa/evidence/phase1/golden-path-gp-1784038024462-f5dadb44.json`.
- Repair commit: `3e7a6cc`

### RF-012 — Customer pages collapse server failures into empty/not-found states

- Severity: **P1 — customer-visible correctness defect**
- Status: **VERIFIED**
- Seed: S-05
- Reproduction: force the data loader on create, batch list/detail, racing, library, or templates to reject. The page catches the exception and returns `[]`/`null`; there are no route-level `loading.tsx` or `error.tsx` files.
- Root cause: silent catches in `src/app/(platform)/app/create/page.tsx:24`, `batches/page.tsx:23`, `batches/[id]/page.tsx:18`, `racing/page.tsx:20`, `library/page.tsx:26`, `templates/page.tsx:16`; only `src/app/error.tsx` exists.
- Impact: outages masquerade as “no data” or 404 and offer no retry/recovery path.
- Required regression: each customer route is exercised under slow, empty, and 500 responses with distinct, accessible states.
- Repair: removed all six silent failure conversions; added route-owned loading/error boundaries with bilingual accessible copy and retry actions; gave successful empty states explicit semantics; and introduced a typed `BatchNotFoundError` so batch 404/access misses remain distinct from retryable service faults in both the page and status endpoint.
- Rehearsal safety: browser state injection requires Preview + explicit rehearsal + dry-run + mock provider simultaneously. Production and real-provider runtimes ignore caller-supplied QA headers; this invariant is locked by a regression test.
- Verification: source regression 6/6; browser slow/empty/500 matrix 7/7 after the final typed-error repair; typecheck, focused lint, optimized build, and diff check pass. Mandatory golden path run `gp-1784036981221-799edb49` passes registration → natural login → mock generation → terminal accounting → stitch → playback → non-empty download.
- Evidence: `qa/evidence/phase34/iteration-3.1-rf012-route-states.md`, `qa/evidence/phase1/golden-path-gp-1784036981221-799edb49.json`.
- Repair commit: `356182a`

### RF-013 — Chinese locale surfaces contain untranslated English operational copy

- Severity: **P1 — customer/operator-visible**
- Status: **VERIFIED**
- Seed: S-06
- Reproduction: set locale to Chinese and open creation, templates, auth, and internal navigation.
- Evidence/root cause: hard-coded `QUALITY-LOCKED`, `QUALITY LOCK`, `PRODUCTION BRIEF`, `Content reports`, `Legacy`, and `Internal Ops` bypassed both customer and internal dictionaries. `JOB ID` was audited and retained as a narrowly documented technical-field token rather than treated as operational copy.
- Impact: same-screen language mixing reduces comprehension and undermines production polish.
- Required regression: locale audit asserting customer-visible copy resolves through the i18n layer; IDs/provider names remain exempt technical tokens.
- Repair: routed customer quality-lock/count and production-brief labels through platform copy; routed internal reports, workspace branding, and legacy navigation through the typed dictionaries; documented the narrow technical-token exemptions and explicitly prohibited using them for headings, buttons, navigation, or explanatory text.
- Verification: focused operational-copy regression 3/3; combined dictionary/coverage/shell audit 11/11; typecheck and focused lint pass; complete Phase 3/4 browser suite 9/9; mandatory golden `gp-1784038463620-2c3cf392` passes with no real provider call.
- Evidence: `qa/evidence/phase34/iteration-3.4-rf013-operational-i18n.md`, `qa/evidence/phase34/rf013-technical-token-exemptions.md`, `qa/evidence/phase1/golden-path-gp-1784038463620-2c3cf392.json`.
- Repair commit: `63cad87`

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

### RF-018 — Batch UI offers retry that the billing guard rejects

- Severity: **P0 — release-evidence and customer recovery blocker**
- Status: **VERIFIED**
- Reproduction: run `npm run test:final-acceptance`. J3 reaches a deterministic mock stall/watchdog failure, renders a retry action, then `POST /api/batches/:batchId/jobs/:jobId/retry` returns 409 on desktop and mobile. Run `fa-1784009993055-a2497f4b` finished 21/23 with only these two equivalent failures; global cleanup exited normally.
- Root cause: `classifyCustomerGenerationError` marks every timeout/stall as retryable, while `isBillingSafeManualRetry` correctly rejects a real-provider timeout whose external job may still be billable. The customer DTO and mutation therefore use different recovery predicates. The explicit mock provider is also intentionally zero-cost and makes retry attempts succeed, but that provider capability is not consulted by the shared billing guard.
- Impact: customers can be shown a dead retry control; in the acceptance rehearsal, the mismatch blocks both desktop and mobile J3 and prevents RF-006 verification.
- Required regression: customer retryability and the mutation must share one billing-safe predicate; ambiguous real-provider failures stay non-retryable, explicit mock rehearsal failures remain retryable, and J3 plus the full 23-test suite pass without assertion changes.
- Repair: customer DTO classification and retry mutations now share the billing-safety predicate. Provider adapters declare a static manual-retry billing risk: the explicit zero-cost mock permits its deterministic stalled fixture to retry, while BytePlus and any ambiguous real-provider acknowledgement remain fail-closed. Historical jobs resolve their persisted provider rather than inheriting the current default provider.
- Verification: 15/15 focused customer-contract and billing-safety tests pass. Targeted setup + desktop/mobile J3 pass 3/3 in run `fa-1784011098406-50ddd9f4`; the clean serial Final Acceptance run `fa-1784011167411-04cf5e45` passes 23/23; the post-fix golden run `gp-1784011670688-32bda3f8` passes. Full unit, explicit rehearsal DB integration, typecheck, lint, optimized build, and diff check pass. No assertion was relaxed and no test was skipped or deleted.
- Evidence: `qa/evidence/phase2/gate-c0-final-acceptance.md`.
- Repair commit: `df5accb`

### RF-019 — RF-003 production migrations sort in dependency-inverted order

- Severity: **P0 — production deployment/data-integrity blocker**
- Status: **OPEN — production-head rehearsal and human execution required**
- Reproduction: sort the pending migration folders. `20260713_phase2_ack_unknown_backfill` is selected before `20260713_phase2_provider_submission_integrity`, but its first statement casts to `ProviderSubmissionState` and updates `submissionState`/`submissionErrorClass`; those objects are created only by the later folder.
- Impact: if both RF-003 migrations are pending as repository evidence indicates, a normal first `prisma migrate deploy` fails on the ack backfill, records a failed migration, and blocks all later production migrations. Marking it applied without creating the exact prerequisite objects would corrupt migration history.
- Required regression: from a fresh Neon branch cut from the current production head, execute the documented atomic provider-integrity bootstrap, reconcile its history, then run ordinary migrate deploy. Require zero drift, both RF-003 backfill invariants, app-role enum/table DML with rollback, and the same successful human-run sequence in production before application deployment.
- Planned repair: one-time observed-state bootstrap and rollback protocol in `qa/certification/PRODUCTION_DEPLOYMENT_CHECKLIST.md`. Migration folders cannot simply be renamed because the rehearsal branch already records their existing names; long-term migration-history reconciliation remains follow-up work.
- Evidence: `qa/certification/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
- Repair commit: —

### RF-020 — Phase 3 route-state bundle regressed login transition continuity

- Severity: **P0 — golden-path continuity regression**
- Status: **VERIFIED — speculative authenticated-route prefetch removed**
- Reproduction: after the uncommitted Phase 3 all-route boundary/matrix iteration passed its 33×3 route scan and 12-test browser suite, run `npm run test:golden-path`. Run `gp-1784040695799-839af69f` observed 18 full-viewport frames without an accepted auth/loading/Studio surface during login → `/app/create`.
- Root-cause boundary: the iteration introduced new route-group loading/error surfaces, including an auth loading surface, plus route-audit fixes. The constitution required immediate whole-iteration rollback, so no speculative sub-change was retained or isolated. The prior committed RF-009 code itself was unchanged.
- Impact: retaining the iteration would reopen the exact first-run blank-frame defect RF-009 locked down.
- Repair: removed every uncommitted Phase 3 product/test/generated-output change as one atomic rollback; preserved only the failed-run evidence. No assertion, threshold, test, or production configuration changed.
- Verification: rollback run `gp-1784040809734-ab04b4a7` passes the full golden journey with the original zero-blank-frame assertion. Working tree returned to the last committed Phase 3/4 baseline apart from the pre-existing external `qa/ITERATION_LOG.md` truncation and the two golden evidence runs.
- Follow-up isolation: auth-only route boundaries were subsequently introduced in repair commit `d82a8f4`. Golden run `gp-1784041162146-48d1317e` passed with the unchanged zero-blank-frame assertion, proving this boundary can be retained safely before the remaining route groups are reintroduced.
- Evidence: `qa/evidence/phase34/iteration-3.6-rf020-route-bundle-rollback.md`, `qa/evidence/phase1/golden-path-gp-1784040695799-839af69f.json`, `qa/evidence/phase1/golden-path-gp-1784040809734-ab04b4a7.json`.
- Repair commit: rollback contained no product commit; evidence commit recorded separately.

### RF-021 — Customer-detail route-state bundle triggered a golden network failure

- Severity: **P0 — golden-path network invariant regression**
- Status: **VERIFIED — offending iteration rolled back**
- Reproduction: add loading/error boundaries for `/app/create/images`, `/app/batches/new`, and `/app/library/[id]` as one iteration, then run the unchanged golden path. Run `gp-1784041620850-0134270e` observed one aborted Next.js JavaScript chunk request and failed at the final network assertion.
- Impact: retaining any iteration after a red golden path would violate the permanent Phase 1 invariant, even though this run reported 0 blank frames and completed the product workflow.
- Repair: atomically removed all uncommitted product, copy/type, and test changes from that iteration. No assertion, allowlist, tolerance, retry, provider, or deployment setting changed.
- Repair attempts: Attempt 1 bundled three customer-detail routes and was rolled back after one aborted chunk; baseline passed. Attempt 2 isolated `/app/create/images` only and was rolled back after two aborted chunks; baseline passed. Attempt 3 used trace evidence: the authenticated Studio shell was speculatively prefetching dynamic RSC destinations and the newly split boundary chunks were cancelled on subsequent navigation/sign-out. Automatic prefetch was disabled for Studio primary/home navigation while click navigation remains intact; `/app/create/images` was then reintroduced.
- Verification: focused prefetch/route regressions 2/2, typecheck, lint, optimized build, and golden `gp-1784042195066-160312e7` passed with the original 0-failed-request and 0-blank-frame assertions.
- Evidence: `qa/evidence/phase34/iteration-3.9-rf021-customer-boundary-rollback.md`, `qa/evidence/phase34/iteration-3.10-rf021-single-route-rollback.md`, `qa/evidence/phase34/iteration-3.11-rf021-prefetch-repair.md`, `qa/evidence/phase1/golden-path-gp-1784042195066-160312e7.json`.
- Repair commit: `c95c7b7`

### RF-022 — All-route matrix accepted authenticated redirects as successful route evidence

- Severity: **P1 — release-evidence integrity**
- Status: **VERIFIED**
- Reproduction: run the original 33-route matrix with its customer storage state. Every `/internal/**` request returned a non-error document after redirecting to `/app/create`, yet the test recorded the route as green and wrote the Studio page into internal screenshot filenames.
- Root cause: the matrix checked only the initial document status and never asserted the final pathname or installed an authorized internal session. It also captured screenshots while a route-level loading boundary could still be visible.
- Impact: the 99-scan result and internal screenshots did not prove the named internal routes were rendered.
- Repair: install a signed session from an existing OPERATOR/SUPER_ADMIN rehearsal account before internal scans; require the exact final pathname (allowing only the two source-defined root redirects); wait for the route loading boundary to settle; and remove per-scan listeners after each assertion set.
- Verification: the strengthened test first failed on the previously hidden redirect, then exercised real internal pages. The corrected 33-route × 3-width matrix passes 99/99 and regenerated all 33 screenshots from settled target pages.
- Evidence: `qa/evidence/phase34/iteration-3.15-rf022-route-evidence-integrity.md`, `qa/screenshots/redesign/phase34-current/`.
- Repair commit: `01e64be`

### RF-023 — AI usage summary tables overflow the operator viewport at 1280px

- Severity: **P1 — operator-visible layout defect**
- Status: **VERIFIED**
- Reproduction: open `/internal/ai-usage` at 1280px with real usage rows after the strengthened route matrix waits for content. The right-hand model table ends at x=1305, outside the x=1280 viewport.
- Root cause: the two-table grid switched to two columns at the `lg` breakpoint while its min-width tables and card grid items retained automatic minimum widths.
- Repair: keep the summaries single-column until `2xl` and make the grid/cards explicitly shrinkable with `min-w-0`; table regions retain horizontal scrolling for genuinely narrow containers.
- Verification: the same optimized-build matrix passes all 99 route-width scans with zero document or element overflow; mandatory golden run `gp-1784044311511-576ad482` passes the unchanged full customer journey.
- Evidence: `qa/evidence/phase34/iteration-3.16-rf023-ai-usage-containment.md`, `qa/screenshots/redesign/phase34-current/internal-ai-usage.png`, `qa/evidence/phase1/golden-path-gp-1784044311511-576ad482.json`.
- Repair commit: `01e64be`

### RF-024 — File selection can land before the upload control is hydrated

- Severity: **P0 — final-acceptance and first-use workflow blocker**
- Status: **VERIFIED**
- Reproduction: start J1 against an optimized build and select the 20 test files as soon as the server-rendered batch form appears. The browser accepts the file assignment, but React has not attached the input change handler; the UI remains at `0/50 已完成 0` and emits no upload requests.
- Root cause: the hidden file input was present and programmatically operable in the server HTML before the client component hydrated. Disabling only the surrounding button cannot protect direct input interaction.
- Repair: derive a hydration-safe interactive state with `useSyncExternalStore`; do not render the real file input until hydration; reject drag/drop and selection callbacks unless the control is hydrated and otherwise enabled.
- Verification: source-level hydration invariant 1/1; focused optimized-build Final Acceptance J1 passes setup + desktop + mobile 3/3 in run `fa-1784046239486-2cfa942a`; unchanged golden path passes as `gp-1784046345375-9b204bf9`.
- Evidence: `qa/evidence/phase34/iteration-3.18-rf024-upload-hydration.md`.
- Repair commit: `fa145d0`

## Seed hypotheses not opened as defects

| Seed | Status | Evidence |
|---|---|---|
| S-01 login whitespace/hierarchy | `CANNOT_REPRO` | Current `/login` and recording both have a complete hero/form composition; `qa/screenshots/baseline/routes/login.png` |
| S-07 stale mutation views | `CANNOT_REPRO` in read-only Phase 0 | Mutation code contains polling/`router.refresh()`; Phase 3 must still exercise all mutations before release |

## PROPOSED_DELETIONS

None. No existing test was deleted, disabled, skipped, or weakened in Phase 0.
