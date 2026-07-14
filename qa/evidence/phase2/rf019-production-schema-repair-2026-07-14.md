# RF-019 production schema repair — 2026-07-14

- Window: 2026-07-14 18:44–19:05 EDT
- Production release: `dd811de` (PR #2 merge)
- Production deployment: `dpl_AycPKRcWQADBTZpypLCyTYW9q2uG`
- Real provider calls / paid operations: **0**
- Database rollback point: Neon branch `br-dark-sun-amkoqa3j` (`rf019-prewrite-restore-20260714-185257`)

## Failure reproduced

- `/app/batches` rendered the customer error boundary with digest `2593178714` because Prisma raised `P2022`: `BatchJob.requestHash` did not exist.
- `POST /api/video-generation/dispatch` failed before provider submission because `VideoDispatchRequest` did not exist.
- `process-batches` and `poll-videos` cron requests returned 500 for the same schema-version mismatch.
- Production code had been promoted before the four expand migrations were applied.

## Safety preparation

- Confirmed the checkout is clean and descends from `7860985`, `2dded10`, `5b713b9`, and `419bb12`.
- Created fresh production-head rehearsal branch `br-lingering-silence-amr52l16`.
- Rehearsal observed state: all four migration history rows absent and all target schema objects absent.
- Rehearsal preflight: 17 batches; 409 video jobs; 0 active batches; 0 queued/running jobs; 0 provider-pollable jobs.
- Completed the exact bootstrap, dependent migrations, helper grants, schema-drift check, data invariants, app-role transaction/rollback probe, and current Prisma read probes on the rehearsal branch.
- Created and verified the production pre-write restore branch above. It contains 17 batches, 409 video jobs, and the pre-migration schema.
- A Neon owner credential appeared in local CLI output while obtaining the rehearsal URI. It was immediately treated as exposed: the rehearsal and production owner passwords were rotated, the local production owner secret was replaced with a direct unpooled URI, and the runtime app role was unaffected.

## Production repair

The dependency-inverted folders were not run in ordinary order. The production sequence was:

1. Execute `20260713_phase2_provider_submission_integrity` inside one explicit PostgreSQL transaction.
2. Verify both enums, five `VideoJob` columns, all 11 `VideoDispatchRequest` columns, four indexes, and the FK.
3. Mark only `20260713_phase2_provider_submission_integrity` applied.
4. Run ordinary Prisma deploy, which successfully applied:
   - `20260713_phase2_ack_unknown_backfill`
   - `20260714_final_video_stitch_attempt_token`
   - `20260714_phase2_batch_quota_guard`
5. Run `scripts/apply-production-migrations.ts`; its internal deploy was a no-op and app-role visibility/grants passed.

## Acceptance evidence

- `prisma migrate status`: database schema is up to date.
- `prisma migrate diff`: no difference detected.
- All four repaired migration history rows are finished and not rolled back.
- `external_id_not_accepted = 0`.
- `ambiguous_not_quarantined = 0`.
- `batches_without_quota = 0`.
- Submission-state totals: `NOT_STARTED = 239`, `ACCEPTED = 170`.
- `FinalVideo.stitchAttemptToken` exists and remains nullable.
- App role has `USAGE` on both new enum types.
- App-role `VideoDispatchRequest` insert/read probe succeeded inside a transaction; rollback left 0 probe rows.
- Video-job accounting remained unchanged: 409 rows, 71 total submit attempts, latest submission timestamp unchanged.
- Four historical `FinalVideo=PENDING` rows remained untouched.
- Provider-call eligibility after repair: 0 dispatchable batches, 0 dispatchable queued jobs, 0 provider-pollable jobs.
- Production browser verification with the demo account:
  - `/app/batches` loads the historical batch list instead of the error boundary;
  - `/app/create` loads Agent Director, the Generate button, and “Browse all 31 templates”;
  - browser console errors: 0;
  - no generation control was exercised.
- First post-repair cron sample: four HTTP 200 requests each for `process-batches`, `poll-videos`, and `stitch-dispatch`; no production error logs in the sampled five-minute window.

## Remaining independent gate

`/api/health` still returns 503 because Production remains deliberately configured with the mock video engine. The database now reports connected and the customer/database failure is fixed, but production mock is rejected by the fail-closed environment policy. Provider configuration and any paid call remain outside this repair and require the existing explicit budget/provider gate.
