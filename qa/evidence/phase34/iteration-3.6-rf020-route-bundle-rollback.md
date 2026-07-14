# Phase 3/4 · Iteration 3.6 — RF-020 route-bundle rollback

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Outcome: whole uncommitted iteration rolled back; no product commit exists.
- Provider mode: local Preview/mock rehearsal; no real provider call or budget.

## Failed invariant

The uncommitted B-stage bundle reached a green 33-route × 3-width scan and a green 12-test Phase 3/4 browser suite. The mandatory golden run then failed the pre-existing strict RF-009 assertion:

```text
Run: gp-1784040695799-839af69f
Expected blank viewport frames: 0
Observed blank viewport frames: 18
Result: failed
```

The bundle had added route-group loading/error surfaces, including the auth route group. Because the golden invariant became red, the constitution required an immediate whole-iteration rollback rather than keeping route fixes that appeared unrelated.

## Rollback scope

- Removed all new route-group boundaries and shared loading/error components.
- Removed the 33-route browser/source matrix and its generated report/screenshots.
- Reverted the AI usage layout and internal historical-media preload changes found during that matrix.
- Reverted Phase 3 test-config and RF-008 test-fixture follow-up edits made in the same iteration.
- Preserved the externally modified `qa/ITERATION_LOG.md` without staging or overwriting it.
- Preserved the failed golden JSON as evidence.

## Verification

```text
npm run test:golden-path
Result: 1 passed; run gp-1784040809734-ab04b4a7
```

No golden assertion was relaxed, skipped, or deleted. The next Phase 3 attempt must introduce auth loading/error behavior in an isolated iteration and run the golden path before any broader route work.
