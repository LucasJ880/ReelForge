# Gate C0 closure — Final Acceptance evidence

- Date: 2026-07-14 (America/Toronto)
- Product/test baseline: `440c91f`
- Scope: RF-004, RF-006, and RF-018 verification
- Real video-provider calls / paid operations: **0**
- Production database writes: **0**

## Repair traceability

| Defect | Repair commit | Closure evidence |
|---|---|---|
| RF-004 stale stitch callback | `0fc863d` | Attempt-token CAS regressions plus post-repair golden and full acceptance |
| RF-005 scheduler cadence code | `761baec` | Code is isolated and tested; production cadence evidence is intentionally still pending |
| RF-006 teardown crash | `e863c8e` | Original serial suite exits 0 including global teardown |
| RF-018 retry contract mismatch | `df5accb` | Shared billing-safe retry policy; focused, J3, full acceptance, and golden regressions |
| Final Acceptance rehearsal isolation | `440c91f` | Run-scoped fixtures and explicit preview/mock rehearsal boundaries |

The RF-004/RF-005 hashes were recorded in the defect ledger by commit `58a8909`. No existing assertion was loosened, and no test was deleted, disabled, or newly skipped.

## Reproducible verification record

### Final Acceptance

Command:

```bash
npm run test:final-acceptance
```

Result:

- run ID: `fa-1784011167411-04cf5e45`;
- **23/23 passed** serially in approximately 8.1 minutes;
- `test-results/final-acceptance/.last-run.json` records `status: passed` and an empty `failedTests` array;
- global teardown exited 0 and deleted 22 run-scoped batches and 4 product images, then archived 1 run-scoped acceptance template;
- HTML report: `playwright-report/final-acceptance/index.html`;
- traces/screenshots: `test-results/final-acceptance/`.

The immediately preceding targeted retry regression also passed setup + desktop J3 + mobile J3 as **3/3**, run `fa-1784011098406-50ddd9f4`.

### Golden path

Command after an optimized build:

```bash
npm run test:golden-path:run
```

Result:

- run ID: `gp-1784011670688-32bda3f8`;
- **1/1 passed** in 13.1 seconds;
- registration → login → create → mock generation → terminal accounting → stitch → playback → non-empty download completed;
- JSON reporter: `qa/evidence/phase1/golden-path-gp-1784011670688-32bda3f8.json`;
- screenshot: `qa/screenshots/phase1/gp-1784011670688-32bda3f8/completed-video.png`.

The pre-RF-018 full-suite baseline golden `gp-1784009968934-c0a37ba7` also passed and is retained for before/after comparison.

### Unit, database, build, and static checks

Commands:

```bash
npm test
RUN_DB_TESTS=true DATABASE_URL="$NEON_REHEARSAL_DATABASE_URL" \
  node --import tsx --test tests/metrics-iteration.integration.test.ts
npm run build
npm run typecheck
npm run lint
git diff --check
```

Results:

- full unit suite: **727/728 passed, 0 failed**, with only the explicitly conditional database integration test skipped in the default run;
- the conditional database integration test was then enabled against the Neon rehearsal branch and passed **1/1, 0 skipped**;
- optimized build, TypeScript, full ESLint, and whitespace/diff checks passed.

No connection string, token, provider payload, or other secret is contained in this evidence file.

## Gate consequence

RF-004 and RF-006 now meet their verification requirements. RF-018 is closed by the same full-suite record. RF-005 remains below VERIFIED until the exact release is deployed by a human and the three production schedulers produce a passing 60-minute heartbeat report.
