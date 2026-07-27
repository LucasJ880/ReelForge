# Aivora P1 Commerce Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SunnyShutter-only template system with eight reusable ecommerce recipes while preserving SunnyShutter as a strict client profile adapter.

**Architecture:** Introduce a product-agnostic shot policy and a canonical commerce-template catalog keyed by stable slugs. Library, advanced creation, and batch creation all read that catalog; the database remains the source of active template version IDs for batch snapshots. SunnyShutter-specific mechanics are injected only when the client lock profile is active.

**Tech Stack:** TypeScript, React 19, Next.js 16, Prisma seed data, Zod, Node test runner with TSX.

## Global Constraints

- Canonical slugs are stable URL identifiers; database IDs remain versioned batch snapshot identifiers.
- Preserve `renderSafeShutterPrompt` output byte-for-byte through the SunnyShutter adapter.
- Public Shuyu storyboard selection remains deterministic; do not add paid judge calls.
- Generated provider prompts remain below 5,000 characters.
- Customer copy must be product-agnostic unless a client lock profile explicitly supplies mechanics.

---

### Task 1: Extract a generic shot safety policy with a SunnyShutter adapter

**Files:**
- Create: `src/lib/video-generation/generic-shot-policy.ts`
- Modify: `src/lib/video-generation/shutter-shot-policy.ts`
- Modify: `tests/shutter-shot-policy.test.ts`
- Create: `tests/generic-shot-policy.test.ts`

- [ ] **Step 1: Write failing generic-policy tests**

```ts
test("generic policy rejects mechanics not supported by the product profile", () => {
  assert.throws(
    () => renderSafeCommercePrompt({
      motion: "operate_demo",
      productProfile: { demonstrableActions: [] },
      basePrompt: "A hand operates the product",
    }),
    /demonstrable action/i,
  );
});

test("SunnyShutter adapter preserves the legacy prompt exactly", () => {
  assert.equal(renderSunnyAdapter(fixture), renderSafeShutterPrompt(fixture));
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/generic-shot-policy.test.ts tests/shutter-shot-policy.test.ts`

Expected: FAIL because the generic policy does not exist.

- [ ] **Step 3: Implement policy and adapter**

```ts
export type GenericShotMotion =
  | "static_product"
  | "reveal_transition"
  | "operate_demo"
  | "presenter_point";
```

Model product profile facts separately from shot motion. Enforce identity, geometry, hand, text, and unsupported-mechanics constraints in the generic renderer. Keep all legacy exports and delegate SunnyShutter calls through an adapter whose tests prove exact output compatibility.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/generic-shot-policy.test.ts tests/shutter-shot-policy.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-generation/generic-shot-policy.ts src/lib/video-generation/shutter-shot-policy.ts tests/generic-shot-policy.test.ts tests/shutter-shot-policy.test.ts
git commit -m "refactor: extract generic commerce shot policy"
```

### Task 2: Create the canonical eight-template commerce catalog

**Files:**
- Create: `src/lib/video-generation/generic-commerce-template.ts`
- Create: `src/lib/video-generation/commerce-template-catalog.ts`
- Modify: `src/lib/video-generation/sunnyshutter-commerce-template.ts`
- Modify: `src/lib/video-generation/batch-style-templates.ts`
- Modify: `src/lib/contracts/batch-style-templates.ts`
- Modify: `prisma/seed.ts`
- Create: `tests/commerce-template-catalog.test.ts`
- Modify: `tests/batch-style-templates.test.ts`
- Modify: `tests/sunnyshutter-commerce-template.test.ts`

- [ ] **Step 1: Add failing catalog tests**

```ts
assert.deepEqual(COMMERCE_TEMPLATE_SLUGS, [
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
]);
assert.ok(COMMERCE_TEMPLATE_SLUGS.every((slug) => renderCommerceTemplate(slug, fixture).prompt.length < 5000));
```

Also assert every recipe has hook, proof, CTA, supported duration, product-safe skeleton, cover image, concise summary, and no SunnyShutter wording.

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/commerce-template-catalog.test.ts tests/batch-style-templates.test.ts tests/sunnyshutter-commerce-template.test.ts`

Expected: FAIL because the shared catalog does not exist and batch seeds are SunnyShutter-only.

- [ ] **Step 3: Implement recipes and seeds**

Create a declarative recipe type whose renderer derives storyboard beats and prompt blocks from product profile facts. Seed one active database template per canonical slug. Add SunnyShutter profile facts and brand constraints as an overlay, not as separate customer templates. Keep the original v2 template exports available for historical snapshots.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/commerce-template-catalog.test.ts tests/batch-style-templates.test.ts tests/sunnyshutter-commerce-template.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-generation/generic-commerce-template.ts src/lib/video-generation/commerce-template-catalog.ts src/lib/video-generation/sunnyshutter-commerce-template.ts src/lib/video-generation/batch-style-templates.ts src/lib/contracts/batch-style-templates.ts prisma/seed.ts tests/commerce-template-catalog.test.ts tests/batch-style-templates.test.ts tests/sunnyshutter-commerce-template.test.ts
git commit -m "feat: add canonical ecommerce template catalog"
```

### Task 3: Make gacha selection and generated copy product-agnostic

**Files:**
- Modify: `src/lib/video-generation/storyboard-gacha.ts`
- Modify: `src/lib/video-generation/client-lock-profiles.ts`
- Modify: `src/lib/video-generation/prompt-intelligence.ts`
- Create: `tests/storyboard-gacha-generic.test.ts`
- Modify: `tests/client-lock-profiles.test.ts`

- [ ] **Step 1: Write failing language and selection tests**

```ts
test("generic judge rubric contains no window-covering assumptions", () => {
  assert.doesNotMatch(genericJudgeSystem(), /louver|shutter|window covering/i);
});

test("public Shuyu selection remains deterministic and free of judge calls", async () => {
  const selected = await selectStoryboardCandidate({ route: "shuyu", candidates });
  assert.equal(selected.id, candidates[0].id);
  assert.equal(judge.calls, 0);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/storyboard-gacha-generic.test.ts tests/client-lock-profiles.test.ts`

Expected: FAIL because the judge system prompt is product-specific.

- [ ] **Step 3: Generalize the rubric**

Judge product identity, shot continuity, intended action, proof clarity, human anatomy, and overlay-text absence. Client profiles may append facts but cannot replace global safety constraints. Keep the deterministic first-successful selection on public Shuyu routes.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/storyboard-gacha-generic.test.ts tests/client-lock-profiles.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-generation/storyboard-gacha.ts src/lib/video-generation/client-lock-profiles.ts src/lib/video-generation/prompt-intelligence.ts tests/storyboard-gacha-generic.test.ts tests/client-lock-profiles.test.ts
git commit -m "refactor: generalize storyboard commerce scoring"
```

### Task 4: Unify template entry points across library, advanced, and batch flows

**Files:**
- Modify: `src/components/templates/template-library-grid.tsx`
- Modify: `src/components/video-generation/streamlined-video-studio.tsx`
- Modify: `src/components/batch/batch-create-wizard.tsx`
- Modify: `src/app/(platform)/app/create/page.tsx`
- Modify: `src/app/(platform)/app/batches/new/page.tsx`
- Modify: `src/i18n/platform-copy.ts`
- Modify: `tests/template-recipe-ux.test.ts`
- Modify: `tests/batch-frontend-contract.test.ts`

- [ ] **Step 1: Add failing cross-entry tests**

```ts
test("all creation surfaces consume canonical commerce slugs", () => {
  for (const source of [library, studio, batchWizard]) {
    assert.match(source, /COMMERCE_TEMPLATE_SLUGS|commerceTemplates/);
  }
});

test("batch deep link resolves slug to the active database version", () => {
  assert.equal(resolveInitialTemplate(templates, "commerce-value-proof")?.id, "db-version-id");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --import tsx --test tests/template-recipe-ux.test.ts tests/batch-frontend-contract.test.ts`

Expected: FAIL because advanced creation hardcodes legacy skills and batch deep links resolve only database IDs.

- [ ] **Step 3: Implement unified discovery**

Render the same eight recipes under the localized `电商带货` category in all three entry points. Store canonical slug in URLs. In batch creation, resolve `template.slug === initialTemplateId || template.id === initialTemplateId`, then submit the active database ID and version unchanged. Make the one-click generated prompt human-readable and editable.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/template-recipe-ux.test.ts tests/batch-frontend-contract.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/templates/template-library-grid.tsx src/components/video-generation/streamlined-video-studio.tsx src/components/batch/batch-create-wizard.tsx 'src/app/(platform)/app/create/page.tsx' 'src/app/(platform)/app/batches/new/page.tsx' src/i18n/platform-copy.ts tests/template-recipe-ux.test.ts tests/batch-frontend-contract.test.ts
git commit -m "feat: unify ecommerce template entry points"
```
