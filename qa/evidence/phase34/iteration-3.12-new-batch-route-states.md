# Iteration 3.12 — New batch route states

Date: 2026-07-14
Repair commit: `800aa6b`

- Reproduction: focused test failed because `/app/batches/new` lacked explicit loading/error boundaries.
- Repair: reused the verified customer route-state components with dedicated bilingual area copy and a safe `/app/batches` fallback.
- Verification: focused 1/1, typecheck, lint, optimized build, and golden `gp-1784042405189-e61a81b0` passed with unchanged assertions.
- New dependencies: none.
