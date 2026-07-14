import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("public and internal groups expose explicit loading and retryable error boundaries", () => {
  const loading = read("src/components/layout/surface-route-loading.tsx");
  const error = read("src/components/layout/surface-route-error.tsx");
  const publicLoading = read("src/app/(public)/loading.tsx");
  const publicError = read("src/app/(public)/error.tsx");
  const internalLoading = read("src/app/(internal)/loading.tsx");
  const internalError = read("src/app/(internal)/error.tsx");

  assert.match(loading, /data-route-state="loading"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /data-route-state="error"/);
  assert.match(error, /onClick=\{reset\}/);
  assert.match(publicLoading, /SurfaceRouteLoading/);
  assert.match(publicError, /SurfaceRouteError/);
  assert.match(internalLoading, /SurfaceRouteLoading/);
  assert.match(internalError, /SurfaceRouteError/);
});

test("public and internal boundaries keep the approved light surface topology", () => {
  const publicLoading = read("src/app/(public)/loading.tsx");
  const publicError = read("src/app/(public)/error.tsx");
  const internalLoading = read("src/app/(internal)/loading.tsx");
  const internalError = read("src/app/(internal)/error.tsx");

  for (const source of [publicLoading, publicError, internalLoading, internalError]) {
    assert.doesNotMatch(source, /auth-studio-theme|studio-shell-theme/);
  }
});
