import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("new batch route exposes explicit loading and retryable error states", () => {
  const loading = readFileSync("src/app/(platform)/app/batches/new/loading.tsx", "utf8");
  const error = readFileSync("src/app/(platform)/app/batches/new/error.tsx", "utf8");
  const state = readFileSync("src/components/platform/customer-route-state.ts", "utf8");
  const copy = readFileSync("src/i18n/platform-copy.ts", "utf8");
  assert.match(loading, /route="newBatch"/);
  assert.match(error, /route="newBatch"/);
  assert.match(state, /newBatch/);
  assert.match(copy, /newBatch:/);
});
