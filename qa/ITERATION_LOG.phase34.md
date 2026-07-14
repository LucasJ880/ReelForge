# ReelForge Phase 3/4 UI Closure Iteration Log

This branch-local companion log exists because `qa/ITERATION_LOG.md` was already externally truncated in the working tree before the UI closure branch was created. The unknown change is preserved and excluded from commits.

## Iteration 3.1 — RF-012 route loading, empty, and service-failure states

- Date: 2026-07-14
- Defect: RF-012 (P1)
- Work: removed six silent loader fallbacks; added six loading/error boundary pairs; added explicit empty states and retry actions; separated typed batch not-found/access errors from retryable service faults; added a production-inert preview rehearsal fault injector and a six-route Playwright matrix.
- Files: customer page boundaries/loaders, shared route-state components/copy, typed batch error/status mapping, `playwright.phase34.config.ts`, source and browser regressions.
- Verification: source 6/6; browser 7/7; typecheck/lint/build/diff check green; golden `gp-1784036981221-799edb49` green.
- Ledger: RF-012 `OPEN → VERIFIED`; repair commit `356182a`.
- Evidence: `qa/evidence/phase34/iteration-3.1-rf012-route-states.md`.
- New dependencies: none.

## Iteration 3.2 — RF-009 login-to-Studio continuity

- Date: 2026-07-14
- Defect: RF-009 (`P1 → P0 → VERIFIED`)
- Attempt 1: persistent overlay + unauthenticated workspace prefetch. Golden `gp-1784037382766-208c3e9d` failed because the protected prefetch redirected to login and was then aborted. No assertion was changed; all attempt-1 product/test changes were immediately rolled back.
- Rollback verification: golden `gp-1784037506214-f921e4b0` passed, restoring the invariant.
- Attempt 2: no prefetch; direct safe `/app/create` default; one `router.replace`; no concurrent refresh; persistent branded light-theme status surface.
- Regression: source 3/3; golden `gp-1784037627201-fa3fc7fb` passed with 27 sampled transition frames and 0 blank frames.
- Ledger: RF-009 upgraded to P0 on the red golden run, then moved to VERIFIED after same full journey passed; repair commit `0fe2896`.
- Evidence: `qa/evidence/phase34/iteration-3.2-rf009-login-continuity.md`.
- New dependencies: none.

## Iteration 3.3 — RF-011 layout containment

- Date: 2026-07-14
- Defect: RF-011 (P1)
- Work: wrapped template filters; stretched same-row cards without inventing previews; pinned card metadata/actions; constrained shared header and round action wrapping.
- Regression: source 3/3; complete Phase 3/4 browser suite 9/9; template and real internal round routes at 1280/1440/1920 with 0 overflow; golden `gp-1784038024462-f5dadb44` green.
- Ledger: RF-011 `OPEN → VERIFIED`; repair commit `3e7a6cc`.
- Evidence: `qa/evidence/phase34/iteration-3.3-rf011-layout-containment.md`.
- New dependencies: none.

## Iteration 3.4 — RF-013 operational-copy i18n

- Date: 2026-07-14
- Defect: RF-013 (P1)
- Reproduction: the new operational-copy audit failed 3/3 on customer quality-lock/production labels, internal navigation/branding labels, and the missing technical-token exemption record.
- Work: moved the affected customer labels into `platform-copy`; moved internal report/workspace/legacy labels into typed `zh-CN`/`en-US` dictionaries; documented narrow technical identifiers that remain untranslated.
- Regression: focused source audit 3/3; combined i18n coverage 11/11; typecheck and focused lint green; complete Phase 3/4 browser suite 9/9; golden `gp-1784038463620-2c3cf392` green.
- Ledger: RF-013 `OPEN → VERIFIED`; repair commit `63cad87`.
- Evidence: `qa/evidence/phase34/iteration-3.4-rf013-operational-i18n.md` and `qa/evidence/phase34/rf013-technical-token-exemptions.md`.
- New dependencies: none.

## Iteration 3.5 — RF-008 role/persona authority

- Date: 2026-07-14
- Defect: RF-008 (P1)
- Reproduction: the production guards normalized and redirected from legacy BUSINESS/PERSONAL persona before evaluating a valid staff role; the initial regression had no shared production policy module and failed to load.
- Work: made system role authoritative in one pure policy used by session normalization and internal-page guards; removed persona-based demotion from staff API guards; retained customer-safe redirects after role denial.
- Regression: source matrices 9/9; complete Phase 3/4 browser suite 11/11 with both positive and negative real-route cases; typecheck/focused lint/build green; golden `gp-1784038873993-71bd69a3` green.
- Ledger: RF-008 `OPEN → VERIFIED`; repair commit `0929fbb`.
- Evidence: `qa/evidence/phase34/iteration-3.5-rf008-role-persona-authority.md`.
- New dependencies: none.

## Iteration 3.6 — RF-020 immediate rollback of Phase 3 route bundle

- Date: 2026-07-14
- Defect: RF-020 (P0, golden-path regression)
- Attempt: a single uncommitted B-stage bundle added inherited route boundaries, a 33×3 route matrix, a real seeded batch detail, and two route fixes found by that matrix. The focused browser suite reached 12/12.
- Failure: mandatory golden `gp-1784040695799-839af69f` failed RF-009 continuity with 18 blank frames. Assertions remained unchanged.
- Required response: immediately rolled back every file and generated artifact from the B-stage bundle; no partial fix was retained.
- Rollback verification: golden `gp-1784040809734-ab04b4a7` passed the full journey and restored the invariant.
- Ledger: RF-020 opened as P0 and moved to VERIFIED by atomic rollback. Future B work must be split so auth loading/error surfaces are introduced and golden-checked independently before the 33-route matrix.
- Evidence: `qa/evidence/phase34/iteration-3.6-rf020-route-bundle-rollback.md`.
- New dependencies: none.

## Iteration 3.7 — Auth route boundaries isolated after RF-020

- Date: 2026-07-14
- Defect boundary: RF-020 prevention / Phase 3 route states
- Reproduction: the focused source regression failed because the auth route group had no explicit loading/error boundary.
- Work: added auth-only full-viewport loading/error surfaces under the approved light auth theme; preserved branded continuity, retry semantics, reduced-motion behavior, and existing i18n. Mechanically renamed a Playwright helper that ESLint incorrectly classified as a React Hook; no assertion changed.
- Regression: auth boundary 1/1; typecheck/lint/build green; golden `gp-1784041162146-48d1317e` green with the original zero-blank-frame assertion.
- Commit: `d82a8f4`.
- Evidence: `qa/evidence/phase34/iteration-3.7-auth-route-boundaries.md`.
- New dependencies: none.

## Iteration 3.8 — Public and internal route-group states

- Date: 2026-07-14
- Scope: Phase 3 all-route state coverage
- Reproduction: focused source regression failed 2/2 because both route groups lacked explicit loading/error boundaries.
- Work: added shared token-based loading and retryable error surfaces; wired only public and internal route groups; retained their approved light topology and i18n.
- Regression: focused 2/2; typecheck/lint/build green; golden `gp-1784041415031-34e2254f` green.
- Commit: `b560661`.
- Evidence: `qa/evidence/phase34/iteration-3.8-public-internal-route-boundaries.md`.
- New dependencies: none.

## Iteration 3.9 — RF-021 immediate rollback of customer-detail boundaries

- Date: 2026-07-14
- Defect: RF-021 (P0, golden network invariant)
- Attempt: added three customer-detail route loading/error pairs as one uncommitted bundle; focused 2/2, typecheck/lint/build green.
- Failure: golden `gp-1784041620850-0134270e` failed on one aborted Next.js JavaScript chunk request. The unchanged continuity probe itself reported 0 blank frames.
- Required response: atomically removed the three-route product/test bundle; no assertion or tolerance changed.
- Rollback verification: baseline golden `gp-1784041708036-a861c1fa` passed.
- Ledger: RF-021 opened and moved to VERIFIED by rollback; future routes must be introduced one at a time.
- Evidence: `qa/evidence/phase34/iteration-3.9-rf021-customer-boundary-rollback.md`.
- New dependencies: none.

## Iteration 3.10 — RF-021 single-route retry rollback

- Date: 2026-07-14
- Defect: RF-021, repair attempt 2/3
- Attempt: added only `/app/create/images` loading/error states plus focused coverage; focused/typecheck/lint/build green.
- Failure: golden `gp-1784041900703-1146c6fa` failed on two aborted Next.js chunk requests; continuity reported 0 blank frames.
- Required response: removed the complete single-route iteration without changing assertions or runtime settings.
- Rollback verification: baseline golden `gp-1784041956937-f623dad1` passed.
- Evidence: `qa/evidence/phase34/iteration-3.10-rf021-single-route-rollback.md`.
- New dependencies: none.

## Iteration 3.11 — RF-021 dynamic prefetch root repair

- Date: 2026-07-14
- Defect: RF-021, repair attempt 3/3
- Root cause: failure trace linked the aborted chunks to speculative RSC prefetches for authenticated dynamic Studio routes; navigation/sign-out cancelled the route prefetch and its newly split client-boundary chunks.
- Work: disabled automatic prefetch on Studio primary/home links while retaining click navigation; reintroduced only `/app/create/images` loading/error states.
- Regression: focused 2/2; typecheck/lint/build green; golden `gp-1784042195066-160312e7` green with unchanged network and continuity assertions.
- Ledger: RF-021 remains VERIFIED, now by root-cause repair rather than rollback alone; repair commit `c95c7b7`.
- Evidence: `qa/evidence/phase34/iteration-3.11-rf021-prefetch-repair.md`.
- New dependencies: none.

## Iteration 3.12 — New batch route states

- Date: 2026-07-14
- Scope: Phase 3 all-route state coverage
- Work: added dedicated loading/error states, bilingual label, and safe retry fallback for `/app/batches/new`.
- Regression: focused 1/1; typecheck/lint/build green; golden `gp-1784042405189-e61a81b0` green.
- Commit: `800aa6b`.
- Evidence: `qa/evidence/phase34/iteration-3.12-new-batch-route-states.md`.
- New dependencies: none.

## Iteration 3.13 — Video detail route states

- Date: 2026-07-14
- Scope: Phase 3 all-route state coverage
- Work: added dedicated loading/error states, bilingual label, and safe retry fallback for `/app/library/[id]`.
- Regression: focused 1/1; typecheck/lint/build green; golden `gp-1784042619346-493a0b4b` green.
- Commit: `108d4ac`.
- Evidence: `qa/evidence/phase34/iteration-3.13-video-detail-route-states.md`.
- New dependencies: none.

## Iteration 3.14 — 33-route desktop matrix

- Date: 2026-07-14
- Scope: Phase 3 all-route verification
- Work: added a 33-route matrix with real owned dynamic records, 1280/1440/1920 scans, semantic/console/service/overflow assertions, and 33 current full-page screenshots.
- Regression: 99 route-width scans green; complete Phase 3/4 browser suite 12/12 green; typecheck/lint/build green; golden `gp-1784043093070-c9c5be09` green.
- Commit: `8b90b51`.
- Evidence: `qa/evidence/phase34/iteration-3.14-all-route-matrix.md`, `qa/screenshots/redesign/phase34-current/`.
- New dependencies: none.
