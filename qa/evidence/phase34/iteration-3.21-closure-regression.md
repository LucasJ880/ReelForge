# Iteration 3.21 — Phase 3/4 closure regression

Date: 2026-07-14 (America/Toronto)

Branch: `ui/phase34-closure`

## Outcome

The functional UI closure gate is green. Visual quality remains a human approval gate, and this branch has not been merged or deployed.

## Route and state acceptance

Command:

```text
npm run test:phase34:routes
```

Result:

- Optimized production build passed.
- Phase 3/4 Playwright suite passed 12/12 serially.
- The settled 33-route matrix completed 99 route-width scans across 1280, 1440, and 1920 pixels.
- Six customer route families passed distinct slow, successful-empty, and service-error states.
- Seeded owned records exercised the real batch detail, library detail, order, brief, and round routes.
- Final route screenshots: 33 PNG files in `qa/screenshots/redesign/phase34-current/`.

## Golden path invariant

Three consecutive independent runs on the final product code passed without assertion changes:

1. `gp-1784047276260-e8880c0c`
2. `gp-1784047304319-a978b9bb`
3. `gp-1784047333120-e0387432`

Each run rebuilt the optimized application and completed registration, natural login, creation, mock generation, terminal accounting, playback, and non-empty download.

## Final Acceptance

Command:

```text
npm run test:final-acceptance
```

Result: run `fa-1784047355157-099e9e8a` passed 23/23 serially in 7.3 minutes. Global teardown deleted 22 rehearsal batches and 4 product images, archived the run-scoped template, and exited 0.

The run includes desktop and mobile coverage for 100-item allocation/accounting, idempotency, retries, input/API boundaries, real upload, 50-image limits/cancellation, parallel batches, Slow 3G, onboarding, product images, watchdog/provider stalls, circuit-breaker recovery, and route smoke.

## Closed defects in the final regression

- RF-024: pre-hydration file-selection false interaction.
- RF-025: missing batch progress semantics during nested route loading.
- RF-026: global CJK webfont contention and aborted font requests on mobile navigation.

P1 OPEN is now zero. RF-019 remains P0 OPEN outside this UI branch, and RF-005 remains P0 FIXED pending production cadence evidence.

## Theme and dependency accounting

- Topology preserved: dark Studio `/app`; light public/auth/operations.
- Design-system source audit: 3/3 passed.
- No dependency added during Phase 3/4 closure; package bundle impact from new dependencies is 0 bytes.
- Downloadable font payload was reduced by replacing global Noto SC downloads with explicit platform CJK fallback stacks.

## Human gate and merge plan

Human visual review must inspect the current screenshots and approve the preserved topology. This evidence does not self-certify aesthetic quality.

After approval, merge the isolated UI branch without deployment-config, migration, cron, or provider changes. On the merged commit, rerun, in order:

1. `npx tsx --test tests/design-system-closure.test.ts tests/customer-route-states.test.ts tests/dropzone-hydration-guard.test.ts`
2. `npm run test:phase34:routes`
3. `npm run test:golden-path` three consecutive times
4. `npm run test:final-acceptance`

Any red result blocks release and reopens the associated defect loop. Production deployment and commercial certification remain separate human-controlled gates.
