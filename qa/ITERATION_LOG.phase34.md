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
