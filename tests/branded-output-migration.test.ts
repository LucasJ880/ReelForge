import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("brand output columns are deployed through an expand-only migration", async () => {
  const sql = await readFile(
    new URL(
      "../prisma/migrations/20260722194000_video_brand_outputs/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const table of ["VideoBrief", "VideoJob"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${table}"`));
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "brandedVideoUrl" TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "brandedAt" TIMESTAMP\(3\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
});
