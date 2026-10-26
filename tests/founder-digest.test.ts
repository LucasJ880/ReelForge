import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  buildFounderDigest,
  FOUNDER_DIGEST_BUCKET,
  loadFounderDigestData,
  runFounderDigest,
  type FounderDigestData,
  type FounderDigestDeps,
} from "../src/lib/services/founder-digest-service";

/**
 * 2026-10-25 审计 B8：没配 Resend 时试点申请不给创始人任何信号。每日汇总 cron：
 * 过去 24 小时的试点申请、询盘页新询盘、失败视频、各账号「需要处理」；
 * 走 notification-service 的发信路径发给 founderNotifyEmail()；没配发信就只记日志、200 + { sent:false, reason }；
 * 按 UTC 日幂等（复用 RateLimitBucket 当「当天已发」闩锁）；全部只读查询。
 */

const NOW = new Date("2026-10-25T13:00:00.000Z");
const CONFIGURED = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Aivora <digest@aivora.test>",
  AIVORA_FOUNDER_EMAIL: "founder@aivora.test",
  APP_BASE_URL: "https://aivora.test/",
} as unknown as NodeJS.ProcessEnv;

function sampleData(overrides: Partial<FounderDigestData> = {}): FounderDigestData {
  return {
    windowStart: new Date("2026-10-24T13:00:00.000Z"),
    windowEnd: NOW,
    pilotApplications: {
      total: 2,
      items: [
        {
          createdAt: new Date("2026-10-25T09:12:00.000Z"),
          who: "Sunny Shutter",
          company: "Sunny Shutter",
          industry: "窗饰",
          city: "Toronto",
          contacts: ["owner@sunny.test", "WhatsApp +1 416 555 0100"],
          contactKinds: ["邮箱", "WhatsApp"],
          source: "canton-fair",
        },
        {
          createdAt: new Date("2026-10-25T08:00:00.000Z"),
          who: "王女士",
          company: null,
          industry: null,
          city: null,
          contacts: [],
          contactKinds: [],
          source: null,
        },
      ],
    },
    leads: {
      total: 1,
      items: [
        {
          createdAt: new Date("2026-10-25T07:40:00.000Z"),
          workspace: "Sunny Shutter",
          name: "李先生",
          source: "tracked_link",
          serviceInterest: "电动卷帘",
        },
      ],
    },
    failedVideos: {
      single: 1,
      batch: 2,
      items: [
        { at: new Date("2026-10-25T06:00:00.000Z"), kind: "batch", owner: "owner@sunny.test", title: "百叶窗 #3 · 整扇开合", reason: "生成服务暂时不可用。" },
      ],
    },
    needsAttention: [{ owner: "owner@sunny.test", workspace: "Sunny Shutter", count: 3 }],
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<FounderDigestDeps> = {}) {
  const calls = { load: 0, claims: [] as string[], releases: [] as string[], sends: [] as Array<{ to: string[]; subject: string; text: string }>, logs: [] as string[] };
  const deps: Partial<FounderDigestDeps> = {
    load: async () => {
      calls.load += 1;
      return sampleData();
    },
    claimDay: async (day) => {
      calls.claims.push(day);
      return true;
    },
    releaseDay: async (day) => {
      calls.releases.push(day);
    },
    send: async (message) => {
      calls.sends.push(message);
      return true;
    },
    log: (message) => calls.logs.push(message),
    ...overrides,
  };
  return { calls, deps };
}

test("汇总正文：四节齐全、中英标题、纯文本；空节写「无」", () => {
  const digest = buildFounderDigest(sampleData(), { day: "2026-10-25", baseUrl: "https://aivora.test/" });
  assert.equal(digest.subject, "Aivora 每日汇总 2026-10-25 · 试点 2 · 询盘 1 · 失败 3 · 需处理 3");
  assert.match(digest.text, /^Aivora 每日汇总 \/ Daily digest · 2026-10-25（UTC）/);
  assert.match(digest.text, /窗口 \/ Window: 2026-10-24 13:00 → 2026-10-25 13:00 UTC/);
  assert.match(digest.text, /试点申请 \/ Pilot applications: 2\n  - 10-25 09:12 · Sunny Shutter（窗饰 · Toronto） · owner@sunny\.test \/ WhatsApp \+1 416 555 0100 · 来源 canton-fair/);
  assert.match(digest.text, /  - 10-25 08:00 · 王女士 · 未留联系方式/);
  assert.match(digest.text, /询盘页新询盘 \/ New lead-page inquiries: 1\n  - 10-25 07:40 · Sunny Shutter · 李先生 · 追踪链接 · 电动卷帘/);
  assert.match(digest.text, /失败的视频 \/ Failed videos（单条 1 · 批量 2）: 3\n  - 10-25 06:00 · 批量 · owner@sunny\.test · 百叶窗 #3 · 整扇开合 · 生成服务暂时不可用。\n  … 另有 2 条/);
  assert.match(digest.text, /需要处理（账号[^\n]*: 1\n  - owner@sunny\.test · Sunny Shutter · 3 条/);
  assert.match(digest.text, /取消的视频不算失败/);
  assert.match(digest.text, /https:\/\/aivora\.test\/app\/leads$/);
  assert.doesNotMatch(digest.text, /<[a-z]/i, "纯文本，不带 HTML");

  const empty = buildFounderDigest(
    sampleData({ pilotApplications: { total: 0, items: [] }, leads: { total: 0, items: [] }, failedVideos: { single: 0, batch: 0, items: [] }, needsAttention: [] }),
    { day: "2026-10-25" },
  );
  assert.equal((empty.text.match(/无 \/ none/g) ?? []).length, 4);
  assert.match(empty.subject, /试点 0 · 询盘 0 · 失败 0 · 需处理 0$/);
});

test("没配 RESEND_API_KEY / EMAIL_FROM：汇总打进日志，返回 not_configured，不占当天闩锁、不发信", async () => {
  const { calls, deps } = fakeDeps();
  const outcome = await runFounderDigest({ now: NOW, env: { AIVORA_FOUNDER_EMAIL: "founder@aivora.test" } as unknown as NodeJS.ProcessEnv, deps });
  assert.deepEqual(outcome, {
    sent: false,
    reason: "not_configured",
    day: "2026-10-25",
    counts: { pilotApplications: 2, leads: 1, failedVideos: 3, needsAttentionAccounts: 1, needsAttentionItems: 3 },
  });
  assert.equal(calls.claims.length, 0);
  assert.equal(calls.sends.length, 0);
  assert.equal(calls.logs.length, 1);
  assert.match(calls.logs[0], /未配置 RESEND_API_KEY \/ EMAIL_FROM/);
  assert.match(calls.logs[0], /试点申请 \/ Pilot applications: 2/);
  /// 日志不写联系方式与姓名（与展台中继「日志只打计数」同一个纪律）；账号邮箱打码
  assert.match(calls.logs[0], /Sunny Shutter（窗饰 · Toronto） · 留了邮箱 \/ WhatsApp/);
  assert.match(calls.logs[0], /10-25 08:00 · 个人申请 · 未留联系方式/);
  assert.match(calls.logs[0], /o\*\*\*@sunny\.test · Sunny Shutter · 3 条/);
  for (const secret of ["owner@sunny.test", "+1 416 555 0100", "王女士", "李先生"]) {
    assert.ok(!calls.logs[0].includes(secret), `日志里不能出现 ${secret}`);
  }
});

test("配了发信：占到当天闩锁 → 发给 founderNotifyEmail()，返回 sent", async () => {
  const { calls, deps } = fakeDeps();
  const outcome = await runFounderDigest({ now: NOW, env: CONFIGURED, deps });
  assert.equal(outcome.sent, true);
  assert.deepEqual(calls.claims, ["2026-10-25"]);
  assert.equal(calls.sends.length, 1);
  assert.deepEqual(calls.sends[0].to, ["founder@aivora.test"]);
  assert.match(calls.sends[0].subject, /^Aivora 每日汇总 2026-10-25/);
  assert.equal(calls.releases.length, 0);
});

test("cron 重试 / 重复触发：当天闩锁已被占 → already_sent，不取数、不发信", async () => {
  const { calls, deps } = fakeDeps({ claimDay: async () => false });
  assert.deepEqual(await runFounderDigest({ now: NOW, env: CONFIGURED, deps }), {
    sent: false,
    reason: "already_sent",
    day: "2026-10-25",
  });
  assert.equal(calls.load, 0);
  assert.equal(calls.sends.length, 0);
});

test("发送失败（拒收或网络错误）：把闩锁放回，下一次触发可以补发", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  for (const send of [async () => false, async () => { throw new Error("timeout"); }]) {
    const { calls, deps } = fakeDeps({ send: send as FounderDigestDeps["send"] });
    const outcome = await runFounderDigest({ now: NOW, env: CONFIGURED, deps });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.sent === false && outcome.reason, "send_failed");
    assert.deepEqual(calls.releases, ["2026-10-25"]);
  }
});

test("取数失败：闩锁放回，错误照常抛给路由（500）", async () => {
  const { calls, deps } = fakeDeps({ load: async () => { throw new Error("db down"); } });
  await assert.rejects(runFounderDigest({ now: NOW, env: CONFIGURED, deps }), /db down/);
  assert.deepEqual(calls.releases, ["2026-10-25"]);
  assert.equal(calls.sends.length, 0);
});

test("幂等按 UTC 日：多伦多晚上 11 点半（UTC 次日 03:30）算次日", async () => {
  const { calls, deps } = fakeDeps();
  await runFounderDigest({ now: new Date("2026-10-26T03:30:00.000Z"), env: CONFIGURED, deps });
  assert.deepEqual(calls.claims, ["2026-10-26"]);
  assert.equal(FOUNDER_DIGEST_BUCKET, "founder-digest:sent");
});

/* ── 取数：只读，窗口与口径对 ─────────────────────────────────────────── */

function patch(t: TestContext, target: Record<string, unknown>, key: string, fn: unknown) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}

test("取数只用只读查询：过去 24 小时、询盘只算询盘页（含追踪链接）、需要处理按账号口径", async (t) => {
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  const seen: Record<string, unknown[]> = {};
  const record = (name: string, result: unknown) => async (args: unknown) => {
    (seen[name] ??= []).push(args);
    return result;
  };
  patch(t, anyDb.pilotApplication, "findMany", record("pilot.findMany", [
    { createdAt: new Date("2026-10-25T09:00:00.000Z"), name: null, company: "Sunny Shutter", email: "a@sunny.test", phone: null, whatsapp: null, wechat: "sunny_wx", industry: null, city: "Vancouver", source: "landing" },
  ]));
  patch(t, anyDb.pilotApplication, "count", record("pilot.count", 1));
  patch(t, anyDb.lead, "findMany", record("lead.findMany", [
    { createdAt: new Date("2026-10-25T10:00:00.000Z"), name: "李先生", source: "lead_page", serviceInterest: null, workspace: { name: "Sunny Shutter" } },
  ]));
  patch(t, anyDb.lead, "count", record("lead.count", 1));
  patch(t, anyDb.videoJob, "findMany", record("videoJob.findMany", []));
  patch(t, anyDb.videoJob, "count", record("videoJob.count", 2));
  patch(t, anyDb.videoBrief, "findMany", record("videoBrief.findMany", []));
  patch(t, anyDb.videoBrief, "count", record("videoBrief.count", 1));
  patch(t, anyDb.batchJob, "findMany", record("batchJob.findMany", [{ userId: "user-1" }]));
  patch(t, anyDb.deliveryOrder, "findMany", record("deliveryOrder.findMany", [{ createdById: "user-1" }, { createdById: "user-2" }]));
  patch(t, anyDb.adminUser, "findMany", record("adminUser.findMany", [
    { id: "user-1", email: "owner@sunny.test", workspace: { name: "Sunny Shutter", failuresAckedAt: null } },
  ]));

  const data = await loadFounderDigestData(NOW);

  const window = { gte: new Date("2026-10-24T13:00:00.000Z"), lt: NOW };
  assert.deepEqual((seen["pilot.findMany"][0] as { where: unknown }).where, { createdAt: window, archivedAt: null });
  assert.deepEqual((seen["lead.findMany"][0] as { where: unknown }).where, {
    createdAt: window,
    archivedAt: null,
    source: { in: ["lead_page", "tracked_link"] },
  });
  /// 失败口径与 exchange-readings 同源：单条排除客户取消
  assert.ok(JSON.stringify((seen["videoBrief.count"][0] as { where: unknown }).where).includes("customer_cancelled"));
  assert.deepEqual((seen["adminUser.findMany"][0] as { where: unknown }).where, { id: { in: ["user-1", "user-2"] } });

  assert.equal(data.pilotApplications.total, 1);
  assert.deepEqual(data.pilotApplications.items[0].contacts, ["a@sunny.test", "微信 sunny_wx"]);
  assert.equal(data.leads.items[0].workspace, "Sunny Shutter");
  assert.equal(data.failedVideos.batch, 2);
  assert.equal(data.failedVideos.single, 1);
  /// 需要处理：videoJob.count(2) + videoBrief.count(1) = 3（与导轨徽标同一个计数函数）
  assert.deepEqual(data.needsAttention, [{ owner: "owner@sunny.test", workspace: "Sunny Shutter", count: 3 }]);
  /// 只调用了 findMany / count：任何写方法都没被打桩，一调就会在没有 DATABASE_URL 的测试环境里炸掉
  assert.deepEqual(
    Object.keys(seen).every((name) => /\.(findMany|count)$/.test(name)),
    true,
  );
});

test("接线：路由先过 CRON_SECRET 鉴权再跑汇总；vercel.json 每天一次", async () => {
  const route = await readFile("src/app/api/cron/founder-digest/route.ts", "utf8");
  assert.match(route, /export async function GET/);
  assert.ok(route.indexOf("machineAuthFailure(req)") < route.indexOf("runFounderDigest()"));
  const vercel = JSON.parse(await readFile("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  const entries = vercel.crons.filter((cron) => cron.path === "/api/cron/founder-digest");
  assert.deepEqual(entries, [{ path: "/api/cron/founder-digest", schedule: "0 13 * * *" }]);
});
