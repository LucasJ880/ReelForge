# Iteration 3.18 — RF-024 upload hydration guard

Date: 2026-07-14 (America/Toronto)

## Reproduction

Final Acceptance J1 selected 20 files immediately after the server-rendered batch form became visible. The browser-side file assignment succeeded, but no upload request followed and the UI stayed at `0/50 已完成 0`.

Trace inspection showed the input event occurred before React attached the dropzone's change handler. The pre-hydration hidden input was therefore a customer-visible false interaction surface.

## Repair

- Added a hydration-safe external-store signal to the shared file dropzone.
- The actual file input is absent from server HTML and appears only after hydration.
- The trigger remains disabled and drag/drop handlers reject files until the component is hydrated and otherwise interactive.
- Added a source regression that locks the absence of a pre-hydration input and the shared interaction guard.

No acceptance assertion, timeout, threshold, provider setting, deployment setting, or test was removed or weakened.

## Verification

- `npx tsx --test tests/dropzone-hydration-guard.test.ts`: 1/1 passed.
- Focused optimized-build Final Acceptance J1: setup + desktop + mobile 3/3 passed, run `fa-1784046239486-2cfa942a`.
- `npm run test:golden-path`: passed unchanged, run `gp-1784046345375-9b204bf9`.

## Dependency impact

None. Bundle dependency impact: 0 bytes.
