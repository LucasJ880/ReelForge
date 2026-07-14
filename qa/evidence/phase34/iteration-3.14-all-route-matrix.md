# Iteration 3.14 — 33-route desktop matrix

Date: 2026-07-14
Test commit: `8b90b51`

## Coverage

- Exactly 33 page routes from `qa/SHIP_AUDIT.md`.
- Widths: 1280, 1440, 1920 (99 document scans).
- Dynamic fixtures: a real owned BatchJob for `/app/batches/[id]`, a real owned ready FinalVideo for `/app/library/[id]`, and connected delivery order/round/brief records for internal detail routes.
- Per scan: document status < 400, no rendered error state, console error 0, page error 0, HTTP 5xx 0, document/element overflow 0, unnamed enabled buttons 0, empty/hash-only links 0.
- 1440 evidence: 33 full-page screenshots in `qa/screenshots/redesign/phase34-current/`.

## Regression

- Complete Phase 3/4 browser suite: 12/12 passed serially, including the six customer slow/empty/500 matrices, RF-008 role/persona authority, RF-011 layout containment, and the 33-route matrix.
- Typecheck/lint/optimized build: passed.
- Mandatory golden path: `gp-1784043093070-c9c5be09`, 1/1 passed unchanged.
- Real providers/deployment configuration: untouched.
- New dependencies: none.

Form double-submit and mutation-refresh behavior are exercised by the golden/final-acceptance journeys rather than by destructive clicks in this read-only route matrix. Final closure still requires the serial Final Acceptance 23/23 gate.

## Correction after RF-022

The initial 12/12 result did not validate internal route identity: the customer storage state redirected internal targets to `/app/create`, and the test neither asserted final pathname nor waited for route loading boundaries to settle. The original result remains recorded as historical evidence but is superseded by RF-022. See `qa/evidence/phase34/iteration-3.15-rf022-route-evidence-integrity.md` for the corrected internal session, exact-path assertions, settled screenshots, and the replacement 99/99 run.
