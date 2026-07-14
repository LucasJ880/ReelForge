# Phase 2 · Iteration 2.2 — Machine endpoint authentication

Date: 2026-07-13 (America/Toronto)

## Reproduction before repair

- With `CRON_SECRET` absent, `/api/cron/process-batches` continued into `db.batchJob.findMany`; the isolated test failed with a Prisma initialization error instead of a fail-closed response.
- With a configured secret and a wrong bearer, both sealed digital-human runner routes returned feature 404 before checking the credential.

## Repair contract

- One shared guard covers four cron routes, two stitch-runner routes, and two sealed digital-human runner routes.
- Missing/empty server secret returns `503 { error: "service unavailable" }` without naming the secret/token mechanism.
- Missing or wrong bearer returns `401 { error: "unauthorized" }`.
- SHA-256 digests are compared with `timingSafeEqual`.
- The guard runs before feature checks, JSON parsing, database queries, queue claims, or completion callbacks.

## Verification

```text
node --import tsx --test \
  tests/machine-endpoint-auth.test.ts \
  tests/digital-human-sealed.test.ts \
  tests/stitch-service-runtime.test.ts
21 passed, 0 failed

npm run typecheck
pass

npx eslint <changed source and test files>
pass

npm run test:golden-path
optimized build: pass
golden path: 1 passed, 0 retry, 13.4s
run: gp-1784001858660-004e8b31
```

Reporter: `qa/evidence/phase1/golden-path-gp-1784001858660-004e8b31.json`.
