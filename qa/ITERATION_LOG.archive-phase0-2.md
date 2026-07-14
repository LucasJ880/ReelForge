# ReelForge Ship-Readiness Iteration Log

## Phase 0 · Iteration 0.1 — Inventory

- Date: 2026-07-13
- Work: enumerated all `src/app/**/page.tsx`, API `route.ts` methods, GitHub workflow triggers, runner scripts, cron/watchdog entry points, and Prisma task enums.
- Files changed: QA artifacts only — `qa/SHIP_AUDIT.md`.
- Verification: 33/33 page routes; 70/70 API route files; three active queue workflows; digital-human workflow no longer active.
- Ledger change: none yet; hypotheses collected for reproduction.
- Product code changes: none.

## Phase 0 · Iteration 0.2 — Route and recording evidence

- Date: 2026-07-13
- Work: inspected the supplied 103.2-second recording, extracted transition/contact frames, and cold-loaded all routes at 1440×1000 against the Neon rehearsal branch with explicit mock providers.
- Files changed: audit harness/evidence only — `qa/playwright.phase0.config.ts`, `qa/phase0/route-audit.spec.ts`, `qa/phase0/global-teardown.ts`, `qa/evidence/phase0-route-scan.json`, `qa/screenshots/baseline/**`.
- Verification: Phase 0 Playwright route audit `1 passed`; 33/33 reached network idle; 0 page errors; 0 warnings; only the deliberately missing `/app/batches/[id]` produced expected 404 console/network evidence.
- Findings: S-02/S-03/S-04/S-05/S-06 confirmed; S-01 cannot reproduce; S-07 not reproduced in the read-only phase.
- Product code changes: none.

## Phase 0 · Iteration 0.3 — State, security, and scheduler trace

- Date: 2026-07-13
- Work: traced every VideoJob/BatchJob/FinalVideo transition, submit/retry/watchdog/sweep/stitch path, machine authentication guard, historical quarantine, production health output, and GitHub scheduler history.
- Files changed: QA ledgers/evidence only.
- Verification: source-line trace plus production `/api/health` and read-only GitHub Actions metadata.
- Ledger change: opened RF-001 through RF-008 (seven P0, one P1).
- Product code changes: none.

## Phase 0 · Iteration 0.4 — Baseline suites and ledger closure

- Date: 2026-07-13
- Work: ran unit, lint, and type baselines; isolated final-acceptance teardown failure; wrote the four required release artifacts.
- Verification:
  - Unit: 658 total, 657 passed, 0 failed, 1 skipped because `RUN_DB_TESTS` was not enabled (`tests/metrics-iteration.integration.test.ts:12`).
  - Lint: product + QA audit harness pass after removing the audit-only unused binding.
  - Typecheck: product + QA audit harness pass after typing the audit-only JWT persona value.
  - Existing final acceptance: nonzero exit at global teardown; RF-006.
- Ledger change: opened RF-009 through RF-013; final Phase 0 total 7 P0 + 6 P1.
- Product code changes: none.

## Phase 0 gate

- Exit criteria: met for inventory, static state/endpoint audit, seed conclusions, route cold-load evidence, and ledger creation.
- Gate state: **APPROVED 2026-07-13**.
- Required human decision before the relevant repair: RF-010 theme topology.
- Next authorized phase after approval: Phase 1 golden-path E2E. No Phase 1 implementation has started.

## Phase 1 · Iteration 1.0 — Gate decision

- Date: 2026-07-13
- Human approval: Phase 1 authorized.
- RF-010 decision: preserve the current color topology; no all-site Light-first recolor.
- Ledger change: RF-010 `OPEN → VERIFIED`; open count is now 7 P0 + 5 P1.
- Product code changes: none in this decision record.
- Next: implement the deterministic registration/login → mock generation → preview → download golden path.

## Phase 1 · Iteration 1.1 — Reproduce and isolate the golden path

- Date: 2026-07-13
- Work: added a dedicated production-build Playwright configuration, exact Neon rehearsal guard, run-scoped account cleanup, zero-cost provider environment, console/5xx/network collector, and the full UI/API/runner/player/download journey.
- Files: `playwright.golden-path.config.ts`, `e2e/golden-path-*.ts`, package scripts.
- First run after the download repair: `gp-1783999630656-6b7964cf` reached a playable completed video and correctly failed because the test queried a link while Base UI exposed the download action as an accessible button. The role selector was corrected; the download attribute, event, filename, and non-empty file assertions stayed intact.
- Ledger change: opened RF-014 through RF-016 from concrete Phase 1 evidence.

## Phase 1 · Iteration 1.2 — Minimal product and test-isolation repairs

- Date: 2026-07-13
- Work: added the Blob-aware download action; aligned middleware with NextAuth cookie rules; added a deterministic no-storage Seedance mock URL; removed the final-acceptance teardown's import-time Playwright hook.
- Regression tests: download action/i18n, signed HTTP/HTTPS auth cookies, mock output fixture, teardown import.
- Verification: focused regressions 8/8 pass; typecheck/lint pass.
- Second run: `gp-1783999710428-8112bb64` completed registration, natural login, creation, terminal job accounting, stitch completion, playback, and non-empty download. It remained red only because the new network collector treated 73 intentional Next.js RSC prefetch cancellations as customer failures.
- Ledger change: RF-014/RF-015/RF-016 fixed; RF-006 fixed but held below VERIFIED pending its full original suite.

## Phase 1 · Iteration 1.3 — Correct the framework-cancellation classification

- Date: 2026-07-13
- Evidence: all 73 failed requests in the second run were exactly `net::ERR_ABORTED` URLs carrying Next.js's `_rsc` prefetch query. There were no console errors, page errors, 5xx responses, or other failed requests.
- Change: classify only `_rsc` + `net::ERR_ABORTED` as an intentional cancelled prefetch and retain a count in the run attachment. Any other failed request still blocks the test. No timeout, retry, functional assertion, or product expectation changed.
- Verification: three independent Playwright processes passed: `gp-1783999754024-28aaedc6`, `gp-1783999786341-1ddd5c8e`, and `gp-1783999816199-222daa9c`.

## Phase 1 · Iteration 1.4 — Regression and cleanup closure

- Date: 2026-07-13
- Verification:
  - optimized Next build: pass;
  - golden path: 4 independent pass, 0 retry (the fourth validates the final env-free reporter configuration; the first three satisfy the phase exit criterion);
  - full unit suite: 663 total, 662 pass, 0 fail, 1 pre-existing conditional DB integration skip;
  - typecheck/lint/diff check: pass;
  - post-run rehearsal cleanup: 0 `golden-gp-*` accounts remain.
- Evidence: `qa/evidence/phase1-verification.md`, per-run JSON, and completed-video screenshots.
- Gate state: **WAITING FOR HUMAN PHASE 1 APPROVAL**. Per the ship loop, no Phase 2 work has started.

## Phase 2 · Iteration 2.0 — Gate approval and golden-path invariant recovery

- Date: 2026-07-13
- Human approval: Phase 2 backend hardening authorized; existing dark `/app` plus light public/auth topology remains unchanged.
- RF-001 attempt 1: four new reproduction tests failed before repair and 31 focused tests passed after a production mock guard was added. The mandatory golden path then terminated with one FAILED provider job, so the entire attempt was rolled back immediately under the phase constitution. RF-001 remains OPEN at attempt 1/3.
- Baseline recovery exposed RF-017: the persistent registration IP rate-limit bucket returned 429 after repeated independent golden runs. No assertion or product limit was relaxed. The rehearsal client now receives a run-unique RFC 3849 IP and explicitly identifies as Vercel preview.
- Verification: network-identity regression 1/1, typecheck, focused lint, and independent optimized golden run `gp-1784001316316-a8fd60a5` pass.
- Ledger change: RF-017 opened and VERIFIED; RF-001 remains OPEN with the rolled-back attempt recorded.
- Evidence: `qa/evidence/phase2/iteration-2.0-golden-invariant.md`.

## Phase 2 · Iteration 2.1 — RF-001 production mock fail-closed

- Date: 2026-07-13
- Reproduction: Vercel Production validation accepted `VIDEO_ENGINE_MOCK=true`, and both the unified Mock provider and legacy Seedance entry created mock jobs in that runtime.
- Repair: added one shared production/runtime classifier, validation failure, and runtime backstops on all mock create/status/cancel branches. Production always refuses mock; Preview and explicit local rehearsal remain supported.
- Regression: production validation (including dry-run), unified Mock provider, legacy Seedance path, Preview rehearsal, existing dry-run fuse, and historical quarantine.
- Verification: 31/31 focused tests, typecheck, focused lint, optimized build, and mandatory golden run `gp-1784001583006-1ca10477` pass.
- Ledger change: RF-001 `OPEN → VERIFIED`; P0 OPEN count 6 → 5.
- Evidence: `qa/evidence/phase2/iteration-2.1-production-mock-guard.md`.

## Phase 2 · Iteration 2.2 — RF-002 machine endpoints fail-closed

- Date: 2026-07-13
- Reproduction: with no `CRON_SECRET`, `/api/cron/process-batches` reached Prisma; with a wrong bearer, sealed digital-human runner routes returned 404 before authentication.
- Repair: centralized SHA-256/timing-safe bearer comparison and a sanitized 503 misconfiguration response. Every cron, stitch runner, and sealed digital-human runner route invokes it before parsing or side effects.
- Regression: all eight endpoints under missing and wrong secret (16 cases); existing digital-human sealed and stitch runtime behavior.
- Verification: 21/21 focused tests, typecheck, focused lint, optimized build, and mandatory golden run `gp-1784001858660-004e8b31` pass.
- Ledger change: RF-002 `OPEN → VERIFIED`; P0 OPEN count 5 → 4.
- Evidence: `qa/evidence/phase2/iteration-2.2-machine-auth.md`.

## Phase 2 · Iteration 2.3 — RF-003 provider submission and request idempotency

- Date: 2026-07-13
- Reproduction: batch submission timeouts were automatically requeued; single-video provider status lookup errors fell through to a new paid submission; the customer dispatch route had no request-level idempotency.
- Repair: added persistent submission intent/acknowledgement states, logical job and per-attempt request keys, conservative historical backfill, request-response replay, quota ownership tracking, and compare-and-swap retry claims. Ambiguous acknowledgements are terminally held for reconciliation and cannot expose a normal retry path.
- Database: two expand-only migrations applied successfully to the Neon rehearsal branch with the branch owner; rehearsal app-role DML access verified. Production was not migrated.
- Verification: 16/16 focused billing-safety tests, typecheck, lint, optimized build, and two mandatory golden runs pass. The second golden run captures and replays the actual browser dispatch request and proves unchanged IDs/job count.
- Ledger change: RF-003 `OPEN → VERIFIED`; P0 OPEN count 4 → 3.
- Evidence: `qa/evidence/phase2/iteration-2.3-provider-billing-safety.md`.

## Phase 2 · Iteration 2.4 — RF-007 historical quarantine closure

- Date: 2026-07-13
- Repair: aligned sweeper selection/CAS with the historical dispatch predicate and added defense-in-depth guards to sweep, reconcile, and manual retry paths.
- Verification: 23/23 quarantine/sweeper/watchdog tests, typecheck, focused lint, optimized build, and mandatory golden path pass. The real-mode fixture proves zero provider calls and zero DB writes for an undecided pre-cutoff job.
- Ledger change: RF-007 `OPEN → VERIFIED`; P0 OPEN count 3 → 2.
- Evidence: `qa/evidence/phase2/iteration-2.4-historical-quarantine-closure.md`.

## Commercial certification · Gate C0 dependency audit

- Date: 2026-07-13
- Scope: read the six required dependency states from `qa/DEFECTS.md`; no throughput/scale/chaos/canary work started.
- Result: RF-002, RF-003, and RF-007 are VERIFIED. RF-004, RF-005, and RF-006 have code repairs but lack mandatory full/production evidence and remain FIXED.
- Reproducible command: `node qa/certification/check-gate-c0.mjs` (expected exit 1 at this revision, 3/6 VERIFIED).
- Ledger change: RF-004 `OPEN → FIXED`; RF-005 `OPEN → FIXED`; RF-006 remains FIXED. No item was promoted to VERIFIED without its required evidence.
- Gate state: **BLOCKED**. Per the Commercial Batch Certification constitution, work stops here pending dependency closure and a new C0 check.

## Gate C0 closure · Iteration 1 — RF-018 retry contract mismatch

- Date: 2026-07-14
- Reproduction: optimized golden path passed 1/1. The serial original Final Acceptance run `fa-1784009993055-a2497f4b` completed cleanup and passed 21/23; desktop and mobile J3 both received HTTP 409 from a retry control that the customer DTO had labelled retryable.
- Evidence: `test-results/final-acceptance/**/trace.zip`, screenshots, and Playwright HTML report for the run above.
- Diagnosis: customer error classification and mutation authorization use different retry-safety predicates. No assertion was relaxed and no test was skipped.
- Ledger change: opened RF-018 as P0. RF-004/RF-006 remain FIXED pending a clean post-repair 23/23 run.

## Gate C0 closure · Iteration 2 — Full acceptance and retry-contract closure

- Date: 2026-07-14
- Repair: aligned customer retry presentation and mutation authorization through one provider-capability-aware billing-safety predicate. Explicit mock retry remains zero-cost and deterministic; ambiguous real-provider work remains blocked. Final Acceptance rehearsal data is run-scoped and production mock guards remain enabled.
- Product/test commits: RF-018 and commercial-contract repair `5b713b9`; Final Acceptance rehearsal isolation `419bb12`. RF-004 and RF-005 were already isolated in `7860985` and `2dded10`; repair hashes were recorded by `ec18b06`.
- Verification:
  - focused RF-018 regressions: 15/15 passed;
  - targeted setup + desktop/mobile J3: 3/3 passed, run `fa-1784011098406-50ddd9f4`;
  - serial full Final Acceptance: 23/23 passed in 8.1 minutes, run `fa-1784011167411-04cf5e45`, teardown exit 0;
  - optimized post-fix golden path: 1/1 passed, run `gp-1784011670688-32bda3f8`;
  - full unit suite: 727/728 passed, 0 failed, 1 intentionally conditional DB integration skip;
  - conditional DB integration explicitly enabled against the Neon rehearsal branch: 1/1 passed, 0 skipped;
  - optimized build, typecheck, full lint, and `git diff --check`: passed.
- Ledger change: RF-004 `FIXED → VERIFIED`; RF-006 `FIXED → VERIFIED`; RF-018 `OPEN → VERIFIED`. RF-005 deliberately remains `FIXED` until a human production deployment is followed by the required 60-minute scheduler heartbeat observation.
- Real provider calls / paid operations: **0**.
- Evidence: `qa/evidence/phase2/gate-c0-final-acceptance.md`.

## Gate C0 closure · Iteration 3 — Production migration/runbook audit

- Date: 2026-07-14
- Work: prepared the human-run production checklist, RF-003 migration/backfill invariants, no-provider observation preflight, application/database rollback points, post-deploy health checks, and the reproducible 60-minute scheduler heartbeat evaluator.
- Finding: opened RF-019. The committed RF-003 ack backfill sorts before the migration that creates its enum and columns, so ordinary migrate deploy is not a safe first production command when both remain pending.
- Containment: the checklist requires a production-head Neon branch rehearsal, atomic prerequisite SQL, exact object verification, migration-history reconciliation, then ordinary migration deploy. Partial or mismatched state is an explicit stop condition.
- Verification: scheduler collector regressions pass 5/5; full Final Acceptance/golden/unit/database/static evidence remains unchanged from Iteration 2.
- Gate state: required C0 dependencies are 5/6 VERIFIED; RF-005 still needs the post-human-deploy 60-minute trace. RF-019 separately blocks that deployment until the checklist's migration rehearsal/bootstrap succeeds.
- Real provider calls / paid operations: **0**.
