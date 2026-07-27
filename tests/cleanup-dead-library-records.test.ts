import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupEvidenceDigest,
  parseCleanupArgs,
} from "../scripts/cleanup-dead-library-records";

test("cleanup defaults to dry-run and accepts an explicit evidence output", () => {
  assert.deepEqual(parseCleanupArgs([]), {
    commit: false,
    evidencePath: null,
    help: false,
  });
  assert.deepEqual(parseCleanupArgs(["--evidence=artifacts/dead.json"]), {
    commit: false,
    evidencePath: "artifacts/dead.json",
    help: false,
  });
});

test("cleanup commit requires a matching evidence path", () => {
  assert.throws(() => parseCleanupArgs(["--commit"]), /--evidence/);
});

test("cleanup evidence digest is deterministic and excludes its digest field", () => {
  const evidence = {
    schemaVersion: 1 as const,
    generatedAt: "2026-07-26T12:00:00.000Z",
    databaseIdentityHash: "db-hash",
    targets: [
      {
        kind: "deliveryOrder" as const,
        id: "order-1",
        reason: "failed_without_playable_output" as const,
      },
    ],
  };
  assert.equal(cleanupEvidenceDigest(evidence), cleanupEvidenceDigest(evidence));
  assert.notEqual(
    cleanupEvidenceDigest(evidence),
    cleanupEvidenceDigest({
      ...evidence,
      targets: [{ ...evidence.targets[0], id: "order-2" }],
    }),
  );
});
