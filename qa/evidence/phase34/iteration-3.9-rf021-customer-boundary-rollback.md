# Iteration 3.9 — RF-021 customer-boundary bundle rollback

Date: 2026-07-14  
Branch: `ui/phase34-closure`

## Attempt

An uncommitted three-route bundle added explicit loading/error boundaries for `/app/create/images`, `/app/batches/new`, and `/app/library/[id]`. Focused source tests (2/2), typecheck, lint, and optimized build passed.

## Golden failure

Mandatory run `gp-1784041620850-0134270e` completed the product journey and recorded 0 blank frames, but failed the unchanged network invariant because one Next.js JavaScript chunk request ended with `net::ERR_ABORTED`.

## Required rollback

The complete three-route bundle, its copy/type extensions, and its regression test were removed before any further product work. No assertion, network allowlist, skip, retry, sleep, tolerance, provider, or deployment configuration changed.

## Baseline verification

After rollback, run `gp-1784041708036-a861c1fa` passed the full golden path with 0 blank frames and no failed network request. Future customer-detail boundaries must be introduced one route at a time, each with its own golden run.

Evidence:

- `qa/evidence/phase1/golden-path-gp-1784041620850-0134270e.json`
- `qa/evidence/phase1/golden-path-gp-1784041708036-a861c1fa.json`

New dependencies: none.
