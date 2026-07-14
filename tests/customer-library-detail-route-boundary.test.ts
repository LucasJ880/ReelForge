import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("video detail route exposes explicit loading and retryable error states", () => {
  const loading = readFileSync("src/app/(platform)/app/library/[id]/loading.tsx", "utf8");
  const error = readFileSync("src/app/(platform)/app/library/[id]/error.tsx", "utf8");
  const state = readFileSync("src/components/platform/customer-route-state.ts", "utf8");
  const copy = readFileSync("src/i18n/platform-copy.ts", "utf8");
  assert.match(loading, /route="libraryDetail"/);
  assert.match(error, /route="libraryDetail"/);
  assert.match(state, /libraryDetail/);
  assert.match(copy, /libraryDetail:/);
});
