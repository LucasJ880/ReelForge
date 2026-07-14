import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("authenticated Studio navigation does not auto-prefetch dynamic route chunks", () => {
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  const primaryLinks = shell.match(/<Link\s+[\s\S]*?href=\{item\.href\}[\s\S]*?>/g) ?? [];
  assert.equal(primaryLinks.length, 1);
  assert.match(primaryLinks[0], /prefetch=\{false\}/);
});

test("product image Studio exposes explicit loading and retryable error states", () => {
  const loading = readFileSync("src/app/(platform)/app/create/images/loading.tsx", "utf8");
  const error = readFileSync("src/app/(platform)/app/create/images/error.tsx", "utf8");
  const state = readFileSync("src/components/platform/customer-route-state.ts", "utf8");
  const copy = readFileSync("src/i18n/platform-copy.ts", "utf8");

  assert.match(loading, /CustomerRouteLoading/);
  assert.match(loading, /route="createImages"/);
  assert.match(error, /CustomerRouteError/);
  assert.match(error, /route="createImages"/);
  assert.match(state, /createImages/);
  assert.match(copy, /createImages:/);
});
