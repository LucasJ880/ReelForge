# ReelForge Final Hardening Iteration Log

## H1 · Iteration 1 — API inventory drift

- Date: 2026-07-14
- Reproduction: `src/app/api/**/route.ts` contains 71 route files, while `qa/SHIP_AUDIT.md` and `qa/RELEASE_GATE.md` still claimed 70/70 and omitted `/api/cron/stitch-dispatch` from the detailed contract table.
- Work: corrected the inventory to 71/71, recorded both exported methods and the current PARTIAL contract depth, and added an executable route-to-audit coverage regression.
- Scope: audit/test only; no endpoint behavior, deployment configuration, migration, provider, or paid call changed.
- Human decisions loaded: Phase 4 visual approval; RF-010 v2 DEFERRED with no color changes; H1 authorized on independent `codex/final-hardening`.

## H1 · Iteration 2 — RF-020 commercial batch boundary

- Date: 2026-07-14
- Reproduction: `POST /api/batches` and both customer quantity controls rejected/clamped every value above 200, so the required 250-item commercial overload tier could not use the production customer path.
- Work: added one shared 250-video limit, extracted the API request schema into the contract layer, and wired the number/range controls to that shared value. Updated the existing acceptance boundary from 201 to 251 because 201–250 are now valid product requirements; no assertion, image cap, idempotency check, or invalid-input guarantee was removed.
- Verification: focused contract/UI tests 5/5, typecheck, optimized build, and golden run `gp-1784050224278-3e756d58` all pass.
- Scope: RF-020 only; no provider, storage, deployment, migration, or visual-theme change.
