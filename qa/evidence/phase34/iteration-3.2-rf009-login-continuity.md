# Phase 3/4 · Iteration 3.2 — RF-009 login continuity

- Date: 2026-07-14 (America/Toronto)
- Branch: `ui/phase34-closure`
- Repair commit: `97d6b69`
- Provider mode: explicit local Preview/mock rehearsal; no real provider call or budget.

## Root cause

When login had no `from` query, it navigated to `/` and relied on a second server redirect to reach `/app/create`. It also issued `router.push(from)` and `router.refresh()` together after clearing its pending state, leaving no durable UI surface while two navigation operations competed.

## Attempt record

### Attempt 1 — failed and fully rolled back

The first repair added a prefetch for the protected destination. Before authentication, that request correctly redirected to `/login?from=/app/create`; successful login then cancelled the now-obsolete request. Golden run `gp-1784037382766-208c3e9d` failed on:

```text
GET http://localhost:3120/login?from=%2Fapp%2Fcreate net::ERR_ABORTED
```

The strict failed-request assertion was not relaxed. All attempt-1 code was immediately rolled back. Golden run `gp-1784037506214-f921e4b0` then passed, proving the invariant was restored before attempt 2.

### Attempt 2 — verified

- No unauthenticated prefetch.
- Sanitize `from` to an internal path and default directly to `/app/create`.
- Keep the pending state mounted on success and perform one `router.replace` with no concurrent refresh.
- Cover the viewport with a branded, accessible light-auth-theme status surface until the dark Studio shell is mounted.
- Respect reduced motion and restore the form on credential/network failure.

## Reproducible verification

```text
node --import tsx --test tests/auth-transition.test.ts
Result: 3 passed, 0 failed

npm run typecheck
focused ESLint + npm run build + git diff --check
Result: passed

npm run test:golden-path
Run: gp-1784037627201-fa3fc7fb
Result: 1 passed, 0 failed in 14.9s; teardown exit 0
Transition attachment: samples=27, blankFrames=0
Network/console contract: 0 client errors, 0 HTTP 5xx, 0 failed requests
```

Golden evidence:

- Failed attempt 1: `qa/evidence/phase1/golden-path-gp-1784037382766-208c3e9d.json`
- Rollback baseline: `qa/evidence/phase1/golden-path-gp-1784037506214-f921e4b0.json`
- Verified attempt 2: `qa/evidence/phase1/golden-path-gp-1784037627201-fa3fc7fb.json`
- Final journey screenshot: `qa/screenshots/phase1/gp-1784037627201-fa3fc7fb/completed-video.png`

No dependency, provider, cron, deployment, migration, or theme-topology change was made.
