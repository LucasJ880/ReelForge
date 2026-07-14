# ReelForge Ship Audit

- Audit date: 2026-07-14 (America/Toronto)
- Phase: 2 — backend hardening in progress
- Source revision: product/test baseline `440c91f` on `codex/final-sprint`
- Coverage status: Phase 0 inventory complete; Phase 1 approved; Gate C0 required dependencies 5/6 verified; RF-005 production cadence and RF-019 migration execution remain blocked on human deployment
- Health legend: `HEALTHY` verified at the stated audit depth · `PARTIAL` representative state missing · `DEGRADED` customer-visible defect · `BLOCKED` delivery blocker · `N/A` intentionally unavailable

## Scope and release invariants

This document inventories every customer, public, operator, and machine entry point before any repair work starts. Phase 0 may add QA evidence only; it must not modify product code, production data, assertions, or existing tests.

Theme instruction conflict resolved at the Phase 0 gate:

- The previously approved design constitution specifies a dark Studio theme for `/app` and a light Editorial theme for auth/public pages.
- The current Ship-Readiness instruction describes a site-wide “Light-first” Phase 4 and lists light/dark coexistence as seed defect S-03.
- Human decision on 2026-07-13: preserve the current color topology. Dark Studio `/app` remains intentional; public/auth and current operational light surfaces remain light. RF-010 is verified by decision.

## Frontend route inventory (33/33)

All routes below are backed by `src/app/**/page.tsx`. The Phase 0 scanner cold-loaded every route at 1440×1000 against the Neon rehearsal branch with explicit mock providers. It recorded console/page errors, HTTP errors, horizontal overflow, and full-page screenshots. Responsive 1280/1920 and loading/empty/error interception remain Phase 3 acceptance work, not Phase 0 evidence.

| Route | Surface | Access boundary | Primary purpose | Cold load | Console/page errors | Network | Layout | Evidence |
|---|---|---|---|---|---|---|---|---|
| `/` | Public | Public | Root entry/redirect | HEALTHY → `/login` | 0 | HEALTHY | HEALTHY | `routes/root.png` |
| `/login` | Auth | Public | Existing-user sign in | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/login.png` |
| `/register` | Auth | Public | Account registration | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/register.png` |
| `/persona` | Public | Public | Persona landing/demo | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/persona.png` |
| `/privacy` | Public | Public | Privacy policy draft | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/privacy.png` |
| `/showcase` | Public | Public | Frozen showcase/demo | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/showcase.png` |
| `/terms` | Public | Public | Terms draft | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/terms.png` |
| `/app` | Customer | Session | Agent Director landing/create entry | HEALTHY → `/app/create` | 0 | HEALTHY | HEALTHY | `routes/app.png` |
| `/app/create` | Customer | Session | Single-video creation flow | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-create.png` |
| `/app/create/images` | Customer | Session | Product Image Studio | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-create-images.png` |
| `/app/batches` | Customer | Session | Batch list/L1 monitoring | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-batches.png` |
| `/app/batches/new` | Customer | Session | Batch creation wizard | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-batches-new.png` |
| `/app/batches/[id]` | Customer | Session + ownership | Batch detail/L2 monitoring | PARTIAL: synthetic 404 only | Expected 404 | Expected 404 | HEALTHY 404 state | `routes/app-batches-id.png` |
| `/app/library` | Customer | Session | Finished video library | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-library.png` |
| `/app/library/[id]` | Customer | Session + ownership | Finished video detail/review/download | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-library-id.png` |
| `/app/racing` | Customer | Session | Campaign racing workspace | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/app-racing.png` |
| `/app/templates` | Customer | Session | Style template library | HEALTHY | 0 | HEALTHY | DEGRADED: filter buttons reach x=1942 | `routes/app-templates.png`; RF-011 |
| `/internal` | Operator | Operator role/persona | Internal overview | HEALTHY → `/internal/orders` | 0 | HEALTHY | HEALTHY | `routes/internal.png` |
| `/internal/ai-usage` | Operator | Operator role/persona | AI usage/cost audit | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-ai-usage.png` |
| `/internal/briefs/[id]` | Operator | Operator role/persona | Brief operations | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-briefs-id.png` |
| `/internal/demo-leads` | Operator | Operator role/persona | Demo lead operations | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-demo-leads.png` |
| `/internal/distillation` | Operator | Operator role/persona | Learning/distillation view | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-distillation.png` |
| `/internal/metrics` | Operator | Operator role/persona | Metric import/analysis | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-metrics.png` |
| `/internal/orders` | Operator | Operator role/persona | Delivery order list | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-orders.png` |
| `/internal/orders/new` | Operator | Operator role/persona | Delivery order creation | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-orders-new.png` |
| `/internal/orders/[id]` | Operator | Operator role/persona | Delivery order operations | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-orders-id.png` |
| `/internal/publish` | Operator | Operator role/persona | Publishing queue | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-publish.png` |
| `/internal/qa` | Operator | Operator role/persona | QA queue | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-qa.png` |
| `/internal/reports` | Operator | Operator role/persona | Content reports/takedown queue | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-reports.png` |
| `/internal/rounds` | Operator | Operator role/persona | Racing round list | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-rounds.png` |
| `/internal/rounds/[id]` | Operator | Operator role/persona | Racing round operations | HEALTHY | 0 | HEALTHY | DEGRADED: action reaches x=1498 | `routes/internal-rounds-id.png`; RF-011 |
| `/internal/settings` | Super admin | Super admin | Admin/user management | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-settings.png` |
| `/internal/videos` | Operator | Operator role/persona | Video operations | HEALTHY | 0 | HEALTHY | HEALTHY | `routes/internal-videos.png` |

Canonical raw evidence: `qa/evidence/phase0-route-scan.json`. Screenshots are relative to `qa/screenshots/baseline/`.

Phase 3 replacement evidence (2026-07-14): all 33 routes were rescanned against real owned dynamic fixtures at 1280/1440/1920. All 99 route-width scans passed document, console, page-error, HTTP 5xx, semantic-control and overflow assertions. `/app/batches/[id]` is now validated with a seeded BatchJob rather than a synthetic 404. See `qa/evidence/phase34/iteration-3.14-all-route-matrix.md` and `qa/screenshots/redesign/phase34-current/`.

### Non-page route behavior

| Route/pattern | Expected behavior | Source | Audit status |
|---|---|---|---|
| `/wizard`, `/wizard/**` | `410 Gone` JSON directing users to `/app/create` | `src/middleware.ts` | STATIC VERIFIED |
| Protected page without session | Redirect to `/login?from=<pathname>` | `src/middleware.ts` | STATIC VERIFIED |
| Protected API without session | `401 { error: "未登录" }` | `src/middleware.ts` | STATIC VERIFIED |
| Unknown page | App not-found UI | `src/app/not-found.tsx` | STATIC VERIFIED |
| Root/runtime error | App error boundary plus route-owned recovery surfaces | `src/app/error.tsx`, route-group and customer `error.tsx` files | DYNAMIC VERIFIED; RF-012 |

## API endpoint inventory (70/70 route files)

Middleware provides public/session boundaries. Phase 0 statically reviewed the endpoint guard calls, ownership lookup patterns, validators, and machine authentication. Full request/response schema snapshots and hostile-input execution belong to Phase 2.

| Endpoint group | Inventory reference | Phase 0 health | Finding |
|---|---|---|---|
| Public/auth/health/intake/webhook | Detailed tables below | HEALTHY static boundary | Production health/mock invariant dynamically verified in RF-001; remaining schemas continue in Phase 2 |
| Customer/account/creative/batch/image/racing/report | Detailed tables below | DEGRADED | Provider submit/retry idempotency is dynamically verified; response schemas and remaining customer error classes are still pending |
| Operator/admin/order/round/QA/publish/report | Detailed tables below | DEGRADED | Guards present; legacy persona can pre-empt staff role (RF-008) |
| Cron/external runner | 8 route files | HEALTHY at authentication depth | Missing secret → sanitized 503; wrong bearer → 401; guard runs before all side effects (RF-002 VERIFIED) |
| Digital-human customer surface | 4 route files | HEALTHY | Feature flag returns sealed 404 for every plan |

The detailed inventory below keeps `PENDING` in the “Contract audit” column to mean **dynamic Phase 2 contract execution not yet performed**. It does not mean the Phase 0 route inventory is incomplete.

### Auth, account, health, billing, and uploads

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET, POST | `/api/auth/[...nextauth]` | Public NextAuth handler | PENDING |
| POST | `/api/auth/register` | Public, rate-limited | PENDING |
| GET, HEAD | `/api/health` | Public, sanitized | VERIFIED: production mock makes deployment validation unhealthy; runtime task paths also reject |
| GET | `/api/me/usage` | Session | PENDING |
| POST | `/api/billing/checkout` | Session | PENDING |
| POST | `/api/upload/blob` | Session | PENDING |
| GET, POST | `/api/admin/users` | Super admin | PENDING |
| PATCH, DELETE | `/api/admin/users/[id]` | Super admin | PENDING |

### Agent Director, briefs, planning, and rendering

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| POST | `/api/personal/agent-chat` | Session | PENDING |
| POST | `/api/video-generation/plan` | Session | PENDING |
| POST | `/api/video-generation/classify-asset` | Session | PENDING |
| POST | `/api/video-generation/dispatch` | Session; idempotency required | PARTIAL: stable-key replay and no duplicate job/quota owner verified; full error schema pending |
| GET, PATCH | `/api/briefs/[id]` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/ad-plan` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/scenes` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/script` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/render` | Session + ownership | PENDING |
| GET, POST | `/api/briefs/[id]/render-status` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/render-retry` | Session + ownership | PENDING |
| POST | `/api/briefs/[id]/qa` | Session + ownership | PENDING |
| POST | `/api/ad-plans/[id]/render` | Session + ownership | PENDING |

### Batch generation and templates

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET | `/api/batch-style-templates` | Session | PENDING |
| POST | `/api/batches` | Session; idempotency required | PENDING |
| GET, POST | `/api/batches/[id]/status` | Session + ownership | PENDING |
| POST | `/api/batches/[id]/cancel` | Session + ownership | PENDING |
| POST | `/api/batches/[id]/retry` | Session + ownership | PENDING |
| POST | `/api/batches/[id]/jobs/[jobId]/retry` | Session + ownership | PENDING |

### Product images and brand assets

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET, POST | `/api/product-images` | Session | PENDING |
| POST | `/api/raw-assets/[id]/preprocess` | Session + ownership | PENDING |
| POST | `/api/projects/[id]/logo/generate` | Session + ownership | PENDING |
| POST | `/api/projects/[id]/logo/select` | Session + ownership | PENDING |

### Delivery orders and round workflow

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET, POST | `/api/delivery-orders` | Operator | PENDING |
| GET, PATCH | `/api/delivery-orders/[id]` | Operator | PENDING |
| GET, POST | `/api/delivery-orders/[id]/assets` | Operator | PENDING |
| POST | `/api/delivery-orders/[id]/research` | Operator | PENDING |
| POST | `/api/delivery-orders/[id]/selling-points` | Operator | PENDING |
| POST | `/api/delivery-orders/[id]/rounds` | Operator | PENDING |
| GET | `/api/rounds/[id]` | Operator | PENDING |
| POST | `/api/rounds/[id]/angles` | Operator | PENDING |
| POST | `/api/rounds/[id]/ad-plans` | Operator | PENDING |
| POST | `/api/rounds/[id]/score` | Operator | PENDING |
| POST | `/api/rounds/[id]/iteration` | Operator | PENDING |
| POST | `/api/rounds/[id]/distill` | Operator | PENDING |
| GET, POST | `/api/metrics/import` | Operator | PENDING |
| POST | `/api/business/metrics` | Session/legacy contract pending | PENDING |

### Racing MVP

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| POST | `/api/racing/rounds/[id]/metrics` | Session + ownership | PENDING |
| POST | `/api/racing/rounds/[id]/analyze` | Session + ownership | PENDING |
| POST | `/api/racing/rounds/[id]/next` | Session + ownership | PENDING |

### QA, publishing, reports, and public intake

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET | `/api/qa` | Operator | PENDING |
| POST | `/api/qa/[id]` | Operator | PENDING |
| GET | `/api/publish` | Operator | PENDING |
| POST | `/api/publish/[id]` | Operator | PENDING |
| POST | `/api/reports` | Session | PENDING |
| GET | `/api/internal/reports` | Operator/session boundary pending | PENDING |
| PATCH | `/api/internal/reports/[id]` | Operator/session boundary pending | PENDING |
| POST | `/api/demo/real-footage-ads/waitlist` | Public | PENDING |
| POST | `/api/persona` | Public/session boundary pending | PENDING |

### Scheduled tasks and external runners

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET, POST | `/api/cron/process-batches` | `CRON_SECRET` | VERIFIED auth fail-closed |
| GET, POST | `/api/cron/poll-videos` | `CRON_SECRET` | VERIFIED auth fail-closed |
| GET, POST | `/api/cron/stitch-videos` | `CRON_SECRET` | VERIFIED auth fail-closed |
| GET, POST | `/api/cron/sweep-stuck-tasks` | `CRON_SECRET` | VERIFIED auth fail-closed |
| GET, POST | `/api/internal/stitch/claim` | `CRON_SECRET` | VERIFIED auth fail-closed |
| POST | `/api/internal/stitch/complete` | `CRON_SECRET` | VERIFIED auth fail-closed |
| GET, POST | `/api/internal/digital-human/claim` | `CRON_SECRET`; feature sealed | VERIFIED auth before sealed response |
| POST | `/api/internal/digital-human/complete` | `CRON_SECRET`; feature sealed | VERIFIED auth before sealed response |

### Digital human sealed surface

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| GET | `/api/digital-human/avatars` | Session; expected fail-closed by feature flag | PENDING |
| GET | `/api/digital-human/voices` | Session; expected fail-closed by feature flag | PENDING |
| GET, POST | `/api/digital-human/jobs` | Session; expected fail-closed by feature flag | PENDING |
| GET | `/api/digital-human/jobs/[id]` | Session; expected fail-closed by feature flag | PENDING |

### Third-party webhooks

| Method | Endpoint | Intended boundary | Contract audit |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | Stripe signature | PENDING |

## Background task and queue inventory

| Executor | Trigger | Responsibility | Failure convergence | Audit status |
|---|---|---|---|---|
| Batch processor | Vercel `/api/cron/process-batches`; manual-only GitHub fallback | Expand and lease queued batch work; submit eligible jobs | Lease CAS, breaker, historical dispatch guard, persisted submission acknowledgement | Code HEALTHY; production minute cadence pending RF-005 evidence |
| Video poller | Vercel `/api/cron/poll-videos`; status endpoint opportunistic polling | Map provider state to internal jobs and synchronize brief/batch state | Poll-error threshold + watchdog + opportunistic sweep | Code HEALTHY; production minute cadence pending RF-005 evidence |
| Stitch coordinator | Vercel `/api/cron/stitch-dispatch`; manual-only GitHub runner | Detect ready assemblies and dispatch one external runner | PostgreSQL advisory lock, active-run de-duplication, claim CAS, retry cap | RF-004 VERIFIED; production minute cadence pending RF-005 evidence |
| External stitch runner | `scripts/stitch-runner.ts` → claim/complete APIs | Download, normalize, concatenate, upload, complete | Claim writes attempt token; completion is `id + STITCHING + token` CAS | HEALTHY: RF-004 and machine authentication VERIFIED |
| Stuck-task sweeper | `/api/cron/sweep-stuck-tasks`; also called by poller | Requeue/fail abandoned video and final-video work | Status/quarantine CAS and max attempts | HEALTHY at quarantine depth; RF-007 VERIFIED |
| Video watchdog | Status reads, dispatch/retry checks, cron fallback | Fail jobs beyond provider deadline/grace | CAS from `RUNNING/QUEUED` to `FAILED`; existing unit coverage | Code HEALTHY; production cadence pending RF-005 evidence |
| Product image worker | Product image service claim path | Claim and run queued Image 2 jobs | Job ownership/status guard; dynamic concurrency test deferred | HEALTHY at static depth |
| Digital-human runner | Internal claim/complete APIs | Sealed legacy TTS/avatar pipeline | Feature flag denies before claim/complete | HEALTHY: workflow disabled; no active GitHub workflow |

### Scheduler finding requiring verification

The baseline had no Vercel crons and GitHub's declared `*/5` schedules were observed starting roughly 55–107 minutes apart. RF-005 now adds three minute Vercel crons, converts the old queue schedules to manual-only, and emits structured start/finish heartbeats. Focused and full local regressions pass. The code is not yet production-verified: RF-005 remains FIXED until the exact deployment produces a passing 60-minute trace for `process-batches`, `poll-videos`, and `stitch-dispatch`. The evaluator and policy are in `qa/certification/collect-scheduler-heartbeats.mjs`.

### Production migration finding

The RF-003 ack backfill folder sorts before the folder that creates its enum and columns. If both are pending, a plain first production `prisma migrate deploy` fails deterministically. RF-019 records this P0 deployment issue. The human checklist requires a production-head Neon branch rehearsal, atomic prerequisite bootstrap, exact object/history verification, then ordinary deploy; no production database write has been made by the agent.

## Video-generation state machines

Static enum inventory and implementation trace are complete. The tables below list every observed transition and its guard/failure path.

### VideoJob

`QUEUED · PAUSED · RUNNING · SUCCEEDED · FAILED · CANCELLED`

| From | To | Trigger/guard | Audit |
|---|---|---|---|
| create | `QUEUED` | brief or batch expansion | HEALTHY |
| `QUEUED` | `RUNNING` | lease claim with status CAS | HEALTHY |
| `RUNNING` | `QUEUED` | expired lease before submission, historical guard, or positively confirmed no-create backoff | HEALTHY: ambiguous acknowledgement cannot requeue (RF-003) |
| `RUNNING` | `RUNNING` | provider pending/processing heartbeat | HEALTHY |
| `RUNNING` | `SUCCEEDED` | provider completed + asset persisted | HEALTHY; terminal CAS exists in reconcile paths |
| `RUNNING`/`QUEUED` | `FAILED` | provider failure, poll threshold, watchdog, or eligible sweep timeout | HEALTHY at quarantine depth; undecided historical rows cannot be swept/reconciled/retried (RF-007) |
| `QUEUED` | `PAUSED` | batch breaker/pause | HEALTHY |
| `PAUSED` | `QUEUED` | batch resume | HEALTHY |
| `FAILED` | `RUNNING` | explicit retry after provider-terminal proof and CAS claim | HEALTHY: status lookup ambiguity becomes non-retryable `ACK_UNKNOWN` (RF-003) |
| `FAILED` | `SUCCEEDED` | retry reconciliation finds provider completed | HEALTHY |
| `FAILED` | `QUEUED` | batch retry after billing-safe eligibility check | HEALTHY: `SUBMITTING`/`ACK_UNKNOWN` cannot reset |
| `QUEUED`/`PAUSED` | `CANCELLED` | batch/user cancellation | HEALTHY |

No legal path leaves `SUCCEEDED`, `FAILED`, or `CANCELLED` except the explicit billing-safe retry paths from `FAILED`. Provider submission acknowledgement is independently persisted as `NOT_STARTED → SUBMITTING → ACCEPTED / REJECTED / ACK_UNKNOWN`; `ACK_UNKNOWN` has no automatic or customer retry transition.

### BatchJob

`EXPANDING · RUNNING · PAUSED · COMPLETED · PARTIAL_FAILED · FAILED · CANCELLED`

| From | To | Trigger/guard | Audit |
|---|---|---|---|
| create | `EXPANDING` | idempotent batch create transaction | HEALTHY at static depth |
| `EXPANDING` | `RUNNING` | child jobs expanded successfully | HEALTHY |
| `RUNNING` | `PAUSED` | breaker or manual pause | HEALTHY |
| `PAUSED` | `RUNNING` | manual resume/retry | HEALTHY |
| `RUNNING` | `COMPLETED` | all children succeeded | HEALTHY |
| `RUNNING` | `PARTIAL_FAILED` | terminal mix of success/failure/cancel | HEALTHY |
| `EXPANDING`/`RUNNING` | `FAILED` | expansion failure or all-terminal failure aggregation | HEALTHY at static depth |
| non-terminal | `CANCELLED` | cancellation and child convergence | HEALTHY |

The historical quarantine is enforced in provider dispatch, sweeper selection/CAS, reconciliation, and manual retry. Explicit `RELEASED` remains the only real-mode path for a pre-cutoff undecided task; `EXPIRED` is permanently excluded (RF-007 VERIFIED).

### FinalVideo

`PENDING · STITCHING · READY · FAILED`

| From | To | Trigger/guard | Audit |
|---|---|---|---|
| create | `PENDING` | multi-segment render plan | HEALTHY |
| `PENDING` | `STITCHING` | external/local runner claim with status CAS | HEALTHY |
| `PENDING` | `READY` | single segment or explicitly disabled stitching fast path | HEALTHY at static depth |
| `STITCHING` | `READY` | active runner completion callback | HEALTHY: `id + STITCHING + stitchAttemptToken` CAS; stale callbacks return 409 (RF-004) |
| `STITCHING` | `FAILED` | active runner failure callback or exhausted timeout | HEALTHY: attempt-token CAS; stale callbacks cannot overwrite (RF-004) |
| `STITCHING` | `PENDING` | sweeper timeout with attempts remaining | HEALTHY: retry claim rotates the token, invalidating the old runner |
| `PENDING` | `FAILED` | waiting-for-segments timeout | HEALTHY at static depth |
| `FAILED` | `PENDING` | explicit stitch retry | HEALTHY at static depth |

RF-004 closed the former design/implementation mismatch. Each new claim rotates an attempt token, and completion/failure is accepted only for the active `STITCHING` attempt. Rolling compatibility accepts a missing token only for a pre-migration in-flight row whose stored token is also null.

## Seed defect verification matrix

| Seed | Hypothesis | Current conclusion | Evidence/status |
|---|---|---|---|
| S-01 | Login hierarchy/whitespace is unbalanced | CANNOT_REPRO | Current `/login` and supplied recording both show a filled hero + form composition; baseline `routes/login.png` |
| S-02 | Login → workspace produces white screen/no feedback | VERIFIED FIXED | Persistent branded transition; golden path asserts zero full-viewport blank frames; RF-009 |
| S-03 | Light-first redesign is partial; visual systems mix | ACCEPTED TOPOLOGY | Human confirmed the current dark `/app` plus light surrounding surfaces should remain; RF-010 VERIFIED |
| S-04 | Grid/card alignment and spacing are inconsistent | VERIFIED FIXED | Template/round regressions plus all 99 settled route-width scans pass at 1280/1440/1920; RF-011/RF-023 |
| S-05 | Loading/empty/error states are incomplete | VERIFIED FIXED | Six customer route families pass slow/empty/500 browser injection with accessible retry; all routes own appropriate boundaries; RF-012 |
| S-06 | Chinese and English mix on the same interface | VERIFIED FIXED | Operational copy is routed through typed dictionaries; documented technical-token exemptions remain narrow; RF-013 |
| S-07 | Mutations do not always refresh views | VERIFIED CANNOT REPRO | Final Acceptance exercises create, retry, cancel, status polling, circuit recovery, and product-image handoff on desktop/mobile without manual refresh; run `fa-1784047355157-099e9e8a` |

## Phase 0 completion checklist

- [x] 33/33 frontend page routes enumerated.
- [x] 70/70 API route files and HTTP methods enumerated.
- [x] Background executor entry points enumerated at filename/trigger level.
- [x] Endpoint authorization statically reviewed; dynamic schema contracts explicitly routed to Phase 2.
- [x] Video/batch/final-video legal transitions verified against implementation.
- [x] Supplied screen recording inspected and all seven seed hypotheses concluded.
- [x] Every route cold-loaded with console/network/overflow evidence at the Phase 0 desktop viewport.
- [x] Baseline screenshots stored under `qa/screenshots/baseline/`.
- [x] `qa/DEFECTS.md`, `qa/ITERATION_LOG.md`, and `qa/RELEASE_GATE.md` created and synchronized.

## Phase 0 gate result

**Audit complete; release blocked.** Phase 0 was approved on 2026-07-13 and Phase 1 was authorized.

## Phase 1 golden-path result

- The dedicated suite refuses any database other than the explicit Neon rehearsal URL and removes its run-scoped account/order/final-video records in global teardown.
- The test server blanks Blob and real provider credentials, enables the global dry-run fuse, and uses a deterministic same-origin MP4. No paid provider or external storage write is part of the journey.
- The UI journey covers public registration, automatic workspace entry, explicit sign-out and natural re-login, plan preview, generation dispatch, all-job terminal accounting, authenticated external-stitch completion, owner-scoped library detail, actual media playback, and a non-empty browser download.
- Browser console/page errors, page-observed 5xx responses, and unexpected request failures are hard failures. Only exact Next.js `_rsc` prefetch cancellations with `net::ERR_ABORTED` are classified as intentional framework cancellation and counted in evidence.
- Four independent optimized-server runs passed with no Playwright retry; the first three satisfy the Phase 1 exit rule and the fourth verifies the final env-free evidence configuration. See `qa/evidence/phase1-verification.md`.
- Current ledger: 1 P0 OPEN (RF-019), 1 P0 FIXED pending production cadence (RF-005), 15 P0 VERIFIED, 0 P1 OPEN, 9 P1 VERIFIED.

**Phase 1 automated exit criteria were approved; release remains blocked.** Phase 3 functional closure now passes the 33-route matrix and final serial Final Acceptance run `fa-1784047355157-099e9e8a` at 23/23 with teardown exit 0. Three consecutive final-code golden runs pass. Phase 4 visual evidence is ready for human review; Gate C0 remains blocked until human deployment, RF-019 migration execution, and RF-005 production heartbeat evidence.
