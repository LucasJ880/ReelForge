# Phase 3/4 · Iteration 3.3 — RF-011 layout containment

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Repair commit: `3e7a6cc`
- Provider mode: local Preview/mock rehearsal; no real provider call or budget.

## Reproduction

The initial regression failed 3/3. Phase 0 evidence at 1440px showed six template category buttons extending as far as x=1942 and a round action ending at x=1498. Template cards opted out of grid-row stretching, so cards without verified sample media had unstable geometry.

## Repair

- Replace the horizontally clipped template category strip with an in-panel wrapping group.
- Stretch cards within each CSS grid row, keep the information section flexible, and pin metadata/actions to the bottom.
- Preserve the product rule that missing verified samples do not render a preview or a fake media placeholder.
- Switch shared page-header side-by-side layout from `sm` to `lg`; constrain the action column and allow round actions to wrap at full available width.

## Reproducible verification

```text
node --import tsx --test tests/layout-overflow-guards.test.ts
Result: 3 passed, 0 failed

npm run test:phase34:routes
Result: optimized build passed; Playwright 9 passed, 0 failed
Routes: six RF-012 state routes + /app/templates + seeded /internal/rounds/[id]
Widths: 1280 / 1440 / 1920
Assertions: document width <= viewport; viewport offenders = []; card row height delta <= 1px

npm run test:golden-path
Run: gp-1784038024462-f5dadb44
Result: 1 passed, 0 failed in 14.9s; transition samples=28, blankFrames=0
```

Evidence:

- Golden JSON: `qa/evidence/phase1/golden-path-gp-1784038024462-f5dadb44.json`
- Completed journey screenshot: `qa/screenshots/phase1/gp-1784038024462-f5dadb44/completed-video.png`

No dependency, provider, cron, deployment, migration, or theme-topology change was made.
