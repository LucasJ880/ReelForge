# Iteration 3.11 — RF-021 dynamic prefetch repair

Date: 2026-07-14  
Branch: `ui/phase34-closure`  
Repair commit: `c95c7b7`

## Root cause evidence

The attempt-2 Playwright trace showed that `/app/create` automatically prefetched authenticated dynamic destinations such as `/app/create/images` and `/app/library`. When the journey navigated or signed out, Next Router cancelled those speculative RSC requests; newly split client-boundary chunks were cancelled with them and surfaced as failed JavaScript requests. The visited workflow itself had 0 blank frames.

## Repair

- Disabled automatic prefetch only for authenticated Studio primary navigation and Studio home links.
- Retained normal click navigation; explicit loading surfaces now communicate the short dynamic fetch.
- Reintroduced only the `/app/create/images` loading/error boundary and its i18n/fallback identifier.
- Did not change the golden-path network assertion, ignore lists, retries, sleeps, or tolerances.

## Verification

- Focused prefetch + route-state regressions: 2/2 passed.
- Typecheck, lint, optimized production build: passed.
- Mandatory golden `gp-1784042195066-160312e7`: 1/1 passed, 0 blank frames, 0 failed browser requests.
- New dependencies: none.
