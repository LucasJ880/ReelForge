# Phase 5a · Mock Readiness Gate Report

Date: 2026-07-13  
Environment: Neon rehearsal branch (`us-east-1`) + Vercel Blob IAD1  
Video / LLM / image / content-review mode: mock  
Real Buddy / BytePlus calls: **0**

## Gate result

**PASS — Phase 5a mock readiness is complete.** The system may move to the human approval point for Phase 5b, but this report does not authorize a real provider canary, production deployment, or an external “launched” claim.

## 1. Capacity: 500 × 3

- Three independent 500-item batches were created through the real batch service and persisted on the Neon rehearsal branch.
- Exact reconciliation: `1,500 submitted = 1,500 succeeded + 0 failed + 0 cancelled`.
- Unique item keys: 1,500; queued/running after completion: 0.
- Global provider concurrency peaked at exactly 50 and never exceeded the 50-slot ceiling.
- Completion time: 138,408 ms (about 2m18s), below the `< 4h` mock capacity criterion.
- Mock provider only: all jobs recorded provider `MOCK`, mock external IDs and template/prompt snapshots. Real provider calls and provider cost were zero.
- Three production templates were exercised: `ugc-handheld-review`, `lifestyle-use-demo`, and `one-action-proof`.
- The temporary rehearsal-only `studio.batchConcurrencyLimit=50` was restored to 10 in `finally`; customer batch API/UI stays capped at 200 and the studio monthly limit stays 200.

Evidence: [capacity-500x3.json](./evidence/phase-5a/capacity-500x3.json)

## 2. Failure, retry and reconciliation readiness

The production-like browser suite used the deterministic mock distribution of 5% provider failures plus 2% stalls. It verified:

- a 100-item batch reaching the expected 93 success / 7 diagnosed failure terminal split;
- machine-readable failure attribution and customer-readable recovery messages;
- single-job retry and bulk retry preserving the original asset assignment and template version;
- retry completion without duplicate item keys;
- watchdog timeout and provider-stall classification;
- breaker `open → half-open probe → closed` recovery;
- no silent loss: terminal counts reconcile to requested counts.

## 3. First-user and core-product journeys

- Main desktop + 390px mobile acceptance: **19/19 passed** in 7.9 minutes.
- Coverage includes single video, 100/200-item batches, concurrent batches, uploads, cancellation, refresh/reopen/idempotency, library, templates, racing route, Slow 3G and performance budgets.
- A separate true-new-user journey registers through the UI, auto-signs in, verifies `CUSTOMER` + starter workspace, creates a video, completes mock generation/stitching and reaches the library.
- Desktop + mobile onboarding plus setup: **3/3 passed** in a combined 30.5 seconds; each journey asserts `< 10 minutes`.

The first onboarding attempt exposed a real defect: `/privacy` and `/terms` were redirected to login during registration-page prefetch. They are now explicitly public, and both viewport reruns passed with no network or console blockers.

Evidence: [user-journey-summary.json](./evidence/phase-5a/user-journey-summary.json)

## 4. Template quality locking

- 31 original templates across 18 product/use categories.
- 31 unique slugs, 31 unique shot/prompt structures.
- A 31-template × 20-product matrix rendered 620 deterministic prompts.
- Zero collisions, unresolved placeholders, missing reference-image bindings, missing visual-truth guards or missing “never invent” guards.
- Active template versions remain immutable; changes require a new draft/version.

This proves deterministic prompt construction and guard coverage. It does **not** prove real-provider hallucination rate or competitor parity; those require the locked real samples and blind VLM comparison in SL-C/P1/P2.

Evidence: [template-quality-matrix.json](./evidence/phase-5a/template-quality-matrix.json)

## 5. Regression status

- Lint: 0 errors, 0 warnings.
- Typecheck: pass.
- Production build: pass.
- Unit/integration suite: 642 total, 641 passed, 0 failed, 1 conditional database integration skip.
- Production dependency audit: 0 critical (gate criterion met). Eight high, ten moderate and one low transitive advisory remain recorded for Phase 3.5 remediation; no forced breaking dependency upgrade was mixed into this capacity change.

Evidence: [verification-summary.json](./evidence/phase-5a/verification-summary.json)

## Remaining gates and limits

1. Buddy remains fail-closed: Vercel secret name is `shuyu_api_key`, but confirmed unit price and funded credits are still required by F4. No secret value is stored in this report.
2. Mock capacity does not establish Buddy/BytePlus rate limits, real latency, real cost, visual quality or P1/P2 competitor parity.
3. Phase 5b real canary is a locked human approval point. A budget, provider choice and all provider-specific unlock conditions must be confirmed before any real call.
4. No production deployment was performed in Phase 5a.

## Gate request

Human review should verify the evidence above and either approve Phase 5b with an explicit provider and budget, or return Phase 5a findings for correction.
