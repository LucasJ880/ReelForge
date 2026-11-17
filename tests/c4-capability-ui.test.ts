import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { CapabilityBoard, orderCapabilities } from "../src/components/capabilities/capability-board";
import { CapabilityIndicator } from "../src/components/capabilities/capability-indicator";
import { CUSTOMER_ROUTE_FALLBACKS, CUSTOMER_ROUTE_WALL_CELLS } from "../src/components/platform/customer-route-state";
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
 * C4 · 界面只在指定几处把能力状态诚实地摆出来：口播稿起草、本周内容页头、
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

/** 1025 真机现状：OpenAI 没额度（文本 quota）；其余正常；邮件没配。（当时还有 TTS 没权限，配音线路 2026-11-16 已删。） */
const PRODUCTION_1025 = view(
  [{ key: "text", status: "unavailable", reason: "quota", failingSince: NOW.toISOString() }],
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

/* ── 创作页接线 ────────────────────────────────────────────────────── */

test("创作页：服务端读好能力状态传给创作台；实拍图库线路卡与它的派发接口已删（2026-11-16）", () => {
  const page = read("src/app/(platform)/app/create/page.tsx");
  assert.match(page, /getCapabilities\(\)/);
  assert.match(page, /capabilities=\{capabilities\}/);
  assert.doesNotMatch(page, /broll/i);
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.doesNotMatch(studio, /BrollQuickCard|brollGate|brollAvailable|ProductLinkPrefill/);
  for (const gone of [
    "src/components/video-generation/broll-quick-card.tsx",
    "src/app/api/broll/dispatch/route.ts",
    "src/app/api/broll/cancel/route.ts",
  ]) {
    assert.equal(existsSync(gone), false, gone);
  }
});

/* ── 口播稿起草 ────────────────────────────────────────────────────── */

/* ── 创作页的能力说明 ──────────────────────────────────────────────── */

test("创作页：写作暂停时写明镜头按模板规划；成片画面质检已删，不再有「质检暂停」这句说明", () => {
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /featureGate\(capabilities, "scriptWriting"\)\.status === "blocked"/);
  assert.doesNotMatch(studio, /frameQa|quickHintNoQa|quickHintTemplateShotsNoQa|画面质检暂停|frame checks are paused/);
  /// 2026-10-28 晚：生成方式并进模板芯片——说明挂在芯片上，能力暂停时卡下再明写一行
  assert.match(studio, /const quickModeHint = shotsFromTemplate \? copy\.quickHintTemplateShots : copy\.quickHint;/);
  assert.match(studio, /const capabilityDegraded = shotsFromTemplate;/);
  assert.match(studio, /data-testid="create-capability-notice">\{quickModeHint\}/);
});

/* ── 本周内容页头 ──────────────────────────────────────────────────── */

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
  assert.match(paused, /tabular-nums[^>]*>3</, "暂停 3 项：写作、看图、配图（同一个账户）");
  assert.equal(renderToStaticMarkup(React.createElement(CapabilityIndicator, { initial: ALL_GOOD, locale: "zh-CN" })), "");
  const unstable = renderToStaticMarkup(
    React.createElement(CapabilityIndicator, {
      initial: view([{ key: "video", status: "degraded", reason: "contract_drift" }]),
      locale: "en-US",
    }),
  );
  assert.match(unstable, /Some AI features unstable/);
});

test("状态页：视频不稳定不承诺备用线路——套餐漂移 / 限流 / 上游抖动都只写正在自动重试（P03-K）", () => {
  for (const reason of ["contract_drift", "rate_limited", "upstream"] as const) {
    const zh = renderToStaticMarkup(
      React.createElement(CapabilityBoard, {
        capabilities: view([{ key: "video", status: "degraded", reason, failingSince: NOW.toISOString() }]),
        locale: "zh-CN",
      }),
    );
    assert.match(zh, /视频生成线路有波动：正在自动重试/, reason);
    assert.doesNotMatch(zh, /备用线路|备用套餐/, reason);
    const en = renderToStaticMarkup(
      React.createElement(CapabilityBoard, {
        capabilities: view([{ key: "video", status: "degraded", reason, failingSince: NOW.toISOString() }]),
        locale: "en-US",
      }),
    );
    assert.match(en, /retrying automatically/, reason);
    assert.doesNotMatch(en, /backup/i, reason);
  }
});

test("状态页：六项能力各一格；看图那一格照常显示、但没有「影响」一栏（故事板 AI 审帧、画面质检都删了）；审核不再有一格", () => {
  const html = renderToStaticMarkup(React.createElement(CapabilityBoard, { capabilities: PRODUCTION_1025, locale: "zh-CN" }));
  assert.doesNotMatch(html, /故事板 AI 审帧|AI 审帧/);
  assert.doesNotMatch(html, /画面质检/);
  assert.doesNotMatch(html, /一致性/, "一致性检查还没落地，文案不许先承诺");
  assert.doesNotMatch(html, /内容审核|上传审核/, "内容审核整套删除，状态页不再有它的格子与功能");

  const rows = [...html.matchAll(/<li[^>]*data-capability="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g)];
  assert.deepEqual(
    rows.map((row) => row[1]).sort(),
    /// 没开通的邮件通知不摆给商家（询盘入口不在导航里）；开通了才有这一格
    ["graphics", "image", "text", "video", "vision"],
  );
  const cell = (key: string) => rows.find((row) => row[1] === key)?.[2] ?? "";
  /// 看图跟着同一个账户暂停：这一格的一句话照常写，只是没有功能再依赖它
  assert.match(cell("vision"), /AI 看图暂停：写镜头脚本要先看商品图/);
  /// 写脚本是「看图 + 写作」一次调用：看图这一格也影响镜头脚本
  assert.match(cell("vision"), /影响[\s\S]*镜头脚本/);
  /// 其余各格的「影响」照列
  assert.match(cell("text"), /影响[\s\S]*镜头脚本/);
  assert.doesNotMatch(html, /口播稿起草|按模板/, "口播稿起草已删；写不成没有模板退路，不许再这么说");
  assert.match(cell("image"), /影响[\s\S]*故事板/);
  assert.match(cell("video"), /影响[\s\S]*视频生成/);
  assert.match(cell("graphics"), /影响[\s\S]*Logo 生成/);
});

test("状态页：行情头读数（零就写零）+ 每个能力一格（StatusTick 记号与颜色成对、一句人话、影响哪些功能）", () => {
  assert.ok(existsSync("src/app/(platform)/app/status/page.tsx"));
  assert.match(read("src/app/(platform)/app/status/loading.tsx"), /<CustomerRouteLoading route="status" \/>/);
  assert.match(read("src/app/(platform)/app/status/error.tsx"), /<CustomerRouteError \{\.\.\.props\} route="status" \/>/);
  assert.equal(CUSTOMER_ROUTE_FALLBACKS.status, "/app/create");
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.status, 4);

  const html = renderToStaticMarkup(React.createElement(CapabilityBoard, { capabilities: PRODUCTION_1025, locale: "zh-CN" }));
  assert.match(html, /data-testid="capability-board"/);
  assert.match(html, /<h1 class="studio-title">能力状态<\/h1>/);
  assert.match(html, /x-wall/);
  // 读数墙四格：正常 / 不稳定 / 暂停 / 未开通（状态词从词典取）
  /// 读数：「正常」永远在，其余是零就不占格（2026-11-17）
  assert.match(html, />正常</);
  assert.match(html, /data-state="unavailable"/);
  assert.match(html, /AI 写作暂停：现在写不了镜头脚本，故事板先生成不了；恢复后自动启用。/);
  assert.match(html, /影响/);
  assert.match(html, /镜头脚本/);
  assert.doesNotMatch(html, /实拍图库|AI 配音|图库素材|链接抓取|产品抠图/, "已删的线路不再出现在状态页");
  assert.doesNotMatch(html, /周计划|图文配图|产品图|配图与 Logo/, "已删的功能（周计划 / 图文配图 / 产品图）不再出现在状态页");
  assert.match(html, /tabular-nums/);
  // 没有主行动、没有眉题：一页最多一枚实心钮，这页一枚都不需要
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /kicker|eyebrow/i);
  // 严重的排前面
  const order = orderCapabilities(PRODUCTION_1025.items).map((item) => item.status);
  assert.deepEqual(order.slice(0, 3), ["unavailable", "unavailable", "unavailable"]);
  assert.notEqual(order[3], "unavailable");
  assert.equal(order.at(-1), "available");

  const en = renderToStaticMarkup(React.createElement(CapabilityBoard, { capabilities: PRODUCTION_1025, locale: "en-US" }));
  assert.match(en, /Service status/);
  assert.doesNotMatch(en.replace(/<time[^>]*>[^<]*<\/time>/g, ""), /[㐀-鿿]/, "英文页没有中文");
});
