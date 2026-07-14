# Commercial Batch Certification — Gate C0

- Date: 2026-07-14 (America/Toronto)
- Product/test baseline: `440c91f`
- Gate verdict: **BLOCKED — 5/6 dependencies VERIFIED**
- Real provider calls / paid operations: **0**

## Dependency check

| Dependency | Ledger status | C0 result | Evidence / missing proof |
|---|---|---:|---|
| RF-002 | VERIFIED | PASS | Machine endpoints fail closed; focused auth suite + golden evidence are recorded in `qa/evidence/phase2/iteration-2.2-machine-auth.md`. |
| RF-003 | VERIFIED | PASS | Ambiguous acknowledgements cannot auto-resubmit or double-charge; evidence is recorded in `qa/evidence/phase2/iteration-2.3-provider-billing-safety.md`. |
| RF-004 | VERIFIED | PASS | Attempt-token CAS regressions plus serial Final Acceptance `fa-1784011167411-04cf5e45` (23/23, teardown exit 0) and post-fix golden `gp-1784011670688-32bda3f8` are green. |
| RF-005 | FIXED | **FAIL** | Minute scheduler code, focused tests, and the fail-closed heartbeat evaluator are green, but the exact release is not deployed and has no 60-minute production trace. |
| RF-006 | VERIFIED | PASS | The original serial Final Acceptance configuration passes 23/23 and global teardown exits 0 with run-scoped cleanup. |
| RF-007 | VERIFIED | PASS | Historical quarantine survives sweep/reconcile/retry with zero protected provider calls/DB mutations; evidence is recorded in `qa/evidence/phase2/iteration-2.4-historical-quarantine-closure.md`. |

## Reproducible check

Run from the repository root:

```bash
node qa/certification/check-gate-c0.mjs
```

Expected result at this revision: JSON reports `passed: false`, `verified: 5`, `required: 6`, and exits with status 1. The command becomes green only when all six ledger sections are explicitly `VERIFIED`.

## Work required before rechecking C0

1. Human: follow `qa/certification/PRODUCTION_DEPLOYMENT_CHECKLIST.md`, including the fresh production-head Neon branch rehearsal and RF-019 ordering bootstrap. A plain first `prisma migrate deploy` is unsafe while both RF-003 migrations are pending.
2. Human: deploy/promote the exact release while new submissions are paused and all provider-call eligibility preflight counts are zero.
3. Agent: after deployment, export at least 70 minutes of production logs and evaluate an exact 60-minute window with `qa/certification/collect-scheduler-heartbeats.mjs`.
4. RF-005 may become VERIFIED only if all three schedulers meet the recorded sample, coverage, gap, and outcome SLOs and the before/after provider-submission snapshot is unchanged.

RF-019 is a separate production deployment blocker discovered while preparing the requested checklist. It does not change the six-item C0 checker, but it must be resolved by the human migration rehearsal/bootstrap before RF-005 observation can begin.

No throughput model, 8/50/200/250 ladder, chaos test, QA drift test, or real-provider canary may start while this Gate is blocked.
