import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import { getPublicPageCopy } from "../src/i18n/public-copy";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { getGrowthCopy } from "../src/i18n/growth-copy";
import { VIDEO_ROUTE_REGISTRY } from "../src/lib/video-generation/video-route-registry";
import { READINGS } from "../src/lib/exchange/readings-registry";
import { loadNeedsAttention, loadPulse } from "../src/lib/services/exchange-readings";
import { templateDisplayName, toBatchLibraryRow } from "../src/lib/services/unified-library-service";
import { videoFirstPassRate } from "../src/lib/services/first-pass-rate-service";
import { batchMonitorReadings } from "../src/components/batch/batch-monitor-readings";
import { leadMilestone } from "../src/components/leads/lead-milestone";

/**
 * 1025 · UI 复核修复（LENS-1 … LENS-10）的回归测试。DB 一律打桩，不连数据库、不调供应商。
 */

const read = (file: string) => readFileSync(file, "utf8");

type Calls = Record<string, unknown[]>;

/** 把 db.<model>.<method> 换成桩，记录每次的入参；测试结束还原。 */
function stub(t: TestContext, calls: Calls, model: string, method: string, impl: (args: unknown) => unknown) {
  const target = (db as unknown as Record<string, Record<string, unknown>>)[model];
  const original = target[method];
  target[method] = async (args: unknown) => {
    (calls[`${model}.${method}`] ??= []).push(args);
    return impl(args);
  };
  t.after(() => {
    target[method] = original;
  });
}

/* ── LENS-2 隐私政策：处理方名单与真实接入的供应商一致 ─────────────────── */

test("LENS-2 隐私政策点名唯一的客户视频线路的供应商（Shuyu），并写明处理区域待确认", () => {
  /// 客户唯一线路 buddy 走 shuyu 适配器；它的处理区域在注册表里还是 null（未确认）
  assert.equal(VIDEO_ROUTE_REGISTRY.buddy.providerAdapter, "shuyu");
  assert.equal(VIDEO_ROUTE_REGISTRY.buddy.processingRegion, null);
  const zh = getPublicPageCopy("zh-CN").privacy.processors.body;
  const en = getPublicPageCopy("en-US").privacy.processors.body;
  assert.match(zh, /Shuyu/);
  assert.match(en, /Shuyu/);
  assert.match(zh, /Shuyu 的处理区域与合同条款仍在确认中/);
  assert.match(en, /Shuyu's processing region and contract terms are still being confirmed/);
  /// 不再许下「新增处理方前先更新本节」这种已经被违反过的承诺
  assert.doesNotMatch(zh, /新增处理方前/);
  assert.doesNotMatch(en, /before adding a new processor/);
});

test("LENS-2 代码里真在调的外部供应商，中英两版处理方名单都点了名", () => {
  /// 供应商模块 → 政策里应出现的名字（模块被删了这里会先红，提醒同步改政策）
  const wired: Array<[file: string, names: string[]]> = [
    ["src/lib/providers/shuyu.ts", ["Shuyu"]],
    ["src/lib/providers/openai.ts", ["OpenAI"]],
    ["src/lib/providers/cutout.ts", ["remove.bg", "Clipdrop"]],
    ["src/lib/providers/firecrawl.ts", ["Firecrawl"]],
    ["src/lib/providers/stock-footage.ts", ["Pexels", "Pixabay"]],
    ["src/lib/services/notification-service.ts", ["Resend"]],
    ["src/lib/config/seedance-runtime.ts", ["BytePlus"]],
  ];
  for (const locale of ["zh-CN", "en-US"] as const) {
    const body = getPublicPageCopy(locale).privacy.processors.body;
    for (const [file, names] of wired) {
      assert.ok(existsSync(file), `${file} 不存在：供应商变了，先同步隐私政策`);
      for (const name of names) assert.ok(body.includes(name), `${locale} 处理方名单缺 ${name}`);
    }
    for (const name of ["Neon", "Vercel"]) assert.ok(body.includes(name), `${locale} 缺 ${name}`);
  }
  /// Seedance 两个档位都只在启用时使用：中国区端点必须写明是北京
  assert.match(getPublicPageCopy("zh-CN").privacy.processors.body, /Seedance 视频线路只在启用时使用：BytePlus（东南亚）或火山引擎（中国北京）/);
  assert.match(getPublicPageCopy("en-US").privacy.processors.body, /Seedance video routes are used only when enabled: BytePlus \(Southeast Asia\) or Volcengine \(Beijing, China\)/);
});

test("LENS-2 询盘与试点申请的联系方式：写清用途与保存多久；法务草案状态行保留", () => {
  const zh = getPublicPageCopy("zh-CN").privacy;
  const en = getPublicPageCopy("en-US").privacy;
  assert.match(zh.information.body, /询盘页或试点申请表/);
  assert.match(zh.information.body, /保存到你申请删除为止/);
  assert.match(en.information.body, /inquiry page or our pilot application form/);
  assert.match(en.information.body, /kept until you ask us to delete them/);
  assert.equal(zh.draftStatus, "草案 · 待加拿大律师复核");
  assert.equal(en.draftStatus, "DRAFT · PENDING CANADIAN LEGAL REVIEW");
});

/* ── LENS-1 读数墙：名字与口径在窄屏折行，不截断 ─────────────────────── */

test("LENS-1 QuoteHeader：读数名与口径不再 truncate，只有大数字保留单行", () => {
  const header = read("src/components/exchange/quote-header.tsx");
  const wall = header.slice(header.indexOf("<dl"), header.indexOf("</dl>"));
  const truncated = [...wall.matchAll(/className=(?:"([^"]*)"|\{cn\("([^"]*)")/g)]
    .map((match) => match[1] ?? match[2])
    .filter((className) => /\btruncate\b/.test(className));
  /// 2026-10-28 读数墙改成一排小数据卡（学 LibTV）：仍然只有数字可以截断
  assert.deepEqual(truncated, ["truncate text-subhead font-semibold tabular-nums"], "只有读数数字可以截断");
  assert.match(wall, /<span className="min-w-0 break-words text-pretty">\{stat\.label\}<\/span>/);
  /// 2026-10-28：口径说明收进悬停提示与读屏文本，不再撑大数据卡
  assert.match(wall, /<dd className="sr-only">\{stat\.caption\}<\/dd>/);
  assert.match(wall, /title=\{typeof stat\.caption === "string" \? stat\.caption : undefined\}/);
});

/* ── LENS-4 英文界面不挂中文模板名 ──────────────────────────────────── */

const TEMPLATE = { nameZh: "价值感证明", name: "Value Proof" };

test("LENS-4 成品库批量行：英文界面用英文模板名，中文界面用中文名", () => {
  const job = {
    id: "job-1",
    batchIndex: 2,
    status: "SUCCEEDED",
    lastProgress: 100,
    outputVideoUrl: null,
    outputThumbUrl: null,
    brandedVideoUrl: null,
    templateSnapshot: null,
    updatedAt: new Date("2026-10-24T10:00:00.000Z"),
    batchJob: { id: "batch-1", productName: null, template: TEMPLATE },
  } as unknown as Parameters<typeof toBatchLibraryRow>[0];
  assert.equal(toBatchLibraryRow(job, false, "en-US")!.title, "Value Proof #3 · Value Proof");
  assert.equal(toBatchLibraryRow(job, false, "zh-CN")!.title, "价值感证明 #3 · 价值感证明");
  assert.equal(toBatchLibraryRow(job)!.title, "价值感证明 #3 · 价值感证明", "默认仍是中文");
  assert.equal(templateDisplayName(TEMPLATE, "en-US"), "Value Proof");
  assert.equal(templateDisplayName(TEMPLATE, "zh-CN"), "价值感证明");
});

test("LENS-4 需要处理列表：英文界面的标题用英文模板名", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "workspace", "findUnique", () => ({ failuresAckedAt: null }));
  stub(t, calls, "videoJob", "findMany", () => [{
    id: "job-9",
    batchIndex: 7,
    status: "FAILED",
    submissionState: null,
    submissionErrorClass: null,
    errorMessage: "provider exploded",
    userSafeError: null,
    updatedAt: new Date("2026-10-24T10:00:00.000Z"),
    batchJob: { id: "batch-9", productName: "Roller blind", template: TEMPLATE },
  }]);
  stub(t, calls, "videoBrief", "findMany", () => []);
  stub(t, calls, "videoJob", "count", () => 1);
  stub(t, calls, "videoBrief", "count", () => 0);
  const en = await loadNeedsAttention("user-1", { locale: "en-US" });
  assert.equal(en.items[0]!.title, "Roller blind #8 · Value Proof");
  const zh = await loadNeedsAttention("user-1");
  assert.equal(zh.items[0]!.title, "Roller blind #8 · 价值感证明");
});

test("LENS-4 生产带：没有产品名时退回的模板名按界面语言取", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "workspace", "findUnique", (args) => {
    const select = (args as { select?: Record<string, unknown> }).select ?? {};
    if ("owner" in select) return { planId: "starter", owner: { subscriptionTier: "free" } };
    return { id: "ws-1", failuresAckedAt: null };
  });
  stub(t, calls, "batchJob", "groupBy", () => []);
  stub(t, calls, "videoJob", "groupBy", () => []);
  stub(t, calls, "videoBrief", "count", () => 0);
  stub(t, calls, "videoJob", "count", () => 0);
  stub(t, calls, "contentPost", "count", () => 0);
  stub(t, calls, "lead", "count", () => 0);
  stub(t, calls, "userUsagePeriod", "findMany", () => []);
  stub(t, calls, "batchJob", "findMany", () => [{
    id: "batch-abcde",
    productName: null,
    status: "RUNNING",
    requestedCount: 3,
    completedCount: 1,
    failedCount: 0,
    updatedAt: new Date("2026-10-24T08:00:00.000Z"),
    template: TEMPLATE,
  }]);
  assert.equal((await loadPulse("user-1", { locale: "en-US" })).tape[0]!.name, "Value Proof");
  assert.equal((await loadPulse("user-1")).tape[0]!.name, "价值感证明");
});

test("LENS-4 页面把界面语言传进成品库、需要处理、大屏与脉搏", () => {
  const library = read("src/app/(platform)/app/library/page.tsx");
  assert.match(library, /loadUnifiedLibrary\(userId, \{ locale \}\)/);
  assert.match(library, /loadNeedsAttention\(userId, \{ locale \}\)/);
  assert.match(read("src/app/(wall)/wall/page.tsx"), /loadExchangeReadings\(userId, \{ mediaLimit: 6, recentLimit: 16, locale \}\)/);
  assert.match(read("src/app/(platform)/app/layout.tsx"), /loadPulse\(userId, \{ locale \}\)/);
  assert.match(read("src/app/api/exchange/pulse/route.ts"), /loadPulse\(guard\.session\.user\.id, \{ locale: await getServerLocale\(\) \}\)/);
  /// 服务层拼标题不再直接读 nameZh，一律走 templateDisplayName
  for (const file of ["src/lib/services/exchange-readings.ts", "src/lib/services/unified-library-service.ts"]) {
    assert.doesNotMatch(read(file), /(?:batch|batchJob)\.template\.nameZh/, file);
  }
});

/* ── LENS-5 批次详情读数墙：取消的条数有去处 ─────────────────────────── */

test("LENS-5 批次读数墙：已取消单独一格，各格加起来等于总数", () => {
  const cancelledBatch = {
    requestedCount: 4,
    completedCount: 1,
    runningCount: 0,
    queuedCount: 0,
    pausedCount: 0,
    failedCount: 0,
    cancelledCount: 3,
  };
  for (const locale of ["zh-CN", "en-US"] as const) {
    const readings = batchMonitorReadings(cancelledBatch, {
      copy: getPlatformCopy(locale).batches.monitor,
      locale,
      progress: 100,
      live: false,
    });
    const cancelledLabel = locale === "zh-CN" ? "已取消" : "Cancelled";
    const cancelled = readings.find((stat) => stat.label === cancelledLabel);
    assert.ok(cancelled, `${locale} 缺「已取消」格`);
    assert.equal(cancelled.value, 3);
    assert.equal(cancelled.tone, undefined, "取消不是故障：中性色");
    /// 总数之外、进度之前的格子就是每一条的去处
    const items = readings.slice(1, -1).map((stat) => Number(stat.value));
    assert.equal(items.reduce((sum, value) => sum + value, 0), cancelledBatch.requestedCount);
    assert.equal(new Set(readings.map((stat) => stat.label)).size, readings.length, "key=label 必须唯一");
  }
  const monitor = read("src/components/batch/batch-monitor.tsx");
  assert.match(monitor, /readings=\{batchMonitorReadings\(batch, \{/);
  /// 2026-10-28 读数改成自动换行的一排小数据卡：7 格也不会留空格
  assert.match(read("src/components/exchange/quote-header.tsx"), /<dl aria-label=\{readingsLabel\} className="flex flex-wrap gap-2">/);
});

/* ── LENS-6 战绩页一次通过率：取消不算失败 ──────────────────────────── */

test("LENS-6 视频一次通过率的样本只含成片与失败，取消不进分母", async (t) => {
  const calls: Calls = {};
  stub(t, calls, "videoJob", "count", (args) => {
    const where = (args as { where: { status: unknown } }).where;
    return where.status === "SUCCEEDED" ? 23 : 29; // 23 条一次通过；成片 + 失败 = 29（另有 3 条取消不计）
  });
  const rate = await videoFirstPassRate({ userId: "user-1" });
  const sampleWhere = (calls["videoJob.count"]![0] as { where: { status: { in: string[] } } }).where;
  assert.deepEqual(sampleWhere.status.in, ["SUCCEEDED", "FAILED"]);
  assert.equal(rate.sample, 29);
  assert.equal(Math.round((rate.rate ?? 0) * 100), 79);
  assert.match(getPlatformCopy("zh-CN").wins.scope, /取消不计/);
  assert.match(getPlatformCopy("en-US").wins.scope, /cancels excluded/);
});

/* ── LENS-8 询盘时间列：里程碑不和当前状态打架 ─────────────────────── */

test("LENS-8 询盘里程碑：只写当前状态仍然成立的那一步", () => {
  const at = { contactedAt: "2026-10-24T10:00:00.000Z", bookedAt: "2026-10-24T12:00:00.000Z", wonAt: "2026-10-24T15:20:00.000Z" };
  assert.deepEqual(leadMilestone({ status: "WON", ...at }), { status: "WON", at: at.wonAt });
  assert.equal(leadMilestone({ status: "LOST", ...at }), null, "已成交改回未成交：不再挂绿色「已成交」");
  assert.equal(leadMilestone({ status: "NEW", ...at }), null, "退回新询盘：不再挂「已联系」");
  assert.deepEqual(leadMilestone({ status: "BOOKED", ...at }), { status: "BOOKED", at: at.bookedAt });
  assert.deepEqual(leadMilestone({ status: "CONTACTED", ...at }), { status: "CONTACTED", at: at.contactedAt });
  assert.deepEqual(
    leadMilestone({ status: "WON", contactedAt: at.contactedAt, bookedAt: null, wonAt: null }),
    { status: "CONTACTED", at: at.contactedAt },
    "缺时间戳时退回更早且成立的一步",
  );
  const board = read("src/components/leads/leads-board.tsx");
  assert.match(board, /const milestone = leadMilestone\(lead\);/);
  assert.doesNotMatch(board, /lead\.wonAt \?/);
});

/* ── LENS-7 手工登记：商家的口吻 ─────────────────────────────────────── */

test("LENS-7 手工登记表单用商家口吻的字段名，不借访客表单的「怎么称呼你」", () => {
  const form = read("src/components/leads/manual-lead-form.tsx");
  assert.match(form, /label=\{copy\.manualName\}/);
  assert.match(form, /label=\{copy\.manualService\}/);
  assert.match(form, /label=\{copy\.manualSource\}/);
  assert.doesNotMatch(form, /growth\.leadForm\.(name|service|source)\b/);
  const zh = getGrowthCopy("zh-CN").leads;
  const en = getGrowthCopy("en-US").leads;
  for (const label of [zh.manualName, zh.manualService, zh.manualSource]) {
    assert.match(label, /客户/);
    assert.doesNotMatch(label, /称呼你|看到我们/);
  }
  for (const label of [en.manualName, en.manualService, en.manualSource]) {
    assert.match(label, /customer/i);
    assert.doesNotMatch(label, /\byour name\b|hear about us/i);
  }
});

/* ── LENS-3 客户看额度（成片条数），供应商积分只给内部角色 ─────────── */

test("LENS-3 创作台：主按钮不写积分，提示按本月额度写，不再写死 900 积分", () => {
  const studio = read("src/components/video-generation/streamlined-video-studio.tsx");
  /// 1028 闭环轮：快速模式不再单独「核对规格」，主按钮直接「生成 AI 故事板」（方案在里面一并出）
  assert.match(studio, /createStoryboard: "生成 AI 故事板",/);
  assert.match(studio, /createStoryboard: "Generate AI storyboard",/);
  assert.doesNotMatch(studio, /reviewSpecs/);
  assert.doesNotMatch(studio, /shuyuEstimate|"900"/);
  assert.match(studio, /quotaHint: "提交时预占 1 条额度，失败与取消自动返还：本月已用 \{used\} \/ \{limit\} 条。"/);
  assert.match(studio, /copy\.quotaHint\s*\.replace\("\{used\}", String\(readings\.quotaUsed\)\)\s*\.replace\("\{limit\}", String\(readings\.quotaLimit\)\)/);
  /// 读数注册表：英文口径与中文一致（取消也返还）
  assert.equal(READINGS.monthlyQuota.formula["en-US"], "Used (incl. in progress) ÷ plan limit · UTC month · failures and cancels refunded");
});

test("LENS-3 新建批次：客户看「计入额度」，供应商积分只在内部角色下出现", () => {
  const wizard = read("src/components/batch/batch-create-wizard.tsx");
  assert.match(wizard, /showProviderPoints = false,/);
  assert.match(wizard, /showPlanPoints=\{showProviderPoints\}/);
  /// 渲染区里每一处积分文案都在 showProviderPoints 判断之后（属性注释里的举例不算）
  const render = wizard.slice(wizard.indexOf("<VideoRouteSelector"));
  const pointsCopy = [...render.matchAll(/本批预计消耗|预计积分|Estimated points|Estimated provider charge/g)];
  assert.ok(pointsCopy.length >= 4);
  for (const match of pointsCopy) {
    const before = render.slice(Math.max(0, (match.index ?? 0) - 900), match.index);
    assert.match(before, /!showProviderPoints/, `「${match[0]}」必须在内部角色判断之后`);
  }
  assert.match(wizard, /提交时预占 \$\{totalVideoCount\} 条/);
  assert.match(wizard, /本批 \$\{totalVideoCount\} 条提交时预占本月额度，失败与取消自动返还——最终只为交付的成片计数。/);
  assert.match(read("src/app/(platform)/app/batches/new/page.tsx"), /showProviderPoints=\{isInternalRole\(session\.user\.role\)\}/);
  const selector = read("src/components/video-generation/video-route-selector.tsx");
  assert.match(selector, /showPlanPoints = true,/);
  assert.match(selector, /\{showPlanPoints \? ` · \$\{plan\.unitSalePoints\.toLocaleString\(\)\} \$\{unitLabel\}` : ""\}/);
  assert.match(selector, /const shuyuDescription = selectedPlan && showPlanPoints/);
});

/* ── LENS-9 暂停横幅不露工程词 ──────────────────────────────────────── */

test("LENS-9 暂停横幅：不说熔断 / circuit breaker，只说拥堵与自动续跑", () => {
  const zh = getPlatformCopy("zh-CN").batches.monitor.paused;
  const en = getPlatformCopy("en-US").batches.monitor.paused;
  assert.equal(zh, "生成服务暂时拥堵，剩余 {count} 条已安全暂停，恢复后会自动续跑。");
  assert.equal(en, "Generation is temporarily congested. {count} items are safely paused and will resume automatically.");
  assert.match(read("tests/b2-copy-hygiene.test.ts"), /\/熔断\|circuit breaker\/i,/);
});

/* ── LENS-10 首页一页一枚实心主钮 ───────────────────────────────────── */

test("LENS-10 首页（2026-10-28 展厅）：全页唯一实心主行动是「免费试做」白色胶囊 → 注册；看样片 / 申请陪跑是玻璃胶囊；表单提交描边", () => {
  const landing = read("src/components/landing/showroom-landing.tsx");
  const form = read("src/components/leads/pilot-application-form.tsx");
  const primaries = [...landing.matchAll(/<(?:Link|a)\b[^>]*data-primary="true"[^>]*>/g)].map((match) => match[0]);
  assert.equal(primaries.length, 1, `实心主行动：${primaries.join(" | ")}`);
  assert.match(primaries[0]!, /href="\/register"/);
  assert.match(landing, /<a href="#pilot-apply" className="show-glass">/);
  assert.match(landing, /<a href="#samples" className="show-glass">/);
  /// 展厅里不再用 <Button> 实心钮；申请表的提交仍然描边
  assert.doesNotMatch(landing, /<Button\b/);
  assert.match(form, /<Button type="submit" variant="outline"/);
});
