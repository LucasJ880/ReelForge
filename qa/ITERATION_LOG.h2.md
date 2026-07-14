# ReelForge H2 Merge and UI Unification Log

## H2 · Iteration 0 — D-0 Option A decision

- Date: 2026-07-14
- Human decision: unify shared tokens, component anatomy, spacing, typography, focus, elevation, and motion **within** the approved topology. `/app` remains dark Studio; public/auth/`/internal` remain light Editorial. `/showcase` is frozen.
- Decision commit: `da83969`.
- Scope guard: no production database, migration, provider, billing, environment, or deployment mutation.

## H2 · Iteration 1 — H1/UI merge resolution

- Date: 2026-07-14
- Parents: H1 `cc75c21`; UI closure `2d4aefc`.
- Branch: `codex/h2-ui-unification`.
- Resolution policy: H1 wins for API/error/billing behavior; UI wins for presentation and route-owned state surfaces; QA documents preserve the semantic union.
- Explicit resolutions:
  - `src/app/api/batches/[id]/status/route.ts`: retained strict H1 success/error schemas, safe `RESOURCE_NOT_FOUND`, dispatch-authorization 409, and typed UI missing-vs-service distinction.
  - `src/lib/api-auth.ts`: retained H1 `AUTH_REQUIRED`/`FORBIDDEN` envelopes while adopting the UI role-authority policy so stale BUSINESS/PERSONAL persona values cannot demote staff or promote customers.
  - `src/components/platform/platform-shell.tsx`: retained `prefetch={false}` plus the RF-036 sign-out-race rationale.
  - `src/lib/services/batch-service.ts`: removed an auto-merge duplicate `BatchNotFoundError`; H1 billing-safe retry semantics remain unchanged.
  - `qa/DEFECTS.md`: preserved UI RF-020…026 and H1 RF-027…036, H1 contract evidence, the five verified UI items, RF-019 OPEN, and RF-005 FIXED pending heartbeat.
  - `qa/SHIP_AUDIT.md` / `qa/RELEASE_GATE.md`: combined the 71-route-file contract evidence with the 33-route/99-width UI evidence while marking merged-tree verification pending.
- Test correction evidence: the UI RF-012 source test encoded the old ternary implementation rather than the required behavior. It now asserts the stronger H1 contract directly: typed missing/foreign ownership → `RESOURCE_NOT_FOUND` 404; operational failure → `INTERNAL_ERROR` 500. No status, retry, or error assertion was relaxed.
- Initial verification: focused merge suite 52/52, typecheck, focused lint, and diff check pass. Full merged-tree evidence begins only after the merge commit.
- Failed diagnostic preserved: the first focused run was 51/52 because the RF-012 test expected the old local variable/ternary source shape; the second exposed its remaining ternary assertion. Both failures led only to the documented semantic test correction.
- Scope guard: 0 real provider calls, 0 paid operations, 0 production database/config/deployment changes.
