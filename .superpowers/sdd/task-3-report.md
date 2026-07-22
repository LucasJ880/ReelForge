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
