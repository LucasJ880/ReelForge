# Gate C0 — Human production deployment checklist

- Owner: human release operator
- Prepared: 2026-07-14 (America/Toronto)
- Agent authority: preparation and verification only; **no production deploy and no real provider call**
- Release prerequisite commits: `7860985`, `2dded10`, `5b713b9`, and `419bb12`

## Stop conditions

Do not deploy if any item below is true:

- the checkout is not a clean descendant of all four prerequisite commits;
- a fresh Neon branch rehearsal of the migration sequence has not passed;
- the Neon production restore branch/PITR point is missing;
- any production queue row is eligible for provider submission or polling during the no-spend observation window;
- Vercel Production is configured for mock video (`VIDEO_PROVIDER=mock`, `VIDEO_ENGINE_MOCK` not explicitly false, or `AIVORA_DRY_RUN` enabled);
- the exact previous migration-compatible Vercel deployment ID is not recorded;
- the RF-003 migration history is partial or differs from the observed-state cases below.

`ASSUMPTION:` Repository evidence says both RF-003 migrations have been applied only to the Neon rehearsal branch, not production. The operator must verify production `_prisma_migrations` before any write; observed database state overrides this assumption.

`ASSUMPTION:` New customer submissions are paused for the migration and 60-minute heartbeat window. If traffic cannot be paused, this no-real-provider certification window must not start.

## 1. Record and rehearse

- [ ] Record the release SHA and prove ancestry:

```bash
git status --porcelain
git rev-parse HEAD
for sha in 7860985 2dded10 5b713b9 419bb12; do
  git merge-base --is-ancestor "$sha" HEAD || exit 1
done
```

- [ ] Record the current production deployment ID/URL and its Git SHA.
- [ ] Create a fresh Neon branch from the current production head and record its branch ID and timestamp.
- [ ] Run sections 2–6 against that branch first. Keep the rehearsal transcript, migration-status output, and invariant queries. Do not substitute the older general rehearsal branch for this production-head rehearsal.
- [ ] Immediately before production writes, create and verify a Neon production restore branch/PITR point.
- [ ] Load the direct, unpooled production owner connection and the runtime app-role connection through the operator's secret manager. Do not paste either URL into chat, reports, or shell history.
- [ ] Verify both connections point to the intended Neon `us-east-1` production database; the owner host must not be a `-pooler` host.

## 2. RF-003 ordering hazard — do not run ordinary deploy first

The repository sorts these folders in the wrong dependency order:

1. `20260713_phase2_ack_unknown_backfill`
2. `20260713_phase2_provider_submission_integrity`

The first migration references the enum and columns created by the second. Therefore **do not initially run** `prisma migrate deploy`, `npm run db:migrate:deploy`, or `scripts/apply-production-migrations.ts`; they would attempt the dependent backfill first.

- [ ] With the owner connection, inspect the latest history rows:

```sql
SELECT DISTINCT ON (migration_name)
  migration_name, started_at, finished_at, rolled_back_at,
  logs IS NOT NULL AS has_error_log
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260713_phase2_ack_unknown_backfill',
  '20260713_phase2_provider_submission_integrity',
  '20260713_phase2_template_archival',
  '20260713_phase4_content_reports',
  '20260713_product_image_studio',
  '20260713_video_job_last_progress',
  '20260714_final_video_stitch_attempt_token',
  '20260714_phase2_batch_quota_guard'
)
ORDER BY migration_name, started_at DESC;
```

- [ ] Record pre-backfill counts; retain only counts, never customer prompts or asset URLs:

```sql
SELECT
  count(*) FILTER (WHERE "externalJobId" IS NOT NULL) AS external_id_jobs,
  count(*) FILTER (
    WHERE "externalJobId" IS NULL AND status = 'RUNNING'
  ) AS running_without_external_id,
  count(*) FILTER (
    WHERE "externalJobId" IS NULL
      AND ("submitAttempts" > 0 OR "submittedAt" IS NOT NULL)
  ) AS attempted_without_external_id
FROM "VideoJob";

SELECT count(*) AS batch_count FROM "BatchJob";
```

Choose exactly one observed-state branch:

- **Both RF-003 migrations pending and provider objects absent:** continue to section 3.
- **Provider migration already successful and its objects complete:** do not rerun its SQL. If the ack migration has a failed row, mark only that row rolled back, then continue to section 4.
- **Provider objects complete but migration history pending:** verify every object in section 3, then use only `migrate resolve --applied` for the provider migration; do not rerun SQL.
- **Any partial/mismatched state:** stop. Do not deploy and do not mark anything applied. Repair forward and rehearse that exact state on a branch first.

## 3. One-time provider-integrity bootstrap

- [ ] If a previous ordinary deploy created a failed ack row, first reconcile that failed attempt. This changes migration history only; it does not undo SQL:

```bash
DATABASE_URL="$OWNER_DB" npx prisma migrate resolve \
  --rolled-back 20260713_phase2_ack_unknown_backfill
```

- [ ] Atomically execute the prerequisite provider migration with the direct owner connection:

```bash
psql "$OWNER_DB" -X --set=ON_ERROR_STOP=1 --single-transaction \
  --file prisma/migrations/20260713_phase2_provider_submission_integrity/migration.sql
```

- [ ] Before reconciling history, verify both enums and all expected objects exist:

```sql
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('ProviderSubmissionState', 'VideoDispatchRequestState')
ORDER BY t.typname, e.enumsortorder;

SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'VideoJob' AND column_name IN (
  'logicalJobKey', 'providerRequestKey', 'submissionState',
  'submissionErrorClass', 'providerUnitPriceUsd'
)) OR table_name = 'VideoDispatchRequest'
ORDER BY table_name, ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE indexname IN (
  'VideoJob_logicalJobKey_key',
  'VideoJob_providerRequestKey_key',
  'VideoDispatchRequest_userId_idempotencyKey_key',
  'VideoDispatchRequest_state_createdAt_idx'
)
ORDER BY indexname;
```

- [ ] Only after the schema exactly matches the committed SQL, mark the prerequisite applied:

```bash
DATABASE_URL="$OWNER_DB" npx prisma migrate resolve \
  --applied 20260713_phase2_provider_submission_integrity
```

If SQL succeeds but `resolve` fails, do not rerun SQL. Stop and reconcile migration history against the verified objects.

## 4. Apply the dependent backfill and remaining expand migrations

- [ ] Ordinary migration order is now safe:

```bash
DATABASE_URL="$OWNER_DB" npx prisma migrate deploy
```

- [ ] Run the repository production helper once. Its internal deploy must be a no-op; it then grants table/sequence access and checks the app role:

```bash
NEON_PRODUCTION_OWNER_DATABASE_URL="$OWNER_DB" \
DATABASE_URL="$APP_DB" \
npx tsx scripts/apply-production-migrations.ts
```

- [ ] From the app-role connection, verify enum usage. If either result is false, grant these two exact types from the owner connection and recheck:

```sql
SELECT
  has_type_privilege(current_user, 'public."ProviderSubmissionState"', 'USAGE')
    AS provider_state_usage,
  has_type_privilege(current_user, 'public."VideoDispatchRequestState"', 'USAGE')
    AS dispatch_state_usage;
```

Owner-only repair if needed, with the actual app role quoted as an identifier:

```sql
GRANT USAGE ON TYPE
  "ProviderSubmissionState", "VideoDispatchRequestState"
TO "APP_ROLE_NAME";
```

## 5. Database acceptance before application deployment

- [ ] Prisma reports no pending/failed migration and no schema drift:

```bash
DATABASE_URL="$OWNER_DB" npx prisma migrate status
DATABASE_URL="$OWNER_DB" npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

- [ ] Every one of the eight migration history rows in section 2 is finished and not rolled back.
- [ ] RF-003 conservative backfill invariants are zero:

```sql
SELECT count(*) AS external_id_not_accepted
FROM "VideoJob"
WHERE "externalJobId" IS NOT NULL
  AND "submissionState" <> 'ACCEPTED';

SELECT count(*) AS ambiguous_not_quarantined
FROM "VideoJob"
WHERE "externalJobId" IS NULL
  AND (
    status = 'RUNNING' OR "submitAttempts" > 0 OR "submittedAt" IS NOT NULL
  )
  AND "submissionState" <> 'ACK_UNKNOWN';

SELECT "submissionState", count(*)
FROM "VideoJob"
GROUP BY "submissionState"
ORDER BY "submissionState";

SELECT count(*) AS batches_without_quota_authorization
FROM "BatchJob"
WHERE "quotaConsumedAt" IS NULL;
```

Expected: the first, second, and fourth counts are `0`. Retain the grouped count as evidence.

- [ ] Confirm `FinalVideo.stitchAttemptToken` exists and remains nullable.
- [ ] Using the app role, begin a transaction, insert/read one `VideoDispatchRequest` referencing a dedicated test user, and roll back. Confirm the new table, enum, FK, and DML grants work and that no probe row persists.

## 6. Prove the observation window cannot call a provider

The production runtime must be real-provider-ready because production mock is rejected, but this Gate does **not** authorize a call. Pause new customer submissions and require all three counts below to be zero before deployment:

```sql
-- A batch capable of creating/dispatching new post-cutoff work.
SELECT count(*) AS dispatchable_active_batches
FROM "BatchJob"
WHERE status IN ('EXPANDING', 'RUNNING', 'PAUSED')
  AND (
    "dispatchQuarantineDecision" = 'RELEASED'
    OR "createdAt" > TIMESTAMPTZ '2026-07-13T14:35:00.000Z'
  );

-- A job that process-batches could submit.
SELECT count(*) AS dispatchable_queued_jobs
FROM "VideoJob"
WHERE status = 'QUEUED'
  AND (
    "dispatchQuarantineDecision" = 'RELEASED'
    OR (
      "dispatchQuarantineDecision" IS NULL
      AND "createdAt" > TIMESTAMPTZ '2026-07-13T14:35:00.000Z'
    )
  );

-- A job that poll-videos could query at a provider.
SELECT count(*) AS provider_pollable_jobs
FROM "VideoJob"
WHERE status IN ('QUEUED', 'RUNNING')
  AND "externalJobId" IS NOT NULL
  AND (
    "dispatchQuarantineDecision" = 'RELEASED'
    OR (
      "dispatchQuarantineDecision" IS NULL
      AND "createdAt" > TIMESTAMPTZ '2026-07-13T14:35:00.000Z'
    )
  );
```

- [ ] Record a pre-window aggregate snapshot of `VideoJob` count, total `submitAttempts`, and maximum `submittedAt`.
- [ ] Do not release historical quarantine, submit a batch, retry a task, or run a real canary during this window.
- [ ] If any count is nonzero, stop. Do not expire/cancel it ad hoc; reconcile it through the approved CAS workflow first.

## 7. Vercel Production configuration and deployment

- [ ] Confirm the Production environment has `CRON_SECRET` and the existing database/auth/storage variables. Do not reveal values.
- [ ] Confirm external stitch preparation: `STITCH_RUNTIME=external`, `GITHUB_STITCH_DISPATCH_TOKEN`, `GITHUB_STITCH_REPOSITORY` (or Vercel-derived repository), and `GITHUB_STITCH_REF` (or Vercel Git ref). Do not trigger the workflow in this Gate.
- [ ] Keep the existing approved real video-provider configuration. Production mock flags are forbidden; provider selection or a paid call is outside this checklist.
- [ ] The existing `shuyu_api_key` secret is not a deployment signal and is not used by the current provider enum; do not rename, print, or exercise it here.
- [ ] Confirm `vercel.json` contains minute crons for:
  - `/api/cron/process-batches`
  - `/api/cron/poll-videos`
  - `/api/cron/stitch-dispatch`
- [ ] Confirm the Vercel Production plan accepts minute cron schedules and the dashboard registers all three after deployment; otherwise roll back and do not start the 60-minute window.
- [ ] Deploy/promote the recorded release SHA to Vercel Production.
- [ ] Record the new deployment ID, URL, Git SHA, start/end timestamps, and previous deployment ID. Do not send secret values.

## 8. Immediate post-deploy health checks

- [ ] `GET /api/health` returns HTTP 200 with:
  - `ok: true`;
  - `region: "na"`;
  - `database: "connected"`;
  - `videoProviderStatus: "configured"`, never `"mock"`;
  - `envValidation.ok: true` and no missing values.
- [ ] `GET /api/health?storage=ping` reports the approved IAD1 Vercel Blob store reachable without writing an object.
- [ ] A request with a deliberately wrong cron bearer returns 401 and no scheduler heartbeat or DB mutation.
- [ ] Login and the five `/app` areas load from the deployed SHA; no generation button is exercised.
- [ ] Vercel logs contain `scheduler_heartbeat` start/finish events and no credential, connection string, prompt, or provider payload.
- [ ] The three no-provider counts and the aggregate snapshot from section 6 remain unchanged after the first five scheduler ticks.
- [ ] Any 5xx, `outcome:error`, `outcome:degraded`, migration error, or provider submission aborts the observation window and invokes rollback.

## 9. Sixty-minute RF-005 cadence evidence

After at least 60 complete minutes on the exact deployment, export at least 70 minutes of production logs as JSON Lines:

```bash
vercel logs --deployment "$DEPLOYMENT_ID" \
  --environment production --since 70m --until now \
  --json --no-follow --limit 1000 \
  > /tmp/reelforge-production-heartbeats.ndjson

node qa/certification/collect-scheduler-heartbeats.mjs \
  /tmp/reelforge-production-heartbeats.ndjson \
  > qa/evidence/phase2/rf005-production-heartbeats.json
```

The evaluator fails closed unless each scheduler has at least 55 unique finished runs, at least 55 minutes of coverage, p95 gap at most 120 seconds, maximum boundary/internal gap at most 180 seconds, and zero `error`/`degraded` outcomes.

- [ ] Re-run the section 6 snapshots after the window and prove no provider submission/poll occurred.
- [ ] Record the deployment ID and time window in the report; never include the Vercel access token.
- [ ] Only after this report passes may RF-005 move to VERIFIED and `node qa/certification/check-gate-c0.mjs` be expected to return 6/6.

## Rollback points

1. **Before any migration:** no database rollback is needed; keep the old application live.
2. **Provider SQL transaction fails:** `--single-transaction` rolls back the SQL. Inspect the schema before retrying; never assume. A `migrate resolve` command changes history only and does not undo SQL.
3. **Any later migration fails:** keep the old application live, inspect `_prisma_migrations.logs`, repair forward on a production-head branch, and use `resolve --rolled-back` only after proving PostgreSQL rolled back that migration. Never mark a partial schema applied.
4. **Application deployment fails:** promote the recorded previous migration-compatible Vercel deployment. Leave the additive tables, columns, enums, indexes, and backfills in place; old code ignores them.
5. **Queue/provider integrity degrades:** close new submissions, leave ambiguous provider jobs untouched, reconcile `ACK_UNKNOWN`, stop external stitch dispatch, and then promote the prior safe deployment. Do not roll back to pre-RF-003 dispatch code or pre-RF-004 completion code while work is in flight.
6. **Proven data corruption only:** use the verified Neon restore point/PITR. Before resuming traffic, reconcile every provider job created after the restore timestamp; otherwise a database restore can itself cause duplicate billing.

Never use `prisma migrate reset`, `prisma db push`, destructive reverse SQL, or column/type drops in production.
