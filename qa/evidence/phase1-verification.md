# Phase 1 Golden-Path Verification

- Date: 2026-07-13 (America/Toronto)
- Branch: `codex/final-sprint`
- Implementation commit: `e863c8e`
- Build mode: optimized `next build` + a new `next start` process for every run
- Database guard: `DATABASE_URL` must exactly equal `NEON_REHEARSAL_DATABASE_URL`
- Billing guard: `AIVORA_DRY_RUN=1`; video/LLM/image/review providers explicitly mocked; real provider and Blob credentials blank in the test server
- Evidence hygiene: per-run JSON excludes `webServer.env`; a repository scan found no live key, token, or database connection string in Phase 1 artifacts

## Red-to-green record

| Run | Result | Evidence | Conclusion |
|---|---:|---|---|
| `gp-1783999630656-6b7964cf` | red | `golden-path-gp-1783999630656-6b7964cf.json` | The completed video played, but the test queried a link while Base UI exposes the download action as a button. The DOM contract was corrected; download attribute/event/file assertions were retained. |
| `gp-1783999710428-8112bb64` | red | `golden-path-gp-1783999710428-8112bb64.json` | The entire journey, playback, and download passed. The remaining failure was 73 intentional Next.js RSC prefetch cancellations, all exactly `_rsc` + `net::ERR_ABORTED`. The network rule now classifies only that exact framework cancellation; every other request failure still blocks. |

No assertion, timeout, retry count, or product requirement was relaxed. No test was skipped or deleted.

## Independent green runs

| Independent process/run ID | Result | Duration | JSON | Screenshot |
|---|---:|---:|---|---|
| `gp-1783999754024-28aaedc6` | 1 passed, 0 unexpected | 12.46s | `golden-path-gp-1783999754024-28aaedc6.json` | `../../screenshots/phase1/gp-1783999754024-28aaedc6/completed-video.png` |
| `gp-1783999786341-1ddd5c8e` | 1 passed, 0 unexpected | 12.07s | `golden-path-gp-1783999786341-1ddd5c8e.json` | `../../screenshots/phase1/gp-1783999786341-1ddd5c8e/completed-video.png` |
| `gp-1783999816199-222daa9c` | 1 passed, 0 unexpected | 12.24s | `golden-path-gp-1783999816199-222daa9c.json` | `../../screenshots/phase1/gp-1783999816199-222daa9c/completed-video.png` |
| `gp-1784000280094-6d83e66f` | 1 passed, 0 unexpected | 12.41s | `golden-path-gp-1784000280094-6d83e66f.json` | `../../screenshots/phase1/gp-1784000280094-6d83e66f/completed-video.png` |

The first three consecutive passes satisfy the Phase 1 exit criterion. The fourth independent pass verifies the final env-free reporter configuration; its JSON was checked to contain no serialized `webServer.env` or secret/connection-string pattern.

Each run created a unique account, started a fresh server on port 3120, registered and signed in through the UI without a cookie bridge, previewed and dispatched a 15-second video, reconciled all provider jobs, completed the external-stitch callback with the run-scoped secret, loaded and played the final MP4, downloaded a non-empty `.mp4`, verified ownership and the starter workspace, then removed the run account/order/final-video records.

Post-run read-only cleanup check: `goldenPathAccountsRemaining=0`.

## Regression commands

- `npm run build` — pass.
- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm test` — 663 total; 662 pass; 0 fail; 1 pre-existing conditional DB integration skip (`RUN_DB_TESTS` not enabled).
- Focused Phase 1 regressions — 8 pass, 0 fail:
  - middleware HTTP/HTTPS signed-cookie contract;
  - deterministic Seedance mock fixture/no Blob write;
  - bilingual Blob download URL/action;
  - final-acceptance teardown side-effect-free import.

## Human gate

Phase 1 automated exit criteria are met. Theme topology was not changed: `/app` remains dark Studio and auth/public surfaces remain light. Human approval is still required before Phase 2.
