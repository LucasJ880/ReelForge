import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveCustomerRouteRehearsalState } from "@/lib/qa/customer-route-state-rehearsal";

const ROOT = process.cwd();
const ROUTES = [
  "src/app/(platform)/app/create",
  "src/app/(platform)/app/batches",
  "src/app/(platform)/app/batches/[id]",
  "src/app/(platform)/app/racing",
  "src/app/(platform)/app/library",
  "src/app/(platform)/app/templates",
] as const;

test("RF-012 customer route loaders never collapse service failures into empty data", async () => {
  for (const route of ROUTES) {
    const source = await readFile(path.join(ROOT, route, "page.tsx"), "utf8");
    assert.doesNotMatch(
      source,
      /\.catch\(\(\)\s*=>\s*(?:\[\]|null)\)/,
      `${route} still converts a rejected service call into an empty/not-found state`,
    );
  }
});

test("RF-012 all six customer routes own loading and error boundaries", async () => {
  for (const route of ROUTES) {
    await Promise.all([
      access(path.join(ROOT, route, "loading.tsx")),
      access(path.join(ROOT, route, "error.tsx")),
    ]);
    const [loading, error] = await Promise.all([
      readFile(path.join(ROOT, route, "loading.tsx"), "utf8"),
      readFile(path.join(ROOT, route, "error.tsx"), "utf8"),
    ]);
    assert.match(loading, /CustomerRouteLoading/);
    assert.match(error, /^"use client";/);
    assert.match(error, /CustomerRouteError/);
  }
});

test("RF-012 shared route states are accessible, retryable, and bilingual", async () => {
  const [loading, error, copy] = await Promise.all([
    readFile(
      path.join(ROOT, "src/components/platform/customer-route-loading.tsx"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "src/components/platform/customer-route-error.tsx"),
      "utf8",
    ),
    readFile(path.join(ROOT, "src/i18n/platform-copy.ts"), "utf8"),
  ]);

  assert.match(loading, /data-route-state="loading"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /motion-reduce:animate-none/);
  assert.match(loading, /route === "batches" \|\| route === "batchDetail"/);
  assert.match(loading, /aria-label=\{copy\.batchProgress\}/);
  assert.match(error, /data-route-state="error"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /onClick=\{reset\}/);
  assert.match(copy, /暂时无法加载/);
  assert.match(copy, /temporarily unavailable/i);
  assert.match(copy, /batchProgress: "批次总进度"/);
  assert.match(copy, /batchProgress: "Batch progress"/);
});

test("RF-012 customer routes expose successful empty states separately from errors", async () => {
  for (const route of ROUTES.filter((candidate) => !candidate.endsWith("/[id]"))) {
    const source = await readFile(path.join(ROOT, route, "page.tsx"), "utf8");
    assert.match(source, /data-route-state=(?:"empty"|\{routeState === "empty")/);
  }
});

test("RF-012 batch detail maps only typed missing access to 404 and rethrows service faults", async () => {
  const [source, statusRoute, service] = await Promise.all([
    readFile(path.join(ROOT, "src/app/(platform)/app/batches/[id]/page.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/app/api/batches/[id]/status/route.ts"), "utf8"),
    readFile(path.join(ROOT, "src/lib/services/batch-service.ts"), "utf8"),
  ]);
  assert.match(source, /batch = await getBatchStatus\(id, session\.user\.id\);/);
  assert.match(source, /error instanceof BatchNotFoundError/);
  assert.match(source, /throw error;/);
  assert.match(service, /if \(!batch\) throw new BatchNotFoundError\(\);/);
  assert.match(statusRoute, /const notFound = error instanceof BatchNotFoundError;/);
  // H1's strict API contract intentionally uses distinct envelopes rather
  // than one ternary status. Lock the customer-visible distinction itself:
  // typed missing/foreign ownership is a non-retryable 404, while an
  // operational failure remains a retryable 500.
  assert.match(statusRoute, /code: "RESOURCE_NOT_FOUND"[\s\S]*?\{ status: 404 \}/);
  assert.match(statusRoute, /code: "INTERNAL_ERROR"[\s\S]*?\{ status: 500 \}/);
});

test("RF-012 route-state network injection is locked to explicit mock rehearsal", () => {
  const headerValue = "batches:error";
  const rehearsal = {
    VERCEL_ENV: "preview",
    FINAL_ACCEPTANCE_REQUIRE_REHEARSAL: "true",
    AIVORA_DRY_RUN: "1",
    VIDEO_PROVIDER: "mock",
  };

  assert.equal(
    resolveCustomerRouteRehearsalState({ headerValue, route: "batches", env: rehearsal }),
    "error",
  );
  assert.equal(
    resolveCustomerRouteRehearsalState({
      headerValue,
      route: "batches",
      env: { ...rehearsal, VERCEL_ENV: "production" },
    }),
    "live",
    "production must ignore a caller-supplied rehearsal header",
  );
  assert.equal(
    resolveCustomerRouteRehearsalState({
      headerValue,
      route: "batches",
      env: { ...rehearsal, FINAL_ACCEPTANCE_REQUIRE_REHEARSAL: "false" },
    }),
    "live",
  );
  assert.equal(
    resolveCustomerRouteRehearsalState({
      headerValue,
      route: "batches",
      env: { ...rehearsal, VIDEO_PROVIDER: "byteplus" },
    }),
    "live",
  );
  assert.equal(
    resolveCustomerRouteRehearsalState({ headerValue, route: "templates", env: rehearsal }),
    "live",
    "a route-scoped signal must never affect another route",
  );
});
