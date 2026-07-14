# ReelForge Release Gate

- Gate owner: human release approver
- Audit revision: H1 product/test revision `e7dfea3`
- Current stage: H1 backend contract closure complete; H2 merge blocked until the RF-005 heartbeat window ends
- Current verdict: **NOT RELEASE-READY — RF-005 lacks production cadence evidence, RF-019 blocks ordinary migration deploy, and 5 UI P1 remain OPEN on this branch**

## Phase gates

- [x] Phase 0 — 33/33 routes and 71/71 API route files inventoried; H1 corrected the previously omitted stitch-dispatch route.
- [x] Phase 0 — background executors and all three video state machines traced.
- [x] Phase 0 — supplied recording and S-01 through S-07 concluded.
- [x] Phase 0 — route screenshots and machine-readable cold-load evidence captured.
- [x] **Human approval of Phase 0 map.** Approved 2026-07-13; Phase 1 authorized.
- [x] Phase 1 — golden path exists and passes three independent runs. Evidence: `qa/evidence/phase1-verification.md`.
- [x] **Human approval of Phase 1 evidence.** Approved 2026-07-13; Phase 2 authorized.
- [ ] Phase 2 — state, idempotency, concurrency, error, and API contract suites pass end to end.
- [x] H1 — first-tier strict and second-tier light API contract closure passes 116/116; RF-028 through RF-036 are VERIFIED. Evidence: `qa/evidence/phase2/h1-contract-closure.md`.
- [ ] Phase 3 — every route passes correctness and three-state acceptance.
- [x] Phase 4 visual decision — human reviewed 33 `phase34-current` screenshots on 2026-07-14 and approved the existing dark Studio `/app` + light public/auth/operational topology. The isolated UI branch still awaits H2 merge/reverification.
- [ ] Commercial certification — the 8/50/200/250 ladder, bad weather, QA drift, and human canary gates replace the obsolete standalone Phase 5 rehearsal.

## Final release checks

- [x] Golden-path E2E invariant remains green. Latest H1 run: `gp-1784055279098-5047b432`; it covers register, natural auth, dispatch, mock completion, stitch, playback, and non-empty download with zero unexpected console/network error.
- [ ] Current post-H2 full validation is green. Last complete pre-H1 unit/acceptance evidence is 727/728 plus the explicitly enabled DB test 1/1 and Final Acceptance `fa-1784011167411-04cf5e45` at 23/23; H1 ordered J4/J7 is `fa-1784054148752-d1a8f9ab` at 3/3. H2 must rerun the full suite after merge.
- [ ] `DEFECTS.md` has P0 = 0 and P1 = 0. Current: RF-019 is P0 OPEN, RF-005 is P0 FIXED pending production evidence, and RF-008/RF-009/RF-011/RF-012/RF-013 are P1 OPEN on this branch.
- [ ] Every route has console error = 0 in representative populated, empty, loading, and error states. Current limitation: `/app/batches/[id]` lacked representative rehearsal data.
- [ ] Batch rehearsal report attached. Evidence: —
- [ ] ESCALATED list attached for human ruling. Current: none.
- [ ] Human disposition recorded for remaining P2/P3. Current: none opened.
- [ ] Production health reports a real provider only after the explicit budget/provider gate. Local release code now fails closed for production mock (RF-001 VERIFIED); redeployed production evidence remains required.
- [ ] Queue scheduler cadence is measured and meets the release SLO (RF-005). Minute-cron code is fixed; production cadence evidence is absent.
- [x] Final-acceptance Playwright exits 0 including teardown (RF-006): run `fa-1784011167411-04cf5e45`, 23/23, teardown exit 0.
- [ ] RF-003 production migrations are rehearsed and applied through the RF-019 observed-state bootstrap; ordinary first deploy is currently unsafe when both remain pending.

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
- Phase 2 machine endpoint authentication: `qa/evidence/phase2/iteration-2.2-machine-auth.md`
- Phase 2 provider billing safety: `qa/evidence/phase2/iteration-2.3-provider-billing-safety.md`
- Phase 2 historical quarantine closure: `qa/evidence/phase2/iteration-2.4-historical-quarantine-closure.md`
- H1 contract closure: `qa/evidence/phase2/h1-contract-closure.md`
- Gate C0 Final Acceptance closure: `qa/evidence/phase2/gate-c0-final-acceptance.md`
- Gate C0 dependency status: `qa/certification/GATE_C0.md`
- Human production deployment and rollback checklist: `qa/certification/PRODUCTION_DEPLOYMENT_CHECKLIST.md`

## Rollback plan (draft; to validate in release phase)

Keep the last human-approved production deployment ID and database migration compatibility note with every release. If a release degrades the golden path or task accounting, stop dispatch, promote the previous Vercel deployment, leave immutable provider jobs untouched, and run reconciliation before re-enabling dispatch. A release-phase drill must prove this sequence and record the exact deployment IDs; this paragraph alone is not evidence.
