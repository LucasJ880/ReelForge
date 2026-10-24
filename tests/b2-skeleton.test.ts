import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { workspaceNavTitle } from "../src/components/exchange/workspace-page";
import { apiErrorMessage, planDayDates, planTodayOffset } from "../src/components/content-plan/plan-week";
import { summarizeRecipeGuards } from "../src/components/templates/recipe-summary";
import { explainVerdictCopy, groupLabel } from "../src/components/wins/dimension-ledger";
import {
  CUSTOMER_ROUTE_FALLBACK_AREAS,
  CUSTOMER_ROUTE_FALLBACKS,
  CUSTOMER_ROUTE_WALL_CELLS,
} from "../src/components/platform/customer-route-state";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { getPublicPageCopy } from "../src/i18n/public-copy";
import type { RacingVerdict } from "../src/lib/services/recipe-racing-service";

/**
 * 1025 · B2 页面骨架与控件层：行情头 / WorkspacePage、选中态与空态、本周内容、品牌、成片详情、
 * 战绩、登录与法务、404、批次详情只读与窄屏、路由边界。
 */

const read = (file: string) => readFileSync(file, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 去掉注释，只留代码与文案（注释里写中文是本仓库的惯例）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const CJK = /[㐀-鿿！-｠　-〿]/;

/* ── B2.1 行情头 / WorkspacePage ───────────────────────────────────── */

test("B2.1 行情头：主行动是必填插槽（可为 null）、模式切换单独一槽、读数与口径必填", () => {
  const header = read("src/components/exchange/quote-header.tsx");
  assert.match(header, /primaryAction: React\.ReactNode \| null;/);
  assert.match(header, /modeSwitch\?: React\.ReactNode;/);
  assert.match(header, /readings: QuoteStat\[\];/);
  assert.match(header, /readingsLabel: string;/);
  assert.match(header, /scope: React\.ReactNode;/);
  // 旧的自由插槽不复存在
  assert.doesNotMatch(header, /\bactions\?:|\bstats\?:|statsLabel/);
  // 口径行永远渲染；副标题不留孤字
  assert.match(header, /data-slot="scope">\{scope\}/);
  assert.match(header, /text-pretty/);
});

test("B2.1 WorkspacePage：标题只能是导航名（从字典取），不接收自由文本标题", () => {
  const page = read("src/components/exchange/workspace-page.tsx");
  assert.match(page, /Omit<QuoteHeaderProps, "title" \| "className">/);
  assert.match(page, /getDictionary\(locale\)\.shell\.platformNav\[nav\]/);
  assert.equal(workspaceNavTitle("plan", "zh-CN"), "本周内容");
  assert.equal(workspaceNavTitle("brands", "zh-CN"), "品牌");
  assert.equal(workspaceNavTitle("wins", "zh-CN"), "战绩");
  assert.equal(workspaceNavTitle("create", "zh-CN"), "创作");
  assert.equal(workspaceNavTitle("plan", "en-US"), "This week");
  assert.equal(workspaceNavTitle("brands", "en-US"), "Brands");
});

test("B2.1 一级区页面都用 WorkspacePage 开场，口号进副标题", () => {
  const pages: Array<[string, string]> = [
    ["src/components/content-plan/plan-timeline.tsx", "plan"],
    ["src/app/(platform)/app/brands/page.tsx", "brands"],
    ["src/app/(platform)/app/wins/page.tsx", "wins"],
    ["src/app/(platform)/app/library/page.tsx", "library"],
    ["src/app/(platform)/app/batches/page.tsx", "batches"],
    ["src/app/(platform)/app/templates/page.tsx", "templates"],
    ["src/app/(platform)/app/leads/page.tsx", "leads"],
    ["src/app/(platform)/app/create/images/page.tsx", "create"],
  ];
  for (const [file, nav] of pages) {
    const source = read(file);
    assert.match(source, new RegExp(`<WorkspacePage\\s+nav="${nav}"`), file);
    assert.doesNotMatch(source, /<QuoteHeader\b/, `${file} 不再手写行情头`);
  }
  // 口号挪进副标题：「一句话，排完一周」「可复用品牌包」「哪种内容在替你赚钱」不再是标题
  const zh = getPlatformCopy("zh-CN");
  assert.match(zh.plan.subtitle, /^一句话，排完一周/);
  assert.match(zh.brands.subtitle, /^可复用品牌包/);
  assert.match(zh.wins.subtitle, /^哪种内容在替你赚钱/);
  // 创作页标题也是导航名，模式切换在自己的插槽里
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.match(studio, /title=\{workspaceNavTitle\("create", locale\)\}/);
  assert.match(studio, /modeSwitch=\{<CreateModeTabs active="video" \/>\}/);
});

test("B2.1 每个行情头都显式写出主行动与统计口径（新建批次、批次详情、成品库补齐口径）", () => {
  // 类型已经把这几个插槽设成必填；这里再按文件数一遍，防止有人用展开 props 绕过去
  const offenders: string[] = [];
  for (const file of walk("src").filter((candidate) => !candidate.endsWith("quote-header.tsx") && !candidate.endsWith("workspace-page.tsx"))) {
    const source = read(file);
    const headers = (source.match(/<(?:QuoteHeader|WorkspacePage)\b/g) ?? []).length;
    if (headers === 0) continue;
    for (const prop of ["primaryAction", "readings", "readingsLabel", "scope"]) {
      const count = (source.match(new RegExp(`\\b${prop}=`, "g")) ?? []).length;
      if (count < headers) offenders.push(`${file}: ${prop}`);
    }
  }
  assert.deepEqual(offenders, []);
  const zh = getPlatformCopy("zh-CN");
  assert.ok(zh.batches.newBoard.scope.length > 0);
  assert.match(zh.batches.monitor.scope, /\{n\}/);
  assert.ok(zh.library.scope.length > 0);
});

/* ── B2.2 选中态与空态 ─────────────────────────────────────────────── */

test("B2.2 选中态统一 FilterChip / Segmented（aria-pressed + 青线），从不借实心主钮", () => {
  const chip = read("src/components/ui/segmented.tsx");
  assert.match(chip, /aria-pressed=\{pressed\}/);
  assert.match(chip, /border-\(--accent-line\) bg-active text-accent/);
  const grid = read("src/components/templates/template-library-grid.tsx");
  assert.match(grid, /<FilterChip key=\{item\} pressed=\{category === item\}/);
  // 全仓库：不许用 variant="default" 表达选中
  const offenders = walk("src").filter((file) =>
    /variant=\{[^}]*(?:===|active|selected|pressed|current)[^}]*\?\s*"default"/.test(read(file)),
  );
  assert.deepEqual(offenders, []);
});

test("B2.2 统一 EmptyState：按钮描边、无角标、无虚线；批量 / 成品库 / 模板库都用它", () => {
  const empty = stripComments(read("src/components/exchange/empty-state.tsx"));
  assert.match(empty, /variant="outline"/);
  assert.doesNotMatch(empty, /x-frame|border-dashed|variant="default"/);
  for (const file of [
    "src/app/(platform)/app/batches/page.tsx",
    "src/app/(platform)/app/library/page.tsx",
    "src/app/(platform)/app/templates/page.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /<EmptyState\s+data-route-state="empty"/, file);
    assert.doesNotMatch(source, /x-panel x-frame px-6 py-12/, file);
  }
});

/* ── B2.3 本周内容 ─────────────────────────────────────────────────── */

test("B2.3 本周内容：共享 Button / Input，CSS module 不再自写按钮与输入框（修 .actions .primary 特异度）", () => {
  const timeline = read("src/components/content-plan/plan-timeline.tsx");
  const css = read("src/components/content-plan/plan-timeline.module.css");
  assert.match(timeline, /from "@\/components\/ui\/button"/);
  assert.match(timeline, /from "@\/components\/ui\/input"/);
  assert.doesNotMatch(timeline, /<input\b/);
  assert.doesNotMatch(stripComments(css), /\bbutton\b|\binput\b|\.primary\b/);
  assert.doesNotMatch(timeline, /data-testid="cutting-room"/, "旧世界的「剪辑台」testid 退役");
});

test("B2.3 本周内容：界面文案全部来自 platform-copy（代码里没有写死的中文）", () => {
  const code = stripComments(read("src/components/content-plan/plan-timeline.tsx"));
  assert.doesNotMatch(code, CJK);
  assert.match(code, /getPlatformCopy\(locale\)\.plan/);
  const zh = getPlatformCopy("zh-CN").plan;
  const en = getPlatformCopy("en-US").plan;
  assert.equal(zh.trackLabel, "本周内容时间线");
  assert.equal(zh.inputLabel, "用一句话描述你的生意，或粘贴商品链接");
  assert.equal(en.formats.CAROUSEL, "Carousel");
  assert.doesNotMatch(JSON.stringify(zh), /青砚/);
});

test("B2.3 接口错误读 body.error（customerApiError 的人话），读不到才用兜底", () => {
  assert.equal(apiErrorMessage({ ok: false, error: "请先用一句话说清楚你家做什么生意" }, "兜底"), "请先用一句话说清楚你家做什么生意");
  assert.equal(apiErrorMessage({ message: "旧字段" }, "兜底"), "兜底");
  assert.equal(apiErrorMessage(null, "兜底"), "兜底");
  assert.equal(apiErrorMessage({ error: "   " }, "兜底"), "兜底");
  const timeline = read("src/components/content-plan/plan-timeline.tsx");
  assert.doesNotMatch(timeline, /body\?\.message/);
  assert.equal((timeline.match(/apiErrorMessage\(body, copy\./g) ?? []).length, 3);
});

test("B2.3 「今天」在浏览器里按计划起始日 + dayOffset 算，服务端只传 ISO", () => {
  const page = read("src/app/(platform)/app/plan/page.tsx");
  assert.match(page, /startIso: latest\.createdAt\.toISOString\(\)/);
  assert.doesNotMatch(page, /getDay\(\)|todayOffset/);

  // 周三晚上排的计划：第 0 天是周三，不是写死的周一
  const start = new Date(2026, 9, 21, 23, 30).toISOString();
  const days = planDayDates(start);
  assert.equal(days.length, 7);
  assert.equal(days[0].getDate(), 21);
  assert.equal(days[6].getDate(), 27);
  assert.equal(planTodayOffset(start, new Date(2026, 9, 21, 23, 59)), 0);
  assert.equal(planTodayOffset(start, new Date(2026, 9, 22, 0, 5)), 1, "过了本地午夜就是下一天");
  assert.equal(planTodayOffset(start, new Date(2026, 9, 24, 17, 30)), 3);
  assert.equal(planTodayOffset(start, new Date(2026, 9, 28, 9, 0)), null, "计划过期不画光针");
  // 跨夏令时（北美 11/1）也按日历加天
  const dst = planDayDates(new Date(2026, 9, 30, 12, 0).toISOString());
  assert.deepEqual(dst.map((day) => day.getDate()), [30, 31, 1, 2, 3, 4, 5]);
  assert.ok(dst.every((day) => day.getHours() === 0));
});

test("B2.3 一页一枚实心主钮：有计划时「排一周」降为描边；出图只对草稿（半套轮播可补齐）", () => {
  const timeline = read("src/components/content-plan/plan-timeline.tsx");
  assert.match(timeline, /variant=\{plan \? "outline" : "default"\}/);
  assert.match(timeline, /selected\.status === "DRAFT";/);
  assert.match(timeline, /copy\.renderMissing/);
});

/* ── B2.4 品牌 ─────────────────────────────────────────────────────── */

test("B2.4 品牌页：一枚实心主钮在页头、预览底色走 token、去掉 TRUSTED BY 眉题、三块同一种抬头与空态", () => {
  const page = read("src/app/(platform)/app/brands/page.tsx");
  assert.match(page, /primaryAction=\{<NewBrandPackageButton label=\{copy\.newPackage\} \/>\}/);
  assert.match(page, /<BrandPackageDraftProvider>/);
  const manager = read("src/components/brand/brand-package-manager.tsx");
  assert.match(manager, /variant=\{channel\?\.draftOpen \? "outline" : "default"\}/);
  assert.match(manager, /<SectionHead/);
  assert.match(manager, /<EmptyState compact/);
  const anchors = read("src/components/brand/product-anchor-manager.tsx");
  assert.match(anchors, /variant="outline" size="sm" onClick=\{\(\) => setDialogOpen\(true\)\} data-testid="product-anchor-open"/);
  assert.match(anchors, /<SectionHead/);
  assert.match(anchors, /<EmptyState/);
  const wall = read("src/components/brand/customer-brand-wall.tsx");
  assert.doesNotMatch(stripComments(wall), /TRUSTED BY|已服务客户|x-label/);
  assert.match(wall, /<SectionHead/);
  for (const file of [manager, anchors, wall]) {
    assert.doesNotMatch(file, /bg-white|border-dashed border-border px-5|text-title font-medium">\{props\.title/);
  }
  assert.match(manager, /bg-\(--brand-tile\)/);
  assert.match(read("src/styles/tokens.css"), /--brand-tile: var\(--surface-raised\);/);
  // AI Logo 提示不再说旧的「项目」
  assert.doesNotMatch(manager, /创建第一个项目|first project/);
});

/* ── B2.1 成片详情：成片是舞台 ─────────────────────────────────────── */

test("B2.1 成片详情：行情头 + 状态记号，成片在制作过程之前，配乐署名紧挨下载按钮", () => {
  const page = read("src/app/(platform)/app/library/[id]/page.tsx");
  assert.match(page, /<QuoteHeader/);
  assert.match(page, /<StatusTick entity="item" state=\{libraryRowState\(item\.status\)\}/);
  assert.doesNotMatch(page, /<Badge\b/);
  const video = page.indexOf("<video");
  const timeline = page.indexOf("<MakingProcessTimeline");
  assert.ok(video > 0 && timeline > video, "成片在上，制作过程在下");
  const download = page.indexOf("<VideoDownloadLink");
  const credit = page.indexOf('data-testid="bgm-attribution"');
  assert.ok(download > 0 && credit > download, "署名在下载按钮下方");
  assert.match(page, /data-testid="bgm-attribution"/);
  assert.match(page, /copy\.musicCredit/);
});

/* ── B2.7 战绩 ─────────────────────────────────────────────────────── */

test("B2.7 战绩：文案进 platform-copy，英文界面不再整页中文", () => {
  for (const file of ["src/app/(platform)/app/wins/page.tsx", "src/components/wins/dimension-ledger.tsx"]) {
    assert.doesNotMatch(stripComments(read(file)), CJK, file);
  }
  const en = getPlatformCopy("en-US").wins;
  const insufficient: RacingVerdict = {
    status: "insufficient",
    metric: "engagement_rate",
    dimension: "recipe",
    ranked: [{ recipeId: "post:POV:single_image", subjectCount: 1, trials: 40, successes: 2, rate: 0.05, lower: 0, upper: 0.2 }],
    missing: ["目前只有 1 种配方有数据，至少要 2 种才能比较"],
  };
  const formats = getPlatformCopy("en-US").plan.formats;
  assert.equal(explainVerdictCopy(insufficient, en, formats), "Not enough data to call a winner yet. Only 1 structures have data so far; at least 2 are needed to compare.");
  assert.doesNotMatch(explainVerdictCopy(insufficient, en, formats), CJK);
  // 不把内部 recipeId 原值摆给商家
  assert.equal(groupLabel("recipe", "post:POV:single_image", formats), "POV · Single image");
  assert.equal(groupLabel("durationSec", "15", formats), "15s");
});

/* ── B2.5 配方弹窗 ─────────────────────────────────────────────────── */

test("B2.5 配方弹窗给人话摘要，不再展示提示词原文与 Negative Prompt", () => {
  const dialog = stripComments(read("src/components/templates/template-recipe-dialog.tsx"));
  assert.doesNotMatch(dialog, /Negative Prompt|NEGATIVE PROMPT|<pre\b|\{IMAGE_REFS\}|\{PRODUCT_NAME\}/);
  assert.match(dialog, /summarizeRecipeGuards\(negativePrompt, locale\)/);
  assert.match(dialog, /parseTemplateShots\(promptSkeleton\)/);
  const summary = summarizeRecipeGuards(
    "product morphing, invented features, wrong color, burned-in text, watermarks, split screen, crossfade, ghosting",
    "zh-CN",
  );
  assert.equal(summary.ruleCount, 8);
  assert.deepEqual(summary.groups.map((group) => group.id), ["product", "claims", "text", "layout", "transitions"]);
  assert.equal(summarizeRecipeGuards("", "en-US").groups.length, 0);
});

/* ── B2.6 登录与法务 ───────────────────────────────────────────────── */

test("B2.6 登录门：口号与首页同一定位（不再「赛出赢家」），主行动「申请试点」，注册降为次要", () => {
  const zh = getPlatformCopy("zh-CN").auth;
  const en = getPlatformCopy("en-US").auth;
  assert.doesNotMatch(`${zh.titleLead}${zh.titleAccent.join("")}${zh.subtitle}`, /赛出赢家|加仓|赢家/);
  assert.doesNotMatch(`${en.titleLead}${en.titleAccent.join(" ")}`, /Race|winner/i);
  assert.equal(`${zh.titleLead}${zh.titleAccent.join("")}`, "批量出片，找到带来询盘的那一条。");
  // 宣言后半句按意群分段、各段不折行
  assert.match(read("src/app/(auth)/layout.tsx"), /copy\.titleAccent\.map\(\(part, index\) => \([\s\S]*?<span className="inline-block">\{part\}<\/span>/);
  assert.equal(zh.pilotCta, "申请试点");
  const layout = read("src/app/(auth)/layout.tsx");
  assert.match(layout, /<PilotCta label=\{copy\.pilotCta\} hint=\{copy\.pilotHint\} \/>/);
  const cta = read("src/components/auth/pilot-cta.tsx");
  assert.match(cta, /href="\/#pilot-apply"/);
  assert.match(cta, /variant=\{primary \? "default" : "outline"\}/);
  assert.ok(read("src/components/leads/pilot-landing.tsx").includes('id="pilot-apply"'), "首页确有试点申请锚点");
  const login = read("src/app/(auth)/login/page.tsx");
  assert.match(login, /<Button type="submit" variant="outline"/);
  assert.match(login, /href="\/register"/);
});

test("B2.6 隐私 / 条款：正文没有运营待办与环境变量名，保留法务草案状态行", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getPublicPageCopy(locale);
    const text = JSON.stringify({ privacy: copy.privacy, terms: copy.terms });
    assert.doesNotMatch(text, /NEXT_PUBLIC_|运营负责人|Human operations|IAD1|Buddy|工程草案|engineering draft|launch configuration/i);
    assert.ok(copy.privacy.draftStatus.length > 0);
    assert.ok(copy.terms.draftStatus.length > 0);
    assert.doesNotMatch(copy.privacy.metadata.title + copy.terms.metadata.title, /草案|Draft/);
  }
  for (const file of ["src/app/(public)/privacy/page.tsx", "src/app/(public)/terms/page.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /assumption/);
    assert.match(source, /copy\.draftStatus/);
  }
});

/* ── B2.7 404 ──────────────────────────────────────────────────────── */

test("B2.7 404：双语、在品牌大厅里、回首页；工作区里的 404 留在壳层", () => {
  const page = read("src/app/not-found.tsx");
  const panel = read("src/components/platform/not-found-panel.tsx");
  const inShell = read("src/app/(platform)/app/not-found.tsx");
  assert.match(page, /getPlatformCopy\(locale\)\.notFound/);
  assert.match(page, /gate-theme desk-canvas/);
  assert.match(page, /<NotFoundPanel locale=\{locale\} \/>/);
  assert.match(inShell, /<NotFoundPanel locale=\{locale\} workspaceHref=\{null\} \/>/);
  assert.match(panel, /getPlatformCopy\(locale\)\.notFound/);
  assert.match(panel, /href="\/"/);
  for (const source of [page, panel, inShell]) {
    assert.doesNotMatch(stripComments(source), CJK);
    assert.doesNotMatch(source, /text-\[clamp\(56px/, "不再用巨大的信号青数字做装饰");
  }
  assert.equal(getPlatformCopy("zh-CN").notFound.title, "页面不存在");
  assert.equal(getPlatformCopy("en-US").notFound.title, "Page not found");
});

/* ── B2.9 批次详情 ─────────────────────────────────────────────────── */

test("B2.9 批次详情：样片批次只读——不轮询、不出重试 / 取消", () => {
  const page = read("src/app/(platform)/app/batches/[id]/page.tsx");
  assert.match(page, /batch = await getBatchStatus\(id, showcaseUserId\);\s*readOnly = true;/);
  assert.match(page, /readOnly=\{readOnly\}/);
  const monitor = read("src/components/batch/batch-monitor.tsx");
  assert.match(monitor, /if \(readOnly \|\| TERMINAL_BATCH\.has\(batch\.status\)\) return;/);
  assert.match(monitor, /!readOnly && \(retryableFailedJobs\.length > 0/);
  assert.match(monitor, /\{readOnly \? \(\s*<span className="hidden w-\[72px\] sm:block" aria-hidden \/>/);
  assert.match(monitor, /!readOnly && detailJob\.status === "FAILED" && detailJob\.error\?\.retryable/);
  assert.match(monitor, /readOnly \? monitorCopy\.readOnlyScope : monitorCopy\.scope/);
});

test("B2.9 批次详情：页面切到后台就停轮询，回到前台先补拉一次", () => {
  const monitor = read("src/components/batch/batch-monitor.tsx");
  assert.match(monitor, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(monitor, /document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(monitor, /if \(document\.visibilityState === "hidden"\) \{\s*stop\(\);/);
  assert.match(monitor, /tick\(\);\s*start\(\);/);
});

test("B2.9 批次详情：窄屏两行卡片，不再 680px 最小宽度横向滑；不露 Image 2 与原始帧状态", () => {
  const monitor = read("src/components/batch/batch-monitor.tsx");
  assert.match(monitor, /grid w-full grid-cols-\[auto_auto_minmax\(0,1fr\)\][^"]*sm:flex sm:h-14 sm:min-w-\[680px\]/);
  assert.doesNotMatch(monitor, /"absolute left-0 top-0 flex h-14 w-full min-w-\[680px\]/);
  assert.match(monitor, /sm:contents/);
  assert.doesNotMatch(monitor, /Image 2|\?\? "QUEUED"\}/);
});

/* ── 路由边界 ──────────────────────────────────────────────────────── */

test("本周内容、战绩、品牌、询盘有自己的加载 / 错误边界，壳层不再被冲掉", () => {
  for (const route of ["plan", "wins", "brands", "leads"] as const) {
    const dir = `src/app/(platform)/app/${route}`;
    assert.ok(existsSync(`${dir}/loading.tsx`) && existsSync(`${dir}/error.tsx`), dir);
    assert.match(read(`${dir}/loading.tsx`), new RegExp(`<CustomerRouteLoading route="${route}" />`));
    const error = read(`${dir}/error.tsx`);
    assert.match(error, /^"use client";/);
    assert.match(error, new RegExp(`<CustomerRouteError \\{\\.\\.\\.props\\} route="${route}" />`));
    assert.ok(CUSTOMER_ROUTE_FALLBACKS[route].startsWith("/app/"));
    assert.ok(getPlatformCopy("zh-CN").routeStates.areas[route]);
    assert.ok(getPlatformCopy("en-US").routeStates.areas[route]);
  }
});

test("骨架按行情头结构画（无眉题短条、读数格数与页面一致）；错误页用失败记号、返回钮写明去处", () => {
  const loading = read("src/components/platform/customer-route-loading.tsx");
  assert.match(loading, /data-skeleton="quote-header"/);
  assert.match(loading, /x-wall/);
  assert.match(loading, /CUSTOMER_ROUTE_WALL_CELLS\[route\]/);
  // 第一根骨架就是大标题，不再先画一条眉题短条
  assert.match(loading, /data-skeleton="quote-header">\s*<div className="max-w-4xl space-y-3">\s*<Skeleton className="h-11/);
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.batches, 5);
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.batchDetail, 6);
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.brands, 3);
  const error = read("src/components/platform/customer-route-error.tsx");
  assert.match(error, /<TickGlyph tone="fault" \/>/);
  assert.doesNotMatch(error, /AlertTriangle/);
  assert.match(error, /copy\.backTo\.replace\("\{area\}", backArea\)/);
  assert.equal(CUSTOMER_ROUTE_FALLBACK_AREAS.libraryDetail, "library");
  assert.equal(
    getPlatformCopy("zh-CN").routeStates.backTo.replace("{area}", getPlatformCopy("zh-CN").routeStates.areas.library),
    "返回成品库",
  );
});
