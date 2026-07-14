# ReelForge Final Hardening Iteration Log

## H1 · Iteration 1 — API inventory drift

- Date: 2026-07-14
- Reproduction: `src/app/api/**/route.ts` contains 71 route files, while `qa/SHIP_AUDIT.md` and `qa/RELEASE_GATE.md` still claimed 70/70 and omitted `/api/cron/stitch-dispatch` from the detailed contract table.
- Work: corrected the inventory to 71/71, recorded both exported methods and the current PARTIAL contract depth, and added an executable route-to-audit coverage regression.
- Scope: audit/test only; no endpoint behavior, deployment configuration, migration, provider, or paid call changed.
- Human decisions loaded: Phase 4 visual approval; RF-010 v2 DEFERRED with no color changes; H1 authorized on independent `codex/final-hardening`.

## H1 · Iteration 2 — RF-027 commercial batch boundary

- Date: 2026-07-14
- Reproduction: `POST /api/batches` and both customer quantity controls rejected/clamped every value above 200, so the required 250-item commercial overload tier could not use the production customer path.
- Work: added one shared 250-video limit, extracted the API request schema into the contract layer, and wired the number/range controls to that shared value. Updated the existing acceptance boundary from 201 to 251 because 201–250 are now valid product requirements; no assertion, image cap, idempotency check, or invalid-input guarantee was removed.
- Verification: focused contract/UI tests 5/5, typecheck, optimized build, and golden run `gp-1784050224278-3e756d58` all pass.
- Scope: RF-027 only; no provider, storage, deployment, migration, or visual-theme change.

## H1 · Iteration 3 — shared customer API error contract

- Date: 2026-07-14
- Reproduction: tier-one APIs used incompatible ad-hoc error bodies, beginning with shared guards that returned only `{ error }`; unknown code/action strings could drift without a closed schema.
- Work: established one enumerated, schema-validated customer error envelope and recovery-action set. Shared API authentication now returns stable `AUTH_REQUIRED/sign_in` and `FORBIDDEN/contact_support` contracts while preserving the existing customer-visible messages and HTTP statuses. The generation classifier re-exports the common helper for backwards-compatible imports.
- Verification: 16/16 envelope, generation, quota, and persona/role tests pass; typecheck, optimized build, and golden run `gp-1784050411194-0e37700e` pass.
- Scope: contract foundation for RF-028; no endpoint-specific error was marked complete, and RF-028 remains OPEN until all first-tier endpoint/consumer snapshots pass.

## H1 · Iteration 4 — RF-028 strict first-tier commercial contracts

- Date: 2026-07-14
- Reproduction: upload/blob, batch templates, batch create/status/cancel/retry, direct dispatch, health, and library used incompatible success/error shapes; clients could not reliably distinguish validation, missing asset, quota, provider, and service failures.
- Work: added strict allowlisted request/response DTOs and a closed recovery envelope; converted ownership/missing-resource failures to safe 404s; aligned customer recovery actions with server retry safety. Direct dispatch now persists/replays exact envelopes and fails closed when provider acknowledgement or idempotency ownership is ambiguous.
- Verification: first-tier contract suites, cross-consumer assertions, typecheck, lint, and optimized build pass. No production, provider, storage, or paid call was made.
- Repair commits: `132401a`, `f0bbdbc`, `b92e344`, `c8fd6bc`, `2c97542`

## H1 · Iteration 5 — RF-029/RF-030 unified library truth

- Date: 2026-07-14
- Reproduction: library detail searched only the newest 100 list rows, and fractional progress was rendered as a percentage without conversion.
- Work: detail now performs a direct owner-scoped lookup through the shared public DTO mapper; progress is converted exactly once to a clamped 0–100 integer for list and detail.
- Verification: `tests/unified-library-contract.test.ts` covers old owned rows, cross-owner denial, DTO parity, and progress conversion; the integrated H1 suite passes.
- Repair commit: `3961854`

## H1 · Iteration 6 — omitted stitch-dispatch contract

- Date: 2026-07-14
- Reproduction: route inventory had omitted `GET /api/cron/stitch-dispatch`; the executor existed but its heartbeat/error response schema was not contract-locked.
- Work: added strict success, disabled, auth, upstream, and unexpected-failure schemas aligned with the scheduler heartbeat service; kept machine authentication fail-closed.
- Verification: stitch-dispatch contract/service suites and machine endpoint authentication pass.
- Repair commit: `be0c7ea`

## H1 · Iteration 7 — second-tier light contract closure

- Date: 2026-07-14
- Work: covered the remaining API methods with lightweight success-shape wiring plus dynamic anonymous/role/ownership boundaries. Group A covers 24 methods, Group B 25 methods, and Group C 18 route entries; these are intentionally not claimed as strict hostile-input snapshots.
- Defect found and repaired: `GET /api/metrics/import` lacked its operator guard; both GET/POST now guard before CSV/JSON work (`073a86c`). Stripe's exact webhook path was incorrectly intercepted by session middleware before signature verification; only `/api/webhooks/stripe` is now public to the signed handler, while subpaths remain protected (`12253a5`).
- Verification: all three secondary groups, related middleware/machine/sealed/report tests, typecheck, lint, and optimized build pass. No external network or webhook/provider call was made.
- Repair commits: `e34bc55`, `073a86c`, `12253a5`

## H1 · Iteration 8 — RF-031 through RF-035 acceptance and billing safety

- Date: 2026-07-14
- Reproduction evidence: ordered Final Acceptance J4→J7 exposed leaked usage; direct/legacy dispatch could advertise unsafe paid retries; real-provider post-generation states were considered no-cost; zero-row quota/response CAS results were silently accepted.
- Work: made acceptance cleanup an automatic run-scoped fixture; used an explicit empty-storage API context for anonymous probes; tightened retry eligibility to positive no-bill evidence; mapped legacy ambiguity to support/reconciliation; required exact one-row CAS ownership.
- Failed evidence preserved: `fa-1784051887340-f5de6474` exposed locator ambiguity; `fa-1784051997045-83dc77ca` exposed quota leakage; `fa-1784053713921-996e9e3f` showed expected anonymous 401 responses polluting page-console accounting; `fa-1784054066547-b0b66ca3` proved the first API context still inherited storage. Each failure drove the minimum product/fixture correction; no quota, error, or console assertion was relaxed.
- Passing evidence: intermediate `fa-1784052408837-0b975d38` and final isolated run `fa-1784054148752-d1a8f9ab` pass 3/3.
- Repair commits: `b92e344`, `c8fd6bc`, `cb14d73`

## H1 · Iteration 9 — RF-036 sign-out prefetch race

- Date: 2026-07-14
- Reproduction: golden run `gp-1784055093318-ae9ed205` failed because a protected `/app/batches` prefetch followed the session-loss redirect and was aborted during sign-out.
- Work: disabled speculative prefetch on protected primary navigation only. Direct navigation remains unchanged; the golden zero-failed-request assertion remains strict.
- Verification: `tests/platform-shell-signout-prefetch.test.ts`, typecheck, lint, optimized build, and golden run `gp-1784055279098-5047b432` pass.
- Repair commit: `b04beb7`

## H1 closure note

- Temporary hardening IDs were reconciled with the UI branch ledger before closure: RF-020→RF-027, RF-021→RF-028, RF-022→RF-029, RF-023→RF-030, and RF-024→RF-031. No history or defect was discarded.
- H1 contract closure contains no production deployment, production database write, real provider invocation, paid VLM/video call, or visual-theme change. H2 remains gated on the RF-005 production heartbeat window and its required human-supervised deployment decisions.
