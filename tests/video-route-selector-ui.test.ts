import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseVideoRouteOverride } from "../src/components/video-generation/video-route-selector";
import { isInternalRole, type AccountRole } from "../src/lib/auth-role-policy";

test("platform creation is Shuyu-only even for an internal account", async () => {
  const [page, studio] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
  ]);

  assert.doesNotMatch(page, /isInternalRole\(session\.user\.role\)/);
  assert.doesNotMatch(page, /session\.user\.userType/);
  assert.match(page, /canSelectVideoRoute=\{false\}/);
  assert.match(page, /showInternalVideoRoutes=\{false\}/);
  assert.match(studio, /<VideoRouteSelector[\s\S]*?canSelectVideoRoute=\{canSelectVideoRoute\}/);
  assert.match(studio, /showInternalRoutes=\{showInternalVideoRoutes\}/);
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

test("only audited public routes can be selected and dispatch keeps the route in its idempotency fingerprint", async () => {
  const [selector, input] = await Promise.all([
    readFile("src/components/video-generation/video-route-selector.tsx", "utf8"),
    readFile("src/components/video-generation/unified-creative-input.tsx", "utf8"),
  ]);

  assert.match(selector, /value="byteplus_international"/);
  assert.match(selector, /value="volcengine_cn_legacy"/);
  assert.match(selector, /value="buddy"/);
  assert.match(selector, /\/api\/video-generation\/routes/);
  assert.match(selector, /showInternalRoutes/);
  assert.match(selector, /resolvedDirectRoutes\?\.byteplus_international/);
  assert.match(selector, /resolvedDirectRoutes\?\.volcengine_cn_legacy/);
  assert.doesNotMatch(selector, /status=\{copy\.available\}/);
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
  assert.equal(parseVideoRouteOverride("buddy"), "buddy");
  assert.equal(parseVideoRouteOverride("attacker-controlled-route"), "");
});

test("route copy names both interfaces and exposes the live plan group in both languages", async () => {
  const selector = await readFile("src/components/video-generation/video-route-selector.tsx", "utf8");
  assert.match(selector, /火山官方接口/);
  assert.match(selector, /Aivora 视频通道/);
  /// 0804 起「工作台可见但不可调用」死清单被实时套餐组取代:
  /// 套餐来自 /prices 审计清单,可选且带实时价,不再硬编码 900 或任何套餐名。
  assert.match(selector, /套餐选择 · 实时价目/);
  assert.match(selector, /Plan selection · live pricing/);
  assert.doesNotMatch(selector, /其它 Seedance 线路/);
  assert.doesNotMatch(selector, /900 积分/);
  assert.match(selector, /Volcengine official/);
  assert.match(selector, /Aivora video route/);
});
