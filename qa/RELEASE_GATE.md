# ReelForge Release Gate

- Gate owner: human release approver
- Audit revision: merged H1 `cc75c21` + UI closure `2d4aefc`; H2 verification pending
- Current stage: H2-A merged-tree re-baseline
- Current verdict: **NOT RELEASE-READY — merged-tree verification is pending, RF-005 lacks production cadence evidence, and RF-019 blocks ordinary migration deploy**

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
- [x] Phase 3 source-branch closure — all 33 routes passed the matrix; customer slow/empty/500 states, seeded batch detail, and 1280/1440/1920 overflow scans passed. H2 must repeat these checks on the merged tree. Evidence: `qa/evidence/phase34/iteration-3.21-closure-regression.md`.
- [x] Phase 4 visual decision — human reviewed 33 `phase34-current` screenshots on 2026-07-14 and approved the existing dark Studio `/app` + light public/auth/operational topology. Option A preserves that topology during H2.
- [ ] Commercial certification — the 8/50/200/250 ladder, bad weather, QA drift, and human canary gates replace the obsolete standalone Phase 5 rehearsal.

## Final release checks

- [ ] Merged-tree golden invariant is green. Pre-merge evidence is green on both parents: H1 `gp-1784055279098-5047b432`; UI final series `gp-1784047276260-e8880c0c`, `gp-1784047304319-a978b9bb`, `gp-1784047333120-e0387432`.
- [ ] Current post-H2 full validation is green. Pre-merge UI evidence is unit 727/728 plus explicit DB 1/1 and Final Acceptance `fa-1784047355157-099e9e8a` at 23/23; H1 ordered J4/J7 is `fa-1784054148752-d1a8f9ab` at 3/3. H2 must rerun every set on the merged tree.
- [ ] `DEFECTS.md` has P0 = 0 and P1 = 0. Current: P1 OPEN = 0; RF-019 is P0 OPEN and RF-005 is P0 FIXED pending production evidence.
- [ ] Merged-tree 33-route console/service/semantic/overflow checks pass across settled and injected states. Pre-merge UI evidence passed; H2 refresh is pending.
- [ ] Batch rehearsal report attached. Evidence: —
- [ ] ESCALATED list attached for human ruling. Current: none.
- [ ] Human disposition recorded for remaining P2/P3. Current: none opened.
- [ ] Production health reports a real provider only after the explicit budget/provider gate. Local release code now fails closed for production mock (RF-001 VERIFIED); redeployed production evidence remains required.
- [ ] Queue scheduler cadence is measured and meets the release SLO (RF-005). Minute-cron code is fixed; production cadence evidence is absent.
- [x] Final-acceptance Playwright exits 0 including teardown (RF-006): final UI-closure run `fa-1784047355157-099e9e8a`, 23/23 in 7.3 minutes; teardown deleted 22 rehearsal batches and 4 product images, archived 1 run-scoped template, and exited 0.
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
- Phase 3/4 final regression and merge plan: `qa/evidence/phase34/iteration-3.21-closure-regression.md`
- Phase 3/4 settled route screenshots: `qa/screenshots/redesign/phase34-current/`
- Phase 4 human visual approval and deferred color decision: `qa/evidence/phase34/phase4-human-visual-approval.md`
- Gate C0 dependency status: `qa/certification/GATE_C0.md`
- Human production deployment and rollback checklist: `qa/certification/PRODUCTION_DEPLOYMENT_CHECKLIST.md`

## Rollback plan (draft; to validate in release phase)

Keep the last human-approved production deployment ID and database migration compatibility note with every release. If a release degrades the golden path or task accounting, stop dispatch, promote the previous Vercel deployment, leave immutable provider jobs untouched, and run reconciliation before re-enabling dispatch. A release-phase drill must prove this sequence and record the exact deployment IDs; this paragraph alone is not evidence.
