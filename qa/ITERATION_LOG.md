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
