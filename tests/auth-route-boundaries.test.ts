import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("auth loading and error boundaries preserve the full-viewport continuity anchor", () => {
  const loading = readFileSync("src/components/auth/auth-route-loading.tsx", "utf8");
  const error = readFileSync("src/components/auth/auth-route-error.tsx", "utf8");
  const loadingEntry = readFileSync("src/app/(auth)/loading.tsx", "utf8");
  const errorEntry = readFileSync("src/app/(auth)/error.tsx", "utf8");
  assert.match(loading, /auth-studio-theme/);
  assert.match(loading, /min-h-screen/);
  assert.match(error, /auth-studio-theme/);
  assert.match(error, /min-h-screen/);
  assert.match(errorEntry, /"use client"/);
  assert.match(loadingEntry, /AuthRouteLoading/);
  assert.match(errorEntry, /AuthRouteError/);
});
