/**
 * 线路精简：对外线路只留 Shuyu（出图 / 出片）与只做出方案的 OpenAI。
 *
 * 2026-11-09（Lucas 定）先做 A 级——只撤入口，组件、接口与供应商代码保留。
 * 2026-11-16 第 2 批瘦身把其中四条线路整段删了：实拍图库 + 配音、链接抓取、抠图。这里守住删完之后的事实：
 *   - 那些接口、组件、供应商文件不在了，也没有任何活代码还指着它们；
 *   - 数据库不动：表与已有记录留着，库里旧的能力状态行不让任何页面出错；
 *   - 还留着但没在用的只有内容审核（生产关着，合规随时可能要开），客户视图不列它、它翻转不叫醒人；
 *   - 留下的线路出问题照样报。
 * 出片没有兜底线路（Shuyu 不可用就按原原因拒绝）的断言在 batch-route-failover.test.ts。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CAPABILITY_KEYS,
  FEATURE_KEYS,
  RETIRED_CAPABILITY_KEYS,
  isCapabilityKey,
  isRetiredCapability,
  resolveCapabilities,
  withoutRetiredCapabilities,
  type CapabilityKey,
  type CapabilityRecord,
} from "../src/lib/capabilities/registry";
import { rowToCapabilityRecord } from "../src/lib/services/capability-status-service";
import { capabilityTransitionAlert } from "../src/lib/services/ops-alert-service";

const NOW = new Date("2026-11-16T12:00:00.000Z");
const ALL_CONFIGURED = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<CapabilityKey, boolean>;
/// 2026-11-16 随线路一起删掉的四个能力键；CapabilityStatus 表里它们的旧行还在
const DELETED_CAPABILITY_KEYS = ["voice", "stock", "scrape", "cutout"] as const;

function record(key: CapabilityKey, status: CapabilityRecord["status"], reason: CapabilityRecord["reason"]): CapabilityRecord {
  return {
    key,
    status,
    reason,
    source: "probe",
    checkedAt: NOW.toISOString(),
    failingSince: status === "available" ? null : NOW.toISOString(),
  };
}

const read = (path: string) => readFileSync(path, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

test("能力清单：留下出方案、看图、出图、配图、出片、审核、邮件；配音 / 图库 / 抓取 / 抠图不再是能力", () => {
  assert.deepEqual([...CAPABILITY_KEYS], ["text", "vision", "image", "graphics", "video", "moderation", "email"]);
  for (const key of DELETED_CAPABILITY_KEYS) assert.equal(isCapabilityKey(key), false, key);
  /// 「已下线」清单里只剩审核：代码与开关都在，生产关着
  assert.deepEqual([...RETIRED_CAPABILITY_KEYS], ["moderation"]);
  for (const key of ["text", "vision", "image", "graphics", "video", "email"] as const) {
    assert.equal(isRetiredCapability(key), false, key);
  }
  for (const gone of ["broll", "linkImport", "productCutout"]) {
    assert.equal((FEATURE_KEYS as readonly string[]).includes(gone), false, gone);
  }
});

test("四条线路的接口、组件与供应商代码都删了（不是关着：这些地址现在是 404）", () => {
  for (const gone of [
    // 实拍图库 + 配音
    "src/app/api/broll",
    "src/components/video-generation/broll-quick-card.tsx",
    "src/lib/services/broll-assembly-service.ts",
    "src/lib/services/broll-plan-service.ts",
    "src/lib/providers/stock-footage.ts",
    "src/lib/providers/tts",
    // 链接抓取
    "src/app/api/product-link",
    "src/components/video-generation/product-link-prefill.tsx",
    "src/lib/providers/firecrawl.ts",
    // 抠图
    "src/app/api/product-anchors",
    "src/components/brand/product-anchor-manager.tsx",
    "src/lib/services/product-anchor-service.ts",
    "src/lib/contracts/product-anchor-api.ts",
    "src/lib/providers/cutout.ts",
    "src/lib/providers/remove-bg.ts",
  ]) {
    assert.equal(existsSync(gone), false, `${gone} 应该已经删除`);
  }
});

test("没有活代码还指着删掉的线路：不 import、不请求那些接口、不读它们的密钥", () => {
  const offenders: string[] = [];
  const forbidden =
    /broll-assembly-service|broll-plan-service|broll-quick-card|providers\/stock-footage|providers\/tts|providers\/firecrawl|providers\/cutout|providers\/remove-bg|product-anchor-service|product-anchor-manager|product-anchor-api|product-link-prefill|\/api\/broll|\/api\/product-link|\/api\/product-anchors|PEXELS_API_KEYS|PIXABAY_API_KEYS|FIRECRAWL_API_KEY|REMOVE_BG_API_KEY|CLIPDROP_API_KEY|ELEVENLABS_API_KEY|TTS_PROVIDER|PRODUCT_ANCHOR_CUTOUT_CRON/;
  for (const file of walk("src")) {
    /// 注释里可以提历史；只看代码行
    const code = read(file)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    if (forbidden.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("入口开关随代码一起拿掉：要放回得取回代码，不是改个开关", () => {
  /// 最后一个开关（产品图工作台的切换）2026-11-16 第 3 批随工作台删除，entry-policy.ts 整个文件没了
  assert.equal(existsSync("src/lib/create/entry-policy.ts"), false);

  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  assert.doesNotMatch(studio, /PRODUCT_LINK_ENTRY_ENABLED|BROLL_ROUTE_ENTRY_ENABLED|ProductLinkPrefill|BrollQuickCard/);
  assert.doesNotMatch(studio, /PRODUCT_IMAGE_STUDIO_ENTRY_ENABLED|CreateModeTabs|entry-policy/);
  const brands = read("src/app/(platform)/app/brands/page.tsx");
  assert.doesNotMatch(brands, /PRODUCT_ANCHOR_ENTRY_ENABLED|ProductAnchorManager|listProductAnchorsForUser/);
  assert.match(brands, /<BrandPackageManager/, "品牌包管理照旧");
  assert.match(brands, /<CustomerBrandWall/, "全局品牌墙照旧");
});

test("每分钟的 poll-videos 不再调抠图续跑，也不再轮询产品图 / 图文配图；出片、故事板、清扫都还在", () => {
  const cron = read("src/app/api/cron/poll-videos/route.ts");
  assert.doesNotMatch(cron, /sweepProductAnchorCutouts|anchorCutout|anchorResult/);
  for (const kept of [
    "dependencies.pollRunningJobs(30)",
    "dependencies.pollPendingStoryboardRuns(20)",
    "dependencies.sweepStuckTasks()",
  ]) {
    assert.ok(cron.includes(kept), kept);
  }
  assert.doesNotMatch(cron, /pollPendingProductImageJobs|pollPendingContentPostRenders/);
});

test("数据库不动：ProductAnchor 表留着；库里已删能力键的旧状态行读出来被忽略，不让任何页面出错", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /^model ProductAnchor \{/m);
  assert.match(schema, /^model CapabilityStatus \{/m);

  for (const key of DELETED_CAPABILITY_KEYS) {
    assert.equal(
      rowToCapabilityRecord({ key, status: "unavailable", detail: { reason: "permission", source: "probe" }, checkedAt: NOW, failingSince: NOW }),
      null,
      key,
    );
  }
  /// 就算有一行漏过了存储层的过滤，视图也只按现存的键出行
  const stale = DELETED_CAPABILITY_KEYS.map(
    (key) => ({ ...record("text", "unavailable", "permission"), key }) as unknown as CapabilityRecord,
  );
  const full = resolveCapabilities({ records: stale, configured: ALL_CONFIGURED, now: NOW });
  assert.deepEqual(full.items.map((item) => item.key), [...CAPABILITY_KEYS]);
  assert.equal(full.paused, false, "一条已经不存在的线路的旧故障不点亮「部分 AI 能力暂停」");
  assert.equal(withoutRetiredCapabilities(full).paused, false);
});

test("客户视图：没在用的审核不列出、不计数；它出错不点亮「部分 AI 能力暂停」", () => {
  const full = resolveCapabilities({
    records: [record("moderation", "unavailable", "permission"), record("video", "available", "ok")],
    configured: ALL_CONFIGURED,
    now: NOW,
  });
  assert.equal(full.items.length, CAPABILITY_KEYS.length, "完整视图不变：功能闸门与探测照旧用它");
  assert.equal(full.paused, true);

  const customer = withoutRetiredCapabilities(full);
  assert.deepEqual(
    customer.items.map((item) => item.key),
    CAPABILITY_KEYS.filter((key) => !isRetiredCapability(key)),
  );
  assert.equal(customer.paused, false, "审核 403 不让壳层报暂停");
  assert.ok(
    customer.items.every((item) => !item.features.includes("uploadReview")),
    "「影响哪些功能」里不列依赖审核的上传审核",
  );
  const writing = customer.items.find((item) => item.key === "text");
  assert.ok(writing?.features.includes("scriptWriting"), "仍在用的功能照列");
  assert.equal(
    Object.values(customer.counts).reduce((sum, count) => sum + count, 0),
    customer.items.length,
    "计数与列出的行一致",
  );
});

test("客户视图：留下的线路出问题照样报", () => {
  const customer = withoutRetiredCapabilities(
    resolveCapabilities({
      records: [record("video", "unavailable", "quota"), record("moderation", "available", "ok")],
      configured: ALL_CONFIGURED,
      now: NOW,
    }),
  );
  assert.equal(customer.paused, true);
  assert.equal(customer.counts.unavailable >= 1, true);
});

test("客户视图接在状态页、壳层与 /api/capabilities 三处；创作页的功能闸门仍用完整视图", () => {
  for (const path of [
    "src/app/(platform)/app/status/page.tsx",
    "src/app/(platform)/app/layout.tsx",
    "src/app/api/capabilities/route.ts",
  ]) {
    assert.match(read(path), /withoutRetiredCapabilities\(/, path);
  }
  assert.doesNotMatch(read("src/app/(platform)/app/create/page.tsx"), /withoutRetiredCapabilities/);
});

test("运维告警：没在用的审核翻转不叫醒人；出片、看图照报", () => {
  for (const key of RETIRED_CAPABILITY_KEYS) {
    assert.equal(
      capabilityTransitionAlert({ status: "available" }, { key, status: "unavailable", reason: "quota" }),
      null,
      key,
    );
    assert.equal(capabilityTransitionAlert({ status: "unavailable" }, { key, status: "available", reason: "ok" }), null, key);
  }
  assert.equal(
    capabilityTransitionAlert({ status: "available" }, { key: "video", status: "unavailable", reason: "quota" })?.kind,
    "capability_down",
  );
  assert.equal(
    capabilityTransitionAlert({ status: "available" }, { key: "vision", status: "unavailable", reason: "quota" })?.kind,
    "capability_down",
  );
});

test("画面质检整套删除之后：功能表里没有它，状态页「影响哪些功能」不列；看图这项能力本身还在（出方案看商品图）", () => {
  assert.equal((FEATURE_KEYS as readonly string[]).includes("frameQa"), false);
  const full = resolveCapabilities({ records: [record("vision", "available", "ok")], configured: ALL_CONFIGURED, now: NOW });
  const fullVision = full.items.find((item) => item.key === "vision");
  assert.deepEqual(fullVision?.features, ["storyboardReview"]);
  const vision = withoutRetiredCapabilities(full).items.find((item) => item.key === "vision");
  assert.ok(vision, "看图能力仍在客户视图里");
  assert.deepEqual(vision.features, ["storyboardReview"]);
  assert.match(vision.message["zh-CN"], /商品图/);
});

/* ── 第 3 批之三（2026-11-16）：四个早已撤出菜单的页面彻底删除 ───────────────── */

test("本周内容、战绩、投放赛马、产品图工作台：页面、接口、组件、只有它们用的服务都不在了", () => {
  for (const gone of [
    "src/app/(platform)/app/plan",
    "src/app/(platform)/app/wins",
    "src/app/(platform)/app/racing",
    "src/app/(platform)/app/create/images",
    "src/app/api/content-plans",
    "src/app/api/racing",
    "src/app/api/product-images",
    "src/app/api/demo",
    "src/components/content-plan",
    "src/components/wins",
    "src/components/racing",
    "src/components/product-images",
    "src/components/library/render-pending-posts-button.tsx",
    "src/components/library/post-render-watcher.tsx",
    "src/lib/services/content-plan-service.ts",
    "src/lib/services/content-plan-store.ts",
    "src/lib/services/product-link-service.ts",
    "src/lib/services/racing-service.ts",
    "src/lib/services/scoring-service.ts",
    "src/lib/services/racing-confidence.ts",
    "src/lib/services/recipe-racing-service.ts",
    "src/lib/services/winner-derivation-service.ts",
    "src/lib/services/first-pass-rate-service.ts",
  ]) {
    assert.equal(existsSync(gone), false, `${gone} 应该已经删除`);
  }
});

test("没有活代码还链到那四页或请求它们的接口；旧网址由 next.config 转到还在的页面", () => {
  const offenders: string[] = [];
  const forbidden =
    /["'`(]\/app\/(plan|wins|racing)\b|\/app\/create\/images|\/api\/content-plans|\/api\/racing|\/api\/product-images|\/api\/demo\b|productImageResultId/;
  for (const file of walk("src")) {
    /// 注释里可以提历史；只看代码行
    const code = read(file)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    if (forbidden.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);

  const config = read("next.config.ts");
  for (const [source, destination] of [
    ["/app/plan", "/app/create"],
    ["/app/wins", "/app/library"],
    ["/app/racing", "/app/library"],
    ["/app/create/images", "/app/create"],
  ]) {
    assert.ok(
      config.includes(`{ source: "${source}", destination: "${destination}", permanent: false }`),
      `${source} 的旧书签要落到 ${destination}`,
    );
  }
  assert.doesNotMatch(config, /destination: "\/app\/(plan|wins|racing|create\/images)"/, "不能再有转向已删页面的跳转");
});

test("成品库里以前做好的图文帖照旧摆着，但不再链到已删的本周内容；询盘出错时的返回钮改回创作页", () => {
  const library = read("src/app/(platform)/app/library/page.tsx");
  assert.match(library, /readyPostRows\.map/);
  assert.match(library, /row\.source !== "post" \|\| row\.status === "ready"/);
  assert.match(read("src/app/(platform)/app/library/[id]/page.tsx"), /if \(id\.startsWith\("post-"\)\) redirect\("\/app\/library"\);/);
  const routeState = read("src/components/platform/customer-route-state.ts");
  assert.match(routeState, /leads: "\/app\/create"/);
  assert.doesNotMatch(routeState, /"createImages"|"racing"|"plan"|"wins"/);
});

test("产品图 / 图文配图的出图与轮询代码整套删了（2026-11-16 收尾）；表留着，以前出好的图文帖成品库照样摆", () => {
  for (const gone of [
    "src/lib/services/product-image-service.ts",
    "src/lib/services/content-post-image-job-service.ts",
    "src/lib/services/content-post-render-service.ts",
    "src/lib/services/content-post-render-state.ts",
    "src/lib/contracts/content-post-render.ts",
  ]) {
    assert.equal(existsSync(gone), false, gone);
  }
  /// 数据库只加不删：表与枚举原样留着
  const schema = read("prisma/schema.prisma");
  for (const model of ["ProductImageJob", "ProductImageProviderTask", "ContentPost", "ContentPostImageTask"]) {
    assert.match(schema, new RegExp(`^model ${model} \\{`, "m"), model);
  }
  /// 成品库还读 ContentPost：出过图的帖子是成品（展示用的代码留着），只是不再有「出图中」
  const library = read("src/lib/services/unified-library-service.ts");
  assert.match(library, /db\.contentPost\.findMany\(/);
  assert.match(library, /export function toContentPostLibraryRow\(/);
  assert.doesNotMatch(library, /isContentPostRendering|content-post-render-state/);
});
