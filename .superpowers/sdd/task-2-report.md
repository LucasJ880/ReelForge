# Task 2 Report: Make Uploads Reliable and Server-Owned

## Status

Implemented the additive `MediaAsset` foundation, removed platform AI review from the two creation upload boundaries, returned server-owned asset IDs, migrated active consumers to the new response, and made active single-video and batch creation resolve owner-scoped IDs before side effects. Existing historical snapshots remain readable, while new creation inputs reject client-supplied media URLs.

## Implementation

- Added `MediaAsset` with explicit owner/workspace relations, unique storage keys, byte size, SHA-256, dimensions, and descending owner/workspace indexes.
- Added the expand-only `20260722190000_media_assets` migration. No historical migration was edited.
- Added `createOwnedMediaAsset(input)` and owner-scoped `resolveOwnedMediaAssets({ userId, assetIds })`.
  - Image metadata is inspected with Sharp.
  - SHA-256 and byte size are derived from the validated upload bytes.
  - Ownership lookup uses one `userId + id IN (...)` query, returns requested order (including duplicates), and uses a non-disclosing `Media asset not found` error for missing or foreign assets.
- Changed `/api/upload/blob` to persist the stored object as a `MediaAsset` and return HTTP 201 with `{ ok: true, asset: { id, url, mimeType, width, height } }`.
- Changed the product-image source upload to persist an owned asset and include its asset view in the successful job response.
- Removed `reviewMediaOrThrow`, provider-failure classification, and review-triggered delete/error branches from both creation upload endpoints.
- Preserved authentication, upload quota/rate limit, size limits, MIME allowlists, magic-byte checks, randomized storage keys, and storage cleanup when persistence fails before the asset record is durable.
- Kept generated product-image review and final stitched-video review unchanged.
- Kept the full URL-bearing `UploadedAsset` schema for historical plans, but introduced a strict ID-only attachment schema for new plan/dispatch requests.
- Made new batch requests accept only `assetIds`; the route resolves those IDs for the authenticated owner and derives the internal URL view before creating the batch.
- Added `resolveOwnedCreationRequest`, which derives URL, MIME type, dimensions, media type, and identity from the owned database record rather than trusting client metadata.
- Enforced ownership before quota checks, route/provider selection, plan building, batch persistence, and batch dispatch work.
- Migrated every active `/api/upload/blob` consumer to the nested `asset` DTO. Single-video and batch request bodies now carry server-issued IDs; URLs remain in client state only for previews/classification and in server-derived internal task snapshots.
- Updated the product-image Studio to require the source asset ID in a successful source-upload response.
- Persisted every newly generated product-image output as a durable owned `MediaAsset`, linked it through `ProductImageJob.outputAssetId`, and changed both advertised video/batch handoffs to use that real ID. Historical rows without an output asset no longer expose broken handoff links and instead show regeneration guidance.
- Rejected `brandKit.logoUrl` in new unified requests. Logos for new work must be owner-resolved attachments; the historical URL-bearing plan schema remains readable.
- Added image-only owner resolution for batch and sealed digital-human inputs, so audio/video assets cannot enter image-only pipelines and the dormant digital-human route is safe if later enabled.
- Owner-resolved an optional `deliveryOrderId` before route selection, plan construction, quota, or persistence. Customer lookups are scoped by `createdById`; the existing staff bypass is explicit and role-gated.
- Updated the upload success contract and the narrow existing source/DTO contract tests that encoded the retired review and URL-only behavior.
- Bumped the Prisma client generation marker so development hot reload does not reuse a client generated before `MediaAsset` existed.

## TDD Evidence

### RED

Command:

```bash
node --import tsx --test tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts
```

Result before production implementation: exit 1, 0 passed / 4 failed.

- Both ownership tests failed because `media-asset-service` did not exist.
- Upload behavior failed because `reviewMediaOrThrow` was still present in the creation upload route.
- The new asset-shaped success contract was not accepted by the existing URL/pathname response schema.

### GREEN

The same command after the initial implementation: exit 0, 4 passed / 0 failed.

Covered behaviors:

- Creation uploads have no platform review dependency.
- Both creation upload endpoints persist server-owned assets.
- Image bytes produce the expected SHA-256, byte size, width, and height.
- A user cannot resolve another user's asset.
- Owned asset resolution preserves requested order and duplicates.

### Ownership-boundary expansion RED

After review identified legacy consumer parsing and URL-bearing task inputs, focused tests were expanded before changing production code. The same command then exited 1 with 4 passed / 3 failed:

- active consumers still expected the former top-level upload URL;
- unified and batch contracts still accepted raw URL-bearing task input;
- plan/dispatch/batch routes did not yet prove owner resolution before side effects.

### Ownership-boundary expansion GREEN

After the consumer and task-boundary changes, the focused command passed 7/7. The additional coverage proves:

- active upload consumers read `response.asset.id`;
- new unified and batch contracts reject raw URL-shaped media input;
- missing/foreign assets use the same non-disclosing not-found path;
- owner resolution occurs before quota, provider selection, plan work, batch persistence, or batch dispatch;
- the product-image source flow requires an asset-bearing success response.

### Review-driven integration RED/GREEN

A second focused RED run covered product-image handoffs, raw brand logos, media-kind enforcement, and the dormant digital-human boundary. It exited 1 with 9 passed / 4 failed. The failures proved that:

- `brandKit.logoUrl` still accepted raw URLs;
- batch had no image-only resolver;
- digital-human discarded submitted IDs and retained URL input;
- product-image handoffs still synthesized IDs that could never resolve.

After implementation, the expanded focused set passed 21/21. Final review then identified two further active-path issues. New assertions failed 11 passed / 2 failed before production changes: a customer-controlled `deliveryOrderId` lacked owner resolution, and historical product-image jobs still exposed unusable handoff links. Both assertions passed after the narrow fixes, and the reviewer confirmed all prior P0/P1 findings closed.

## Verification

Final verification command:

```bash
DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:1/reelforge npx prisma validate \
  && npx prisma generate \
  && node --import tsx --test tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts tests/product-image-studio.test.ts tests/digital-human-sealed.test.ts \
  && npm run typecheck \
  && npm test
```

Results:

- Prisma validate: PASS (the placeholder URL supplies the required schema environment variable; validation does not connect).
- Prisma generate: PASS, Prisma Client 6.19.3.
- Focused media-asset and affected-boundary tests: PASS, 21/21.
- TypeScript: PASS, `tsc --noEmit`.
- Full unit suite: PASS, 972 passed / 0 failed / 1 skipped (973 total).
- `git diff --check`: PASS.

One earlier full-suite run exposed a stale static product-image success-shape regex (967 passed / 1 failed / 1 skipped). The regex was updated to the required asset-bearing response, its focused suite passed 4/4, and the fresh full suite above passed.

## Files Changed

- `prisma/schema.prisma`
- `prisma/migrations/20260722190000_media_assets/migration.sql`
- `src/lib/db.ts`
- `src/lib/services/media-asset-service.ts`
- `src/app/api/upload/blob/route.ts`
- `src/app/api/product-images/route.ts`
- `src/app/api/batches/route.ts`
- `src/app/api/digital-human/jobs/route.ts`
- `src/app/api/video-generation/plan/route.ts`
- `src/app/api/video-generation/dispatch/route.ts`
- `src/lib/contracts/upload-blob.ts`
- `src/lib/schemas/unified-input.ts`
- `src/lib/contracts/batch-request.ts`
- `src/lib/upload/blob-xhr.ts`
- `src/lib/services/product-image-service.ts`
- `src/types/video-generation.ts`
- `src/components/batch/batch-create-wizard.tsx`
- `src/components/digital-human/digital-human-wizard.tsx`
- `src/components/personal/glass-create-workflow.tsx`
- `src/components/personal/upload-assets.ts`
- `src/components/product-images/product-image-studio.tsx`
- `src/components/video-generation/attachment-uploader.tsx`
- `src/components/video-generation/streamlined-video-studio.tsx`
- `src/components/video-generation/unified-creative-input.tsx`
- `src/app/(internal)/internal/orders/new/new-order-form.tsx`
- `src/app/(internal)/internal/orders/[id]/asset-actions.tsx`
- `src/app/(platform)/app/create/page.tsx`
- `src/app/(platform)/app/batches/new/page.tsx`
- `src/app/(platform)/app/create/images/page.tsx`
- `tests/media-asset-upload.test.ts`
- `tests/media-asset-ownership.test.ts`
- `tests/content-review-phase4.test.ts`
- `tests/product-image-studio.test.ts`
- `tests/h1-upload-template-health-contract.test.ts`
- `tests/h1-secondary-contract-group-a.test.ts`
- `tests/batch-request-contract.test.ts`

## Self-Review

- Schema/migration are additive; historical migrations are unchanged.
- Storage key uniqueness and owner/workspace foreign keys match the Prisma schema.
- Generic upload returns the exact required asset view and HTTP 201.
- Storage cleanup occurs only before an owned asset is durable, avoiding a database row that points to a deliberately deleted object.
- Owner resolution cannot distinguish a foreign asset from a missing asset.
- New plan/dispatch attachments and batch input are strict ID-only DTOs; client URL fields fail validation.
- Plan, dispatch, and batch resolve all asset IDs against the authenticated owner before quota, provider, plan, persistence, or dispatch work.
- Batch and digital-human image inputs reject owned non-image media before quota or persistence.
- New product-image outputs are copied to controlled storage, hashed/inspected as `MediaAsset`, and linked to their job before the handoff is enabled.
- Raw new-request logo URLs are rejected; the logo path uses an owned attachment.
- Optional continuation orders are owner-scoped before any generation side effect; staff override remains explicit.
- Server-derived records replace client URL/MIME/dimension identity before the existing generation supervisor receives the request.
- Every active generic-upload consumer reads the nested asset response; the task-producing consumers submit only server-issued IDs.
- The upload endpoints no longer contain review-provider imports or branches.
- Existing review boundaries in `product-image-service` (generated output) and `stitch-service` remain wired and tested.
- Existing auth, quota/rate-limit, byte limit, MIME, magic-byte, and randomized-key checks remain before storage/persistence.
- The two pre-existing untracked `.bak` files were not read, modified, staged, or removed.

## Concerns / Follow-Ups

- No live database migration or browser/e2e upload was run in this task. Prisma schema validation, client generation, service behavior, route contract checks, typecheck, and the full unit suite were run locally.
- The product-image endpoint intentionally performs source upload and job creation atomically in one request. It returns the created source asset ID, while its existing job record continues to store the server-derived source URL for provider compatibility.
- Operator-only legacy order tooling retains its authorized URL compatibility paths; it was not broadened into the public customer creation contract.

## Review Fix Addendum — 2026-07-22

### Status

All Task 2 review findings are addressed. The public product-image path is now a durable Shuyu Image 2 workflow, generic uploads are route-boundary tested, asset replay is complete, and delivery-order authorization is based on the authenticated role rather than persona.

### Review Findings Addressed

- Replaced the public product-image service's direct OpenAI/provider generation calls with Shuyu catalog audit, submission, polling, and reconciliation.
- Persisted the provider request key before submission, the audited plan/model/resolution/point snapshot before the paid provider call, and the external task ID after acknowledgement. Unknown acknowledgements are not automatically resubmitted.
- Added bounded Shuyu output fetching: HTTPS-only URLs, explicit hostname allowlisting, no credentials or custom ports, redirects rejected, MIME and declared-size validation, streamed byte limits, timeouts, and body cancellation.
- Copied generated outputs into controlled storage, created owned `MediaAsset` rows, persisted ordered `ProductImageResult` relations, and removed uploaded output bytes when asset persistence fails.
- Made idempotent product-image replay reconstruct both the owned source asset and ordered output asset DTOs from durable database relations.
- Changed `deliveryOrderId` override authorization to the authenticated `OPERATOR` or `SUPER_ADMIN` role; persona cannot grant staff authority.
- Added injectable route-boundary tests that invoke the actual upload and product-image handlers with controlled dependencies, including validation order, cleanup, HTTP 201 behavior, no review-provider dependency, and replay behavior.

### TDD Evidence

RED command:

```text
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts tests/upload-route-boundary.test.ts
```

Initial result: 0/6 passed. Failures demonstrated the missing Shuyu provider module, direct legacy provider usage, the old split-mode UI, and the missing injectable upload route handler.

GREEN verification:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reelforge npx prisma validate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reelforge npx prisma generate
node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts tests/upload-route-boundary.test.ts tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts tests/product-image-studio.test.ts
npm run typecheck
npm test
```

Results: Prisma validate PASS; Prisma generate PASS; focused tests 29/29 PASS; TypeScript PASS; full suite 985 passed / 0 failed / 1 skipped (986 total). The first full-suite run found two stale legacy contract expectations; both were corrected and the complete verification chain was rerun successfully.

### Self-Review

- The Task 2 migration remains unchanged; Task 3 schema changes are isolated in the additive `20260722191000_shuyu_image_jobs` migration.
- Historical product-image rows are not falsely labelled as Shuyu because the provider column is nullable.
- Provider correlation identifiers are not exposed in public route DTOs.
- Owner resolution happens before quota or provider work, and foreign assets remain indistinguishable from missing assets.
- Durable assets are not deleted after their database records exist; cleanup only covers pre-durability failures.
- The two pre-existing untracked `.bak` files and `scratch` were left untouched.

### Concerns / Follow-Ups

- No live database migration or browser/e2e run was performed; Prisma validation/generation, focused behavior tests, typecheck, and the complete unit suite passed.
- Production must set `SHUYU_OUTPUT_HOST_ALLOWLIST` if Shuyu returns output URLs from CDN hosts beyond the narrow built-in allowlist.
- The full unit suite retains one pre-existing skipped test.
