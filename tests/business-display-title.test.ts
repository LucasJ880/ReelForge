import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBusinessOrderTitle,
  inferProductLineZh,
} from "../src/lib/video-generation/business-display-title";

test("deriveBusinessOrderTitle: 中文语言 + 窗帘关键词 → 品牌 + 产品线", () => {
  const title = deriveBusinessOrderTitle({
    rawPrompt:
      "Sunny Shutter blackout curtains in a sunlit bedroom, 30s vertical TikTok ad",
    language: "zh",
    brandKit: { brandName: "Sunny Shutter" },
    durationSec: 30,
  });
  assert.equal(title, "Sunny Shutter · 遮光帘竖屏广告");
});

test("deriveBusinessOrderTitle: prompt 含中文则直接用首行", () => {
  const title = deriveBusinessOrderTitle({
    rawPrompt: "Sunny Shutter 遮光帘 — 卧室清晨竖屏广告\n更多描述",
    language: "en",
  });
  assert.match(title, /遮光帘/);
});

test("inferProductLineZh: 纱帘", () => {
  assert.equal(
    inferProductLineZh("sheer curtains living room breeze"),
    "纱帘竖屏广告",
  );
});
