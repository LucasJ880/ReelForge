# Phase 3/4 · Iteration 3.1 — RF-012 customer route states

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Repair commit: `5286033`
- Provider mode: local Vercel Preview rehearsal, explicit mock/dry-run; no real provider call and no real budget.

## Reproduction

The initial source regression failed 4/4: the six customer loaders converted rejected operations to `[]`/`null`, none owned `loading.tsx`/`error.tsx`, the shared accessible state components did not exist, and batch detail erased service faults into 404.

Affected routes:

1. `/app/create`
2. `/app/batches`
3. `/app/batches/[id]`
4. `/app/racing`
5. `/app/library`
6. `/app/templates`

## Repair

- Removed every silent `.catch(() => [] | null)` from the six customer pages.
- Added route-owned streaming loading boundaries and retryable error boundaries for all six routes.
- Added explicit successful empty-state markers, distinct from service-failure states.
- Added bilingual, accessible error/loading copy without exposing raw exception messages.
- Added `BatchNotFoundError`; only that typed access/missing result maps to 404. Other failures remain 500/retryable and are logged server-side.
- Added a browser fault-injection seam that is enabled only when all four rehearsal predicates hold: `VERCEL_ENV=preview`, `FINAL_ACCEPTANCE_REQUIRE_REHEARSAL=true`, `AIVORA_DRY_RUN`, and `VIDEO_PROVIDER=mock`. Production or real-provider modes ignore the header.

## Reproducible verification

```text
node --import tsx --test tests/customer-route-states.test.ts
Result: 6 passed, 0 failed

npm run test:phase34:routes
Result: optimized build passed; Playwright 7 passed, 0 failed
Coverage: auth setup + six routes, each under slow / successful empty / service failure

npm run typecheck
Result: passed

focused ESLint + git diff --check
Result: passed

npm run test:golden-path
Run: gp-1784036981221-799edb49
Result: 1 passed, 0 failed in 14.4s; teardown exit 0
```

The browser matrix was rerun at the same six-route scale after correcting the batch-detail typed 404 behavior; the post-repair run remained 7/7.

## Golden-path evidence

- JSON: `qa/evidence/phase1/golden-path-gp-1784036981221-799edb49.json`
- Completed playback/download screenshot: `qa/screenshots/phase1/gp-1784036981221-799edb49/completed-video.png`

## Scope / ledger note

No dependency, provider, cron, deployment, or migration configuration changed. The pre-existing unstaged truncation of `qa/ITERATION_LOG.md` was not overwritten or staged; this iteration is recorded separately in `qa/ITERATION_LOG.phase34.md` pending human reconciliation of that file.
