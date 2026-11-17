import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { workspaceNavTitle } from "../src/components/exchange/workspace-page";
import {
  CUSTOMER_ROUTE_FALLBACK_AREAS,
  CUSTOMER_ROUTE_FALLBACKS,
  CUSTOMER_ROUTE_WALL_CELLS,
} from "../src/components/platform/customer-route-state";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { getPublicPageCopy } from "../src/i18n/public-copy";

/**
 * 1025 · B2 页面骨架与控件层：行情头 / WorkspacePage、选中态与空态、品牌、成片详情、
 * 登录与法务、404、批次详情只读与窄屏、路由边界。
 * （本周内容 B2.3、战绩 B2.7 的用例随这两页 2026-11-16 删除。）
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
  // 口径必填：有读数时悬停可见、读屏读到（2026-11-10 起不再单占一行）；副标题不留孤字
  assert.match(header, /data-slot="scope">\{scope\}/);
  assert.match(header, /title=\{typeof scope === "string" \? scope : undefined\}/);
  assert.match(header, /text-pretty/);
});

test("B2.1 WorkspacePage：标题只能是导航名（从字典取），不接收自由文本标题", () => {
  const page = read("src/components/exchange/workspace-page.tsx");
  assert.match(page, /Omit<QuoteHeaderProps, "title" \| "className">/);
  assert.match(page, /getDictionary\(locale\)\.shell\.platformNav\[nav\]/);
  assert.equal(workspaceNavTitle("library", "zh-CN"), "成品库");
  assert.equal(workspaceNavTitle("brands", "zh-CN"), "品牌");
  assert.equal(workspaceNavTitle("create", "zh-CN"), "创作");
  assert.equal(workspaceNavTitle("library", "en-US"), "Video library");
  assert.equal(workspaceNavTitle("brands", "en-US"), "Brands");
  /// 2026-11-16 删掉的两页不再是导航 id（字典里也没有它们的名字）
  assert.doesNotMatch(page, /"plan"|"wins"/);
});

test("B2.1 一级区页面都用 WorkspacePage 开场，口号进副标题", () => {
  const pages: Array<[string, string]> = [
    ["src/app/(platform)/app/brands/page.tsx", "brands"],
    ["src/app/(platform)/app/library/page.tsx", "library"],
    ["src/app/(platform)/app/leads/page.tsx", "leads"],
  ];
  for (const [file, nav] of pages) {
    const source = read(file);
    assert.match(source, new RegExp(`<WorkspacePage\\s+nav="${nav}"`), file);
    assert.doesNotMatch(source, /<QuoteHeader\b/, `${file} 不再手写行情头`);
  }
  // 口号挪进副标题：「可复用品牌包」不再是标题
  const zh = getPlatformCopy("zh-CN");
  assert.match(zh.brands.subtitle, /^可复用品牌包/);
  /// 创作页 2026-10-28 晚改成对话框优先（上线审核 §4，学 Runway 首页）：不再用行情头，
  /// 标题是一句轻问句，读数退成一行；「生成视频 / 产品图片」切换随产品图工作台 2026-11-16 删除
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.doesNotMatch(studio, /<QuoteHeader\b/);
  assert.match(studio, /<h1 id="create-hero-title" className="create-hero-title">\{copy\.heroTitle\}<\/h1>/);
  assert.match(studio, /heroTitle: "今天想拍什么？"/);
  assert.match(studio, /aria-label=\{copy\.readingsLabel\}\s+title=\{copy\.readingsScope\}/);
  assert.doesNotMatch(studio, /CreateModeTabs|PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED/);
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
  assert.ok(zh.library.scope.length > 0);
});

/* ── B2.2 选中态与空态 ─────────────────────────────────────────────── */

test("B2.2 选中态统一 FilterChip / Segmented（aria-pressed + 青线），从不借实心主钮", () => {
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
    "src/app/(platform)/app/library/page.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /<EmptyState\s+data-route-state="empty"/, file);
    assert.doesNotMatch(source, /x-panel x-frame px-6 py-12/, file);
  }
});

/* ── B2.4 品牌 ─────────────────────────────────────────────────────── */

test("B2.4 品牌页：一枚实心主钮在页头、预览底色走 token、去掉 TRUSTED BY 眉题、两块同一种抬头与空态（商品主体那一块 2026-11-16 删除）", () => {
  const page = read("src/app/(platform)/app/brands/page.tsx");
  assert.match(page, /primaryAction=\{<NewBrandPackageButton label=\{copy\.newPackage\} \/>\}/);
  assert.match(page, /<BrandPackageDraftProvider>/);
  const manager = read("src/components/brand/brand-package-manager.tsx");
  assert.match(manager, /variant=\{channel\?\.draftOpen \? "outline" : "default"\}/);
  assert.match(manager, /<SectionHead/);
  assert.match(manager, /<EmptyState compact/);
  assert.doesNotMatch(page, /ProductAnchorManager|product-anchor/);
  const wall = read("src/components/brand/customer-brand-wall.tsx");
  assert.doesNotMatch(stripComments(wall), /TRUSTED BY|已服务客户|x-label/);
  assert.match(wall, /<SectionHead/);
  for (const file of [manager, wall]) {
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

/* ── B2.5 配方弹窗 ─────────────────────────────────────────────────── */

/* ── B2.6 登录与法务 ───────────────────────────────────────────────── */

test("B2.6 登录门：口号与首页同一定位（不再「赛出赢家」）；C1 起实心钮是登录 / 创建账号，「申请试点」描边", () => {
  const zh = getPlatformCopy("zh-CN").auth;
  const en = getPlatformCopy("en-US").auth;
  assert.doesNotMatch(`${zh.titleLead}${zh.titleAccent.join("")}${zh.subtitle}`, /赛出赢家|加仓|赢家/);
  assert.doesNotMatch(`${en.titleLead}${en.titleAccent.join(" ")}`, /Race|winner/i);
  /// 2026-10-28 询盘入口下线、首页改「展厅」：登录门口号与首页同一句定位
  assert.equal(`${zh.titleLead}${zh.titleAccent.join("")}`, "一张商品图，拍成一条能直接发的广告。");
  // 宣言后半句按意群分段、各段不折行
  assert.match(read("src/app/(auth)/layout.tsx"), /copy\.titleAccent\.map\(\(part, index\) => \([\s\S]*?<span className="inline-block">\{part\}<\/span>/);
  assert.equal(zh.pilotCta, "申请试点");
  const layout = read("src/app/(auth)/layout.tsx");
  assert.match(layout, /<PilotCta label=\{copy\.pilotCta\} hint=\{copy\.pilotHint\} \/>/);
  const cta = read("src/components/auth/pilot-cta.tsx");
  assert.match(cta, /href="\/#pilot-apply"/);
  /// C1：登录页的主行动就是登录（旅程审计：实心钮是「申请试点」让登录难找），申请试点一律描边
  assert.match(cta, /variant="outline"/);
  assert.doesNotMatch(cta, /variant=\{/);
  assert.ok(read("src/components/landing/showroom-landing.tsx").includes('id="pilot-apply"'), "首页确有试点申请锚点");
  const login = read("src/app/(auth)/login/page.tsx");
  assert.match(login, /<Button type="submit" disabled=\{loading\} className="w-full">/);
  assert.match(login, /href="\/register"/);
  /// 登录后默认直达创作页（RF-009：不多一跳重定向）；新注册的人由注册页直接进 /app/welcome
  assert.match(login, /: "\/app\/create";/);
});

test("B2.6 隐私 / 条款：正文没有运营待办与环境变量名，保留法务草案状态行", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const copy = getPublicPageCopy(locale);
    const text = JSON.stringify({ privacy: copy.privacy, terms: copy.terms });
    assert.doesNotMatch(text, /NEXT_PUBLIC_|运营负责人|Human operations|IAD1|Buddy|工程草案|engineering draft|launch configuration/i);
    assert.ok(copy.privacy.versionLabel.length > 0);
    assert.ok(copy.terms.versionLabel.length > 0);
    assert.doesNotMatch(copy.privacy.metadata.title + copy.terms.metadata.title, /草案|Draft/);
  }
  for (const file of ["src/app/(public)/privacy/page.tsx", "src/app/(public)/terms/page.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /assumption/);
    assert.match(source, /copy\.versionLabel/);
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

/* ── 路由边界 ──────────────────────────────────────────────────────── */

test("品牌、询盘有自己的加载 / 错误边界，壳层不再被冲掉", () => {
  for (const route of ["brands", "leads"] as const) {
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
  /// 2026-11-10：品牌、模板库页头不再放读数，骨架同步不画（否则加载完读数块消失，页面往上跳）
  assert.equal(CUSTOMER_ROUTE_WALL_CELLS.brands, 0);
  assert.match(loading, /\{cells > 0 \? \(/);
  const error = read("src/components/platform/customer-route-error.tsx");
  assert.match(error, /<TickGlyph tone="fault" \/>/);
  assert.doesNotMatch(error, /AlertTriangle/);
  assert.match(error, /copy\.backTo\.replace\("\{area\}", backArea\)/);
  assert.equal(CUSTOMER_ROUTE_FALLBACK_AREAS.libraryDetail, "library");
  /// 询盘出错时的「返回」以前去本周内容；那一页 2026-11-16 删了，改回创作页——不能再指向不存在的页面
  assert.equal(CUSTOMER_ROUTE_FALLBACKS.leads, "/app/create");
  assert.equal(CUSTOMER_ROUTE_FALLBACK_AREAS.leads, "create");
  for (const target of Object.values(CUSTOMER_ROUTE_FALLBACKS)) {
    assert.doesNotMatch(target, /\/app\/(plan|wins|racing|create\/images)/, target);
  }
  assert.equal(
    getPlatformCopy("zh-CN").routeStates.backTo.replace("{area}", getPlatformCopy("zh-CN").routeStates.areas.library),
    "返回成品库",
  );
});
