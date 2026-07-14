# Phase 2 · Iteration 2.0 — Golden-path invariant recovery

Date: 2026-07-13 (America/Toronto)

## RF-001 attempt 1 (rolled back)

- Before repair: four production-mock reproduction assertions failed.
- Focused result after repair: 31/31 passed.
- Mandatory golden result: failed because one mock provider job reached `FAILED`.
- Constitutional action: all RF-001 product and regression changes were immediately rolled back. RF-001 remains OPEN, attempt 1/3.
- Reporter: `qa/evidence/phase1/golden-path-gp-1784001035053-52c5af59.json`.

## RF-017 isolation repair

- Baseline rebuild after rollback reached `/api/auth/register` and received 429 because prior independent runs shared the same persisted IP bucket.
- Reporter: `qa/evidence/phase1/golden-path-gp-1784001222928-d6f0321b.json`.
- Repair: run-unique RFC 3849 client IP in the golden browser context; explicit `VERCEL_ENV=preview` runtime identity.
- Product registration limits, status codes, and the E2E 200 assertion were not changed.

## Verification

```text
node --import tsx --test tests/golden-path-network-identity.test.ts
1 passed, 0 failed

npm run typecheck
pass

npx eslint e2e/golden-path-network-identity.ts playwright.golden-path.config.ts tests/golden-path-network-identity.test.ts
pass

npm run test:golden-path:run
1 passed, 0 retry, 12.8s
run: gp-1784001316316-a8fd60a5
```

Successful reporter: `qa/evidence/phase1/golden-path-gp-1784001316316-a8fd60a5.json`.
