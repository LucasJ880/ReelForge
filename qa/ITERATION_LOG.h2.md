# ReelForge H2 Merge and UI Unification Log

## H2 · Iteration 0 — D-0 Option A decision

- Date: 2026-07-14
- Human decision: unify shared tokens, component anatomy, spacing, typography, focus, elevation, and motion **within** the approved topology. `/app` remains dark Studio; public/auth/`/internal` remain light Editorial. `/showcase` is frozen.
- Decision commit: `bba9b80`.
- Scope guard: no production database, migration, provider, billing, environment, or deployment mutation.

## H2 · Iteration 1 — H1/UI merge resolution

- Date: 2026-07-14
- Parents: H1 `87b9f34`; UI closure `bb0c05b`.
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

## H2 · Iteration 2 — RF-037 locale continuity

- Date: 2026-07-14.
- Reproduction: the desktop Studio locale switch did not carry through the mobile shell, persisted batch taxonomy/status/error fields, or the public privacy/terms/persona surfaces.
- Repair: added one shared public-copy source, server-locale metadata/body rendering, public and mobile Studio switchers, and localized batch presentation/recovery text without exposing upstream-language errors.
- Focused evidence: 16/16 related tests, TypeScript, focused ESLint, optimized build, and diff check pass.
- Status discipline: RF-037 remains FIXED rather than VERIFIED because the human paused broad golden/final-acceptance reruns in favor of internal operations testing.

## H2 · Iteration 3 — RF-038 creation density and bounded Agent thread

- Date: 2026-07-14.
- Reproduction: transcript growth expanded the whole page, moved the composer, and hid the Generate action behind a prior Preview result.
- Repair: reduced only Studio typography/spacing/control/card density inside the approved dark `/app` theme; bounded the Agent card with independent transcript scrolling; added pinned/detached scrolling and jump-to-latest; kept the composer fixed; changed recommendations to a compact horizontal rail; rendered one primary Generate action before preview and reused the existing fail-closed quality-plan check.
- Open-source method review: assistant-ui (MIT), Vercel Chatbot (Apache-2.0), Hugging Face Chat UI (Apache-2.0), and Chatbot UI (MIT) were reviewed only for layout/scrolling patterns. No code, visual design, copy, or proprietary artifact was copied.
- Evidence: TypeScript and focused ESLint pass; 16/16 focused source/journey/locale tests pass; optimized production build passes; focused browser run `phase34-1784065559900-a0eb3437` passes 2/2 and cleans its rehearsal fixture.
- Human scope direction: no 200/250 simulation, full 33-route matrix, Final Acceptance, or real provider call was run in this iteration.
- Release note: the code repair is ready for internal operations feedback, but production remains blocked independently by RF-019 and RF-005.

## H2 · Iteration 4 — RF-039 signed-evidence history remediation

- Date: 2026-07-14.
- Reproduction: the first branch push was rejected by GitHub Push Protection because a Phase 0 network-failure artifact had retained expired signed Beijing TOS URLs.
- Repair: redacted 20 affected URLs, added a regression that forbids the TOS host/credential/signature/access-key patterns, rebuilt all 78 H2-only commits from `origin/main`, and updated QA references to the rewritten commit graph.
- Evidence: focused redaction test 1/1 and JSON parsing pass; deterministic commit map and procedure are archived under `qa/evidence/h2/`.
- Stop condition: production remains untouched. RF-039 cannot become VERIFIED until the sanitized branch is accepted remotely and the historical VolcEngine credential is confirmed revoked or rotated if it remains active.
