# H2 secret-history remediation

Date: 2026-07-14

GitHub Push Protection rejected the first H2 branch push because an early Phase 0 browser-scan artifact retained expired Beijing TOS signed URLs. Those URLs exposed a credential identifier and request signatures even though they were not part of the current UX diff.

Remediation:

1. Replaced every signed TOS URL in `qa/evidence/phase0-route-scan.json` with a non-routable redaction marker.
2. Added `tests/qa-evidence-secret-redaction.test.ts` so future evidence cannot retain the TOS host, credential, signature, or access-key identifier.
3. Rebuilt every H2-only commit from `origin/main` with the redacted evidence blob before any remote branch was created.
4. Updated tracked QA commit references to their rewritten identifiers.
5. Preserved the deterministic old-to-new commit map in `history-rewrite-map.json` for audit continuity.

The rewrite changes commit identifiers but not product code semantics. The production database, Vercel deployment, provider configuration, and real provider were not touched.
