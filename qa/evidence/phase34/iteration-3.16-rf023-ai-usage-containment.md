# Iteration 3.16 — RF-023 AI usage containment

Date: 2026-07-14

## Reproduction

Once RF-022 made the route matrix render settled internal content, `/internal/ai-usage` failed at 1280px. The model table and its terminal cells ended at x=1305 in a 1280px viewport.

## Root cause and repair

The two summary cards entered a two-column grid at `lg`, but each card contained a minimum-width table and the grid children retained their automatic minimum width. The repair defers the two-column layout to `2xl` and marks the grid and cards `min-w-0`. Existing accessible horizontal table regions remain intact.

## Verification

- Optimized production build: passed.
- 33-route × 3-width matrix: 99/99 scans passed; zero element/document overflow, console errors, page errors, or HTTP 5xx.
- Screenshot: `qa/screenshots/redesign/phase34-current/internal-ai-usage.png` shows settled content in one contained column at the evidence width.
- Mandatory golden path: `gp-1784044311511-576ad482`, 1/1 passed with unchanged network, blank-frame, terminal-accounting, playback, and download assertions.
- New dependencies: none.
