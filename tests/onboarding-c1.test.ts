import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getOnboardingCopy, TERMS_VERSION } from "../src/i18n/onboarding-copy";
import { getGrowthCopy } from "../src/i18n/growth-copy";
import {
  BUSINESS_INDUSTRIES,
  FALLBACK_TEMPLATE_ORDER,
  INDUSTRY_TEMPLATE_PREFERENCES,
  isBusinessIndustry,
} from "../src/lib/onboarding/industries";
import { COMMERCE_TEMPLATE_SLUGS } from "../src/lib/video-generation/commerce-template-catalog";
import { stateTone, stateWord } from "../src/lib/exchange/state-vocab";
import { LANDING_HERO_SCENES, LANDING_PROOF_VIDEOS, LANDING_STORYBOARD_FRAMES } from "../src/lib/config/landing-media";

/**
 * 1025 整合轮 C1：首页 → 注册 → /app/welcome 上手向导 → 创作。
 * 服务层要连库的部分用源码契约守（CAS、只提醒一次、内部角色不进向导），纯数据部分直接测。
 */

const read = (file: string) => readFileSync(file, "utf8");
const CJK = /[㐀-鿿]/;

function keyShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? ["array", typeof value[0]] : ["array"];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, keyShape(inner)]));
  }
  return typeof value;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

test("onboarding-copy：中英结构一致，英文界面不出现中文", () => {
  const zh = getOnboardingCopy("zh-CN");
  const en = getOnboardingCopy("en-US");
  assert.deepEqual(keyShape(en), keyShape(zh));
  for (const text of strings(en)) assert.doesNotMatch(text, CJK, text);
  assert.match(TERMS_VERSION, /^terms-\d{4}-\d{2}-\d{2}$/);
});

test("行业：每个行业都有标签、尾卡默认行动与询盘页默认服务；推荐模板都是目录里真实存在的模板", () => {
  const catalog = new Set<string>(COMMERCE_TEMPLATE_SLUGS);
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getOnboardingCopy(locale);
    for (const industry of BUSINESS_INDUSTRIES) {
      assert.ok(copy.industries[industry], `${locale} label ${industry}`);
      assert.ok(copy.welcome.brand.ctaDefaults[industry], `${locale} cta ${industry}`);
      assert.ok(copy.welcome.leadPage.defaultServices[industry].length > 0, `${locale} services ${industry}`);
    }
  }
  for (const industry of BUSINESS_INDUSTRIES) {
    for (const slug of INDUSTRY_TEMPLATE_PREFERENCES[industry]) assert.ok(catalog.has(slug), `${industry}: ${slug}`);
  }
  for (const slug of FALLBACK_TEMPLATE_ORDER) assert.ok(catalog.has(slug), slug);
  assert.equal(isBusinessIndustry("window_coverings"), true);
  assert.equal(isBusinessIndustry("pets"), false);
});

test("推荐模板只推有真机样片的（样片即门面），按行业偏好再按通用顺序补齐 3 个", () => {
  const service = read("src/lib/services/onboarding-service.ts");
  assert.match(service, /if \(!template \|\| !hasVerifiedTemplateVideo\(slug\)\) continue;/);
  assert.match(service, /INDUSTRY_TEMPLATE_PREFERENCES\[industry\] : \[\]\), \.\.\.FALLBACK_TEMPLATE_ORDER\]/);
  assert.match(service, /if \(picked\.length >= 3\) break;/);
});

test("每一步做没做完从真实数据推出来：档案、品牌包、成片、询盘页", () => {
  const service = read("src/lib/services/onboarding-service.ts");
  assert.match(service, /business: profile\.industry \? "done" : "todo"/);
  assert.match(service, /brand: ownPackages\.length > 0 \? "done" : "todo"/);
  assert.match(service, /recentVideos\.some\(\(row\) => row\.status === "ready"\)/);
  assert.match(service, /workspace\.leadPageEnabled \|\| workspace\.leadPageRequestedAt/);
});

test("申请开通询盘页：条件更新只记第一次、重复点不重复提醒；开通仍归超管", () => {
  const service = read("src/lib/services/onboarding-service.ts");
  assert.match(service, /where: \{ id: workspace\.id, leadPageRequestedAt: null \}/);
  assert.doesNotMatch(service, /data:\s*\{[^}]*leadPageEnabled/, "商家申请不能自己开通（只有 select，没有写入）");
  const route = read("src/app/api/leads/page/activation-request/route.ts");
  assert.match(route, /if \(!result\.alreadyRequested && !result\.alreadyEnabled\) \{/);
  assert.match(route, /runAfterResponse\(\(\) => notifyLeadPageActivationRequest\(userId\)\)/);
  assert.match(route, /requireAuth\(\)/);
});

test("/app 的去处：客户走完或跳过向导前先进 /app/welcome；内部角色不进向导；完成只记第一次", () => {
  const page = read("src/app/(platform)/app/page.tsx");
  assert.match(page, /!isInternalRole\(session\.user\.role\) && \(await needsOnboarding\(session\.user\.id\)\)/);
  assert.match(page, /redirect\("\/app\/welcome"\)/);
  assert.match(page, /redirect\("\/app\/create"\)/);
  const service = read("src/lib/services/onboarding-service.ts");
  assert.match(service, /where: \{ id: workspace\.id, onboardingCompletedAt: null \}/);
  /// 查库失败不把人挡在门外
  assert.match(service, /export async function needsOnboarding[\s\S]*?catch \{\s*return false;/);
});

test("上手向导：客户端小岛只做类型导入服务层；全页实心钮只给当前一步（都做完交给「完成上手」）", () => {
  const steps = read("src/components/onboarding/welcome-steps.tsx");
  assert.match(steps, /^"use client";/);
  assert.match(steps, /import type \{ OnboardingState \} from "@\/lib\/services\/onboarding-service";/);
  assert.doesNotMatch(steps, /from "@\/lib\/db"|from "@\/lib\/services\/(?!onboarding-service)/);
  assert.match(steps, /solid=\{active === null\}/);
  assert.match(steps, /<StatusTick entity="setupStep"/);
  const page = read("src/app/(platform)/app/welcome/page.tsx");
  assert.match(page, /primaryAction=\{null\}/);
  assert.match(page, /value: `\$\{state\.quota\.used\} \/ \$\{state\.quota\.limit\}`/);
});

test("状态词典：上手一步的三种状态（进行中是半圆金，等你接着做）", () => {
  assert.equal(stateWord("setupStep", "todo", "zh-CN"), "待完成");
  assert.equal(stateWord("setupStep", "started", "zh-CN"), "进行中");
  assert.equal(stateWord("setupStep", "done", "en-US"), "Done");
  assert.equal(stateTone("setupStep", "started"), "partial");
  assert.equal(stateTone("setupStep", "done"), "filled");
});

test("首页媒体：都在生产 Blob（不走 /brand/*），英雄墙标 AI 生成，真实交付写明关联方", () => {
  const all = [
    ...LANDING_HERO_SCENES.flatMap((item) => [item.video, item.poster]),
    ...LANDING_PROOF_VIDEOS.flatMap((item) => [item.video, item.poster]),
    ...LANDING_STORYBOARD_FRAMES,
  ];
  for (const url of all) {
    /// 1025 的证明片与分镜 + 2026-10-28 晚换上的英雄墙（landing-1028，Veo 3.1 商品广告镜头）
    assert.match(url, /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/renders\/marketing\/landing-10(?:25|28)\//, url);
    assert.doesNotMatch(url, /\/brand\//, url);
  }
  for (const item of LANDING_HERO_SCENES) {
    assert.match(item.video, /\/landing-1028\/hero-[a-z]+\.mp4$/, item.video);
    assert.match(item.poster, /\/landing-1028\/hero-[a-z]+\.jpg$/, item.poster);
  }
  /// 英雄墙的场景名中英两套都齐，且不再写上门服务
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getGrowthCopy(locale).landing;
    for (const item of LANDING_HERO_SCENES) assert.ok(copy.heroScenes[item.scene]?.trim(), `${locale} ${item.scene}`);
    assert.doesNotMatch(copy.heroWallLabel, /上门服务|local service/i);
  }
  /// 2026-10-28 展厅：首屏视频与每张成片卡都标 AI 生成；关联方交付写明关系
  const landing = read("src/components/landing/showroom-landing.tsx");
  assert.match(landing, /<AiGeneratedLabel compact className="mb-4" \/>/);
  assert.ok((landing.match(/<AiGeneratedLabel compact \/>/g) ?? []).length >= 4, "每张成片卡都有 AI 标注");
  assert.match(getGrowthCopy("zh-CN").landing.showroom.deliveredBody, /关联方 SunnyShutter/);
  assert.match(getGrowthCopy("en-US").landing.showroom.deliveredBody, /affiliate SunnyShutter/);
  assert.match(getGrowthCopy("zh-CN").landing.proofNote, /关联方，不是第三方客户/);
  assert.match(getGrowthCopy("en-US").landing.proofNote, /related party of Aivora, not an independent customer/);
});

test("迁移只加可空列（铁律：只加不删）", () => {
  const sql = read("prisma/migrations/20261025150000_onboarding_profile/migration.sql");
  assert.doesNotMatch(sql, /\bDROP\b|ALTER COLUMN|NOT NULL|RENAME/i);
  for (const column of ["businessProfile", "onboardingCompletedAt", "leadPageRequestedAt", "termsAcceptedAt", "termsVersion"]) {
    assert.ok(sql.includes(`ADD COLUMN "${column}"`), column);
  }
});

test("批量向导：默认数量与上限按本月剩余额度钳制（试用 3 条不再默认 10 条），内部角色不钳", () => {
  const wizard = read("src/components/batch/batch-create-wizard.tsx");
  assert.match(wizard, /remainingVideos = null,/);
  assert.match(wizard, /Math\.max\(1, Math\.min\(MAX_BATCH_VIDEO_COUNT, remainingVideos\)\)/);
  assert.match(wizard, /useState\(Math\.min\(10, countCap\)\)/);
  assert.match(wizard, /max=\{countCap\}/);
  const page = read("src/app/(platform)/app/batches/new/page.tsx");
  assert.match(page, /remainingVideos=\{isInternalRole\(session\.user\.role\) \|\| quota\.limit <= 0 \? null : Math\.max\(0, quota\.limit - quota\.used\)\}/);
});

test("询盘页设置：没开通时给「申请开通」，申请过显示已申请（不再只说联系对接人）", () => {
  const settings = read("src/components/leads/lead-page-settings.tsx");
  assert.match(settings, /sendJson\("\/api\/leads\/page\/activation-request", "POST", \{\}\)/);
  assert.match(settings, /requestedAt \? \(/);
  for (const locale of ["zh-CN", "en-US"] as const) {
    const leads = getGrowthCopy(locale).leads;
    assert.doesNotMatch(leads.pageNotEnabledHint, /对接人|Aivora contact/);
    assert.ok(leads.pageRequest && leads.pageRequested);
  }
});

test("C1 摩擦：周计划视频帖带脚本去创作；没品牌包给去处；批量额度用完给能点的去处", () => {
  const timeline = read("src/components/content-plan/plan-timeline.tsx");
  assert.match(timeline, /href=\{`\/app\/create\?prompt=\$\{encodeURIComponent\(videoScriptPrompt\(selected\)\)\}`\}/);
  assert.match(timeline, /\[post\.copyHook, post\.copyBody, post\.copyCta\]\.filter\(Boolean\)\.join\("\\n"\)\.slice\(0, 4000\)/);
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /<Link href="\/app\/brands"[^>]*>\s*\{copy\.setUpBrandPackage\}/);
  const wizard = read("src/components/batch/batch-create-wizard.tsx");
  assert.match(wizard, /recoveryAction === "view_usage" \? \(/);
  assert.match(wizard, /<QuotaNextSteps locale=\{english \? "en-US" : "zh-CN"\} contactEmail=\{contactEmail\} \/>/);
  assert.match(read("src/app/(platform)/app/batches/new/page.tsx"), /contactEmail=\{contactEmail\(\)\}/);
});

test("A6：原生口播不再承诺口型同步（Shuyu 不接受显式音频开关，口播只是尽力而为）", () => {
  const controls = read("src/components/video-generation/audio-caption-controls.tsx");
  assert.doesNotMatch(controls, /口型与画面同步|in sync with the picture/);
  assert.match(controls, /不保证口型同步/);
  assert.match(controls, /lip-sync and exact wording aren't guaranteed/);
});
