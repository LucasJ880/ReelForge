import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("QA browser evidence never persists signed TOS URLs or credential identifiers", async () => {
  const evidence = await readFile("qa/evidence/phase0-route-scan.json", "utf8");

  assert.doesNotMatch(evidence, /ark-acg-cn-beijing\.tos-cn-beijing\.volces\.com/);
  assert.doesNotMatch(evidence, /X-Tos-(?:Credential|Signature|Security-Token)=/i);
  assert.doesNotMatch(evidence, /AKLT[A-Za-z0-9%_-]{12,}/);
  assert.match(evidence, /https:\/\/redacted\.invalid\/expired-tos-signed-url/);
});
