# Iteration 3.15 — RF-022 route evidence integrity

Date: 2026-07-14

## Reproduction

The existing 33-route matrix used a customer storage state and considered any document status below 400 successful. Adding a final-path assertion immediately reproduced the hidden behavior: the first internal target expected `/internal/orders` but ended at `/app/create`. Existing internal screenshots were therefore mislabeled Studio/loading views rather than evidence for the named route.

## Repair

- Sign an internal NextAuth token from a real rehearsal OPERATOR/SUPER_ADMIN account before the first internal scan.
- Assert the final pathname for every route. Only `/` and `/app` may follow their source-defined redirects to `/app/create`; `/internal` must settle at its source-defined `/internal/orders` redirect.
- Require `[data-route-state="loading"]` to leave the DOM before semantic, console, HTTP, overflow, and screenshot checks.
- Remove page listeners after each scan to avoid cross-route listener accumulation.

No assertion was relaxed and no production authentication path was modified.

## Verification

- Corrected matrix: 33 routes × 1280/1440/1920 = 99/99 scans passed.
- All current 1440 screenshots were regenerated from settled target pages.
- Spot checks: internal demo leads, AI usage, and video library show their actual route content; login remains light and Studio remains dark.
- Golden path after the resulting product defect repair: `gp-1784044311511-576ad482`, 1/1 passed.
- New dependencies: none.
