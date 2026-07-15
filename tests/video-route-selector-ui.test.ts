import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buddyRouteDiscoverySummary } from "../src/components/video-generation/video-route-selector-contract";
import { parseVideoRouteOverride } from "../src/components/video-generation/video-route-selector";
import { isInternalRole, type AccountRole } from "../src/lib/auth-role-policy";

test("internal Seedance selector is gated by system role across the create component chain", async () => {
  const [page, agent, input] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/video-generation/agent-creative-studio.tsx", "utf8"),
    readFile("src/components/video-generation/unified-creative-input.tsx", "utf8"),
  ]);

  assert.match(page, /isInternalRole\(session\.user\.role\)/);
  assert.doesNotMatch(page, /session\.user\.userType/);
  assert.match(page, /canSelectVideoRoute=\{canSelectVideoRoute\}/);
  assert.match(agent, /canSelectVideoRoute=\{canSelectVideoRoute\}/);
  assert.match(input, /<VideoRouteSelector[\s\S]*?canSelectVideoRoute=\{canSelectVideoRoute\}/);
});

test("legacy role/persona mismatches cannot demote staff or promote customers", () => {
  const cases: Array<{
    role: AccountRole;
    legacyUserType: "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN";
    expected: boolean;
  }> = [
    { role: "OPERATOR", legacyUserType: "PERSONAL", expected: true },
    { role: "SUPER_ADMIN", legacyUserType: "BUSINESS", expected: true },
    { role: "CUSTOMER", legacyUserType: "OPERATOR", expected: false },
    { role: "CUSTOMER", legacyUserType: "SUPER_ADMIN", expected: false },
  ];

  for (const identity of cases) {
    assert.equal(
      isInternalRole(identity.role),
      identity.expected,
      `${identity.role}/${identity.legacyUserType} must follow the system role`,
    );
  }
});

test("only audited routes can be selected and customer dispatches omit the override", async () => {
  const [selector, input] = await Promise.all([
    readFile("src/components/video-generation/video-route-selector.tsx", "utf8"),
    readFile("src/components/video-generation/unified-creative-input.tsx", "utf8"),
  ]);

  assert.match(selector, /option value="byteplus_international"/);
  assert.match(selector, /option value="volcengine_cn_legacy"/);
  assert.match(selector, /option value="buddy" disabled/);
  assert.match(selector, /if \(!canSelectVideoRoute\) return null/);
  assert.doesNotMatch(selector, /apiBaseUrl|ARK_API_KEY|shuyu_api_key/);

  assert.match(
    input,
    /canSelectVideoRoute && selectedVideoRouteId[\s\S]*?videoRouteId: selectedVideoRouteId/,
  );
  assert.match(input, /const dispatchFingerprint = JSON\.stringify\(dispatchBody\)/);
  assert.match(input, /body: dispatchFingerprint/);
  assert.equal(parseVideoRouteOverride("byteplus_international"), "byteplus_international");
  assert.equal(parseVideoRouteOverride("volcengine_cn_legacy"), "volcengine_cn_legacy");
  assert.equal(parseVideoRouteOverride("buddy"), "");
  assert.equal(parseVideoRouteOverride("attacker-controlled-route"), "");
});

test("Buddy discovery is reduced to a model count and never unlocks submission", () => {
  assert.deepEqual(
    buddyRouteDiscoverySummary({
      ok: true,
      routes: [{
        id: "buddy",
        availability: "available",
        apiBaseUrl: "must-not-render",
        models: [{ id: "seedance-a" }, { id: "seedance-b" }, { id: "" }],
      }],
    }),
    { state: "available", modelCount: 2 },
  );
  assert.deepEqual(
    buddyRouteDiscoverySummary({ ok: true, routes: [{ id: "buddy", availability: "unavailable", models: [] }] }),
    { state: "unavailable", reason: "unknown" },
  );
  assert.deepEqual(
    buddyRouteDiscoverySummary({
      ok: true,
      routes: [{
        id: "buddy",
        availability: "unavailable",
        unavailableReason: "authentication_rejected",
        models: [],
      }],
    }),
    { state: "unavailable", reason: "authentication_rejected" },
  );
});

test("internal route copy is complete in Chinese and English", async () => {
  const copy = await readFile("src/i18n/platform-copy.ts", "utf8");
  assert.match(copy, /视频生成线路（内部）/);
  assert.match(copy, /Video generation route \(internal\)/);
  assert.match(copy, /契约与价格确认前不可提交/);
  assert.match(copy, /blocked until contract and pricing are confirmed/);
});
