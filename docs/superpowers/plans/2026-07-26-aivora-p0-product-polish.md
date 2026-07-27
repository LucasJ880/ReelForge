# Aivora P0 Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the highest-traffic authentication, batch, template, and library screens to a compact, reliable production standard without changing generation behavior.

**Architecture:** Keep the existing App Router pages and visual system. Add small presentational contracts for batch rows and template previews, filter unusable library records at the service boundary, and make deletion a separate evidence-gated maintenance command.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 6, Node test runner with TSX, Playwright visual and accessibility suites.

## Global Constraints

- Preserve all 2026-07-22 mock, storyboard refresh, and SunnyShutter v2 behavior.
- Template previews remain lazy, muted, looped, keyboard operable, and free of paid generation calls.
- Failed library records with no playable URL are hidden from customer UI, not silently deleted.
- Physical deletion is dry-run by default and is not executed during this implementation.
- Keep mobile horizontal overflow at zero.

---

### Task 1: Tighten the authentication hero hierarchy

**Files:**
- Modify: `src/app/(auth)/layout.tsx`
- Modify: `tests/layout-overflow-guards.test.ts`
- Modify: `tests/e2e/editorial-fixtures.ts`

- [ ] **Step 1: Add a failing source contract**

```ts
test("auth hero uses the compact editorial type scale", () => {
  const source = readSource("src/app/(auth)/layout.tsx");
  assert.match(source, /clamp\(2\.35rem,5vw,4\.75rem\)/);
  assert.match(source, /max-w-\[34rem\]/);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `node --import tsx --test tests/layout-overflow-guards.test.ts`

Expected: FAIL because the current hero still uses the oversized `2.75rem–5.5rem` scale.

- [ ] **Step 3: Apply the compact hierarchy**

Change the hero heading to `text-[clamp(2.35rem,5vw,4.75rem)]`, constrain the supporting copy to `max-w-[34rem]`, reduce metric emphasis by one type step, and keep the current copy, color tokens, and breakpoint layout.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/layout-overflow-guards.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(auth)/layout.tsx' tests/layout-overflow-guards.test.ts tests/e2e/editorial-fixtures.ts
git commit -m "style: refine authentication hero hierarchy"
```

### Task 2: Replace batch cards with a responsive operations table

**Files:**
- Modify: `src/app/(platform)/app/batches/page.tsx`
- Modify: `tests/batch-frontend-contract.test.ts`
- Modify: `tests/e2e/editorial-fixtures.ts`

- [ ] **Step 1: Add failing batch-list contracts**

```ts
test("batch list exposes a compact table with mobile labels", () => {
  const source = readSource("src/app/(platform)/app/batches/page.tsx");
  assert.match(source, /<table/);
  assert.match(source, /data-label=["']状态["']/);
  assert.doesNotMatch(source, /grid-cols-2/);
});
```

Add the `batch-list` fixture at `/app/batches` so the shared visual and accessibility loops cover the page.

- [ ] **Step 2: Verify the tests fail**

Run: `node --import tsx --test tests/batch-frontend-contract.test.ts tests/layout-overflow-guards.test.ts`

Expected: FAIL because the page renders two-column cards and the fixture is absent.

- [ ] **Step 3: Implement the table**

Render columns for batch, template, progress, status, updated time, and action. Use a semantic `<table>` on desktop and CSS `data-label` cells below `md`; preserve status links, empty state, and server-side data loading. Remove the decorative film-strip dependency from the list page only.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/batch-frontend-contract.test.ts tests/layout-overflow-guards.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(platform)/app/batches/page.tsx' tests/batch-frontend-contract.test.ts tests/e2e/editorial-fixtures.ts
git commit -m "feat: add compact responsive batch table"
```

### Task 3: Add trustworthy sample-video template previews

**Files:**
- Modify: `src/lib/contracts/batch-style-templates.ts`
- Modify: `src/lib/video-generation/template-sample.ts`
- Modify: `src/components/templates/template-library-grid.tsx`
- Modify: `src/components/library/hover-preview-video.tsx`
- Modify: `tests/template-recipe-ux.test.ts`
- Modify: `tests/library-video-loading.test.ts`

- [ ] **Step 1: Add failing preview tests**

```ts
test("template DTO carries an optional verified sample video", () => {
  const sample = verifiedTemplateSample(
    "commerce-ugc-testimonial",
    "/template-previews/commerce-ugc-testimonial.jpg",
    "/template-previews/commerce-ugc-testimonial.mp4",
  );
  assert.equal(sample.sampleVideo, "/template-previews/commerce-ugc-testimonial.mp4");
});

test("template preview video never autoloads offscreen", () => {
  const source = readSource("src/components/library/hover-preview-video.tsx");
  assert.match(source, /preload=["']none["']/);
  assert.match(source, /aria-label/);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --import tsx --test tests/template-recipe-ux.test.ts tests/library-video-loading.test.ts`

Expected: FAIL because verified samples only return images and preview controls lack the expanded contract.

- [ ] **Step 3: Implement verified video previews**

Extend the DTO with `sampleVideo?: string | null` and `summary?: string | null`. Accept only same-origin `/template-previews/<slug>.mp4` assets. Overlay `HoverPreviewVideo` when a verified sample exists, retain the image fallback, and support pointer enter/leave plus focus/blur without autoplaying on page load.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/template-recipe-ux.test.ts tests/library-video-loading.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contracts/batch-style-templates.ts src/lib/video-generation/template-sample.ts src/components/templates/template-library-grid.tsx src/components/library/hover-preview-video.tsx tests/template-recipe-ux.test.ts tests/library-video-loading.test.ts
git commit -m "feat: add verified template video previews"
```

### Task 4: Hide dead library failures and add evidence-gated cleanup

**Files:**
- Modify: `src/lib/services/unified-library-service.ts`
- Modify: `src/app/(platform)/app/library/page.tsx`
- Create: `scripts/cleanup-dead-library-records.ts`
- Modify: `package.json`
- Modify: `tests/unified-library-contract.test.ts`
- Create: `tests/cleanup-dead-library-records.test.ts`

- [ ] **Step 1: Add failing visibility and cleanup tests**

```ts
test("failed records without playable output are excluded", () => {
  assert.deepEqual(
    filterCustomerLibraryRows([
      { id: "dead", status: "FAILED", videoUrl: null },
      { id: "kept", status: "FAILED", videoUrl: "https://cdn.example/kept.mp4" },
    ]).map((row) => row.id),
    ["kept"],
  );
});

test("cleanup requires matching evidence to commit", () => {
  assert.throws(
    () => parseCleanupArgs(["--commit"]),
    /--evidence/,
  );
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --import tsx --test tests/unified-library-contract.test.ts tests/cleanup-dead-library-records.test.ts`

Expected: FAIL because filtering and the command do not exist.

- [ ] **Step 3: Implement safe filtering and dry-run evidence**

Filter only customer-facing results whose terminal failure has no video URL. The cleanup command must emit a JSON evidence file containing timestamp, database identity hash, selected IDs, selection reasons, and SHA-256 digest. It defaults to dry-run. `--commit` is accepted only with `--evidence=<path>` whose digest and current re-query match; do not run it in this task.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/unified-library-contract.test.ts tests/cleanup-dead-library-records.test.ts && npm run typecheck`

Expected: PASS, and `npm run cleanup:library:dead -- --help` documents dry-run as the default.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/unified-library-service.ts 'src/app/(platform)/app/library/page.tsx' scripts/cleanup-dead-library-records.ts package.json tests/unified-library-contract.test.ts tests/cleanup-dead-library-records.test.ts
git commit -m "feat: hide and audit dead library records"
```
