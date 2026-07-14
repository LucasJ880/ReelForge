# Phase 2 · Iteration 2.3 — Provider billing safety

- Date: 2026-07-13 (America/Toronto)
- Defect: RF-003
- Commit: `961d660`
- Real provider calls: **0**
- Production database writes: **0**

## Reproduction closed

Before the repair, a batch submit timeout was returned to `QUEUED`, and a single-video retry treated a provider status lookup exception as permission to submit again. Both paths could duplicate a provider-side job and charge.

The repair persists request intent before any provider call and records one of `NOT_STARTED`, `SUBMITTING`, `ACCEPTED`, `REJECTED`, or `ACK_UNKNOWN`. Any ambiguous acknowledgement—including transport timeout, 5xx, malformed success, status lookup failure, or failure to persist an accepted provider ID—becomes `ACK_UNKNOWN` and cannot be automatically or manually resubmitted. Concurrent retries use compare-and-swap; logical segment keys and request-level idempotency close the initial double-submit path.

## Verification

- Focused billing-safety suite: **16/16 passed**.
- Batch timeout: provider submit count `1`, terminal `ACK_UNKNOWN`, no requeue.
- Provider accepted / DB acknowledgement save lost: terminal `ACK_UNKNOWN`, no second submit.
- Single retry status lookup timeout: new provider submit count `0`.
- Two concurrent manual retries: one fulfilled, one CAS-rejected, provider submit count `1`.
- Repeated logical segment dispatch: one provider submit.
- Three concurrent request claims: one owner, two `in_progress`; one persistent row.
- Optimized Next build: passed.
- Golden path `gp-1784004030002-3e3089af`: passed.
- Golden idempotent replay `gp-1784004092244-2a4be693`: passed; same response IDs and unchanged VideoJob count before/after replay.

## Rehearsal database

`20260713_phase2_provider_submission_integrity` and `20260713_phase2_ack_unknown_backfill` were applied only to the Neon rehearsal branch. The first app-role attempt correctly failed for missing DDL permission; the failed record was rolled back with the branch owner, migrations were applied with the owner role, and the rehearsal app role received DML access. A direct app-role read of `VideoDispatchRequest` then succeeded. No connection string or credential was logged into the repository.
