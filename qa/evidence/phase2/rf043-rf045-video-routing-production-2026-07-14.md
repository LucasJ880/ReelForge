# RF-043–RF-045 production video routing evidence

Date: 2026-07-14 (America/Toronto)

## Scope and safety boundary

- The human explicitly superseded the video-only international-endpoint restriction for the CEO-owned Volcengine account.
- The exception is limited to Seedance video processing. Neon and Vercel Blob remain in North America; LLM, moderation, TTS and digital-human routing were not moved.
- BytePlus international remains available. Buddy is discovery-only until an official task contract and confirmed price exist.
- No credential value, signed media URL, raw provider body or database connection string is stored in this evidence.

## Bounded real canary

- Entry: signed-in production `/app/create` customer journey.
- Input: one 15-second, 9:16 World Cup watch-party brief for young adults.
- Runtime: explicit `volcengine_cn_legacy` profile using the fixed Beijing Ark endpoint and its non-fallback credential realm.
- Provider accounting: one submit, one acknowledgement, one external task, zero automatic retries, zero polling errors.
- Result: provider success; internal final asset entered `READY`; customer library detail exposed playback and Download.
- Media verification: HTTP 200; 15.12 seconds; 1080×1920; H.264 video; AAC audio; approximately 3.19 MB.
- Usage verification: one VIDEO_DISPATCH increment and one SEEDANCE_SEGMENT increment for the canary, with no duplicate submit evidence.

## Stitch defect and repair

The first assembly attempt exposed a real product defect: the runner uploaded the final MP4 but no representative JPEG, so final media moderation could not inspect a frame and blocked completion. The repair extracts a bounded JPEG, uploads both assets, and supplies both URLs to the completion contract. The next attempt succeeded.

An independent provider-free production fixture then verified the unattended path: the minute stitch dispatcher invoked the GitHub runner, the fixture reached READY with a video and thumbnail, and its temporary database rows and Blob objects were removed afterward. This rehearsal submitted no video-provider work.

## Immutable multi-route repair

The production schema now contains nullable `videoRouteSnapshot`, `videoModelSnapshot`, and `videoProviderAdapterSnapshot` fields on VideoDispatchRequest, VideoBrief, VideoJob and BatchJob. The migration has no default and performs no historical backfill: absence remains explicit historical uncertainty.

The runtime now:

1. selects an effective route before idempotency and quota work;
2. permits explicit override only to OPERATOR/SUPER_ADMIN system roles;
3. includes the effective snapshot in the idempotency hash;
4. reconstructs submit, poll and retry adapters from persisted evidence;
5. makes zero provider calls for unknown historical real tasks;
6. keeps mock rehearsal isolated from paid routes;
7. keeps Buddy submission disabled while allowing authenticated, read-only model/OpenAPI discovery.

## Database migration evidence

- Rehearsal: the app role correctly failed DDL with PostgreSQL 42501; the failed migration record was marked rolled back by the branch owner, then the owner applied the exact migration.
- Rehearsal app-role check: 12/12 new columns visible and readable.
- Production precondition: zero QUEUED/RUNNING non-mock VideoJobs and zero active batches.
- Production: owner applied `20260714_video_route_snapshots`; app role sees and reads 12/12 columns; non-mock in-flight VideoJobs remain zero.

## Reproducible validation

```text
npm run typecheck
npm test
npm run build
node --import tsx --test <multi-route, Buddy, idempotency, billing and stitch test set>
```

Observed results:

- focused multi-route/stitch set: 61 passed, 0 failed;
- complete unit suite: 901 passed, 0 failed, 1 pre-existing skip;
- TypeScript, scoped ESLint, Prisma schema validation, optimized Next.js build and diff check: passed.

## Remaining gate

RF-045 remains FIXED until the matching application build is deployed, production health passes, the authenticated discovery endpoint returns only its sanitized DTO, and the customer default-route journey still loads without exposing internal route controls.
