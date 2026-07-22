# Shuyu Creation Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver separate Shuyu-only AI Image, single-video, and batch-video workflows with durable Image 2 storyboards, optional workspace branding, bounded video details, and realistic regression coverage.

**Architecture:** Extend existing durable `ProductImageJob`, `VideoBrief`, `BatchJob`, and `VideoJob` foundations rather than replacing the queue. Add an audited Shuyu catalog, server-owned uploaded assets, durable storyboard records, versioned workspace brand packages, and shared workflow/player components. Customer APIs never select a direct model provider and every visible stage is reconstructed from persisted server state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6/PostgreSQL, Zod, Tailwind CSS 4, Node test runner with TSX, Playwright 1.61, Vercel Blob, Sharp, FFmpeg-based packaging.

## Global Constraints

- All generative model calls in public image and video workflows go through Shuyu.
- Uploads keep authentication, size, MIME, magic-byte, quota, ownership, and bounded-fetch checks, but never call platform-side AI content review.
- AI Image and AI Video remain separate routes and task types.
- A 15-second video uses 3–5 storyboard frames; default to 4.
- Single video pauses for storyboard approval; batch video auto-approves before provider dispatch.
- Brand packaging is optional and `false` must always expose the clean video.
- Preserve current Studio design tokens and accessible primitives.
- Never touch the pre-existing `.bak` files or unrelated untracked plans.

---

## File Structure

### Provider and routing

- Create `src/lib/providers/shuyu-catalog.ts`: parse and audit live Shuyu plan data.
- Create `src/lib/providers/shuyu-image-provider.ts`: durable Image 2 submit/poll adapter.
- Modify `src/lib/providers/shuyu.ts`: reuse request primitives without silently selecting non-Image-2 plans.
- Modify `src/lib/video-generation/video-route-selection.ts`: Shuyu customer default and direct-route rejection.
- Modify `src/app/api/video-generation/routes/route.ts` and `src/lib/contracts/video-route-options.ts`: customer-visible Shuyu-only contract.

### Persistence and services

- Modify `prisma/schema.prisma`: add `MediaAsset`, `StoryboardRun`, `StoryboardFrame`, `WorkspaceBrandPackage`, and required snapshots/relations.
- Create `prisma/migrations/20260722190000_media_assets/migration.sql`: owned upload records.
- Create `prisma/migrations/20260722191000_shuyu_image_jobs/migration.sql`: durable image provider snapshots.
- Create `prisma/migrations/20260722192000_storyboards/migration.sql`: storyboard runs and frames.
- Create `prisma/migrations/20260722193000_workspace_brand_packages/migration.sql`: versioned workspace brand packages.
- Create `src/lib/services/media-asset-service.ts`: owned asset creation and resolution.
- Create `src/lib/video-generation/storyboard-service.ts`: durable storyboard generation, retry, approval, and provider handoff.
- Create `src/lib/services/workspace-brand-package-service.ts`: versioned package lookup and immutable snapshots.
- Modify image, single-video, and batch services to consume those interfaces.

### APIs and UI

- Modify `src/app/api/upload/blob/route.ts` and `src/app/api/product-images/route.ts`.
- Create `src/app/api/video-generation/storyboards/[id]/approve/route.ts`.
- Create `src/app/api/video-generation/storyboards/[id]/frames/[frameId]/regenerate/route.ts`.
- Create `src/components/media/media-asset-uploader.tsx`.
- Create `src/components/video-generation/workflow-stage-rail.tsx`.
- Create `src/components/video-generation/storyboard-panel.tsx`.
- Create `src/components/video-generation/brand-package-control.tsx`.
- Create `src/components/video/video-player-frame.tsx`.
- Create `src/components/batch/batch-job-inspector.tsx`.
- Modify the existing AI Image, single-video, batch-create, and batch-monitor components.

---

### Task 1: Audit Shuyu Plans and Enforce Shuyu-Only Routing

**Files:**
- Create: `src/lib/providers/shuyu-catalog.ts`
- Modify: `src/lib/providers/shuyu.ts`
- Modify: `src/lib/video-generation/video-route-selection.ts`
- Modify: `src/lib/contracts/video-route-options.ts`
- Modify: `src/app/api/video-generation/routes/route.ts`
- Test: `tests/shuyu-catalog.test.ts`
- Test: `tests/video-route-selection.test.ts`

**Interfaces:**
- Produces: `parseShuyuCatalog(input: unknown): ShuyuCatalog`
- Produces: `selectAuditedImage2Plan(catalog, resolution): AuditedShuyuImagePlan`
- Produces: `selectCustomerVideoRouteSnapshot(input): VideoRouteSnapshot`, always resolving to `buddy` outside mock mode.

- [ ] **Step 1: Write failing catalog tests**

```ts
test("selects only GPT Image 2 plans at the requested resolution", () => {
  const catalog = parseShuyuCatalog(priceFixture);
  assert.equal(selectAuditedImage2Plan(catalog, "2K").planId, "image-plan-02");
});

test("fails closed when Image 2 is absent", () => {
  assert.throws(
    () => selectAuditedImage2Plan(parseShuyuCatalog(geminiOnlyFixture), "1K"),
    /Image 2.*unavailable/i,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --import tsx --test tests/shuyu-catalog.test.ts tests/video-route-selection.test.ts`

Expected: FAIL because the catalog functions and Shuyu-only default do not exist.

- [ ] **Step 3: Implement the audited catalog**

```ts
export type ShuyuResolution = "1K" | "2K" | "4K";
export interface AuditedShuyuImagePlan {
  planId: string;
  model: string;
  resolution: ShuyuResolution;
  points: number;
  family: "gpt-image-2";
}

export function selectAuditedImage2Plan(
  catalog: ShuyuCatalog,
  resolution: ShuyuResolution,
): AuditedShuyuImagePlan {
  const plan = catalog.imagePlans.find(
    (candidate) => candidate.family === "gpt-image-2" && candidate.resolution === resolution,
  );
  if (!plan) throw new ShuyuPlanUnavailableError(`Image 2 ${resolution} is unavailable`);
  return plan;
}
```

Remove dynamic Gemini/Nano Banana fallback from strict Image 2 calls. Make customer route options return Shuyu only; retain mock in test mode and historical registry readers.

- [ ] **Step 4: Run focused tests and type checking**

Run: `node --import tsx --test tests/shuyu-catalog.test.ts tests/video-route-selection.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/shuyu-catalog.ts src/lib/providers/shuyu.ts src/lib/video-generation/video-route-selection.ts src/lib/contracts/video-route-options.ts src/app/api/video-generation/routes/route.ts tests/shuyu-catalog.test.ts tests/video-route-selection.test.ts
git commit -m "feat: enforce audited Shuyu creation routes"
```

### Task 2: Make Uploads Reliable and Server-Owned

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722190000_media_assets/migration.sql`
- Create: `src/lib/services/media-asset-service.ts`
- Modify: `src/app/api/upload/blob/route.ts`
- Modify: `src/app/api/product-images/route.ts`
- Modify: `src/lib/schemas/unified-input.ts`
- Modify: `src/lib/contracts/batch-request.ts`
- Test: `tests/media-asset-upload.test.ts`
- Test: `tests/media-asset-ownership.test.ts`

**Interfaces:**
- Produces: `createOwnedMediaAsset(input): Promise<MediaAssetRecord>`
- Produces: `resolveOwnedMediaAssets({ userId, assetIds }): Promise<MediaAssetRecord[]>`
- API response: `{ ok: true, asset: { id, url, mimeType, width, height } }`

- [ ] **Step 1: Write failing upload and ownership tests**

```ts
test("upload succeeds without invoking AI review", async () => {
  const response = await uploadImageFixture({ reviewProvider: throwingReviewProvider });
  assert.equal(response.status, 201);
  assert.equal(throwingReviewProvider.calls, 0);
  assert.ok((await response.json()).asset.id);
});

test("task input cannot resolve another user's asset", async () => {
  await assert.rejects(
    resolveOwnedMediaAssets({ userId: "user-b", assetIds: [ownedByUserA.id] }),
    /not found/i,
  );
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts`

Expected: FAIL because upload invokes review and returns only a URL.

- [ ] **Step 3: Add the additive schema**

```prisma
model MediaAsset {
  id         String   @id @default(cuid())
  userId     String
  workspaceId String?
  storageKey String   @unique
  url        String
  mimeType   String
  byteSize   Int
  sha256     String
  width      Int?
  height     Int?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId, createdAt(sort: Desc)])
  @@index([workspaceId, createdAt(sort: Desc)])
}
```

Include explicit user/workspace relations matching existing `AdminUser` and `Workspace` relation names. Generate a migration; do not modify historical migrations.

- [ ] **Step 4: Implement reliable upload behavior**

After existing auth, quota, size, MIME, and magic-byte validation, store the blob, inspect image dimensions, hash the bytes, create `MediaAsset`, and return its ID. Remove `reviewMediaOrThrow` and the review-triggered delete branch from both creation upload endpoints. Creation schemas accept asset IDs; URL compatibility is read-only for historical tasks.

- [ ] **Step 5: Run Prisma generation, focused tests, and type checking**

Run: `npx prisma generate && node --import tsx --test tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/services/media-asset-service.ts src/app/api/upload/blob/route.ts src/app/api/product-images/route.ts src/lib/schemas/unified-input.ts src/lib/contracts/batch-request.ts tests/media-asset-upload.test.ts tests/media-asset-ownership.test.ts
git commit -m "feat: persist reliable creation uploads"
```

### Task 3: Move AI Image Generation to Durable Shuyu Image 2 Tasks

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722191000_shuyu_image_jobs/migration.sql`
- Create: `src/lib/providers/shuyu-image-provider.ts`
- Modify: `src/lib/services/product-image-service.ts`
- Modify: `src/app/api/product-images/route.ts`
- Modify: `src/components/product-images/product-image-studio.tsx`
- Test: `tests/shuyu-product-image-service.test.ts`
- Test: `tests/product-image-ui-contract.test.ts`

**Interfaces:**
- Produces: `submitShuyuImageTask(input): Promise<{ requestKey, externalTaskId, planSnapshot }>`
- Produces: `pollShuyuImageTask(externalTaskId): Promise<ShuyuImageTaskResult>`
- Product image API consumes optional `sourceAssetId`, prompt, resolution, aspect ratio, and result count.

- [ ] **Step 1: Write failing provider/service tests**

```ts
test("persists the audited Shuyu plan and external task id", async () => {
  const job = await createProductImageJob(validRequest);
  assert.equal(job.provider, "shuyu");
  assert.equal(job.planId, "image-plan-01");
  assert.equal(job.externalTaskId, "task-image-1");
});

test("keeps the source asset when Shuyu fails", async () => {
  const job = await runFailingImageJob();
  assert.equal(job.status, "FAILED");
  assert.equal(job.sourceAssetId, sourceAsset.id);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts`

Expected: FAIL because product images still call the generic direct provider.

- [ ] **Step 3: Extend `ProductImageJob` and implement async Shuyu calls**

Add provider request key, external task ID, plan/model/resolution/points snapshots, source asset relation, and retry fields. Submit through the audited catalog and poll through the existing cron-safe service pattern. Never call `generateImages` or `editImages` from the public product-image flow.

- [ ] **Step 4: Simplify the image UI**

Replace the `GENERATE`/`OPTIMIZE` first-choice split with optional reference upload plus one prompt. Expose compact resolution, aspect ratio, and count controls; move style presets under `<details>`. Render 1–4 results with download, variation, edit, single-video, and batch-video actions.

- [ ] **Step 5: Run focused tests and type checking**

Run: `node --import tsx --test tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/providers/shuyu-image-provider.ts src/lib/services/product-image-service.ts src/app/api/product-images/route.ts src/components/product-images/product-image-studio.tsx tests/shuyu-product-image-service.test.ts tests/product-image-ui-contract.test.ts
git commit -m "feat: add Shuyu Image 2 creation workflow"
```

### Task 4: Add Durable Storyboard Runs and Approval APIs

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722192000_storyboards/migration.sql`
- Modify: `src/lib/video-generation/storyboard-lock.ts`
- Create: `src/lib/video-generation/storyboard-service.ts`
- Create: `src/app/api/video-generation/storyboards/[id]/approve/route.ts`
- Create: `src/app/api/video-generation/storyboards/[id]/frames/[frameId]/regenerate/route.ts`
- Modify: `src/app/api/video-generation/dispatch/route.ts`
- Modify: `src/lib/services/video-service.ts`
- Test: `tests/storyboard-service.test.ts`
- Test: `tests/storyboard-api.test.ts`

**Interfaces:**
- Produces: `createStoryboardRun(input): Promise<StoryboardRunView>`
- Produces: `regenerateStoryboardFrame({ userId, runId, frameId }): Promise<StoryboardFrameView>`
- Produces: `approveStoryboard({ userId, runId }): Promise<StoryboardRunView>`
- Produces: `getStoryboardVideoReferences(runId): Promise<string[]>`

- [ ] **Step 1: Write failing storyboard state tests**

```ts
test("a 15 second single video creates four ordered frames and waits", async () => {
  const run = await createStoryboardRun(singleVideoInput);
  assert.equal(run.frames.length, 4);
  assert.deepEqual(run.frames.map((frame) => frame.ordinal), [0, 1, 2, 3]);
  assert.equal(run.status, "AWAITING_APPROVAL");
});

test("regeneration invalidates approval and preserves other frames", async () => {
  const before = await approvedRun();
  const after = await regenerateStoryboardFrame({ userId, runId: before.id, frameId: before.frames[1].id });
  assert.equal(after.runStatus, "GENERATING");
  assert.equal(after.unchangedFrameCount, 3);
});

test("parses shuyu_image2 artifacts", () => {
  assert.equal(parseStoryboardArtifact(shuyuImage2Artifact).source, "shuyu_image2");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/storyboard-service.test.ts tests/storyboard-api.test.ts`

Expected: FAIL because storyboard records and approval APIs do not exist and parser rejects `shuyu_image2`.

- [ ] **Step 3: Add schema and service**

```prisma
model StoryboardRun {
  id             String   @id @default(cuid())
  videoBriefId   String?
  videoJobId     String?
  approvalPolicy String
  status         String
  approvedAt     DateTime?
  approvedBy     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  frames         StoryboardFrame[]
}

model StoryboardFrame {
  id             String   @id @default(cuid())
  storyboardRunId String
  ordinal        Int
  prompt         String
  status         String
  outputUrl      String?
  providerRequestKey String? @unique
  externalTaskId String?
  planSnapshot   Json?
  attempt        Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([storyboardRunId, ordinal, attempt])
}
```

Use enums and explicit relations in the actual Prisma schema. Generate four frames for 15 seconds. Submit through `shuyu-image-provider`, persist each transition, and use transactions for approval/regeneration.

- [ ] **Step 4: Gate video dispatch on approved storyboard references**

Single-video dispatch first creates or returns a storyboard run. Provider video submission occurs only after approval and receives the selected ordered frame URLs. Retry recovers by stable request key.

- [ ] **Step 5: Run focused tests, Prisma validation, and type checking**

Run: `npx prisma validate && npx prisma generate && node --import tsx --test tests/storyboard-service.test.ts tests/storyboard-api.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/video-generation/storyboard-lock.ts src/lib/video-generation/storyboard-service.ts src/app/api/video-generation/storyboards src/app/api/video-generation/dispatch/route.ts src/lib/services/video-service.ts tests/storyboard-service.test.ts tests/storyboard-api.test.ts
git commit -m "feat: persist and approve video storyboards"
```

### Task 5: Show the Real Single-Video Workflow

**Files:**
- Create: `src/components/media/media-asset-uploader.tsx`
- Create: `src/components/video-generation/workflow-stage-rail.tsx`
- Create: `src/components/video-generation/storyboard-panel.tsx`
- Modify: `src/components/video-generation/streamlined-video-studio.tsx`
- Modify: `src/components/video-generation/plan-preview-card.tsx`
- Modify: `src/i18n/platform-copy.ts`
- Test: `tests/single-video-storyboard-ui.test.ts`
- Test: `tests/e2e/single-video-storyboard.spec.ts`

**Interfaces:**
- `MediaAssetUploader.onUploaded(asset: MediaAssetView): void`
- `StoryboardPanel.run: StoryboardRunView`
- `StoryboardPanel.onApprove(): Promise<void>`
- `StoryboardPanel.onRegenerate(frameId: string): Promise<void>`

- [ ] **Step 1: Write failing component contract tests**

```ts
test("single video exposes the five durable stages", () => {
  for (const label of ["Product images", "Image 2 storyboard", "Shuyu video", "Brand package", "Ready"]) {
    assert.match(source, new RegExp(label));
  }
});

test("provider route selection is absent from customer creation", () => {
  assert.doesNotMatch(source, /VideoRouteSelector/);
});
```

- [ ] **Step 2: Verify contract tests fail**

Run: `node --import tsx --test tests/single-video-storyboard-ui.test.ts`

Expected: FAIL because the stage rail and visual storyboard are absent.

- [ ] **Step 3: Build shared stage and storyboard components**

Render real server statuses, four responsive frame cards, partial errors, per-frame regeneration, and an approval CTA. Use current `Card`, `Button`, `Dialog`, semantic colors, and reduced-motion conventions. Do not introduce emoji or placeholder art.

- [ ] **Step 4: Rewire the single studio**

Use media asset IDs, remove customer route selection, submit storyboard creation first, poll persisted state, and unlock video generation only after approval. Replace the text-only scene list with the real storyboard panel while retaining useful prompt/quality summaries.

- [ ] **Step 5: Run unit test and browser journey**

Run: `node --import tsx --test tests/single-video-storyboard-ui.test.ts && npx playwright test tests/e2e/single-video-storyboard.spec.ts --project=desktop`

Expected: PASS; the mocked journey uploads, regenerates one frame, approves, and reaches video generation.

- [ ] **Step 6: Commit**

```bash
git add src/components/media/media-asset-uploader.tsx src/components/video-generation/workflow-stage-rail.tsx src/components/video-generation/storyboard-panel.tsx src/components/video-generation/streamlined-video-studio.tsx src/components/video-generation/plan-preview-card.tsx src/i18n/platform-copy.ts tests/single-video-storyboard-ui.test.ts tests/e2e/single-video-storyboard.spec.ts
git commit -m "feat: expose the single video storyboard workflow"
```

### Task 6: Add Versioned Optional Workspace Brand Packages

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722193000_workspace_brand_packages/migration.sql`
- Create: `src/lib/services/workspace-brand-package-service.ts`
- Create: `src/components/video-generation/brand-package-control.tsx`
- Modify: `src/types/video-generation.ts`
- Modify: `src/lib/schemas/unified-input.ts`
- Modify: `src/lib/video-generation/brand-packaging.ts`
- Modify: `src/lib/video-generation/brand-packaging-service.ts`
- Modify: `src/components/library/brand-package-button.tsx`
- Modify: `prisma/seed.ts`
- Test: `tests/workspace-brand-package.test.ts`
- Test: `tests/brand-packaging-service.test.ts`

**Interfaces:**
- Produces: `getDefaultWorkspaceBrandPackage(userId): Promise<WorkspaceBrandPackageView | null>`
- Produces: `snapshotWorkspaceBrandPackage({ userId, packageId, enabled }): Promise<BrandPackageSnapshot | null>`

- [ ] **Step 1: Write failing brand behavior tests**

```ts
test("disabled branding returns the clean source", async () => {
  const result = await packageVideo({ enabled: false, sourceVideoUrl });
  assert.equal(result.deliveryUrl, sourceVideoUrl);
  assert.equal(result.brandedVideoUrl, null);
});

test("a non-Sunny workspace cannot receive Sunny branding", async () => {
  await assert.rejects(
    snapshotWorkspaceBrandPackage({ userId: otherUser.id, packageId: sunnyPackage.id, enabled: true }),
    /not found/i,
  );
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/workspace-brand-package.test.ts tests/brand-packaging-service.test.ts`

Expected: FAIL because the UI hard-codes SunnyShutter and `none` can still be coerced.

- [ ] **Step 3: Add package schema, service, and seed**

Persist workspace, version, logo asset, optional end-card still, contact/CTA, placement, colors, tail trim, and active/default flags. Seed SunnyShutter only for the matching workspace fixture. Snapshot the selected version into every request.

- [ ] **Step 4: Wire the optional control and deterministic packaging**

Add one toggle with package preview before storyboard creation. Preserve the clean output. When enabled, apply the exact logo overlay and end card locally; when disabled, skip branding. Remove `clientProfileId: "sunnyshutter"` from the library button.

- [ ] **Step 5: Run focused tests and type checking**

Run: `node --import tsx --test tests/workspace-brand-package.test.ts tests/brand-packaging-service.test.ts tests/brand-end-card-renderer.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts src/lib/services/workspace-brand-package-service.ts src/components/video-generation/brand-package-control.tsx src/types/video-generation.ts src/lib/schemas/unified-input.ts src/lib/video-generation/brand-packaging.ts src/lib/video-generation/brand-packaging-service.ts src/components/library/brand-package-button.tsx tests/workspace-brand-package.test.ts tests/brand-packaging-service.test.ts
git commit -m "feat: add optional workspace video branding"
```

### Task 7: Integrate Batch Storyboards and Fix Submission Idempotency

**Files:**
- Modify: `src/lib/contracts/batch-request.ts`
- Modify: `src/app/api/batches/route.ts`
- Modify: `src/lib/services/batch-service.ts`
- Modify: `src/app/api/cron/process-batches/route.ts`
- Modify: `src/components/batch/batch-create-wizard.tsx`
- Modify: `src/components/batch/batch-monitor.tsx`
- Test: `tests/batch-storyboard-service.test.ts`
- Test: `tests/batch-submission-idempotency.test.ts`

**Interfaces:**
- Batch request adds `assetIds`, optional immutable brand package selection, and no customer route ID.
- Batch processor calls `ensureBatchStoryboard(videoJobId)` before provider submission.

- [ ] **Step 1: Write failing batch tests**

```ts
test("identical groups receive distinct stable submission identities", async () => {
  const result = await submitGroups([group, group]);
  assert.notEqual(result[0].idempotencyKey, result[1].idempotencyKey);
});

test("retry after group two fails does not duplicate group one", async () => {
  const first = await submitWithSecondFailure();
  const retry = await retrySubmission(first.resumeToken);
  assert.equal(await countBatchesForGroup(first.groups[0].identity), 1);
  assert.equal(retry.completedGroups, 2);
});

test("batch storyboard auto-approves before Shuyu video submission", async () => {
  const job = await processBatchJob(queuedJob);
  assert.equal(job.storyboard.status, "APPROVED");
  assert.equal(fakeShuyuVideo.submissions.length, 1);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/batch-storyboard-service.test.ts tests/batch-submission-idempotency.test.ts`

Expected: FAIL because batch submits directly to video and shares one client identity ref.

- [ ] **Step 3: Add batch storyboard processing**

Persist brand/storyboard policy snapshots on the batch and video job. `process-batches` creates or resumes four-frame storyboards, auto-approves complete runs, and only then submits the ordered frame references to Shuyu video.

- [ ] **Step 4: Fix client submission identity**

Derive one stable identity per queued group from the overall submission UUID plus group index and canonical group fingerprint. Persist completed group IDs locally during the submission attempt; retry sends only unsent groups.

- [ ] **Step 5: Add review copy and stage data to batch UI**

Show storyboard frame count, Shuyu plan, estimated points, and optional brand package before submission. Monitor rows consume storyboard summaries returned by the status API.

- [ ] **Step 6: Run focused tests and type checking**

Run: `node --import tsx --test tests/batch-storyboard-service.test.ts tests/batch-submission-idempotency.test.ts tests/batch-queue.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/contracts/batch-request.ts src/app/api/batches/route.ts src/lib/services/batch-service.ts src/app/api/cron/process-batches/route.ts src/components/batch/batch-create-wizard.tsx src/components/batch/batch-monitor.tsx tests/batch-storyboard-service.test.ts tests/batch-submission-idempotency.test.ts
git commit -m "feat: add storyboards to batch video production"
```

### Task 8: Replace the Enlarged Batch Detail with a Bounded Inspector

**Files:**
- Create: `src/components/video/video-player-frame.tsx`
- Create: `src/components/batch/batch-job-inspector.tsx`
- Modify: `src/components/batch/batch-monitor.tsx`
- Modify: `src/app/(platform)/app/library/[id]/page.tsx`
- Test: `tests/video-player-frame.test.ts`
- Test: `tests/e2e/batch-video-inspector.spec.ts`

**Interfaces:**
- `VideoPlayerFrame({ src, poster, title, aspectRatio?, maxHeightClassName? })`
- `BatchJobInspector({ job, open, onOpenChange })`

- [ ] **Step 1: Write failing geometry contract and browser tests**

```ts
test("player contains media instead of forcing a portrait crop", () => {
  assert.match(source, /object-contain/);
  assert.doesNotMatch(source, /aspect-9\/12.*object-cover/);
});
```

The Playwright test opens portrait, landscape, and square jobs at desktop and mobile viewports and asserts the player bounding box stays within the inspector and viewport, with controls visible.

- [ ] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/video-player-frame.test.ts && npx playwright test tests/e2e/batch-video-inspector.spec.ts --project=desktop`

Expected: FAIL because the full-width bottom sheet forces a cropped ratio.

- [ ] **Step 3: Build the shared player and inspector**

Use intrinsic media sizing, `object-contain`, `max-h-[70vh]`, `max-w-full`, and accessible title/controls. Use a bounded bottom sheet with internal scrolling on mobile and a maximum-width dialog/right sheet on desktop. Restore focus to the clicked virtual row.

- [ ] **Step 4: Reuse the player on single detail**

Replace the duplicated single-page player markup without changing page behavior.

- [ ] **Step 5: Run focused unit and browser tests**

Run: `node --import tsx --test tests/video-player-frame.test.ts && npx playwright test tests/e2e/batch-video-inspector.spec.ts --project=desktop --project=mobile`

Expected: PASS for all three aspect ratios at both viewport classes.

- [ ] **Step 6: Commit**

```bash
git add src/components/video/video-player-frame.tsx src/components/batch/batch-job-inspector.tsx src/components/batch/batch-monitor.tsx 'src/app/(platform)/app/library/[id]/page.tsx' tests/video-player-frame.test.ts tests/e2e/batch-video-inspector.spec.ts
git commit -m "fix: bound batch video details on every viewport"
```

### Task 9: Full Regression, Visual QA, and Delivery

**Files:**
- Modify: `tests/e2e/editorial.visual.spec.ts`
- Modify: `tests/e2e/editorial.a11y.spec.ts`
- Modify: `tests/final-acceptance/journeys.spec.ts`
- Modify: existing snapshots only when the reviewed UI intentionally changes.

**Interfaces:**
- Consumes every workflow and component from Tasks 1–8.
- Produces verified build/test evidence and the final pushed commit set.

- [ ] **Step 1: Add complete user journeys**

Cover text-to-image, reference-to-image, image-to-video handoff, single storyboard regenerate/approve, clean single delivery, branded single delivery, batch auto-storyboards, partial retry, and responsive batch inspection. Explicitly dismiss first-run onboarding before interacting.

Reproduce the supplied 1910×895 creation-page failure state that displays `PROVIDER_ERROR` with `contact_support`. Trace and verify Shuyu runtime readiness, immutable route snapshot, idempotency replay, submission error classification, and quota compensation. After a safely rejected/configuration-repaired request, a real user must be able to submit a fresh generation without a stale poisoned attempt; acknowledgement-unknown requests must still remain fail-closed and recover through status/support reconciliation rather than blind resubmission.

- [ ] **Step 2: Run static verification**

Run: `npx prisma validate && npm run typecheck && npm run lint`

Expected: all commands exit 0.

- [ ] **Step 3: Run focused and full unit suites**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: build exits 0 with all customer routes compiled.

- [ ] **Step 5: Run realistic mock user journeys**

Run the repository mock server and Playwright suites for desktop and mobile. Exercise every core control; screenshots alone are insufficient.

Expected: all creation and delivery journeys pass, including reload during processing.

- [ ] **Step 6: Perform visual comparison**

Capture the supplied problem states and new workflows at matching viewports. Compare reference and implementation side by side. Fix and rerun until there is no viewport overflow, forced crop, hidden control, focus trap defect, or inconsistent Studio styling.

- [ ] **Step 7: Review final diff and preserve user files**

Run: `git status --short && git diff --check && git diff --stat origin/main...HEAD`

Expected: only intended workflow, test, migration, and documentation changes; the two `.bak` files and pre-existing unrelated plan remain untracked and untouched.

- [ ] **Step 8: Final commit and push**

```bash
git add tests/e2e/editorial.visual.spec.ts tests/e2e/editorial.a11y.spec.ts tests/final-acceptance/journeys.spec.ts tests/e2e/editorial.visual.spec.ts-snapshots
git commit -m "test: verify Shuyu creation workflows"
git push origin HEAD
```

Expected: push succeeds and the remote branch points at the verified commit.
