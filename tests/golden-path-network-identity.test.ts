import assert from "node:assert/strict";
import test from "node:test";
import { rehearsalClientIpForRun } from "../e2e/golden-path-network-identity";

test("golden path 每次独立运行使用不同的 RFC 3849 rehearsal IP", () => {
  const first = rehearsalClientIpForRun("gp-one");
  const second = rehearsalClientIpForRun("gp-two");

  assert.match(first, /^2001:db8:(?:[0-9a-f]{4}:){4}:1$/);
  assert.notEqual(first, second);
  assert.equal(first, rehearsalClientIpForRun("gp-one"));
});
