# ReelForge Ship Defect Ledger

- Audit revision: H2 merge `ff1c959` + RF-037/RF-038 repair `a7fb734`
- Last updated: 2026-07-14 (America/Toronto)
- Current phase: H2-A merged-tree re-baseline in progress
- Counts: **P0 OPEN 1 · P0 FIXED 2 · P0 VERIFIED 21 · P1 OPEN 0 · P1 FIXED 2 · P1 VERIFIED 13 · P2 OPEN 0 · P3 OPEN 0**

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
- Repair commit: `db8ca29`

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
- Repair commit: `11c4c74`

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
- Repair commit: `961d660`

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
- Repair commit: `7860985`

### RF-005 — Queue schedules declare 5 minutes but run roughly 55–107 minutes apart

- Severity: **P0 — unattended batch completion blocker**
- Status: **FIXED — production cadence evidence remains**
- Reproduction: compare `.github/workflows/{process-batches,poll-videos,stitch-videos}.yml` (`*/5`) with GitHub Actions start timestamps on 2026-07-13/14. `vercel.json` has no crons.
- Evidence: `qa/evidence/github-scheduler-observation.md`
- Impact: jobs can remain queued/running/stitching far beyond customer expectations after the user leaves the monitoring page; watchdog convergence is equally delayed.
- Required regression: deploy a scheduler with measured maximum delay, capture at least one 30-minute cadence trace, and prove queue/poller/stitch/sweep each execute within the agreed SLO.
- Repair: `vercel.json` now declares minute crons for batch processing, video polling/sweeping, and stitch dispatch. The old GitHub schedules are manual-only; each scheduler emits structured heartbeat data. External stitch dispatch is guarded by a PostgreSQL advisory lock, active-run de-duplication, and fail-closed GitHub configuration.
- Verification: 25/25 focused scheduler/auth/dispatch tests and the full unit suite pass. This code has not been deployed and no 30–60 minute production heartbeat trace or ready-stitch end-to-end dispatch observation exists; therefore the dependency is not VERIFIED.
- Repair commit: `2dded10`

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
- Repair commit: `26b430e`

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
- Repair commit: `961d660`

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
- Repair commit: `8dab2c2`

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
- Repair commit: `97d6b69`

### RF-010 — Current theme topology conflicts with the new Light-first instruction

- Severity: **P1 — customer-visible, human decision required**
- Status: **VERIFIED — human decision, 2026-07-13**
- Seed: S-03
- Reproduction: compare `/app/create` (dark Studio) with `/internal/orders`, auth, and public pages (light Editorial).
- Evidence: `qa/screenshots/baseline/routes/app-create.png`, `internal-orders.png`, `login.png`
- Impact: the current ship instruction calls this an incomplete Light-first migration, while the earlier approved design constitution explicitly requires dark `/app` plus light public/auth. Either implementation choice would violate one active instruction.
- Human decision: preserve the current color topology — dark Studio `/app`, light public/auth and existing light operational surfaces. Phase 4 may unify tokens/components within those surfaces but must not perform an all-site recolor.
- Human decision v3 (2026-07-14, H2 D-0): **Option A — unify within topology.** One shared shadcn/ui-based component anatomy and one token system may express two sanctioned skins: warm-charcoal Studio with brand orange for `/app`, and light Editorial for public/auth/`/internal`. No route changes color mode. `/showcase` remains frozen; shared changes must prove pixel equivalence or be forked away from it.
- Human decision v4 (2026-07-14): preserve the same topology but return the `/app` Studio skin to the project's earlier neutral-dark direction. The approved Studio canvas/surface tokens are `#101015` / `#18181f`; public, auth, and internal surfaces remain light. The Studio root canvas may inherit the dark token set only while a `.studio-theme` descendant is mounted so viewport overscroll and short pages cannot expose the light root canvas. This supersedes only v3's warm-charcoal palette detail, not its route topology, component anatomy, or Showcase freeze.
- Human visual approval: 33 Phase 3/4 screenshots were approved on 2026-07-14 before the v4 palette refinement. The proposed future unification of internal and customer themes (RF-010 v2) remains explicitly **DEFERRED** until after the first commercial delivery and before formal market launch. The v4 palette itself is human-authorized; its final deployed screenshot/browser check remains pending.
- Repair: removed an accidental copied dark-token block from `.auth-studio-theme`; auth now inherits the light root token set and only declares `color-scheme: light`, while `.studio-theme` remains the sole dark workspace override.
- Verification: the v4 design hard gates require the neutral-dark values and the descendant-scoped root canvas selector. The focused design and batch-customer recovery suite passes 35/35 and TypeScript passes. Earlier settled route screenshots, the 99-scan route matrix, and golden `gp-1784043470993-88e292ff` remain historical topology evidence; a post-deploy browser check is still required for the refined palette.
- Evidence: `qa/evidence/phase34/iteration-3.17-design-system-closure.md`, `qa/evidence/phase34/iteration-3.22-neutral-studio-canvas-and-batch-error-locale.md`, `qa/evidence/phase34/design-token-exemptions.md`, `qa/evidence/phase34/phase4-human-visual-approval.md`, `qa/screenshots/redesign/phase34-current/`.
- Repair commit: `38dea0f`

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
- Repair commit: `697b0d7`

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
- Repair commit: `5286033`

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
- Repair commit: `d601c16`

### RF-014 — Completed customer video had no download action

- Severity: **P1 — customer-visible delivery gap**
- Status: **VERIFIED**
- Reproduction: open an owner-scoped READY item at `/app/library/[id]`; before this repair the header offered refresh/report actions and a player but no way to download the asset.
- Root cause: the unified library detail never rendered a download control, even though the product journey promises review and download.
- Repair: added a bilingual download action that uses `@vercel/blob.getDownloadUrl`, preserves existing query parameters, requests attachment disposition, and supplies a stable `.mp4` filename.
- Regression: `tests/video-download-link.test.ts`; four independent golden runs verify the browser download event and a non-empty local file.
- Repair commit: `26b430e`

### RF-015 — Local optimized server rejected the cookie issued by NextAuth

- Severity: **P0 — release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: run an optimized build over `http://localhost`; NextAuth issues `next-auth.session-token`, while middleware previously forced lookup of `__Secure-next-auth.session-token` whenever `NODE_ENV=production`.
- Root cause: middleware overrode NextAuth's own URL/Vercel secure-cookie decision with `NODE_ENV === "production"`. Existing acceptance code masked the mismatch by manually cloning the cookie.
- Repair: remove the override so `getToken` follows the same rule as NextAuth. HTTPS still requires the secure-prefixed cookie.
- Regression: `tests/middleware-auth-cookie.test.ts` signs real JWTs for HTTP/HTTPS; the three golden runs register and log in naturally with no cookie bridge.
- Repair commit: `26b430e`

### RF-016 — Unified Seedance mock could write real Blob storage during E2E

- Severity: **P0 — test-isolation/release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: enable `VIDEO_ENGINE_MOCK=true` while `.env.local` contains a Blob token; `getStatusMock` always calls `generateMockClip`, whose configured storage path can upload the generated fixture.
- Root cause: the unified Seedance mock did not honor the deterministic `MOCK_OUTPUT_VIDEO_URL` seam already used by the batch mock provider.
- Repair: in mock-only status handling, accept an explicit HTTP(S) fixture URL and bypass clip rendering/storage; invalid non-HTTP(S) fixtures fail the mock task.
- Regression: `tests/seedance-mock-hints.test.ts`; all golden runs blank Blob/real-provider secrets and prove every job output equals the local static MP4.
- Repair commit: `26b430e`

### RF-017 — Independent golden-path runs shared a persistent registration rate-limit bucket

- Severity: **P0 — release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: after the Phase 1 pass series and two Phase 2 diagnostic starts, another clean optimized-server run received HTTP 429 from `/api/auth/register` before account creation.
- Root cause: every local browser run used the same implicit `unknown`/loopback registration IP, while `RateLimitBucket` correctly persists across server restarts; account cleanup intentionally did not erase security audit buckets.
- Repair: derive a deterministic, run-unique RFC 3849 documentation IPv6 address and send it through the rehearsal browser context; explicitly label that server as `VERCEL_ENV=preview`. Production rate-limit code and assertions are unchanged.
- Regression: `tests/golden-path-network-identity.test.ts` proves stable-per-run and distinct-between-run identities. The next independent golden run `gp-1784001316316-a8fd60a5` completed register → generate → preview → download with no retry.
- Evidence: `qa/evidence/phase2/iteration-2.0-golden-invariant.md`.
- Repair commit: `198b514`

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
- Repair commit: `5b713b9`

### RF-019 — RF-003 production migrations sort in dependency-inverted order

- Severity: **P0 — production deployment/data-integrity blocker**
- Status: **VERIFIED**
- Reproduction: sort the pending migration folders. `20260713_phase2_ack_unknown_backfill` is selected before `20260713_phase2_provider_submission_integrity`, but its first statement casts to `ProviderSubmissionState` and updates `submissionState`/`submissionErrorClass`; those objects are created only by the later folder.
- Impact: if both RF-003 migrations are pending as repository evidence indicates, a normal first `prisma migrate deploy` fails on the ack backfill, records a failed migration, and blocks all later production migrations. Marking it applied without creating the exact prerequisite objects would corrupt migration history.
- Required regression: from a fresh Neon branch cut from the current production head, execute the documented atomic provider-integrity bootstrap, reconcile its history, then run ordinary migrate deploy. Require zero drift, both RF-003 backfill invariants, app-role enum/table DML with rollback, and the same successful human-run sequence in production before application deployment.
- Repair: created a fresh branch from the current production head and completed the documented observed-state bootstrap there; created a separate pre-write restore branch; then repeated the exact one-transaction provider-integrity bootstrap, object verification, history reconciliation, ordinary deploy, app-role grants, and rollback probe against production. The immutable migration folder names were preserved.
- Verification: Prisma reports 20/20 migrations applied and zero schema drift. Both RF-003 invariants and the historical batch-quota invariant are zero; all 170 external-id jobs are `ACCEPTED`; 239 remaining jobs are `NOT_STARTED`; the app role can use both new enum types and transactionally insert/read `VideoDispatchRequest`; the rollback probe left no row. Video-job count, submit-attempt total, latest submission timestamp, and the four historical pending final videos were unchanged. Production `/app/batches` and `/app/create` load with zero browser console errors; the first post-repair cron sample is HTTP 200 for all three schedulers with no provider-eligible work and no provider call.
- Evidence: `qa/evidence/phase2/rf019-production-schema-repair-2026-07-14.md`.
- Repair commit: this production-repair evidence commit

### RF-027 — Batch submission cap blocks the required 250-video commercial certification tier

- Severity: **P0 — commercial certification blocker**
- Status: **VERIFIED**
- Reproduction: submit `requestedCount=250` to `POST /api/batches`, or enter 250 in the customer batch wizard. The API schema rejects every value above 200 and both UI controls clamp to 200.
- Root cause: the commercial certification target was raised to 250 after the original 200-item UI/API boundary was implemented; the limit is duplicated in `src/app/api/batches/route.ts` and `src/components/batch/batch-create-wizard.tsx` instead of sharing one contract constant.
- Impact: the mandated 250-item overload rehearsal cannot be created through the same customer/API path that will serve the commercial order.
- Required regression: one shared limit must drive API and UI; 250 is accepted, 251 is rejected/clamped, and the existing 50-image and idempotency boundaries remain unchanged.
- Repair: introduced a single `MAX_BATCH_VIDEO_COUNT=250` contract constant, moved the API request validator into a reusable contract schema, and wired both customer quantity controls to the same limit. The 50-image boundary and idempotency path are unchanged.
- Verification: 5/5 focused API/UI boundary tests pass; the contract accepts 250 and rejects 251, while the customer controls clamp 251 to 250. Typecheck and the mandatory golden run `gp-1784050224278-3e756d58` pass end to end through register, dispatch, terminal mock completion, playback, and download.
- Evidence: `qa/evidence/phase1/golden-path-gp-1784050224278-3e756d58.json`.
- Repair commit: `c3c3268`

### RF-028 — Tier-one customer APIs expose inconsistent or naked error envelopes

- Severity: **P1 — customer-visible recovery and contract defect**
- Status: **VERIFIED**
- Reproduction: exercise authentication, validation, missing-resource, conflict, quota, and service failures across upload/blob, batch templates, the batch route group, video dispatch, health, and library loaders. Several paths return only `{ error }`, classify a 404 as `INTERNAL_ERROR`, turn ownership/not-found into 500, or let an exception reach the framework response.
- Impact: clients cannot reliably distinguish empty data from outages or render the promised retry/replace/wait/upgrade/contact recovery action; contract snapshots cannot be made stable.
- Required regression: first-tier endpoints use a shared machine-readable error envelope and endpoint DTO schemas; every supported status shape is snapshot-tested and frontend-consumed recovery fields are cross-asserted.
- Repair: introduced a closed shared customer error envelope, strict request/response DTO schemas for upload/blob, batch templates, all batch mutations/status, direct dispatch, health, and library, plus customer-safe recovery-action rendering. The remaining API surface now has light success-shape, authentication, and ownership boundary contracts without claiming strict hostile-input depth.
- Verification: the integrated H1 contract/inventory suite passes 116/116 with no skip; Final Acceptance J4/J7 run `fa-1784054148752-d1a8f9ab` passes 3/3; golden run `gp-1784055279098-5047b432` passes the complete customer journey. Typecheck, lint, and optimized build pass.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commits: `132401a`, `f0bbdbc`, `b92e344`, `c8fd6bc`, `be0c7ea`, `2c97542`, `e34bc55`, `073a86c`, `12253a5`

### RF-029 — Library detail lookup is incorrectly bounded by the latest 100 list rows

- Severity: **P1 — customer-visible historical asset access defect**
- Status: **VERIFIED**
- Reproduction: create more than 100 unified library orders for one owner, then open the detail route for an older valid order. `getUnifiedLibraryItem` calls the list loader (`take: 100`) and searches that truncated result, returning null/404 for an owned asset that still exists.
- Impact: a commercial customer can lose access to older delivered videos as their library grows, and the SSR detail DTO does not have an independently enforced ownership/query contract.
- Required regression: detail lookup queries the requested owner-scoped order directly, uses the same public DTO mapper as the list, and succeeds beyond the list pagination window without leaking another owner's item.
- Repair: detail lookup now queries the requested owner-scoped order directly and maps it through the same allowlisted public DTO as the list; it no longer depends on the list's 100-row window.
- Verification: `tests/unified-library-contract.test.ts` covers an owned item beyond the list window, cross-owner denial, and list/detail DTO parity; it passes inside the 116/116 H1 suite and the optimized build.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `3961854`

### RF-030 — Library progress exposes a 0–1 fraction as a 0–100 percentage

- Severity: **P1 — customer-visible monitoring truth defect**
- Status: **VERIFIED**
- Reproduction: open a generating or completed item in `/app/library`. `derivePersonalStatus` documents and returns `progressHint` in the 0–1 range, while the library renders `row.progress` with a percent sign and passes it to a 0–100 Progress component without conversion.
- Impact: a completed item can display `1%`, and in-flight progress is understated by 100×, contradicting the monitoring-truth requirement.
- Required regression: the shared library DTO mapper converts the fraction to an integer 0–100 exactly once; ready maps to 100 and all list/detail consumers use that same field.
- Repair: the shared library DTO mapper converts the service fraction to one clamped integer percentage; READY maps to 100 and list/detail use the identical field.
- Verification: `tests/unified-library-contract.test.ts` locks 0–100 conversion and list/detail parity; it passes inside the 116/116 H1 suite.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `3961854`

### RF-031 — Final Acceptance quota state leaks from J4 into J7

- Severity: **P0 — release-evidence isolation blocker**
- Status: **VERIFIED**
- Reproduction: run the desktop Final Acceptance subset matching `J4|J7` with one worker. J4 validly creates and cancels a 200-video batch; J7 then receives `429 QUOTA_EXCEEDED` with `used=200` before it can create its four-job resilience fixture.
- Root cause: the cleanup hook is registered at module scope in the shared `tests/final-acceptance/framework.ts` helper. When the shared module is cached across spec loading, the hook is not reliably attached to every consuming spec, so the 200-unit usage rows written by J4 remain visible to J7.
- Impact: the serial acceptance suite is order-dependent and cannot provide reproducible H1 or release-gate evidence even though the product quota boundary is behaving correctly.
- Required regression: move acceptance cleanup into an automatic fixture exported with the shared `test`, delete by the resolved acceptance user ID inside a transaction, assert zero remaining usage before each test, and pass the J4→J7 sequence without changing quota limits or assertions.
- Repair: Final Acceptance cleanup is now an automatic per-test fixture, resolves the run-scoped user, deletes usage/batch state transactionally, and asserts a zero baseline. J4's anonymous contract probes use an explicit empty-storage API context rather than consuming page-console findings or inheriting the authenticated browser session.
- Verification: ordered J4→J7 run `fa-1784054148752-d1a8f9ab` passes 3/3 with unchanged product quota limits and assertions.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `cb14d73`

### RF-032 — Legacy dispatch replay can advertise a duplicate-billing retry

- Severity: **P0 — duplicate provider submission and billing blocker**
- Status: **VERIFIED**
- Reproduction: deserialize a persisted pre-H1 dispatch failure with `code=DISPATCH_FAILED` and `retryable=true`. The compatibility mapper emits `INTERNAL_ERROR`, preserves `retryable=true`, and derives `action=retry`; both customer creation UIs then discard the original idempotency key and can submit the request again.
- Root cause: the legacy-code mapper normalizes the machine code but the retry normalizer still trusts the persisted boolean. `DISPATCH_FAILED` does not prove that the provider failed before accepting or billing the request.
- Impact: an ambiguous historical replay can create a second paid provider job while appearing to the customer as an ordinary safe retry.
- Required regression: every legacy `DISPATCH_FAILED` replay maps to `SUBMISSION_ACK_UNKNOWN`, `retryable=false`, and `action=contact_support`, including hostile persisted values that claim retryability.
- Repair: compatibility mapping treats every legacy `DISPATCH_FAILED` as acknowledgement-unknown regardless of the persisted retry flag and returns `SUBMISSION_ACK_UNKNOWN`, `retryable=false`, `contact_support`.
- Verification: hostile legacy replay cases pass in `tests/video-dispatch-error-contract.test.ts`; customer consumers also refuse to rotate the idempotency key for this class.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `c8fd6bc`

### RF-033 — Real-provider post-generation failures are misclassified as billing-safe retries

- Severity: **P0 — commercial reconciliation and duplicate billing blocker**
- Status: **VERIFIED**
- Reproduction: pass a failed real-provider job with an `externalJobId` plus terminal provider status, or an accepted job whose local error starts with `[frame-qa]`, to `isBillingSafeManualRetry`. The predicate returns true, and retry resets the job to `NOT_STARTED` without recording a new quota or usage charge.
- Root cause: the guard treats provider-terminal and post-generation QA failures as proof of non-billing. Those states prove only that the first attempt is no longer running; frame QA specifically proves that a provider output already existed.
- Impact: provider submission count can exceed internally metered task count, violating the commercial T3 reconciliation invariant and charging again for a generated attempt.
- Required regression: real providers may use the no-cost retry path only for `NOT_STARTED` or explicitly `REJECTED` jobs with no external job ID. Accepted, terminal, frame-QA, submitting, and acknowledgement-unknown attempts remain fail-closed; explicit zero-cost mock behavior remains recoverable.
- Repair: the real-provider retry predicate now requires positive no-bill evidence: `NOT_STARTED`, or explicit `REJECTED` with no external job ID. Accepted, terminal, frame-QA, submitting, and acknowledgement-unknown attempts fail closed; zero-cost mock behavior remains separately recoverable.
- Verification: `tests/batch-provider-billing-safety.test.ts` covers every positive and negative state plus external-job/frame-QA cases; the integrated H1 suite passes.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `b92e344`

### RF-034 — Direct dispatch advertises a new paid attempt after quota was consumed

- Severity: **P0 — entitlement reconciliation and duplicate billing blocker**
- Status: **VERIFIED**
- Reproduction: let the direct Agent Director dispatch consume quota, then return only failed jobs whose submission state is anything other than `ACK_UNKNOWN`—including `ACCEPTED` with an external provider job. The route returns `PROVIDER_ERROR`, `retryable=true`, `action=retry`; the UI replaces the idempotency key and a second request consumes quota and can submit again.
- Root cause: the route infers “safe to retry” from the absence of `ACK_UNKNOWN`. That is not positive proof that the provider created no job, and the consumed usage ledger is not compensated before a new attempt is offered.
- Impact: a customer can be charged entitlement twice and the provider can be called twice for one intended generation, while internal and provider reconciliation diverge.
- Required regression: after quota ownership is marked, an all-failed dispatch must not advertise an immediate new-key retry. It remains fail-closed with an explicit support/reconciliation action unless a future atomic quota-compensation path is implemented and proven idempotent.
- Repair: once dispatch quota is owned, an all-failed result never advertises a new paid attempt; the response remains fail-closed with support/reconciliation guidance and the UI preserves the stable idempotency key.
- Verification: dispatch route and consumer contract tests prove no `retry` action/new-key rotation after quota consumption; the golden path still completes under explicit mock mode.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `c8fd6bc`

### RF-035 — Dispatch quota/response CAS misses are treated as persisted

- Severity: **P1 — idempotency durability and customer recovery defect**
- Status: **VERIFIED**
- Reproduction: make `videoDispatchRequest.updateMany` return `{count:0}` from either `markVideoDispatchQuotaConsumed` or `completeVideoDispatchRequest`. Both helpers resolve normally; the route can continue into provider submission without owning the quota marker or return a response that was never persisted for replay.
- Root cause: the idempotency helpers expose raw CAS results and callers only handle thrown errors, never the zero-row outcome.
- Impact: the same idempotency key can remain permanently `PROCESSING`, while the client has already received a response or a provider job may have been submitted without durable request ownership.
- Required regression: both CAS helpers throw on any count other than one; quota-marker failure stops before provider submission and response-persistence failure returns fail-closed reconciliation guidance.
- Repair: quota ownership and response persistence helpers now require `updateMany.count === 1`; every zero/multiple-row result throws into the fail-closed reconciliation path before unsafe continuation.
- Verification: `tests/video-dispatch-idempotency.test.ts` and `tests/video-dispatch-error-contract.test.ts` cover both CAS misses and prove provider submission does not continue without durable ownership.
- Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- Repair commit: `c8fd6bc`

### RF-036 — Protected navigation prefetch races sign-out and produces an aborted customer request

- Severity: **P0 — golden-path/release-evidence blocker**
- Status: **VERIFIED**
- Reproduction: run the golden path through sign-out while platform primary navigation links remain mounted. After the session cookie clears, Next.js prefetch for `/app/batches` follows middleware to `/login?from=%2Fapp%2Fbatches`; navigation then tears it down and records `net::ERR_ABORTED`.
- Evidence before repair: golden run `gp-1784055093318-ae9ed205` fails the unchanged zero-failed-network-request assertion.
- Root cause: protected primary navigation used default viewport/hover prefetch even though sign-out deliberately invalidates every protected destination before redirecting.
- Impact: the customer-visible sign-out transition emits a failed request and the mandatory golden invariant cannot provide clean evidence.
- Required regression: protected primary navigation must not prefetch across authentication teardown; the zero-network-error golden assertion remains strict.
- Repair: disabled speculative prefetch on protected platform primary navigation links. Deliberate clicks still navigate normally; no assertion was removed or weakened.
- Verification: `tests/platform-shell-signout-prefetch.test.ts` passes; typecheck, lint, optimized build, and golden run `gp-1784055279098-5047b432` pass with zero console/network errors.
- Evidence: `qa/evidence/phase1/golden-path-gp-1784055093318-ae9ed205.json`, `qa/evidence/phase1/golden-path-gp-1784055279098-5047b432.json`.
- Repair commit: `b04beb7`

### RF-020 — Phase 3 route-state bundle regressed login transition continuity

- Severity: **P0 — golden-path continuity regression**
- Status: **VERIFIED — speculative authenticated-route prefetch removed**
- Reproduction: after the uncommitted Phase 3 all-route boundary/matrix iteration passed its 33×3 route scan and 12-test browser suite, run `npm run test:golden-path`. Run `gp-1784040695799-839af69f` observed 18 full-viewport frames without an accepted auth/loading/Studio surface during login → `/app/create`.
- Root-cause boundary: the iteration introduced new route-group loading/error surfaces, including an auth loading surface, plus route-audit fixes. The constitution required immediate whole-iteration rollback, so no speculative sub-change was retained or isolated. The prior committed RF-009 code itself was unchanged.
- Impact: retaining the iteration would reopen the exact first-run blank-frame defect RF-009 locked down.
- Repair: removed every uncommitted Phase 3 product/test/generated-output change as one atomic rollback; preserved only the failed-run evidence. No assertion, threshold, test, or production configuration changed.
- Verification: rollback run `gp-1784040809734-ab04b4a7` passes the full golden journey with the original zero-blank-frame assertion. Working tree returned to the last committed Phase 3/4 baseline apart from the pre-existing external `qa/ITERATION_LOG.md` truncation and the two golden evidence runs.
- Follow-up isolation: auth-only route boundaries were subsequently introduced in repair commit `760b358`. Golden run `gp-1784041162146-48d1317e` passed with the unchanged zero-blank-frame assertion, proving this boundary can be retained safely before the remaining route groups are reintroduced.
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
- Repair commit: `bbb867e`

### RF-022 — All-route matrix accepted authenticated redirects as successful route evidence

- Severity: **P1 — release-evidence integrity**
- Status: **VERIFIED**
- Reproduction: run the original 33-route matrix with its customer storage state. Every `/internal/**` request returned a non-error document after redirecting to `/app/create`, yet the test recorded the route as green and wrote the Studio page into internal screenshot filenames.
- Root cause: the matrix checked only the initial document status and never asserted the final pathname or installed an authorized internal session. It also captured screenshots while a route-level loading boundary could still be visible.
- Impact: the 99-scan result and internal screenshots did not prove the named internal routes were rendered.
- Repair: install a signed session from an existing OPERATOR/SUPER_ADMIN rehearsal account before internal scans; require the exact final pathname (allowing only the two source-defined root redirects); wait for the route loading boundary to settle; and remove per-scan listeners after each assertion set.
- Verification: the strengthened test first failed on the previously hidden redirect, then exercised real internal pages. The corrected 33-route × 3-width matrix passes 99/99 and regenerated all 33 screenshots from settled target pages.
- Evidence: `qa/evidence/phase34/iteration-3.15-rf022-route-evidence-integrity.md`, `qa/screenshots/redesign/phase34-current/`.
- Repair commit: `585a4c7`

### RF-023 — AI usage summary tables overflow the operator viewport at 1280px

- Severity: **P1 — operator-visible layout defect**
- Status: **VERIFIED**
- Reproduction: open `/internal/ai-usage` at 1280px with real usage rows after the strengthened route matrix waits for content. The right-hand model table ends at x=1305, outside the x=1280 viewport.
- Root cause: the two-table grid switched to two columns at the `lg` breakpoint while its min-width tables and card grid items retained automatic minimum widths.
- Repair: keep the summaries single-column until `2xl` and make the grid/cards explicitly shrinkable with `min-w-0`; table regions retain horizontal scrolling for genuinely narrow containers.
- Verification: the same optimized-build matrix passes all 99 route-width scans with zero document or element overflow; mandatory golden run `gp-1784044311511-576ad482` passes the unchanged full customer journey.
- Evidence: `qa/evidence/phase34/iteration-3.16-rf023-ai-usage-containment.md`, `qa/screenshots/redesign/phase34-current/internal-ai-usage.png`, `qa/evidence/phase1/golden-path-gp-1784044311511-576ad482.json`.
- Repair commit: `585a4c7`

### RF-024 — File selection can land before the upload control is hydrated

- Severity: **P0 — final-acceptance and first-use workflow blocker**
- Status: **VERIFIED**
- Reproduction: start J1 against an optimized build and select the 20 test files as soon as the server-rendered batch form appears. The browser accepts the file assignment, but React has not attached the input change handler; the UI remains at `0/50 已完成 0` and emits no upload requests.
- Root cause: the hidden file input was present and programmatically operable in the server HTML before the client component hydrated. Disabling only the surrounding button cannot protect direct input interaction.
- Repair: derive a hydration-safe interactive state with `useSyncExternalStore`; do not render the real file input until hydration; reject drag/drop and selection callbacks unless the control is hydrated and otherwise enabled.
- Verification: source-level hydration invariant 1/1; focused optimized-build Final Acceptance J1 passes setup + desktop + mobile 3/3 in run `fa-1784046239486-2cfa942a`; unchanged golden path passes as `gp-1784046345375-9b204bf9`.
- Evidence: `qa/evidence/phase34/iteration-3.18-rf024-upload-hydration.md`.
- Repair commit: `b013c8a`

### RF-025 — Batch detail navigation temporarily loses monitor progress semantics

- Severity: **P1 — customer-visible loading feedback**
- Status: **VERIFIED**
- Reproduction: submit a one-item batch under the J8 Slow 3G profile, navigate to its detail URL, and start the delayed status tick. The parent `/app/batches/loading.tsx` boundary can remain visible while the detail route resolves, but it exposed only generic skeletons and no `批次总进度` progressbar within the 200ms feedback budget.
- Root cause: the nested detail route has a progress-aware loading boundary, but Next.js may render the parent batches loading boundary during navigation; the shared parent state did not preserve the monitor's primary progress semantic.
- Repair: shared batch list/detail loading surfaces now render a localized zero-state progressbar while data resolves. The real monitor replaces it with live progress after navigation settles.
- Verification: shared route-state regression 6/6; optimized build; focused Final Acceptance J8 desktop setup + journey 2/2 under Slow 3G and the configured 30-second monitor delay, run `fa-1784046542905-9a7c8a52`; unchanged golden `gp-1784046710814-9748fc44` passes.
- Evidence: `qa/evidence/phase34/iteration-3.19-rf025-batch-loading-progress.md`.
- Repair commit: `7f6d7d1`

### RF-026 — Global CJK webfont payload blocks mobile onboarding and aborts on navigation

- Severity: **P0 — mobile final-acceptance and network-invariant blocker**
- Status: **VERIFIED**
- Reproduction: run Final Acceptance mobile P6/J8 on the optimized build. The root layout requests six global font families, including multi-weight Noto Sans SC and Noto Serif SC payloads. Under Slow 3G, J8 cannot reach its template action inside 30 seconds; P6 records four aborted WOFF2 requests when navigation cancels still-pending fonts. The same resource contention reduced J2's five-second status sample count in the first full run.
- Root cause: downloadable CJK families and weights were applied to every surface at the document root, although the approved typography contract permits an explicit Chinese system fallback. The payload competes with functional RSC/data requests and survives across route transitions long enough to be cancelled.
- Repair: keep the four role-defining Latin `next/font` families and replace downloadable Noto SC families with explicit macOS/Windows/Linux CJK sans/serif system fallbacks in the single token source. Theme topology and font roles remain unchanged.
- Verification: design-system audit 3/3 and optimized build pass; focused Final Acceptance mobile P6 2/2 (`fa-1784046862464-cbce87da`), J8 2/2 (`fa-1784046907181-1ef340f2`), and J2 2/2 (`fa-1784047003719-ac2aed1c`) pass with unchanged assertions; golden `gp-1784047054103-01af2a53` passes.
- Evidence: `qa/evidence/phase34/iteration-3.20-rf026-font-network-budget.md`.
- Repair commit: `c23d287`

### RF-037 — Locale switch does not cover the complete customer journey

- Severity: **P1 — customer-visible language continuity defect**
- Status: **FIXED — focused regression is green; merged golden remains intentionally deferred**
- Reproduction: switch the authenticated Studio to English, then open batch creation/detail and the public privacy, terms, and persona routes; repeat at a 390px viewport. The desktop shell headings switch, but mobile Studio has no visible locale control, batch surfaces can expose Chinese template/category/error fields, and public legal/persona pages remain English-only or mixed-language.
- Root cause: RF-013 locked a narrow set of operational labels at source level but never exercised a real locale click across client and RSC boundaries. Several customer components still consume untranslated database/API display fields, while public routes own hard-coded copy and the mobile shell omits `LanguageSwitcher`.
- Impact: a customer can select English or Chinese and immediately encounter a different language on the next production, review, or legal step; mobile customers cannot correct the locale at all.
- Required regression: browser tests must perform the real switch, prove cookie/localStorage/`html[lang]` persistence across auth, Studio, batch, library, and public routes, and prove a visible 390px control. Customer error rendering must select localized recovery copy from machine codes rather than echo an upstream-language message.
- Repair: the authenticated mobile shell now exposes the same locale control as desktop; batch creation and monitoring translate persisted template/category/status values and replace upstream-language error bodies with locale-owned recovery copy. Privacy, terms, and persona pages now read the persisted locale for metadata and body copy and expose a visible switcher.
- Follow-up repair: batch creation now derives customer-facing failure copy from the API machine error code. English workspaces never echo the API's Chinese default error body; Chinese workspaces retain the specific server detail. Unknown error codes also fall back to locale-owned copy.
- Verification: 16/16 focused Agent/locale/public/platform journey tests remain green. The follow-up focused design, customer-recovery, batch frontend/API, and batch-pipeline suite passes 35/35, and TypeScript passes. The human explicitly paused further broad simulation before internal operations testing, so this item is not promoted to VERIFIED on pre-repair golden evidence.
- Evidence: H2 merge audit on 2026-07-14; `tests/phase34/locale-switch.spec.ts`; `qa/evidence/phase34/iteration-3.22-neutral-studio-canvas-and-batch-error-locale.md`.
- Repair commit: `a7fb734`

### RF-038 — Agent conversation grows the page and hides the primary generation action

- Severity: **P1 — customer-visible creation UX blocker**
- Status: **FIXED — focused browser regression is green; internal operator feedback pending**
- Reproduction: continue the Agent conversation on `/app/create`. The transcript has `overflow-y-auto` but no bounded ancestor, so each reply increases the whole page height; the composer moves away, and the actual generation button does not exist in the DOM until a separate plan preview succeeds.
- Root cause: `min-height + flex: 1` was used without a constrained parent; auto-scroll was unconditional and success-only; the production CTA was conditionally mounted behind `plan != null` at the bottom of a long form.
- Impact: users lose conversational context, must chase the composer down the page, and can reasonably conclude that generation is unavailable.
- Required regression: at 1440px, a long mocked conversation must produce `scrollHeight > clientHeight` inside the transcript while the composer remains fixed; manual upward scrolling exposes a jump-to-latest action; exactly one primary generation control remains visible and available without a prior preview.
- Repair: the Agent card now has a viewport-bounded desktop height, independent asset/transcript scrolling, pinned-versus-detached auto-scroll, a jump-to-latest control, a fixed composer, compact message/panel density, and a horizontal recommendation rail. The production form always renders one primary Generate action and performs the existing quality-plan check automatically before dispatch; Preview remains optional.
- Verification: focused source regression 3/3, related journey/locale tests 16/16, TypeScript, focused ESLint, optimized production build, and browser run `phase34-1784065559900-a0eb3437` 2/2 with rehearsal teardown exit 0. No real provider or paid operation was invoked.
- Evidence: `tests/phase34/agent-chat-ux.spec.ts`; `qa/evidence/h2/open-source-ux-research.md`.
- Repair commit: `a7fb734`

### RF-039 — Phase 0 browser evidence retained expired signed TOS URLs

- Severity: **P0 — repository credential-hygiene and release blocker**
- Status: **FIXED — sanitized history push accepted; credential disposition remains**
- Reproduction: push the H2 release branch. GitHub Push Protection rejects the branch because `qa/evidence/phase0-route-scan.json` in an early commit contains Beijing TOS pre-signed URLs with a credential identifier and request signatures.
- Root cause: the cold-load audit persisted complete failed network request URLs instead of normalizing query credentials before serializing evidence.
- Impact: signed bearer URLs were retained in local Git history and the release branch could not be pushed. The observed URLs are expired, but any still-active access-key pair must be treated according to the human credential-rotation process.
- Required regression: repository evidence contains no TOS credential/signature markers or access-key identifiers; every H2-only commit is rebuilt from the clean `origin/main` base; GitHub Push Protection accepts the sanitized branch.
- Repair: all affected evidence URLs were replaced by a non-routable redaction marker, a regression test was added, 78 H2-only commits were deterministically rebuilt with the redacted blob, and tracked QA commit references were mapped to the rewritten graph.
- Verification: JSON integrity and the focused redaction regression pass; the rewritten graph contains zero `X-Tos-Credential` markers in the affected artifact. GitHub Push Protection accepted `origin/codex/h2-ui-unification` after rejecting the unsanitized graph. Human confirmation that the historical VolcEngine credential is revoked/rotated is still pending, so the defect remains FIXED.
- Evidence: `qa/evidence/h2/history-rewrite-2026-07-14.md`; `qa/evidence/h2/history-rewrite-map.json`; `tests/qa-evidence-secret-redaction.test.ts`.
- Repair commit: rewritten `5b492a3` plus the pending audit-reference commit.

### RF-040 — Production video generation was sealed by an incompatible mock/secret configuration

- Severity: **P0 — customer generation blocker and quota-accounting defect**
- Status: **FIXED — deployment and one bounded production canary pending**
- Reproduction: submit one 15-second video from the deployed Agent Director. The request reaches planning, consumes the direct-video entitlement, creates a `VideoDispatchRequest` and `VideoJob`, then the production mock backstop rejects the provider path with `production runtime 禁止 mock 视频 provider`. The customer sees only a generation failure and no provider job exists.
- Root cause: production still had `VIDEO_ENGINE_MOCK=true`, while the international BytePlus credential remained under the legacy `ARK_API_KEY` name. The real Seedance adapter intentionally reads only `BYTEPLUS_ARK_API_KEY`, so simply disabling mock would still fail closed. Runtime readiness was also checked too late on the direct path and after an idempotent existing-batch shortcut on the batch path.
- Impact: internal operators cannot produce a video; configuration failures can create failed job/accounting rows before any provider call.
- Repair: add one typed runtime-readiness predicate covering production mock, international BytePlus key/endpoint, invalid env values, and mandatory real moderation credentials. Direct dispatch now checks it before planning/quota/idempotency/job writes. Batch create/tick/retry check it before idempotency lookup, lease recovery, or reset mutations. Production secret migration is prepared from the existing international credential to the canonical variable without exposing its value.
- Accounting repair: the diagnostic request made zero video-provider calls. Its single VIDEO_DISPATCH and SEEDANCE_SEGMENT usage units were compensated with auditable negative `UsageLog` rows and compare-and-swap clearing of `quotaConsumedAt`.
- Regression: `tests/production-mock-runtime-guard.test.ts`, `tests/batch-runtime-readiness.test.ts`, and `tests/china-env-validation.test.ts` lock zero-side-effect fail-closed behavior while preserving Preview/local mock rehearsal.
- Verification: focused generation/runtime/design suite 72/72, TypeScript, ESLint, optimized build, and a zero-cost browser rehearsal all pass. The rehearsal completed login -> Agent brief -> plan -> dispatch -> polling -> `FinalVideo READY` -> preview/download entry; H.264/AAC media reached browser `readyState=4`. Production verification remains pending deployment.
- Evidence: `qa/evidence/phase2/rf040-rf041-production-generation-repair-2026-07-14.md`.
- Repair commit: pending.

### RF-041 — Batch creation allowed fewer assets than the selected immutable template requires

- Severity: **P1 — customer-visible batch creation blocker**
- Status: **FIXED — production browser verification pending**
- Reproduction: upload one product image, select a template whose immutable `imagesPerVideo.min` is three, continue to confirmation, and submit. The API throws a generic error, returns HTTP 500, and the UI replaces the useful reason with `创建批次失败`.
- Root cause: the wizard gated only on `uploaded.length > 0`; the service parsed the allocation rule only inside expansion and did not expose a typed validation error at the API boundary.
- Impact: a valid-looking four-step customer journey ends in an opaque failure. No BatchJob/provider submission is committed because the transaction rolls back, but the operator cannot understand how to recover.
- Repair: derive the selected template minimum in the wizard, display required/actual/missing counts, block continue and submit until the minimum is met, and retain a defensive submit guard. The service revalidates the immutable ACTIVE template before the transaction and throws `BatchInsufficientAssetsError`; the API maps it to `422 VALIDATION_FAILED / fix_request`. Customer copy is selected from the machine code so English workspaces never echo the Chinese server default.
- Regression: one image against `min=3` produces no API request in the UI and a direct API call returns the strict 422 envelope before transaction/quota/provider work; Preview mock idempotency still works.
- Verification: focused batch/runtime/design suite 72/72, TypeScript, ESLint, optimized build, and diff check pass.
- Evidence: `qa/evidence/phase2/rf040-rf041-production-generation-repair-2026-07-14.md`.
- Repair commit: pending.

## Seed hypotheses not opened as defects

| Seed | Status | Evidence |
|---|---|---|
| S-01 login whitespace/hierarchy | `CANNOT_REPRO` | Current `/login` and recording both have a complete hero/form composition; `qa/screenshots/baseline/routes/login.png` |
| S-07 stale mutation views | `CANNOT_REPRO` in read-only Phase 0 | Mutation code contains polling/`router.refresh()`; Phase 3 must still exercise all mutations before release |

## PROPOSED_DELETIONS

None. No existing test was deleted, disabled, skipped, or weakened in Phase 0.
