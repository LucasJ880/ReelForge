# H1 API Contract Closure Evidence

- Date: 2026-07-14 (America/Toronto)
- Branch: `codex/final-hardening`
- Product/test revision under evidence: `b04beb7`
- Scope: API contract hardening only. No production deployment, production database write, migration execution, real provider call, external webhook call, or paid operation occurred.

## Result

H1 is complete at the explicitly recorded evidence depth:

- **Strict first tier:** upload/blob, batch-style-templates, batch create/status/cancel/retry, direct video dispatch, health, and unified library service/SSR DTOs have closed runtime request/response schemas, safe customer errors, ownership boundaries, and frontend-consumer cross-assertions.
- **Light second tier:** the remaining API methods have success-shape wiring plus authentication/role/ownership boundary evidence. These tests intentionally do not claim the hostile-input depth of the first tier.
- The route inventory is 71/71, including the previously omitted `GET /api/cron/stitch-dispatch`.

The four required customer failure classes are distinguishable and actionable:

| Failure | Customer code/action | Billing rule | Evidence depth |
|---|---|---|---|
| Provider timeout/ambiguous acknowledgement | `SUBMISSION_ACK_UNKNOWN / contact_support` | No automatic paid retry | strict route/service + UI contract |
| Provider returned error | `PROVIDER_ERROR` with recovery derived from positive billing evidence | Retry only when the backend proves no external paid job exists | strict service + UI contract |
| Asset missing/rejected | `ASSET_MISSING` or validation/review code with `replace_asset` | Stops before unsafe submission | strict upload/generation + UI contract |
| Quota exhausted | `QUOTA_EXCEEDED / upgrade_plan` | Fail-closed before provider submission | strict route contract + intercepted customer UI acceptance |

The quota UI assertion uses a controlled route response; it is not represented as a live production-database or real-provider end-to-end call.

## Defects closed

- RF-028: one customer error/DTO contract across first-tier APIs.
- RF-029: direct owner-scoped library detail beyond the 100-row list window.
- RF-030: one 0–100 library progress value for list and detail.
- RF-031: Final Acceptance J4/J7 quota isolation.
- RF-032: legacy ambiguous dispatch replay cannot advertise a paid retry.
- RF-033: real-provider retries require positive no-bill evidence.
- RF-034: quota-consumed direct dispatch remains fail-closed.
- RF-035: quota/response CAS misses cannot masquerade as persisted state.
- RF-036: protected navigation no longer prefetches across sign-out.

During second-tier closure two additional authorization defects were repaired: `GET /api/metrics/import` now requires operator access, and only the exact Stripe webhook path bypasses session middleware so the handler can verify its signature. A sibling webhook path remains protected.

## Reproducible contract suite

Run from the repository root:

```bash
node --import tsx --test \
  tests/customer-api-envelope-contract.test.ts \
  tests/quota-envelope-contract.test.ts \
  tests/h1-upload-template-health-contract.test.ts \
  tests/batch-api-contract.test.ts \
  tests/video-dispatch-error-contract.test.ts \
  tests/customer-recovery-ui-contract.test.ts \
  tests/unified-library-contract.test.ts \
  tests/machine-endpoint-auth.test.ts \
  tests/stitch-dispatch-contract.test.ts \
  tests/stitch-dispatch-service.test.ts \
  tests/customer-generation-contract.test.ts \
  tests/batch-provider-billing-safety.test.ts \
  tests/video-dispatch-idempotency.test.ts \
  tests/batch-request-contract.test.ts \
  tests/batch-frontend-contract.test.ts \
  tests/middleware-auth-cookie.test.ts \
  tests/china-health-endpoint.test.ts \
  tests/content-review-phase4.test.ts \
  tests/batch-style-templates.test.ts \
  tests/h1-secondary-contract-group-a.test.ts \
  tests/h1-secondary-api-contract.test.ts \
  tests/h1-secondary-contract-group-c.test.ts \
  tests/platform-shell-signout-prefetch.test.ts \
  tests/ship-audit-api-inventory.test.ts
```

Observed result at H1 closure: **116/116 passed, 0 failed, 0 skipped**.

Additional build evidence:

- `npm run typecheck` — passed.
- `npm run lint` — passed with no warning.
- `npm run build` — optimized production build passed.

## Browser acceptance evidence

- Ordered Final Acceptance J4/J7: `fa-1784054148752-d1a8f9ab` — **3/3 passed** with isolated anonymous request context and unchanged quota/error assertions.
- Golden path before RF-036: `gp-1784055093318-ae9ed205` — failed the strict request assertion on a protected sign-out prefetch.
- Golden path after RF-036: `gp-1784055279098-5047b432` — passed register → workspace → sign-out/sign-in → plan/dispatch → mock completion → stitch → playback → non-empty download, with no console or unexpected network error.
- The last complete pre-H1 serial Final Acceptance evidence remains `fa-1784011167411-04cf5e45` at 23/23. A fresh full 23/23 run is part of H2 post-merge verification and is not claimed here.

Failed diagnostic run IDs are retained in `qa/ITERATION_LOG.hardening.md`; no assertion, quota, retry, or console rule was relaxed to obtain the passing evidence.

## Commit chain

`b8ba530`, `c3c3268`, `0cf5af6`, `132401a`, `f0bbdbc`, `b92e344`, `c8fd6bc`, `3961854`, `be0c7ea`, `2c97542`, `cb14d73`, `e34bc55`, `073a86c`, `12253a5`, `b04beb7`

## Gate boundary

H1 completion does not make the product release-ready. H2 remains blocked until RF-005's human-supervised deployment and 60-minute production heartbeat observation finish; RF-019 still blocks unsafe production migration execution. The five UI P1 items RF-008/RF-009/RF-011/RF-012/RF-013 remain on the isolated UI branch until the authorized H2 merge.
