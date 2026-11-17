import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const STUDIO_PATH = "src/components/video-generation/streamlined-video-studio.tsx";

test("创作首页直接进入单页生成流程，不再强制先和 Agent 对话", async () => {
  const [page, studio] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile(STUDIO_PATH, "utf8"),
  ]);

  assert.match(page, /StreamlinedVideoStudio/);
  assert.doesNotMatch(page, /AgentCreativeStudio/);
  assert.doesNotMatch(studio, /\/api\/personal\/agent-chat/);
  assert.match(studio, /data-testid="streamlined-product-assets"/);
  assert.match(studio, /data-testid="streamlined-generation-mode"/);
  assert.match(studio, /data-testid="streamlined-video-specs"/);
  assert.match(studio, /data-testid="streamlined-video-prompt"/);
  assert.match(studio, /data-testid="streamlined-generate-bar"/);
});

test("单页工作流提供中英文五步首用提示，并可持久隐藏", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");

  assert.match(studio, /第一次使用，顺着五步完成/);
  assert.match(studio, /Follow five clear steps for your first video/);
  assert.match(studio, /GUIDE_STORAGE_KEY/);
  assert.match(studio, /localStorage\.getItem/);
  assert.match(studio, /localStorage\.setItem/);
  assert.match(studio, /data-testid="streamlined-first-use-guide"/);
  assert.match(studio, /aria-label=\{copy\.dismissGuide\}/);
});

test("产品图限制与提示卡里的缩略图条均明确落地", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");

  assert.match(studio, /const MAX_PRODUCT_IMAGES = 9/);
  assert.match(studio, /productAssets\.length === 0/);
  assert.match(studio, /forceRole: "product_image"/);
  /// 2026-11-17：导演线路只照着商品实拍图拍，「参考」素材入口和「参考方式」随老线路删了
  assert.doesNotMatch(studio, /forceRole: "reference_image"|forceRole: "product_demo_clip"|referenceMode|uploadReferenceAssets/);
  /// 2026-10-28 晚对话框改版：素材是提示卡里一条可换行的缩略图（零最小宽度，窄屏不撑破卡片）
  assert.match(studio, /<ul className="flex min-w-0 flex-wrap items-center gap-2" aria-label=\{imageLabel\}>/);
  assert.match(studio, /disabled=\{attachDisabled \|\| productSlotsFull\}/);
  assert.doesNotMatch(studio, /if \(productAssets\.length === 0\) return copy\.productRequired/);
  assert.match(studio, /text-to-video generation/);
});

test("生成复用 plan/dispatch、客户安全错误与请求级幂等契约", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");

  assert.match(studio, /\/api\/video-generation\/dispatch/);
  assert.match(studio, /customerDirectDispatchMessage\(payload, locale\)/);
  assert.match(studio, /shouldResetDispatchAttempt\(payload\)/);
  assert.match(studio, /"Idempotency-Key": dispatchAttemptRef\.current\.key/);
  assert.match(studio, /fingerprint: dispatchFingerprint/);
  assert.match(studio, /crypto\.randomUUID\(\)/);
  assert.match(studio, /const request = buildRequest\(\)/);
  assert.match(studio, /busy !== null \|\| uploadingTarget !== null/);
});

test("规格栏只有客户的线路卡：线路只有一条，创作页不带线路 id 派发，也不硬编码 provider route id", async () => {
  const studio = await readFile(STUDIO_PATH, "utf8");

  /// 2026-11-17：只有一条出片线路，客户不用看供应商和模型清单，「线路」卡收掉了
  assert.doesNotMatch(studio, /CustomerRoutePicker|routes\/catalog/);
  assert.doesNotMatch(studio, /VideoRouteSelector|canSelectVideoRoute|selectedVideoRouteId|videoRouteId/);
  assert.doesNotMatch(studio, /byteplus_international|volcengine_cn_legacy|value="buddy"/);
});
