import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("public group exposes explicit loading and retryable error boundaries", () => {
  const loading = read("src/components/layout/surface-route-loading.tsx");
  const error = read("src/components/layout/surface-route-error.tsx");
  const publicLoading = read("src/app/(public)/loading.tsx");
  const publicError = read("src/app/(public)/error.tsx");

  assert.match(loading, /data-route-state="loading"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /data-route-state="error"/);
  assert.match(error, /onClick=\{reset\}/);
  assert.match(publicLoading, /SurfaceRouteLoading/);
  assert.match(publicError, /SurfaceRouteError/);
});

test("public boundaries keep the approved light surface topology", () => {
  const publicLoading = read("src/app/(public)/loading.tsx");
  const publicError = read("src/app/(public)/error.tsx");

  for (const source of [publicLoading, publicError]) {
    assert.doesNotMatch(source, /auth-studio-theme|studio-shell-theme/);
  }
});
