# Iteration 3.20 — RF-026 font network budget

Date: 2026-07-14 (America/Toronto)

## Reproduction and root cause

The first complete Final Acceptance run exposed three related mobile symptoms:

- P6 reported four aborted WOFF2 requests during onboarding navigation.
- J8 could not reach the template choice in 30 seconds under Slow 3G.
- J2 obtained only two status samples during its five-second continuous-sampling window.

The document root loaded Inter, Instrument Serif, Space Grotesk, JetBrains Mono, multi-weight Noto Sans SC, and Noto Serif SC on every route. Trace evidence linked navigation cancellation to the still-pending CJK font transfers. These requests competed with functional route and data requests under constrained bandwidth.

## Repair

- Preserved the four role-defining Latin `next/font` families.
- Removed global downloadable Noto Sans SC and Noto Serif SC families.
- Added explicit macOS, Windows, and Linux CJK sans/serif system fallbacks to the single token source.
- Updated the design-system regression to require both the retained `next/font` roles and the performance-safe CJK fallback stack.

The approved dark Studio/light public-auth-operations topology, font roles, component system, build chain, and all acceptance thresholds remain unchanged.

## Verification

- `npx tsx --test tests/design-system-closure.test.ts`: 3/3 passed.
- Optimized production build passed.
- Final Acceptance mobile P6: setup + journey 2/2, run `fa-1784046862464-cbce87da`.
- Final Acceptance mobile J8 under Slow 3G: setup + journey 2/2, run `fa-1784046907181-1ef340f2`.
- Final Acceptance mobile J2: setup + journey 2/2, run `fa-1784047003719-ac2aed1c`.
- `npm run test:golden-path`: passed unchanged, run `gp-1784047054103-01af2a53`.

## Dependency impact

No dependency was added. Downloaded font payload is reduced; package bundle impact is 0 bytes.
