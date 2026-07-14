# Iteration 3.7 — Auth route-boundary continuity

Date: 2026-07-14
Branch: `ui/phase34-closure`
Repair commit: `d82a8f4`

## Reproduction

`node --import tsx --test tests/auth-route-boundaries.test.ts` initially failed because the auth route group had no explicit loading/error boundary. The earlier all-route boundary bundle could not be retained because it reopened RF-009.

## Repair

- Added auth-only loading and error boundaries.
- Both surfaces retain the approved light auth theme and a full-viewport Aivora continuity anchor.
- The loading state is announced as busy and respects reduced motion.
- The error state distinguishes a service failure and exposes an in-place retry.
- Renamed the ordinary Playwright helper `useMatrixSession` to `seedMatrixSession` so ESLint no longer misclassifies it as a React Hook; assertions and behavior are unchanged.

## Verification

- Auth boundary source regression: 1/1 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- Mandatory golden path: `gp-1784041162146-48d1317e`, 1/1 passed with the original zero-blank-frame assertion.
- Production/provider configuration: untouched.
- New dependencies: none.

This is the first isolated B-stage step after RF-020. It proves auth boundaries can be retained without reopening login continuity before any other route-group boundary is added.
