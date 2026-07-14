# Iteration 3.8 — Public and internal route-group states

Date: 2026-07-14
Branch: `ui/phase34-closure`
Repair commit: `57350d1`

## Reproduction

The focused route-boundary regression failed 2/2 because the public and internal route groups had no explicit loading or error boundaries.

## Repair

- Added shared, token-based loading and retryable service-error surfaces.
- Wired them to the public and internal route groups only.
- Kept both route groups on their approved existing light surfaces; no dark Studio token or auth theme class was introduced.
- Added Chinese and English area labels through the existing platform copy layer.

## Verification

- Focused source regressions: 2/2 passed.
- Typecheck, lint, optimized production build: passed.
- Mandatory golden path: `gp-1784041415031-34e2254f`, 1/1 passed with the unchanged continuity assertion.
- Production/provider/deployment configuration: untouched.
- New dependencies: none.
