import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("RF-013 customer operational labels resolve through platform copy", async () => {
  const [studio, templates] = await Promise.all([
    readFile(path.join(ROOT, "src/components/video-generation/streamlined-video-studio.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/templates/template-library-grid.tsx"), "utf8"),
  ]);
  for (const hardcoded of ["QUALITY LOCK", "PRODUCTION BRIEF", "QUALITY-LOCKED"]) {
    assert.doesNotMatch(studio + templates, new RegExp(hardcoded));
  }
  assert.match(templates, /copy\.lockedCount/);
});

test("RF-013 technical-token exemptions stay explicit and narrow", async () => {
  const source = await readFile(path.join(ROOT, "qa/evidence/phase34/rf013-technical-token-exemptions.md"), "utf8");
  assert.match(source, /JOB ID/);
  assert.match(source, /provider/);
  assert.match(source, /不得作为运营文案豁免/);
});
