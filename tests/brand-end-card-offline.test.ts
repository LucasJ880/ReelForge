import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BRAND_END_CARD_ENTRY_ENABLED } from "../src/lib/brand/brand-end-card-policy";
import { ONBOARDING_STEP_ORDER } from "../src/lib/onboarding/steps";
import { getOnboardingCopy } from "../src/i18n/onboarding-copy";
import { guideArticle } from "../src/lib/guide/guide-articles";

/**
 * 2026-10-28 商品主体轮 P0：品牌尾卡和整条片子脱节（CEO 拍保温杯，片尾冒出窗帘厂尾卡），入口 A 级下线。
 * 守住三件事：创作页默认干净视频且那一步不渲染、成品库不再给封装入口、任何对外文案不再承诺品牌尾卡。
 */

const LOCALES = ["zh-CN", "en-US"] as const;
const END_CARD_PROMISE = /品牌片尾|品牌尾卡|结尾的联系卡|brand end card|contact card at the end/i;

test("尾卡入口关着：创作页默认干净视频，那一步与摘要行都不渲染", async () => {
  assert.equal(BRAND_END_CARD_ENTRY_ENABLED, false);
  const studio = await readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /\[selectedBrandPackageId, setSelectedBrandPackageId\] = useState<string \| null>\(null\)/);
  assert.doesNotMatch(studio, /defaultBrandPackageId/);
  assert.match(studio, /\{BRAND_END_CARD_ENTRY_ENABLED \? \(\s*<TicketRow\s+data-testid="streamlined-brand-package"/);
  assert.match(studio, /\.\.\.\(BRAND_END_CARD_ENTRY_ENABLED\s*\? \[\{ label: copy\.summaryEnding/);
  /// 「高级生成」的说明不再拿品牌片尾当卖点
  assert.doesNotMatch(studio, /模板与品牌片尾|模板或品牌片尾|branded ending|branded-ending/);
  const planCard = await readFile("src/components/video-generation/plan-preview-card.tsx", "utf8");
  assert.match(planCard, /BRAND_END_CARD_ENTRY_ENABLED \|\| preview\.breakdown\.hasBrandEndCard/);
});

test("成品库：不再给封装入口，以前封装过的成片照旧能下载", async () => {
  const library = await readFile("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(library, /brandPackageId=\{BRAND_END_CARD_ENTRY_ENABLED \? preferredBrandPackage\?\.id \?\? null : null\}/);
  const button = await readFile("src/components/library/brand-package-button.tsx", "utf8");
  /// 先看已封装的下载地址，再看有没有包——没包时只剩下载
  assert.ok(button.indexOf("if (brandedVideoUrl)") < button.indexOf("!brandPackageId) return null"));
});

test("上手引导：生意 → 第一条视频，不再要 logo，文案不再承诺结尾联系卡", async () => {
  assert.deepEqual([...ONBOARDING_STEP_ORDER], ["business", "video"]);
  for (const locale of LOCALES) {
    const copy = getOnboardingCopy(locale).welcome;
    assert.doesNotMatch(`${copy.subtitle} ${copy.business.body} ${copy.scope}`, END_CARD_PROMISE, locale);
    assert.doesNotMatch(copy.subtitle, /三步|Three steps/, locale);
  }
  const page = await readFile("src/app/(platform)/app/welcome/page.tsx", "utf8");
  assert.match(page, /ONBOARDING_STEP_ORDER\.filter\(\(key\) => state\.steps\[key\] === "done"\)/);
  assert.doesNotMatch(page, /readingBrand/);
});

test("对外文案不再承诺品牌尾卡：首页、登录页、使用指南的上手篇", async () => {
  const [growth, platform] = await Promise.all([
    readFile("src/i18n/growth-copy.ts", "utf8"),
    readFile("src/i18n/platform-copy.ts", "utf8"),
  ]);
  assert.doesNotMatch(growth, END_CARD_PROMISE);
  assert.doesNotMatch(platform, END_CARD_PROMISE);
  for (const locale of LOCALES) {
    const quickStart = guideArticle("quick-start", locale);
    assert.ok(quickStart);
    assert.doesNotMatch(JSON.stringify(quickStart), END_CARD_PROMISE, locale);
    /// 品牌篇改讲「logo 跟着商品走」，主行动去创作页而不是去设置品牌包
    const brand = guideArticle("brand", locale);
    assert.equal(brand?.href, "/app/create");
    assert.doesNotMatch(brand?.title ?? "", /品牌包|Brand pack/);
  }
});
