# Phase 2 · Iteration 2.1 — Production mock fail-closed

Date: 2026-07-13 (America/Toronto)

## Reproduction before repair

Four assertions failed:

1. Vercel Production accepted `VIDEO_ENGINE_MOCK=true` in deployment validation.
2. Vercel Production accepted `AIVORA_DRY_RUN=1` plus `VIDEO_PROVIDER=mock`.
3. `MockVideoProvider.createVideoJob` created a job in Vercel Production.
4. The legacy Seedance mock branch created a job in Vercel Production.

## Repair contract

- `VERCEL_ENV=production` is always a customer runtime, even if dry-run is present.
- `VERCEL_ENV=preview|development` may run an explicit mock rehearsal.
- A local optimized server may rehearse only with the explicit dry-run fuse.
- Effective mock means `VIDEO_PROVIDER=mock`, dry-run, or no explicit `VIDEO_ENGINE_MOCK=false|0|no`.
- Deployment validation returns unhealthy and actual mock task paths throw before creating/querying a mock job.

## Verification

```text
node --import tsx --test \
  tests/china-env-validation.test.ts \
  tests/production-mock-runtime-guard.test.ts \
  tests/dry-run-guard.test.ts \
  tests/historical-dispatch-quarantine.test.ts
31 passed, 0 failed

npm run typecheck
pass

npx eslint <changed source and test files>
pass

npm run test:golden-path
optimized build: pass
golden path: 1 passed, 0 retry, 12.7s
run: gp-1784001583006-1ca10477
```

Reporter: `qa/evidence/phase1/golden-path-gp-1784001583006-1ca10477.json`.
