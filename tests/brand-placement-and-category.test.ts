import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  categoryLockProfile,
  isProductCategoryId,
  PRODUCT_CATEGORIES,
} from "../src/lib/video-generation/category-lock-registry";
import { clientLockCommerceProductProfile } from "../src/lib/video-generation/client-lock-profiles";

/**
 * B2 植入分档 + B4 品类锁（PRD §5.2 / M6）。
 */

test("🔴 B4：SunnyShutter 的 CEO 锁定值在泛化后逐字保留", () => {
  /// 这是 0719/0720 拍板的窗主角锁与防幻视锁 —— 泛化成品类不许漂移一个字。
  const viaLegacy = clientLockCommerceProductProfile("sunnyshutter");
  const viaCategory = categoryLockProfile("window_shutters");
  assert.deepEqual(viaLegacy, viaCategory);
  assert.equal(viaLegacy!.productType, "plantation shutters");
  assert.ok(
    viaLegacy!.identityLocks?.some((lock) =>
      lock.includes("one continuous straight rod"),
    ),
    "tilt bar 锁必须还在",
  );
  assert.ok(
    viaLegacy!.forbiddenActions?.includes("grip or twist the tilt bar"),
  );
});

test("B4：每个实物品类都有完整的锁结构，generic 明确返回 null", () => {
  for (const category of PRODUCT_CATEGORIES) {
    const profile = categoryLockProfile(category);
    if (category === "generic_commerce") {
      assert.equal(profile, null, "generic 只有通用约束，不加品类锁");
      continue;
    }
    assert.ok(profile, `${category} 缺锁`);
    assert.ok((profile.identityLocks?.length ?? 0) >= 3, `${category} 主角锁太少`);
    assert.ok((profile.demonstrableActions?.length ?? 0) >= 2);
    assert.ok((profile.forbiddenActions?.length ?? 0) >= 3, `${category} 禁止动作太少`);
  }
});

test("B4：未知品类返回 null 而不是猜一个", () => {
  assert.equal(categoryLockProfile("electronics"), null);
  assert.equal(categoryLockProfile(null), null);
  assert.equal(isProductCategoryId("window_shutters"), true);
  assert.equal(isProductCategoryId("随便"), false);
});

test("B3：Brand Kit 视觉配方进的是 imagePrompt，不碰文案", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/services/content-plan-service.ts"),
    "utf8",
  );
  assert.match(source, /apply to EVERY imagePrompt/);
  assert.match(source, /They do not affect the copy/);
});
