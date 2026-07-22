# Task 3 Report — Durable Shuyu Image 2 Workflow

## Status

Complete. Product image creation now uses a durable, auditable Shuyu Image 2 workflow with owned source assets, asynchronous polling, controlled-storage outputs, idempotent replay, and a simplified single-workbench UI.

## Implementation

- Added the additive `20260722191000_shuyu_image_jobs` migration and Prisma models/fields for owned source assets, ordered output relations, provider correlation, audited plan snapshots, point accounting, polling state, and reconciliation metadata.
- Added a dedicated Shuyu image provider adapter that audits the live catalog before submission, selects the exact Image 2 plan, polls task status, and fetches output bytes through a bounded SSRF-resistant downloader.
- Rebuilt the product-image service around durable submission and reconciliation. It records the request key before submission, records the selected plan before the paid call, avoids ambiguous automatic resubmission, and copies successful outputs into controlled storage before completing a job.
- Added authenticated owner-scoped product-image creation and job polling routes. Public DTOs expose owned asset views while withholding provider correlation identifiers.
- Integrated pending product-image reconciliation with the existing polling cron.
- Reworked generic upload into an injectable route handler with strict auth, form, size, MIME, magic-byte, prefix, storage, quota, upload, and persistence ordering plus storage cleanup on persistence failure.
- Replaced the split product-image modes with one optional-reference workbench. References upload immediately and are submitted by asset ID; users choose prompt, aspect ratio, resolution, and result count, then receive an asynchronous 1–4 image grid with download, variation, edit, single-video, and batch-video actions.
- Updated product-image documentation and the API ship-audit inventory.

## TDD Evidence

RED command:

```text
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts tests/upload-route-boundary.test.ts
```

Initial result: 0/6 passed for the intended missing provider, legacy service dependency, old UI contract, and missing route factory boundaries.

The resulting suites cover:

- exact audited plan selection and persistence before provider submission;
- poll-state mapping and durable reconciliation;
- source preservation on submission failure;
- ordered owned-output persistence and cleanup on asset-write failure;
- HTTPS/host/redirect/content-type/content-length/stream-cap/timeout output-fetch controls;
- upload validation ordering, HTTP 201 response, no AI review call, storage cleanup, and idempotent asset replay;
- the simplified single-workbench UI contract.

## Verification

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reelforge npx prisma validate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reelforge npx prisma generate
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts tests/upload-route-boundary.test.ts tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts tests/product-image-studio.test.ts
npm run typecheck
npm test
```

- Prisma validate: PASS.
- Prisma generate: PASS, Prisma Client 6.19.3.
- Focused tests: PASS, 29/29.
- TypeScript: PASS, `tsc --noEmit`.
- Full unit suite: PASS, 985 passed / 0 failed / 1 skipped (986 total).
- `git diff --check`: PASS.

The first complete suite exposed two legacy static contract expectations for the former product-image implementation. Those expectations were updated to the new route/service contracts, and the full verification chain above passed on a fresh run.

## Self-Review

- Schema work is additive and does not modify historical migrations.
- Historical jobs keep a nullable provider rather than being misclassified.
- Source assets are owner-resolved before quota or provider work.
- Idempotency replay is backed by durable asset relations, including ordered outputs.
- Provider request keys and external task IDs remain server-only.
- Generated content is bounded before memory/storage use and cleanup only removes non-durable bytes.
- Staff-only delivery-order overrides use the authenticated role.
- The two existing untracked `.bak` files and `scratch` were not modified or staged.

## Concerns / Follow-Ups

- No live database migration or browser/e2e workflow was run in this task.
- Configure `SHUYU_OUTPUT_HOST_ALLOWLIST` in production when provider output hosts differ from the narrow built-in set.
- The full unit suite contains one pre-existing skip.

## Review Fix Addendum — 2026-07-22

### Status

All Task 3 lifecycle review findings are addressed. The aggregate image job now owns one durable `ProductImageProviderTask` per requested result, paid submission is fail-closed under acknowledgement loss, reconciliation is lease-exclusive, success requires the exact requested durable result count, and every durable result has a result-scoped continuation path.

### Implementation

- Added the expand-only `20260722191500_product_image_provider_tasks` migration without changing either committed migration. It creates provider-task submission, audit, retry, polling, and lease state; backfills historical tasks; links/backfills `ProductImageResult` from existing owned primary outputs; and leaves URL-only history readable.
- Persisted all 1–4 provider-task rows and unique stable request keys in the aggregate job create before any provider call. The Shuyu request body remains documented-only and contains no invented count field.
- Each provider task transitions through `NOT_STARTED → SUBMITTING → ACCEPTED`, `REJECTED`, or `ACK_UNKNOWN`. Transport/response/persistence uncertainty becomes `ACK_UNKNOWN` and is never automatically submitted again. A provider-confirmed no-job rejection can be explicitly retried with the same request key and persisted plan snapshot.
- Stale `SUBMITTING` rows become `ACK_UNKNOWN`, not ordinary retryable failures. Only untouched `NOT_STARTED` rows are recovered automatically.
- Added expiring per-task leases. A compare-and-swap claim permits one owner; poll updates, provider-terminal transitions, result insertion, and finalization all require that owner. Result insertion verifies the live lease in a transaction, and a losing writer removes its unreferenced `MediaAsset` plus stored object when safe.
- Mapped `failed`, `refund_error`, and `refunded` to terminal failure. Only `queued`, `processing`, and `refund_pending` remain nonterminal.
- Each task accepts only its first documented output and creates one ordinal result. The aggregate succeeds only when task count and durable result count both exactly equal `resultCount`.
- URL-only historical successes synthesize a read-only result DTO with regeneration guidance instead of showing a spinner or invalid continuation.
- Moved download, variation, edit, single-video, and batch-video controls onto each durable result. Handoffs carry `productImageResultId`; both destinations resolve that exact result and asset by authenticated owner, including outputs two through four.

### TDD Evidence

RED focused run: 15 passed / 4 failed. The failures demonstrated the incorrect `failed` mapping, missing provider-task/submission/lease schema, and job-scoped primary-output handoffs.

GREEN focused run:

```text
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts tests/product-image-studio.test.ts tests/upload-route-boundary.test.ts tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts
```

Result: 36 passed / 0 failed. Behavioral coverage includes every documented lifecycle status, durable task creation before paid calls, ACK_UNKNOWN no-resubmit, same-identity confirmed rejection retry, a concurrent single-winner lease claim, exact four-task/four-result completion, loser cleanup, URL-only history, and owner-scoped handoff for outputs two through four.

### Verification

Final verification covered Prisma schema validation and client generation, the focused suite above, `tsc --noEmit`, the complete `npm test` suite, and `git diff --check`. The complete suite passed 998 tests / 0 failed / 1 pre-existing skipped (999 total).

### Concerns / Follow-Ups

- No live database migration or paid Shuyu/browser e2e was run. Migration SQL, Prisma generation, lifecycle behavior, route/UI contracts, TypeScript, and the complete unit suite were verified locally.
- Production still must configure any additional Shuyu CDN output hosts through `SHUYU_OUTPUT_HOST_ALLOWLIST`.

## Final Reviewer Closure — 2026-07-22

### Findings and Fixes

- **Retry/finalization race:** aggregate reactivation and the task's `REJECTED → SUBMITTING` compare-and-swap now commit in one transaction before submission. Reconciliation cannot observe the aggregate as active while every task is still terminal.
- **Operational retry path:** added `POST /api/product-images/tasks/[taskId]/retry`, authenticated by owner. Failed-job DTOs expose only `REJECTED` task IDs; the workbench renders explicit per-result retry controls. Foreign, acknowledgement-unknown, and otherwise ineligible tasks return the same 404 boundary.
- **Exact replay:** confirmed retries use the persisted `sourceImageUrl` even when the `MediaAsset` relation was deleted via `onDelete: SetNull`, together with the original stable request key and audited plan snapshot.
- **Lease freshness:** all poll and terminal owner writes require `leaseExpiresAt > now`. The owner renews before output download/storage, and durable result creation plus task success finalization occur atomically under the live lease.
- **Concurrency cleanup:** unique task/ordinal constraints prevent duplicate durable results. A stale or losing worker deletes its unreferenced newly created asset and stored object.
- **API inventory:** updated the ship-audit inventory from 76 to 77 route files for the owner-scoped retry endpoint.

### Additional Behavioral Coverage

- The production retry function verifies aggregate/task writes share a transaction and the paid call starts only after that transaction commits.
- The public retry route verifies authenticated owner propagation and non-disclosing ineligible-task handling.
- Lease tests verify a single winner, denial before expiry, reclaim after expiry, stale-owner finalization rejection, no duplicate result insertion, and losing-copy cleanup.
- Replay verifies the immutable persisted source URL is sent after the live asset relation is absent.

### Final Verification

Prisma validation and client generation passed. The focused lifecycle/route/asset/UI suite passed 42/42, TypeScript passed, the full unit suite passed 998/998 with one pre-existing skip (999 total), and `git diff --check` passed.

## Final Lifecycle Recovery Closure — 2026-07-22

### Findings Addressed

- Removed the creation-time `QUEUED → PROCESSING` crash window: a job and all provider-task rows are now created in one transaction with the parent already `PROCESSING`. Idempotent replay promotes legacy `QUEUED` rows, and cron also promotes recoverable legacy rows before submission scanning.
- Added aggregate recovery scanning for active parents whose child tasks are already terminal. It self-heals both the successful-result and failed-task interruption windows, including legacy parents still marked `QUEUED`; aggregate completion remains CAS-protected so usage is not double-recorded.
- Changed transient polling exceptions from a three-strike terminal failure to durable exponential backoff on the already-accepted external task. `ACK_UNKNOWN` remains non-retryable and is never blindly resubmitted.
- Added owner-only retry for provider-confirmed `failed`/`refunded` terminal tasks. The retry retains prompt/source/plan snapshots, clears the confirmed-terminal external identity, and uses a fresh request key before a new paid submission. Confirmed preflight rejection still reuses its stable request key.
- Made retry eligibility aggregate-aware: any fatal sibling, including `ACK_UNKNOWN` or another non-recoverable failed state, suppresses retry in both the server transaction predicate and the API/page DTO.
- Isolated cron image polling failures from video polling and sweep execution, returning a degraded heartbeat instead of aborting the whole scheduler run.
- Strengthened result handoff ownership to verify the related output asset owner as well as the parent job owner.
- No schema expansion was needed: the existing additive lifecycle migration already provides `availableAt`, leases, task status, immutable snapshots, and unique request/result identities. Historical migrations were not edited.

### TDD Evidence

Initial RED command:

```text
node --import tsx --test tests/product-image-recovery.test.ts
```

Result before implementation: 0 passed / 6 failed. The failures independently demonstrated the unrecovered `QUEUED` replay, missing aggregate scanner, third-poll terminal failure, mixed-failure retry leak, missing cron isolation boundary, and absent result-asset owner predicate.

GREEN affected-suite command:

```text
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/upload-route-boundary.test.ts tests/product-image-studio.test.ts tests/product-image-recovery.test.ts
```

Result: 36 passed / 0 failed. The new recovery file contains 7 behavioral tests, including explicit provider-refund owner retry with a fresh paid identity.

### Verification

```text
DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:1/reelforge npx prisma validate
DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:1/reelforge npx prisma generate
npm run typecheck
npm test
git diff --check
```

- Prisma schema validation: PASS.
- Prisma Client generation: PASS (6.19.3).
- TypeScript: PASS (`tsc --noEmit`).
- Complete unit suite: PASS, 1005 passed / 0 failed / 1 skipped (1006 total).
- Diff whitespace validation: PASS.

### Remaining Risk

- No paid Shuyu request, live database migration, or browser E2E was run in this review closure. The lifecycle behavior is covered with provider/database boundary fakes plus the complete repository test suite.
- Repeated provider polling outages now remain safely recoverable and use a capped 15-minute backoff; operational monitoring should still alert on sustained high `pollErrors` rather than relying on terminal job failure.

## Immutable Attempt Ledger Closure — 2026-07-22

### Reviewer Finding Addressed

- Accepted-task retries no longer erase the earlier billable request identity. The expand-only `20260722192500_product_image_provider_attempts` migration adds `ProductImageProviderAttempt`, backfills every currently observable task correlation, and preserves each future request key, external task ID, audited plan/model/resolution/points snapshot, submission state, provider status, polling state, error, and timestamp as a distinct attempt.
- A provider task remains the current ordinal summary and keeps its one-to-one result relation. Submission, acknowledgement, polling, terminal failure, successful output finalization, and stale-submission quarantine update the current immutable attempt and task summary atomically.
- Accepted-acknowledgement persistence and stale-submission quarantine both treat a task-summary CAS miss as a transaction abort. A dedicated regression test proves an attempt-only quarantine state cannot commit after a concurrent task transition.
- Only a provider-confirmed `refunded` terminal state can create a fresh paid request identity. Ordinary `failed` and `refund_error` states are fail-closed for billing reconciliation; confirmed pre-provider rejection remains safe to retry under the same idempotency key; `ACK_UNKNOWN` remains non-retryable.
- Retry behavior tests distinguish `failed`, `refunded`, and `refund_error`, and assert that the original request key/external task ID remain unchanged after a refunded retry creates a second attempt.

### Fresh Verification

- Prisma validate/generate: PASS (Prisma Client 6.19.3).
- Focused image/upload/UI/recovery suite: 34 passed / 0 failed.
- TypeScript: PASS.
- Complete unit suite: 1008 passed / 0 failed / 1 skipped (1009 total).
- `git diff --check`: PASS.

No paid Shuyu request, live migration, or browser E2E was run at this stage; those remain final-delivery checks where safe and available.
