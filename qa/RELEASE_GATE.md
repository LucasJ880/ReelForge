# ReelForge Release Gate

- Gate owner: human release approver
- Audit revision: Phase 2 iteration `825efe9`
- Current stage: Phase 2 backend hardening in progress
- Current verdict: **NOT RELEASE-READY — 5 P0 OPEN, 1 P0 FIXED awaiting full-suite verification, and 5 P1 OPEN**

## Phase gates

- [x] Phase 0 — 33/33 routes and 70/70 API route files inventoried.
- [x] Phase 0 — background executors and all three video state machines traced.
- [x] Phase 0 — supplied recording and S-01 through S-07 concluded.
- [x] Phase 0 — route screenshots and machine-readable cold-load evidence captured.
- [x] **Human approval of Phase 0 map.** Approved 2026-07-13; Phase 1 authorized.
- [x] Phase 1 — golden path exists and passes three independent runs. Evidence: `qa/evidence/phase1-verification.md`.
- [x] **Human approval of Phase 1 evidence.** Approved 2026-07-13; Phase 2 authorized.
- [ ] Phase 2 — state, idempotency, concurrency, error, and API contract suites pass.
- [ ] Phase 3 — every route passes correctness and three-state acceptance.
- [ ] Phase 4 — human visual review approves the selected theme topology.
- [ ] Phase 5 — two 50-item mock commercial rehearsals and bad-weather cases pass.

## Final release checks

- [ ] Golden-path E2E passes five consecutive independent runs. Phase 1 recorded four consecutive passes; Phase 2 restarted the consecutive counter after a rolled-back RF-001 attempt and now has one pass with run-isolated rate limiting. Evidence: `qa/evidence/phase1-verification.md`, `qa/evidence/phase2/iteration-2.0-golden-invariant.md`.
- [ ] Full test suite passes with no newly added skip/xfail and all required DB integration tests enabled. Current: 662/663 pass, 1 pre-existing conditional DB integration skip.
- [ ] `DEFECTS.md` has P0 = 0 and P1 = 0. Current: 5 P0 OPEN + 1 P0 FIXED pending full verification; 5 P1 OPEN.
- [ ] Every route has console error = 0 in representative populated, empty, loading, and error states. Current limitation: `/app/batches/[id]` lacked representative rehearsal data.
- [ ] Batch rehearsal report attached. Evidence: —
- [ ] ESCALATED list attached for human ruling. Current: none.
- [ ] Human disposition recorded for remaining P2/P3. Current: none opened.
- [ ] Production health reports a real provider only after the explicit budget/provider gate. Local release code now fails closed for production mock (RF-001 VERIFIED); redeployed production evidence remains required.
- [ ] Queue scheduler cadence is measured and meets the release SLO (RF-005).
- [ ] Final-acceptance Playwright exits 0 including teardown (RF-006). Import-time crash is fixed and regression-tested; full original configuration remains to run.

## Evidence index

- Route inventory and state map: `qa/SHIP_AUDIT.md`
- Defect ledger: `qa/DEFECTS.md`
- Route scan JSON: `qa/evidence/phase0-route-scan.json`
- Baseline route screenshots: `qa/screenshots/baseline/routes/`
- Recording transition: `qa/screenshots/baseline/recording/login-transition.jpg`
- Production health snapshot: `qa/evidence/production-health-2026-07-13.json`
- Scheduler observation: `qa/evidence/github-scheduler-observation.md`
- Acceptance teardown error: `qa/evidence/final-acceptance-teardown-error.txt`
- Phase 0 verification commands/results: `qa/evidence/phase0-verification.md`
- Phase 1 golden-path summary: `qa/evidence/phase1-verification.md`
- Phase 1 per-run JSON: `qa/evidence/phase1/golden-path-*.json`
- Phase 1 completed-video screenshots: `qa/screenshots/phase1/*/completed-video.png`
- Phase 2 golden-invariant recovery: `qa/evidence/phase2/iteration-2.0-golden-invariant.md`
- Phase 2 production-mock guard: `qa/evidence/phase2/iteration-2.1-production-mock-guard.md`

## Rollback plan (draft; to validate in release phase)

Keep the last human-approved production deployment ID and database migration compatibility note with every release. If a release degrades the golden path or task accounting, stop dispatch, promote the previous Vercel deployment, leave immutable provider jobs untouched, and run reconciliation before re-enabling dispatch. A release-phase drill must prove this sequence and record the exact deployment IDs; this paragraph alone is not evidence.
