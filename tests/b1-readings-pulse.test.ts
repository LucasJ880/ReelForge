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
  /// 批量生产 2026-11-17 下线：脉搏不再查批次与批量任务，这几个桩只是为了证明没人调
  stub(t, calls, "batchJob", "groupBy", () => []);
  stub(t, calls, "videoJob", "groupBy", () => []);
  stub(t, calls, "videoBrief", "count", (args) => {
    const where = JSON.stringify((args as { where: unknown }).where);
    if (where.includes('"RUNNING","batchJobId":null')) return 1; // 单条生成中
    if (where.includes('"QUEUED","batchJobId":null')) return 2; // 单条排队
    return 5; // 单条失败（需要处理）
  });
  stub(t, calls, "videoJob", "count", () => 7); // 批量失败（需要处理）
  stub(t, calls, "videoBrief", "findFirst", () => ({
    finalVideo: { finishedAt: new Date("2026-10-24T08:30:00.000Z") },
    contentAngle: { round: { deliveryOrder: { id: "order-ready-1", title: "保温杯通勤广告" } } },
  }));
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

test("脉搏：生成中只数供应商侧在跑的视频；排队单列；不再查批次", async (t) => {
  const calls = installPulseStubs(t);
  const pulse = await loadPulse("user-1", { now: NOW });
  assert.equal(pulse.generating, 1, "单条真在生成的 brief");
  assert.equal(pulse.queued, 2);
  assert.equal("activeBatches" in pulse || "pausedBatches" in pulse || "tape" in pulse, false, "批次读数与生产带随批量生产下线");
  assert.equal("awaitingImages" in pulse, false, "「待出图」读数 2026-11-16 随图文出图删除");
  assert.equal(calls["contentPost.count"], undefined, "脉搏不再数图文帖");
  assert.equal(pulse.needsAttention, 5, "只数单条失败");
  assert.equal(pulse.newLeads, 6);

  // 只用 count / groupBy，不扫成品库（成品库 findMany 一次都没有）
  assert.equal(calls["deliveryOrder.findMany"], undefined);
  assert.equal(calls["videoJob.findMany"], undefined);
  for (const call of ["batchJob.groupBy", "videoJob.groupBy", "batchJob.findMany", "videoJob.count"]) {
    assert.equal(calls[call], undefined, `${call} 不该再被调用`);
  }
  // 询盘徽标按工作区数未归档的新询盘
  assert.deepEqual((calls["lead.count"]![0] as { where: unknown }).where, { workspaceId: "ws-1", archivedAt: null, status: "NEW" });
});

test("需要处理：近 7 天、在「看过了」之后——徽标从 ack 那一刻重新起算", async (t) => {
  const ackedAt = new Date(NOW.getTime() - 2 * DAY);
  const calls = installPulseStubs(t, { ackedAt });
  await loadPulse("user-1", { now: NOW });
  /// 单条失败按「失败那一刻」起算：ack 之后的才算（where 里带着 ack 时间，不是固定的 7 天前）
  const failureWheres = (calls["videoBrief.count"] ?? []).map((args) => JSON.stringify((args as { where: unknown }).where));
  assert.ok(failureWheres.some((where) => where.includes(JSON.stringify(ackedAt).slice(1, -1))), "失败计数从 ack 那一刻起算");
  assert.equal(calls["videoJob.count"], undefined, "不再数批量失败");

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
  assert.equal("awaitingImages" in READINGS, false);
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
  /// 询盘入口 2026-10-28 下线：新询盘徽标随导航撤掉（脉搏里的 newLeads 仍在，放回导航时接回）
  assert.doesNotMatch(shell, /leads: \{ count: pulse\.newLeads/);
  assert.doesNotMatch(shell, /activeBatches|batches:/);
  for (const file of [
    "src/components/video-generation/streamlined-video-studio.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /import \{ requestPulseRefresh \} from "@\/lib\/exchange\/pulse";/, file);
    assert.match(source, /requestPulseRefresh\(\);/, file);
  }
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
