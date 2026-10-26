import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { CapabilityBoard, orderCapabilities } from "../src/components/capabilities/capability-board";
import { CapabilityIndicator } from "../src/components/capabilities/capability-indicator";
import { CapabilityNotice } from "../src/components/capabilities/capability-notice";
import { AudioCaptionControls } from "../src/components/video-generation/audio-caption-controls";
import { CUSTOMER_ROUTE_FALLBACKS, CUSTOMER_ROUTE_WALL_CELLS } from "../src/components/platform/customer-route-state";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import {
  CAPABILITY_KEYS,
  resolveCapabilities,
  type CapabilityKey,
  type CapabilityRecord,
  type PublicCapabilities,
} from "../src/lib/capabilities/registry";
import { customerApiErrorSchema } from "../src/lib/contracts/customer-api";
import { middleware } from "../src/middleware";

/**
 * C4 · 界面只在指定几处把能力状态诚实地摆出来：实拍线路卡、口播稿起草、本周内容页头、
 * 创作页的质检说明、壳层状态栏 + /app/status。另有 GET /api/capabilities 的鉴权边界。
 */

const read = (file: string) => readFileSync(file, "utf8");
const NOW = new Date("2026-10-25T12:00:00.000Z");
const ALL = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<CapabilityKey, boolean>;

function view(records: Array<Partial<CapabilityRecord> & { key: CapabilityKey }>, configured = ALL): PublicCapabilities {
  return resolveCapabilities({
    records: records.map((record) => ({
      status: "available",
      reason: "ok",
      source: "probe",
      checkedAt: NOW.toISOString(),
      failingSince: null,
      ...record,
    })),
    configured,
    now: NOW,
  });
}

/** 1025 真机现状：OpenAI 没额度（文本 quota），TTS 没权限；其余正常；邮件没配。 */
const PRODUCTION_1025 = view(
  [
    { key: "text", status: "unavailable", reason: "quota", failingSince: NOW.toISOString() },
    { key: "voice", status: "unavailable", reason: "permission", failingSince: NOW.toISOString() },
  ],
  { ...ALL, email: false },
);
const ALL_GOOD = view([]);

/* ── GET /api/capabilities ─────────────────────────────────────────── */

test("API：路由只做鉴权 + 调 service；拒绝在前，不碰任何服务", () => {
  const route = read("src/app/api/capabilities/route.ts");
  const guard = route.indexOf("const guard = await requireAuth()");
  const deny = route.indexOf("if (!guard.ok) return guard.response");
  const call = route.indexOf("await getCapabilities()");
  assert.ok(guard > 0 && deny > guard && call > deny, "鉴权 → 拒绝 → service");
  assert.match(route, /export async function GET\(\)/);
  assert.doesNotMatch(route, /@\/lib\/db|prisma|fetch\(/, "路由里不写业务、不直连库");
});

test("API DYNAMIC：未登录请求被中间件拦成统一的 AUTH_REQUIRED", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  const previousUrl = process.env.NEXTAUTH_URL;
  process.env.AUTH_SECRET = "c4-capabilities-secret";
  process.env.NEXTAUTH_URL = "https://contract.reelforge.example";
  try {
    const response = await middleware(new NextRequest("https://contract.reelforge.example/api/capabilities", { method: "GET" }));
    assert.equal(response.status, 401);
    assert.equal(customerApiErrorSchema.parse(await response.json()).code, "AUTH_REQUIRED");
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousUrl;
  }
});

/* ── 实拍线路卡 ────────────────────────────────────────────────────── */

test("实拍线路卡：被挡住时禁用提交并写明原因（不再「提交后才 503」）；取消入口不受影响", () => {
  const card = read("src/components/video-generation/broll-quick-card.tsx");
  assert.match(card, /gate\?: FeatureGate \| null;/);
  assert.match(card, /const blocked = gate\?\.status === "blocked";/);
  assert.match(card, /disabled=\{blocked \|\| busy !== null \|\| script\.trim\(\)\.length < 20\}/);
  assert.match(card, /data-testid="broll-capability-blocked"/);
  assert.match(card, /href="\/app\/status"/);
  // 铁律 #7：已提交那一条的取消按钮只看自己的忙碌态，不被能力闸门禁用
  assert.match(card, /disabled=\{busy === "cancel"\}/);
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /const brollGate = featureGate\(capabilities, "broll"\);/);
  assert.match(studio, /<BrollQuickCard available=\{brollAvailable\} gate=\{brollGate\} \/>/);
  const page = read("src/app/(platform)/app/create/page.tsx");
  assert.match(page, /getCapabilities\(\)/);
  assert.match(page, /capabilities=\{capabilities\}/);
});

test("服务端也挡：实拍线路派发在拆段 / TTS 花钱之前查能力闸门，返回能力暂停的人话", () => {
  const route = read("src/app/api/broll/dispatch/route.ts");
  const gate = route.indexOf('featureGate(await getCapabilities(), "broll")');
  const spend = route.indexOf("startBrollDelivery({");
  const limit = route.indexOf("assertPaidActionRateLimit({");
  assert.ok(gate > 0 && gate < limit && gate < spend, "闸门在限流与花钱之前");
  assert.match(route, /code: "CAPABILITY_UNAVAILABLE"/);
  assert.match(route, /brollGate\.message\?\.\[locale\]/);
});

/* ── 口播稿起草 ────────────────────────────────────────────────────── */

test("口播稿：写作暂停时按钮写明「按模板」，并提示这份稿是模板起的", () => {
  const props = {
    value: {
      voiceoverEnabled: true,
      voiceId: "warm-confident",
      voiceoverScript: "先看实际效果。",
      captionsEnabled: true,
      captionStyle: "word_by_word" as const,
      captionPosition: "bottom" as const,
      exportSrt: true,
      bgmTrackId: "none" as const,
      bgmVolume: 0.2,
    },
    onChange: () => {},
    onRegenerate: () => {},
  };
  const paused = renderToStaticMarkup(React.createElement(AudioCaptionControls, { ...props, english: false, draftFromTemplate: true }));
  assert.match(paused, /按模板生成口播稿/);
  assert.match(paused, /data-testid="voiceover-template-notice"/);
  assert.match(paused, /AI 写作暂停：这份口播稿按模板起稿/);
  const pausedEn = renderToStaticMarkup(
    React.createElement(AudioCaptionControls, {
      ...props,
      value: { ...props.value, voiceoverScript: "Start with the real result." },
      english: true,
      draftFromTemplate: true,
    }),
  );
  assert.match(pausedEn, /Draft script from template/);
  assert.doesNotMatch(pausedEn, /[㐀-鿿]/);
  const normal = renderToStaticMarkup(React.createElement(AudioCaptionControls, { ...props, english: false }));
  assert.match(normal, /生成口播稿/);
  assert.doesNotMatch(normal, /按模板|voiceover-template-notice/);

  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /featureGate\(capabilities, "narrationDraft"\)\.status === "blocked"/);
  assert.match(studio, /draftFromTemplate=\{narrationFromTemplate\}/);
});

/* ── 创作页的质检说明 ──────────────────────────────────────────────── */

test("创作页：看图暂停时「快速生成」的说明不再承诺质量检查；写作暂停时写明镜头按模板规划", () => {
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /featureGate\(capabilities, "frameQa"\)\.status === "blocked"/);
  assert.match(studio, /description=\{quickModeHint\}/);
  assert.match(studio, /quickHintNoQa: "系统自动完成镜头规划；画面质检暂停，成片照常生成"/);
  assert.match(studio, /quickHintNoQa: "Automatic shot planning; frame checks are paused, videos still render"/);
  assert.match(studio, /quickHintTemplateShotsNoQa:/);
});

/* ── 本周内容页头 ──────────────────────────────────────────────────── */

test("本周内容：写作或配图暂停时，时间线上方一条细通知（只改 page.tsx，不动 plan-timeline）", () => {
  const page = read("src/app/(platform)/app/plan/page.tsx");
  assert.match(page, /const PLAN_CAPABILITY_FEATURES = \["contentPlanWriting", "imagePosts"\] as const;/);
  const notice = page.indexOf("<CapabilityNotice");
  const timeline = page.indexOf("<PlanTimeline plan={plan} />");
  assert.ok(notice > 0 && timeline > notice, "通知在时间线上方");
  assert.doesNotMatch(read("src/components/content-plan/plan-timeline.tsx"), /CapabilityNotice|capabilities/);

  const html = renderToStaticMarkup(
    React.createElement(CapabilityNotice, {
      capabilities: PRODUCTION_1025,
      features: ["contentPlanWriting", "imagePosts"],
      locale: "zh-CN",
      linkLabel: getPlatformCopy("zh-CN").status.noticeLink,
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /周计划撰写暂停：AI 写作暂不可用。周计划先按模板排好/);
  assert.match(html, /图文配图暂停：配图与 Logo 暂不可用/, "账户没额度 → 配图一起停");
  assert.match(html, /href="\/app\/status"/);
  assert.equal(
    renderToStaticMarkup(
      React.createElement(CapabilityNotice, { capabilities: ALL_GOOD, features: ["contentPlanWriting", "imagePosts"], locale: "zh-CN" }),
    ),
    "",
    "全部正常时不占位",
  );
});

/* ── 壳层状态栏 + 状态页 ───────────────────────────────────────────── */

test("壳层：状态栏挂能力提示（首屏用服务端值）；layout 传入 getCapabilities()", () => {
  const shell = read("src/components/platform/platform-shell.tsx");
  assert.match(shell, /<CapabilityIndicator initial=\{initialCapabilities\} locale=\{locale\} \/>/);
  const footer = shell.slice(shell.indexOf("<footer"), shell.indexOf("</footer>"));
  assert.match(footer, /CapabilityIndicator/, "提示在状态栏里");
  const layout = read("src/app/(platform)/app/layout.tsx");
  assert.match(layout, /getCapabilities\(\),/);
  assert.match(layout, /initialCapabilities=\{capabilities\}/);

  const paused = renderToStaticMarkup(React.createElement(CapabilityIndicator, { initial: PRODUCTION_1025, locale: "zh-CN" }));
  assert.match(paused, /部分 AI 能力暂停/);
  assert.match(paused, /href="\/app\/status"/);
  assert.match(paused, /tabular-nums[^>]*>4</, "暂停 4 项：写作、看图、配图（账户）+ 配音");
  assert.equal(renderToStaticMarkup(React.createElement(CapabilityIndicator, { initial: ALL_GOOD, locale: "zh-CN" })), "");
  const unstable = renderToStaticMarkup(
    React.createElement(CapabilityIndicator, {
      initial: view([{ key: "video", status: "degraded", reason: "contract_drift" }]),
      locale: "en-US",
    }),
  );
  assert.match(unstable, /Some AI features unstable/);
});

test("状态页：行情头读数（零就写零）+ 每个能力一格（StatusTick 记号与颜色成对、一句人话、影响哪些功能）", () => {
  assert.ok(existsSync("src/app/(platform)/app/status/page.tsx"));
  assert.match(read("src/app/(platform)/app/status/loading.tsx"), /<CustomerRouteLoading route="status" \/>/);
  assert.match(read("src/app/(platform)/app/status/error.tsx"), /<CustomerRouteError \{\.\.\.props\} route="status" \/>/);
  assert.equal(CUSTOMER_ROUTE_FALLBACKS.status, "/app/create");
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.status, 4);

  const html = renderToStaticMarkup(React.createElement(CapabilityBoard, { capabilities: PRODUCTION_1025, locale: "zh-CN" }));
  assert.match(html, /data-testid="capability-board"/);
  assert.match(html, /<h1 class="x-display">能力状态<\/h1>/);
  assert.match(html, /x-wall/);
  // 读数墙四格：正常 / 不稳定 / 暂停 / 未开通（状态词从词典取）
  for (const word of ["正常", "不稳定", "暂停", "未开通"]) assert.match(html, new RegExp(`>${word}<`));
  assert.match(html, /data-state="unavailable"/);
  assert.match(html, /AI 写作暂停：脚本与周计划先用模板生成，恢复后自动启用。/);
  assert.match(html, /影响/);
  assert.match(html, /实拍图库线路/);
  assert.match(html, /tabular-nums/);
  // 没有主行动、没有眉题：一页最多一枚实心钮，这页一枚都不需要
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /kicker|eyebrow/i);
  // 严重的排前面
  const order = orderCapabilities(PRODUCTION_1025.items).map((item) => item.status);
  assert.deepEqual(order.slice(0, 4), ["unavailable", "unavailable", "unavailable", "unavailable"]);
  assert.equal(order.at(-1), "available");

  const en = renderToStaticMarkup(React.createElement(CapabilityBoard, { capabilities: PRODUCTION_1025, locale: "en-US" }));
  assert.match(en, /Service status/);
  assert.doesNotMatch(en.replace(/<time[^>]*>[^<]*<\/time>/g, ""), /[㐀-鿿]/, "英文页没有中文");
});
