# Phase 3/4 · Iteration 3.5 — RF-008 role/persona authority

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Repair commit: `8dab2c2`
- Provider mode: local Preview/mock rehearsal; no real provider call or budget.

## Reproduction

The old session normalizer preserved BUSINESS/PERSONAL before consulting the system role. The internal page guard then redirected those persona values before checking `SUPER_ADMIN`/`OPERATOR`, locking a legitimate staff account out. Conversely, authorization could not safely treat a stored system persona as proof of staff status.

The new regression was introduced before the shared policy and initially failed to load, making the missing single source of truth explicit.

## Repair

- System role is now the authorization source of truth.
- Session normalization rewrites any `SUPER_ADMIN`/`OPERATOR` account to its system user type, even if a legacy customer persona remains in the database.
- Internal page and API guards allow only `SUPER_ADMIN`/`OPERATOR` roles.
- CUSTOMER and REVIEWER roles remain denied even if a token contains OPERATOR/SUPER_ADMIN as its stored persona.

## Reproducible verification

```text
node --import tsx --test tests/auth-role-persona-routing.test.ts tests/api-auth-persona-matrix.test.ts
Result: 9 passed, 0 failed

npm run typecheck
Result: exit 0

npm run test:phase34:routes
Result: 11 passed, 0 failed

npm run test:golden-path
Result: 1 passed; run gp-1784038873993-71bd69a3
```

The browser matrix signs a `SUPER_ADMIN + BUSINESS` session into `/internal/orders`. It also uses a seeded customer with a real default Workspace and proves that BUSINESS, PERSONAL, OPERATOR, and SUPER_ADMIN stored persona values never grant internal access. No assertion was relaxed.
