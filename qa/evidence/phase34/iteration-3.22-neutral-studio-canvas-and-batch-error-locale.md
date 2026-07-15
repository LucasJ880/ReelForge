# Iteration 3.22 — Neutral Studio canvas and batch error locale

Date: 2026-07-14 (America/Toronto)

## Human authorization and scope

The human explicitly authorized returning the authenticated `/app` workspace to the project's earlier neutral-dark Studio palette. Theme topology is unchanged: `/app` is dark, while public, auth, and internal surfaces remain light. Showcase remains frozen.

This iteration did not modify provider, backend service, deployment, migration, or cron code. It also did not change the token implementation already present in the working tree; it aligned the design-system hard gates and QA ledger with the newly authorized values, then closed one customer-language leak in the batch UI.

## Canvas diagnosis and design invariant

Screenshot pixel sampling identified the exposed light region as the root Editorial canvas color `#fafaf7`, while the intended workspace region matched the Studio token family. The optimized CSS contained the relevant utility classes, so the defect was not a missing Tailwind rule. The failure boundary was the document canvas: a short or transitioning Studio page could expose the light root background outside the descendant shell.

The approved invariant is now locked by source tests:

- Studio canvas `#101015`, surface `#18181f`, and raised surface `#22222b`.
- `.studio-theme` remains the explicit workspace boundary.
- `:root:has(.studio-theme)` extends the Studio background to the document canvas only while that boundary is mounted.
- Auth uses `.auth-studio-theme`, and public/internal routes do not mount the exact `.studio-theme` class, so their light topology is preserved.

## Batch error language repair

The batch API intentionally retains a Chinese default error body for operator context. The customer UI now selects localized copy from the stable machine error code instead of rendering that upstream body directly:

- English workspaces receive English guidance for known codes.
- Chinese workspaces preserve the specific Chinese server detail when available.
- Unknown codes use a locale-owned generic fallback; an English UI never echoes Chinese.

The mapping is pure and covered without modifying API defaults or backend services.

## Verification

Command:

```text
node --import tsx --test tests/design-system-closure.test.ts tests/studio-design-system.test.ts tests/customer-recovery-ui-contract.test.ts tests/batch-frontend-contract.test.ts tests/batch-api-contract.test.ts tests/batch-pipeline.test.ts
```

Result: **35/35 passed**, 0 failed, 0 skipped.

Command:

```text
npm run typecheck
```

Result: passed (`tsc --noEmit`).

## Remaining visual evidence

After deployment, the human/browser gate must still verify:

1. public and auth routes remain light;
2. the `/app` root canvas stays neutral-dark at the page bottom and during overscroll;
3. a long-to-short batch-wizard transition exposes no light strip;
4. an English batch-validation failure contains no Chinese text.

No production visual claim is made from source tests alone.
