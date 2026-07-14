# Iteration 3.19 — RF-025 batch loading progress

Date: 2026-07-14 (America/Toronto)

## Reproduction and root cause

J8 submits one item while Slow 3G is active, follows the batch detail navigation, restores normal network, and then delays the status endpoint by 30 seconds. The parent batches loading boundary can own the route transition before the nested detail boundary or monitor mounts. That surface offered generic skeletons but no batch-progress semantic within the 200ms feedback budget.

## Repair

- Added one localized `routeStates.batchProgress` label to the existing i18n source.
- Shared loading surfaces for `batches` and `batchDetail` render the existing accessible Progress component at zero until live data replaces the boundary.
- No polling period, endpoint delay, timeout, performance budget, or acceptance assertion changed.

## Verification

- `npx tsx --test tests/customer-route-states.test.ts`: 6/6 passed.
- Optimized production build passed.
- Focused Final Acceptance J8 desktop: setup + journey 2/2 passed under Slow 3G and the configured 30-second delayed status response, run `fa-1784046542905-9a7c8a52`.
- `npm run test:golden-path`: passed unchanged, run `gp-1784046710814-9748fc44`.

## Dependency impact

None. Bundle dependency impact: 0 bytes.
