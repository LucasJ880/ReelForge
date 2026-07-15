import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260714_video_route_snapshots/migration.sql",
  "utf8",
);

function modelBody(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} model must exist`);
  return match[1];
}

test("route/model/adapter evidence is nullable on every lifecycle record", () => {
  for (const model of [
    "VideoBrief",
    "BatchJob",
    "VideoJob",
    "VideoDispatchRequest",
  ]) {
    const body = modelBody(model);
    assert.match(body, /videoRouteSnapshot\s+String\?/);
    assert.match(body, /videoModelSnapshot\s+String\?/);
    assert.match(body, /videoProviderAdapterSnapshot\s+String\?/);
  }
});

test("route snapshot migration is expand-only and preserves historical null", () => {
  for (const table of [
    "VideoBrief",
    "BatchJob",
    "VideoJob",
    "VideoDispatchRequest",
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE "${table}"`));
  }
  assert.equal(
    (migration.match(/ADD COLUMN "videoRouteSnapshot" TEXT/g) ?? []).length,
    4,
  );
  assert.equal(
    (migration.match(/ADD COLUMN "videoModelSnapshot" TEXT/g) ?? []).length,
    4,
  );
  assert.equal(
    (migration.match(/ADD COLUMN "videoProviderAdapterSnapshot" TEXT/g) ?? [])
      .length,
    4,
  );
  assert.doesNotMatch(migration, /\bUPDATE\b/);
  assert.doesNotMatch(migration, /\bDEFAULT\b/);
  assert.doesNotMatch(migration, /\bNOT NULL\b/);
  assert.doesNotMatch(migration, /\bDROP\b/);
});
