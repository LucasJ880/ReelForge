# RF-043 — Explicit CEO Volcengine video runtime

Date: 2026-07-14  
Scope: video generation only

## Human decision

The CEO explicitly authorized temporary use of the existing Volcengine Beijing video account so the team can resume real Seedance testing. This supersedes only the earlier international-only video endpoint rule. Database and object storage placement remain North American, and the BytePlus/Buddy implementations remain available for later selection.

No credential value is copied into source, tests, logs, reports, or chat output. The runtime reads the existing managed secret only.

## Repair boundary

- `byteplus_international` accepts only the audited BytePlus international Ark endpoint and `BYTEPLUS_ARK_API_KEY`.
- `volcengine_cn_legacy` accepts only the audited Volcengine Beijing Ark endpoint and `ARK_API_KEY`.
- Neither profile may fall back to the other profile's credential.
- Real mode remains explicit; production mock remains forbidden.
- Health exposes the profile identifier only, never a credential or endpoint.

This first repair is a global production-profile hotfix. It is safe to activate only while there are no in-flight real jobs. Per-job multi-route selection requires a persisted route/model snapshot so polling and retries cannot cross regions; that work is tracked separately and is not emulated by mutating process environment variables.

## Zero-cost evidence

- Endpoint/readiness/health contract suite: 39 passed, 0 failed.
- Broader focused suite reported by the implementation agent: 48 passed, 0 failed.
- Full unit suite reported by the implementation agent: 865 passed, 0 failed, 1 pre-existing skip.
- TypeScript and scoped ESLint passed.
- Optimized production build passed.

## Production gate

Pending:

1. activate the explicit legacy profile with the existing managed secret;
2. deploy and verify health shows the legacy profile with database connected;
3. submit one bounded video through the customer UI;
4. confirm an external task id is recorded and quota/accounting are consistent;
5. keep the profile unchanged until that task reaches a terminal state.
