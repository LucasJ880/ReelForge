# Phase 3/4 · Iteration 3.4 — RF-013 operational-copy i18n

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Repair commit: `d601c16`
- Provider mode: local Preview/mock rehearsal; no real provider call or budget.

## Reproduction

The source-level regression initially failed 3/3. Customer creation/template components contained `QUALITY LOCK`, `PRODUCTION BRIEF`, and `QUALITY-LOCKED`; the internal sidebar contained hard-coded English report, workspace, and legacy-navigation labels; no bounded technical-token exemption record existed.

## Repair

- Customer operational labels now resolve from the active locale through `platform-copy`.
- Internal report, workspace-branding, and legacy-navigation labels now resolve from the typed global dictionaries.
- `JOB ID`, provider names, and genuine protocol/file-format identifiers have a narrow written exemption. That exemption explicitly cannot be used for customer headings, actions, navigation, or explanatory copy.

## Reproducible verification

```text
node --import tsx --test tests/operational-copy-i18n.test.ts
Result: 3 passed, 0 failed

node --import tsx --test tests/i18n-coverage.test.ts tests/shell-i18n-wiring.test.ts tests/operational-copy-i18n.test.ts
Result: 11 passed, 0 failed

npm run typecheck
Result: exit 0

npm run test:phase34:routes
Result: 9 passed, 0 failed

npm run test:golden-path
Result: 1 passed; run gp-1784038463620-2c3cf392
```

The optimized build and focused ESLint invocation also exited 0. The golden journey used the explicit mock rehearsal and generated no real provider call.
