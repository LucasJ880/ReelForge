import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isInternalRole, type AccountRole } from "../src/lib/auth-role-policy";

test("platform creation is Shuyu-only for every account: the create page has no route selector at all", async () => {
  const [page, studio] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
  ]);

  assert.doesNotMatch(page, /isInternalRole\(session\.user\.role\)/);
  assert.doesNotMatch(page, /session\.user\.userType/);
  /// 线路只有一条（2026-11-17 直连线路删除）：创作页不挂选择器，派发也不带线路 id
  assert.doesNotMatch(page, /canSelectVideoRoute|showInternalVideoRoutes/);
  assert.doesNotMatch(studio, /VideoRouteSelector|canSelectVideoRoute|showInternalVideoRoutes|videoRouteId/);
  assert.match(studio, /<CustomerRoutePicker/);
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

test("the selector (batch wizard) offers the one audited route and its live plans; no direct or internal routes remain", async () => {
  const [selector, wizard, studio] = await Promise.all([
    readFile("src/components/video-generation/video-route-selector.tsx", "utf8"),
    readFile("src/components/batch/batch-create-wizard.tsx", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
  ]);

  assert.match(selector, /export type VideoRouteOverride = "buddy";/);
  assert.match(selector, /value="buddy"/);
  assert.equal((selector.match(/<RouteRadioItem\b/g) ?? []).length, 1, "只有一条线路可选");
  assert.match(selector, /\/api\/video-generation\/routes/);
  assert.doesNotMatch(
    selector,
    /byteplus|volcengine|showInternalRoutes|resolvedDirect|directRoute|directTitle|internalGroup|parseVideoRouteOverride/i,
  );
  assert.doesNotMatch(selector, /status=\{copy\.available\}/);
  assert.match(selector, /if \(!canSelectVideoRoute\) return null/);
  assert.doesNotMatch(selector, /apiBaseUrl|ARK_API_KEY|shuyu_api_key/);

  /// 批量向导是唯一挂它的地方：线路固定 buddy，选的是套餐
  assert.match(wizard, /useState<VideoRouteOverride>\("buddy"\)/);
  assert.match(wizard, /<VideoRouteSelector[\s\S]*?planSelectable/);
  /// 创作页的幂等指纹仍然是整个派发体
  assert.match(studio, /const dispatchFingerprint = JSON\.stringify\(dispatchBody\)/);
  assert.match(studio, /body: dispatchFingerprint/);
});

test("route copy names the Aivora route and exposes the live plan group in both languages", async () => {
  const selector = await readFile("src/components/video-generation/video-route-selector.tsx", "utf8");
  assert.match(selector, /Aivora 视频通道/);
  /// 0804 起「工作台可见但不可调用」死清单被实时套餐组取代:
  /// 套餐来自 /prices 审计清单,可选且带实时价,不再硬编码 900 或任何套餐名。
  assert.match(selector, /套餐选择 · 实时价目/);
  assert.match(selector, /Plan selection · live pricing/);
  assert.doesNotMatch(selector, /其它 Seedance 线路/);
  assert.doesNotMatch(selector, /900 积分/);
  assert.match(selector, /Aivora video route/);
  /// 直连线路的文案随选项一起删了
  assert.doesNotMatch(selector, /火山|BytePlus|Volcengine|内部诊断线路|Internal diagnostic/);
});
