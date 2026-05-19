import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBusinessOrderTitleFromOrder,
  shouldUpdateBusinessTitle,
} from "../src/lib/services/business-order-title-service";

test("shouldUpdateBusinessTitle: 英文旧标题 + 中文新标题 → 应更新", () => {
  assert.equal(
    shouldUpdateBusinessTitle(
      "hydration sports drink, energetic vertical ad",
      "Sunny Shutter · 饮品竖屏广告",
    ),
    true,
  );
});

test("shouldUpdateBusinessTitle: 已是中文则默认跳过", () => {
  assert.equal(
    shouldUpdateBusinessTitle("Sunny Shutter · 遮光帘竖屏广告", "Sunny Shutter · 遮光帘竖屏广告"),
    false,
  );
});

test("resolveBusinessOrderTitleFromOrder: 从 productInput 推导", () => {
  const title = resolveBusinessOrderTitleFromOrder({
    title: "hydration sports drink, energetic vertical ad",
    targetLanguage: "zh",
    targetPlatform: "tiktok",
    productInput: {
      userType: "business",
      rawPrompt:
        "Sunny Shutter blackout curtains bedroom, 30s vertical TikTok ad",
      brandKit: { brandName: "Sunny Shutter" },
    },
    durationSec: 30,
  });
  assert.equal(title, "Sunny Shutter · 遮光帘竖屏广告");
});
