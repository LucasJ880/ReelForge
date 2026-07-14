# Phase 2 · Iteration 2.4 — Historical quarantine closure

- Date: 2026-07-13 (America/Toronto)
- Defect: RF-007
- Commit: `961d660`
- Real provider calls: **0**

## Repair

The stuck-task sweeper now applies the dispatch-quarantine predicate both in its database selection and in the status compare-and-swap. It permits only explicitly `RELEASED` jobs or post-cutoff undecided jobs in real-provider mode and always excludes `EXPIRED`. A second runtime check prevents mutation even if a future query regression returns an ineligible row. `reconcileVideoJob` and `retryFailedVideoJob` also stop before provider access or state mutation for an undecided historical task.

## Verification

- Quarantine + sweeper + watchdog focused suite: **23/23 passed**.
- Real-mode fixture (`VIDEO_ENGINE_MOCK=false`, placeholder credential): provider calls `0`, DB writes `0` for reconcile and retry.
- Deliberately misbehaving sweeper query fixture: timeout mutations `0`.
- Explicit `RELEASED` and permanent `EXPIRED` behavior remains covered.
- Typecheck and focused lint: passed.
- Integrated optimized build and golden path: passed.
