import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("customer report endpoint verifies ownership before create", async () => {
  const source = await readFile("src/app/api/reports/route.ts", "utf8");
  assert.match(source, /checkBriefAccess/);
  assert.ok(source.indexOf("checkBriefAccess") < source.indexOf("contentReport.create"));
});

test("internal takedown is operator-only, transactional, and compare-and-swap guarded", async () => {
  const source = await readFile("src/app/api/internal/reports/[id]/route.ts", "utf8");
  assert.match(source, /requireOperator/);
  assert.match(source, /\$transaction/);
  assert.match(source, /takedownAt: null/);
  assert.match(source, /brief.count !== 1/);
  assert.doesNotMatch(source, /delete\(/);
});

test("customer library suppresses taken-down briefs", async () => {
  const source = await readFile("src/lib/services/unified-library-service.ts", "utf8");
  assert.match(source, /takedownAt/);
  assert.match(source, /if \(brief\?\.takedownAt\) return null/);
});
