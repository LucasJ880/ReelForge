# Aivora P2 Brand System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-ready workspace and global brand packages, a dedicated brand management surface, and transparent making-process details in the customer library.

**Architecture:** Extend the existing `WorkspaceBrandPackage` model additively with a global flag. The service merges platform-owned global packages with workspace-owned packages and enforces read-only global mutations. Reuse current owned media assets and logo-generation workflow. Derive library process steps from persisted order, storyboard, job, and final-video records.

**Tech Stack:** Prisma 6/PostgreSQL, Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Node test runner with TSX.

## Global Constraints

- Existing workspace package IDs and snapshots remain valid.
- Global packages are platform-owned, visible to all workspaces, and immutable from customer routes.
- Customer write operations may affect only their own workspace packages and owned assets.
- Library process data is evidence from persisted state, never invented progress.

---

### Task 1: Add global brand-package persistence and authorization

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260726120000_global_brand_packages/migration.sql`
- Modify: `src/lib/services/workspace-brand-package-service.ts`
- Modify: `src/app/api/brand-packaging/route.ts`
- Modify: `prisma/seed.ts`
- Modify: `tests/workspace-brand-packages.test.ts`

- [ ] **Step 1: Add failing global-package tests**

```ts
test("lists global packages before workspace packages", async () => {
  const packages = await listWorkspaceBrandPackages(workspace.id);
  assert.deepEqual(packages.map((item) => item.scope), ["global", "workspace"]);
});

test("customer cannot mutate a global package", async () => {
  await assert.rejects(
    () => upsertWorkspaceBrandPackage({ workspaceId: customer.id, id: global.id, name: "Changed" }),
    /read-only/i,
  );
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/workspace-brand-packages.test.ts`

Expected: FAIL because all packages are workspace-only and the DTO has no scope.

- [ ] **Step 3: Add the schema and service contract**

```prisma
isGlobal Boolean @default(false)

@@index([isGlobal, isActive, updatedAt(sort: Desc)])
```

Return `scope: "global" | "workspace"` and `canEdit: boolean` in views. List active global packages plus the current workspace's active packages. Keep `workspaceId` required and seed global rows under the platform workspace. Reject customer updates or deactivation of `isGlobal=true`.

- [ ] **Step 4: Verify**

Run: `npx prisma generate && node --import tsx --test tests/workspace-brand-packages.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260726120000_global_brand_packages/migration.sql src/lib/services/workspace-brand-package-service.ts src/app/api/brand-packaging/route.ts prisma/seed.ts tests/workspace-brand-packages.test.ts
git commit -m "feat: add read-only global brand packages"
```

### Task 2: Build the brand management page

**Files:**
- Create: `src/app/(platform)/app/brands/page.tsx`
- Create: `src/components/brand/brand-package-manager.tsx`
- Modify: `src/components/platform/platform-shell.tsx`
- Modify: `src/components/wizard/logo-generator-dialog.tsx`
- Create: `tests/brand-package-manager.test.ts`
- Modify: `tests/layout-overflow-guards.test.ts`
- Modify: `tests/e2e/editorial-fixtures.ts`

- [ ] **Step 1: Add failing page contracts**

```ts
test("brand manager separates reusable global and editable workspace packs", () => {
  assert.match(source, /全局品牌包/);
  assert.match(source, /工作区品牌包/);
  assert.match(source, /LogoGeneratorDialog/);
  assert.match(source, /canEdit/);
});
```

Add a `brand-manager` fixture for `/app/brands`.

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/brand-package-manager.test.ts tests/layout-overflow-guards.test.ts`

Expected: FAIL because the route and manager do not exist.

- [ ] **Step 3: Implement the page**

Show compact preview cards, default marker, scope badge, logo, slogan, CTA, contact details, and edit action only when `canEdit`. Reuse the owned media uploader and `LogoGeneratorDialog`; keep save through the existing brand-packaging API. Add the route to platform navigation.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/brand-package-manager.test.ts tests/layout-overflow-guards.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(platform)/app/brands/page.tsx' src/components/brand/brand-package-manager.tsx src/components/platform/platform-shell.tsx src/components/wizard/logo-generator-dialog.tsx tests/brand-package-manager.test.ts tests/layout-overflow-guards.test.ts tests/e2e/editorial-fixtures.ts
git commit -m "feat: add brand package management"
```

### Task 3: Add the customer brand wall

**Files:**
- Create: `src/components/brand/customer-brand-wall.tsx`
- Modify: `src/app/(platform)/app/brands/page.tsx`
- Create: `tests/customer-brand-wall.test.ts`

- [ ] **Step 1: Add a failing data-safety test**

```ts
test("brand wall renders only explicitly public logo assets", () => {
  const visible = filterPublicBrandWallEntries(fixtures);
  assert.deepEqual(visible.map((entry) => entry.id), ["public-active"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/customer-brand-wall.test.ts`

Expected: FAIL because the filter and component do not exist.

- [ ] **Step 3: Implement an allowlisted wall**

Use only seeded, platform-approved global brand assets; do not derive customer logos from private workspace records. Render a responsive, desaturated logo wall with accessible names and no outbound links unless explicitly configured.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/customer-brand-wall.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/brand/customer-brand-wall.tsx 'src/app/(platform)/app/brands/page.tsx' tests/customer-brand-wall.test.ts
git commit -m "feat: add approved customer brand wall"
```

### Task 4: Show a persisted making-process timeline in the library

**Files:**
- Modify: `src/lib/services/unified-library-service.ts`
- Modify: `src/app/(platform)/app/library/[id]/page.tsx`
- Create: `src/components/library/making-process-timeline.tsx`
- Modify: `tests/unified-library-contract.test.ts`
- Modify: `tests/customer-library-detail-route-boundary.test.ts`

- [ ] **Step 1: Add failing timeline tests**

```ts
test("library detail derives process steps only from persisted records", () => {
  const steps = deriveMakingProcess(fixture);
  assert.deepEqual(steps.map((step) => step.key), [
    "brief",
    "storyboard",
    "generation",
    "post-production",
  ]);
  assert.equal(steps[1].status, "completed");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/unified-library-contract.test.ts tests/customer-library-detail-route-boundary.test.ts`

Expected: FAIL because detail DTOs do not expose process steps.

- [ ] **Step 3: Implement the evidence timeline**

Derive ordered steps from creation timestamp, approved storyboard, provider jobs, and final-video status. Each step contains key, label, status, timestamp if available, and safe summary. Render completed/current/pending/failed states without exposing provider secrets, internal error stacks, or unsupported progress percentages.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/unified-library-contract.test.ts tests/customer-library-detail-route-boundary.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/unified-library-service.ts 'src/app/(platform)/app/library/[id]/page.tsx' src/components/library/making-process-timeline.tsx tests/unified-library-contract.test.ts tests/customer-library-detail-route-boundary.test.ts
git commit -m "feat: explain library creation process"
```
