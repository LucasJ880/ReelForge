import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  loadPulse,
  loadVideoQuota,
  needsAttentionSince,
  NEEDS_ATTENTION_WINDOW_DAYS,
} from "../src/lib/services/exchange-readings";
import {
  READINGS,
  quotaStat,
  readingStat,
  type ReadingId,
} from "../src/lib/exchange/readings-registry";
import { PULSE_INTERVAL_MS } from "../src/lib/exchange/pulse";

/**
 * 1025 · B1.1 / B1.2：一个脉搏 + 一张读数注册表。全部跑在打桩的 Prisma 方法上，不连数据库。
 */

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

const NOW = new Date("2026-10-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function installPulseStubs(t: TestContext, options: { ackedAt?: Date | null; trial?: boolean; used?: number } = {}) {
  const calls: Calls = {};
  stub(t, calls, "workspace", "findUnique", (args) => {
    const select = (args as { select?: Record<string, unknown> }).select ?? {};
    if ("owner" in select) return { planId: "starter", owner: { subscriptionTier: options.trial ? "trial" : "free" } };
    return { id: "ws-1", failuresAckedAt: options.ackedAt ?? null };
  });
  stub(t, calls, "batchJob", "groupBy", () => [
    { status: "RUNNING", _count: { _all: 1 } },
    { status: "EXPANDING", _count: { _all: 1 } },
    { status: "PAUSED", _count: { _all: 2 } },
  ]);
  stub(t, calls, "videoJob", "groupBy", () => [
    { status: "RUNNING", _count: { _all: 3 } },
    { status: "QUEUED", _count: { _all: 4 } },
  ]);
  stub(t, calls, "videoBrief", "count", (args) => {
    const where = JSON.stringify((args as { where: unknown }).where);
    if (where.includes('"RUNNING","batchJobId":null')) return 1; // 单条生成中
    if (where.includes('"QUEUED","batchJobId":null')) return 2; // 单条排队
    return 5; // 单条失败（需要处理）
  });
  stub(t, calls, "videoJob", "count", () => 7); // 批量失败（需要处理）
  stub(t, calls, "contentPost", "count", () => 11);
  stub(t, calls, "lead", "count", () => 6);
  stub(t, calls, "userUsagePeriod", "findMany", () => [{ resource: "VIDEO_DISPATCH", amount: options.used ?? 2 }]);
  stub(t, calls, "batchJob", "findMany", () => [{
    id: "batch-abcde",
    productName: null,
    status: "COMPLETED",
    requestedCount: 3,
    completedCount: 3,
    failedCount: 0,
    updatedAt: new Date("2026-10-24T08:00:00.000Z"),
    template: { nameZh: "开箱", name: "Unboxing" },
  }]);
  return calls;
}

test("脉搏：生成中只数供应商侧在跑的视频；进行中批次不含暂停；排队与暂停各自单列", async (t) => {
  const calls = installPulseStubs(t);
  const pulse = await loadPulse("user-1", { now: NOW });
  assert.equal(pulse.generating, 3 + 1, "批量 RUNNING 任务 + 单条真在生成的 brief");
  assert.equal(pulse.queued, 4 + 2);
  assert.equal(pulse.activeBatches, 2, "EXPANDING + RUNNING，PAUSED 不算");
  assert.equal(pulse.pausedBatches, 2);
  assert.equal(pulse.awaitingImages, 11);
  assert.equal(pulse.needsAttention, 7 + 5);
  assert.equal(pulse.newLeads, 6);
  assert.deepEqual(pulse.tape.map((entry) => entry.name), ["开箱"]);

  // 只用 count / groupBy，不扫成品库（成品库 findMany 一次都没有）
  assert.equal(calls["deliveryOrder.findMany"], undefined);
  assert.equal(calls["videoJob.findMany"], undefined);
  // 批量任务只按 RUNNING / QUEUED 分组：PAUSED 任务不会混进「生成中」
  const jobGroup = calls["videoJob.groupBy"]![0] as { where: { status: { in: string[] }; batchJob: unknown } };
  assert.deepEqual(jobGroup.where.status.in, ["RUNNING", "QUEUED"]);
  assert.deepEqual(jobGroup.where.batchJob, { userId: "user-1" });
  // 询盘徽标按工作区数未归档的新询盘
  assert.deepEqual((calls["lead.count"]![0] as { where: unknown }).where, { workspaceId: "ws-1", archivedAt: null, status: "NEW" });
  // 待出图：只数单图 / 轮播（短视频帖是「待生产」）
  const postWhere = (calls["contentPost.count"]![0] as { where: { format: { in: string[] }; renderedImageUrls: unknown } }).where;
  assert.deepEqual(postWhere.format.in, ["SINGLE_IMAGE", "CAROUSEL"]);
  assert.deepEqual(postWhere.renderedImageUrls, { isEmpty: true });
});

test("需要处理：近 7 天、在「看过了」之后——徽标从 ack 那一刻重新起算", async (t) => {
  const ackedAt = new Date(NOW.getTime() - 2 * DAY);
  const calls = installPulseStubs(t, { ackedAt });
  await loadPulse("user-1", { now: NOW });
  const batchFailure = (calls["videoJob.count"]![0] as { where: { status: string; updatedAt: { gte: Date } } }).where;
  assert.equal(batchFailure.status, "FAILED");
  assert.equal(batchFailure.updatedAt.gte.toISOString(), ackedAt.toISOString());

  assert.equal(needsAttentionSince(NOW, null).getTime(), NOW.getTime() - NEEDS_ATTENTION_WINDOW_DAYS * DAY);
  const longAgo = new Date(NOW.getTime() - 30 * DAY);
  assert.equal(needsAttentionSince(NOW, longAgo).getTime(), NOW.getTime() - 7 * DAY, "很久以前的 ack 不让窗口超过 7 天");
});

test("额度格读真实用量，试用账号的上限是 3 条（不是 PlanEntitlement 的 30）", async (t) => {
  installPulseStubs(t, { trial: true, used: 2 });
  assert.deepEqual(await loadVideoQuota("user-1"), { used: 2, limit: 3, plan: "trial" });
});

test("额度格：入门版按 quota-tiers 的 30 条；用满时上金色", async (t) => {
  installPulseStubs(t, { trial: false, used: 30 });
  const quota = await loadVideoQuota("user-1");
  assert.deepEqual(quota, { used: 30, limit: 30, plan: "starter" });
  assert.equal(quotaStat(quota.used, quota.limit, "zh-CN").tone, "winner");
  assert.equal(quotaStat(1, 30, "zh-CN").value, "1 / 30");
  assert.equal(quotaStat(1, 30, "zh-CN").tone, "neutral");
});

test("注册表：同名必同值——每种语言里名字唯一，零不上色、大于零才上色", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const names = (Object.keys(READINGS) as ReadingId[]).map((id) => READINGS[id].name[locale]);
    assert.equal(new Set(names).size, names.length, `${locale} 读数名重复`);
  }
  assert.equal(readingStat("generating", 0, "zh-CN").tone, "neutral");
  assert.equal(readingStat("generating", 2, "zh-CN").tone, "live");
  assert.equal(readingStat("needsAttention", 1, "zh-CN").tone, "fault");
  assert.equal(readingStat("awaitingImages", 1, "zh-CN").tone, "winner");
  assert.equal(readingStat("batchCompletion", "53%", "zh-CN", { params: { n: 12 } }).caption, "已成片 ÷ 下单条数（近 12 批）");
  // 视频侧读数名不出现「成交」
  for (const id of Object.keys(READINGS) as ReadingId[]) assert.doesNotMatch(READINGS[id].name["zh-CN"], /成交/);
});

test("各页读数都从注册表与 exchange-readings 取，不再各算各的", () => {
  const studio = readFileSync("src/components/video-generation/streamlined-video-studio.tsx", "utf8");
  assert.match(studio, /readingStat\("generating", readings\.generating, locale\)/);
  assert.match(studio, /quotaStat\(readings\.quotaUsed, readings\.quotaLimit, locale\)/);
  assert.doesNotMatch(studio, /import (?!type )[^;]*from "@\/lib\/services\//, "client studio 只拿纯数字（服务端模块只能 import type）");

  const create = readFileSync("src/app/(platform)/app/create/page.tsx", "utf8");
  assert.match(create, /loadVideoQuota\(userId\)/);
  assert.doesNotMatch(create, /monthlyVideoLimit/);

  const newBatch = readFileSync("src/app/(platform)/app/batches/new/page.tsx", "utf8");
  assert.match(newBatch, /quotaStat\(quota\.used, quota\.limit, locale\)/);
  assert.doesNotMatch(newBatch, /monthlyVideoLimit|filled30d \}/);

  const batches = readFileSync("src/app/(platform)/app/batches/page.tsx", "utf8");
  // 1025 · B2.1：没有批次也开场读数（零就写零），所以读数不再挂在 production 非空上
  assert.match(batches, /readingStat\("activeBatches", production\?\.activeBatches \?\? 0, locale\)/);
  assert.doesNotMatch(batches, /new Set\(\["EXPANDING", "RUNNING", "PAUSED"\]\)/, "进行中批次不含暂停");

  const wall = readFileSync("src/app/(wall)/wall/page.tsx", "utf8");
  for (const id of ["generating", "filled24h", "filled7d", "failed7d", "successRate7d"]) {
    assert.match(wall, new RegExp(`readingName\\("${id}", locale\\)`));
  }
  const templates = readFileSync("src/app/(platform)/app/templates/page.tsx", "utf8");
  assert.match(templates, /readingStat\("filled30d", readings\?\.filled30d \?\? 0, locale\)/);
  assert.doesNotMatch(templates, /completedCount: true/, "近 30 天成片不按批次创建时间另算");

  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /readingName\("monthlyQuota", locale\)/);
  assert.match(shell, /\{pulse\.quota\.used\} \/ \{pulse\.quota\.limit\}/);
});

test("读数不扫成品库：exchange-readings 不再 import loadUnifiedLibrary", () => {
  const source = readFileSync("src/lib/services/exchange-readings.ts", "utf8");
  assert.doesNotMatch(source, /loadUnifiedLibrary/);
  assert.doesNotMatch(source, /take:\s*100\b/);
});

test("壳层是 30 秒自刷新的客户端小岛；提交 / 取消 / 派发后主动刷新", () => {
  assert.equal(PULSE_INTERVAL_MS, 30_000);
  const hook = readFileSync("src/components/exchange/use-pulse.ts", "utf8");
  assert.match(hook, /window\.setInterval\(\(\) => void refresh\(true\), PULSE_INTERVAL_MS\)/);
  assert.match(hook, /document\.visibilityState !== "visible"/);
  assert.match(hook, /window\.addEventListener\(PULSE_REFRESH_EVENT/);
  const shell = readFileSync("src/components/platform/platform-shell.tsx", "utf8");
  assert.match(shell, /const pulse = usePulse\(initialPulse, pathname\)/);
  assert.match(shell, /library: \{ count: pulse\.needsAttention, tone: "fault"/);
  assert.match(shell, /leads: \{ count: pulse\.newLeads, tone: "winner"/);
  assert.match(shell, /batches: \{ count: pulse\.activeBatches, tone: "live"/);
  for (const file of [
    "src/components/batch/batch-create-wizard.tsx",
    "src/components/batch/batch-monitor.tsx",
    "src/components/video-generation/streamlined-video-studio.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /import \{ requestPulseRefresh \} from "@\/lib\/exchange\/pulse";/, file);
    assert.match(source, /requestPulseRefresh\(\);/, file);
  }
  const wizard = readFileSync("src/components/batch/batch-create-wizard.tsx", "utf8");
  assert.match(wizard, /setQueuedGroups\(\[\]\);\s*requestPulseRefresh\(\);\s*if \(createdBatchIds\.length === 1\)/);
});

test("脉搏与「看过了」接口：会话鉴权、只读写本人", () => {
  const pulse = readFileSync("src/app/api/exchange/pulse/route.ts", "utf8");
  assert.match(pulse, /export async function GET\(\)/);
  assert.match(pulse, /const guard = await requireAuth\(\);\s*if \(!guard\.ok\) return guard\.response;/);
  assert.match(pulse, /loadPulse\(guard\.session\.user\.id, \{ locale: await getServerLocale\(\) \}\)/);
  assert.match(pulse, /status: 500/);
  const ack = readFileSync("src/app/api/exchange/failures-ack/route.ts", "utf8");
  assert.match(ack, /export async function POST\(\)/);
  assert.match(ack, /const guard = await requireAuth\(\);\s*if \(!guard\.ok\) return guard\.response;/);
  assert.match(ack, /acknowledgeFailures\(guard\.session\.user\.id\)/);
  const readings = readFileSync("src/lib/services/exchange-readings.ts", "utf8");
  assert.match(readings, /db\.workspace\.update\(\{ where: \{ ownerId: userId \}, data: \{ failuresAckedAt: now \} \}\)/);
});
