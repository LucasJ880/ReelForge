# RF-040 / RF-041 production generation repair evidence

Date: 2026-07-14 (America/Toronto)

## Scope and authorization

The human reported that deployed single and batch video creation could not complete and authorized root-cause repair, including production database/configuration work. The latest request explicitly asks for one real front-end video attempt after the repair. This change does not enable Buddy: Buddy pricing and credits remain unconfirmed, so that provider stays fail-closed.

## Production reproduction

- Agent Director reached the real plan step, then direct dispatch failed before a provider acknowledgement.
- The persisted dispatch was `FAILED` with a rejected preflight classification, no external provider job id, and a production-mock guard error.
- Production configuration inspection (values redacted) showed:
  - international BytePlus endpoint configured;
  - legacy `ARK_API_KEY` present;
  - canonical `BYTEPLUS_ARK_API_KEY` absent;
  - `VIDEO_ENGINE_MOCK=true`;
  - real OpenAI moderation enabled with its credential present.
- The diagnostic request made zero video-provider calls. Its two entitlement units were compensated through negative `UsageLog` entries and a compare-and-swap update of the request quota marker.

## Batch reproduction

The latest production `POST /api/batches` failures selected an immutable template requiring at least three product images but supplied one. The service rolled the transaction back: no BatchJob, batch VideoJob, batch usage row, or provider call was created. The old API boundary converted the validation failure to HTTP 500 and the UI discarded the useful detail.

## Repairs

1. Runtime readiness is evaluated before any paid planning, quota ownership, idempotency mutation, job creation, batch replay, lease recovery, or retry reset.
2. Production mock, missing/blank canonical BytePlus key, non-international endpoint, invalid env enum, and missing mandatory real-moderation key all return one typed unavailable result.
3. Batch template minimum assets are enforced in both the customer wizard and the service. The API returns the strict customer error envelope with HTTP 422.
4. Batch customer error copy is selected from the machine code; an English workspace cannot display a Chinese upstream error.
5. The `/app` Studio token set is also applied to the document root only while `.studio-theme` is mounted, preventing the light root canvas from appearing below short/transitioning pages. Public/auth surfaces remain light.

## Zero-cost real-user rehearsal

Environment: optimized local build, Neon rehearsal branch, explicit Preview/dry-run mock video/LLM/review, local stitch runtime, zero failure/stall/latency injection.

Journey:

1. Open `/app/create` and enter through the demo login.
2. Submit a natural-language 15-second vertical reusable-water-bottle brief.
3. Agent Director produces the brief and generation plan.
4. Confirm generation with no end card.
5. Library displays the new item at 20% while the mock provider job is active.
6. One authenticated scheduler poll transitions the only VideoJob from RUNNING to SUCCEEDED and inline stitching marks the FinalVideo READY.
7. Library displays `已完成`; detail exposes the video and download URL.

Result:

- FinalVideo id: `cmrlbl4e1000fliol1d6kb2zz` (rehearsal database only).
- Media: H.264 video + AAC audio, 720x1280, browser `readyState=4`, download link present.
- Root canvas at 1280x720: html/body/Studio all `rgb(16, 16, 21)`; no light canvas exposure.
- Video/LLM provider spend: zero (explicit mock rehearsal).

## Automated verification

- Focused generation/runtime/batch/design suite: 72/72 pass.
- `npm run typecheck`: pass.
- Scoped ESLint: pass.
- `npm run build`: pass.
- `git diff --check`: pass.

## Remaining production gate

Before production verification:

1. confirm there are zero eligible QUEUED/RUNNING jobs (observed zero before configuration change);
2. copy the existing international credential to `BYTEPLUS_ARK_API_KEY` without exposing it;
3. set `VIDEO_PROVIDER=byteplus`, `VIDEO_ENGINE_MOCK=false`, and the canonical international `ARK_BASE_URL`;
4. deploy the repaired commit;
5. verify health, one-image/min-three batch blocking, dark document canvas, and exactly one 15-second front-end canary. Do not automatically retry an ambiguous provider response.
