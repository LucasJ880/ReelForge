import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { db } from "../src/lib/db";
import { DEFAULT_CONTACT_EMAIL } from "../src/lib/config/contact";
import {
  notifyNewLead,
  notifyPilotApplication,
  runAfterResponse,
  safeSubject,
} from "../src/lib/services/notification-service";

/**
 * D8 通知回归：没配 key 只记日志；配了才直接调 Resend REST；成功才写 notifiedAt
 * （条件更新防重复）；任何失败都不抛——表单提交永远不被邮件拖住。
 */

function patch(t: TestContext, model: unknown, patches: Record<string, unknown>) {
  const target = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = target[key];
    target[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) target[key] = originals[key];
  });
}

const CONFIGURED = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Aivora <leads@aivora.test>",
  AIVORA_FOUNDER_EMAIL: "founder@aivora.test",
  APP_BASE_URL: "https://aivora.test/",
} as unknown as NodeJS.ProcessEnv;

const NOW = new Date("2026-10-25T15:00:00.000Z");

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    name: "王女士\r\nBcc: attacker@example.com",
    phone: "+1 416 555 0100",
    email: null,
    serviceInterest: "电动卷帘",
    preferredTime: "weekday_evening",
    selfReportedSource: "instagram",
    message: "3 扇窗",
    source: "tracked_link",
    notifiedAt: null,
    trackedLink: { label: "IG 主页链接", channel: "ig_bio" },
    workspace: { name: "Sunny Shutter", owner: { email: "owner@sunnyshutter.test" } },
    ...overrides,
  };
}

function recordingFetch(response: { ok: boolean; status: number } | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return new Response(null, { status: response.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("没配 RESEND_API_KEY / EMAIL_FROM：不发信、不查库、不抛", async (t) => {
  patch(t, db.lead, {
    findUnique: async () => {
      throw new Error("must not query when email is not configured");
    },
  });
  const { calls, fetchImpl } = recordingFetch({ ok: true, status: 200 });
  assert.deepEqual(await notifyNewLead("lead-1", { env: {} as NodeJS.ProcessEnv, fetchImpl }), { sent: false, reason: "not_configured" });
  assert.deepEqual(
    await notifyPilotApplication("pilot-1", { env: { RESEND_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, fetchImpl }),
    { sent: false, reason: "not_configured" },
  );
  assert.equal(calls.length, 0);
});

test("新询盘：发给商家、创始人密送；纯文本正文；主题去换行；成功后条件写 notifiedAt", async (t) => {
  const stamps: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patch(t, db.lead, {
    findUnique: async () => leadRow(),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      stamps.push(args);
      return { count: 1 };
    },
  });
  const { calls, fetchImpl } = recordingFetch({ ok: true, status: 200 });
  assert.deepEqual(await notifyNewLead("lead-1", { env: CONFIGURED, fetchImpl, now: NOW }), { sent: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_test_key");
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(body.to, ["owner@sunnyshutter.test"]);
  assert.deepEqual(body.bcc, ["founder@aivora.test"]);
  assert.equal(body.from, "Aivora <leads@aivora.test>");
  assert.doesNotMatch(String(body.subject), /[\r\n]/);
  assert.equal("html" in body, false, "plain text only");
  assert.match(String(body.text), /\+1 416 555 0100/);
  assert.match(String(body.text), /IG 主页链接/);
  assert.match(String(body.text), /https:\/\/aivora\.test\/app\/leads/);
  assert.deepEqual(stamps, [{ where: { id: "lead-1", notifiedAt: null }, data: { notifiedAt: NOW } }]);
});

test("已通知过的询盘不重复发", async (t) => {
  patch(t, db.lead, { findUnique: async () => leadRow({ notifiedAt: new Date() }) });
  const { calls, fetchImpl } = recordingFetch({ ok: true, status: 200 });
  assert.deepEqual(await notifyNewLead("lead-1", { env: CONFIGURED, fetchImpl }), { sent: false, reason: "already_notified" });
  assert.equal(calls.length, 0);
});

test("Resend 拒收或网络异常：不写 notifiedAt、不抛（留给角标与每日汇总兜底）", async (t) => {
  let stamped = 0;
  patch(t, db.lead, {
    findUnique: async () => leadRow(),
    updateMany: async () => {
      stamped += 1;
      return { count: 1 };
    },
  });
  const rejected = recordingFetch({ ok: false, status: 422 });
  assert.deepEqual(await notifyNewLead("lead-1", { env: CONFIGURED, fetchImpl: rejected.fetchImpl }), { sent: false, reason: "send_failed" });
  const offline = recordingFetch(new Error("ECONNRESET"));
  assert.deepEqual(await notifyNewLead("lead-1", { env: CONFIGURED, fetchImpl: offline.fetchImpl }), { sent: false, reason: "send_failed" });
  assert.equal(stamped, 0);
});

test("试点申请：只发给创始人；没配 AIVORA_FOUNDER_EMAIL 时回落到对外联系人（默认 CEO 邮箱）", async (t) => {
  const stamps: Array<Record<string, unknown>> = [];
  patch(t, db.pilotApplication, {
    findUnique: async () => ({
      id: "pilot-1",
      name: "Lee",
      company: "Sunny Shutter",
      email: null,
      phone: null,
      whatsapp: "+1 905 555 0100",
      wechat: null,
      website: null,
      industry: "blinds",
      city: "Vaughan",
      monthlyLeadSpend: "under_300",
      message: null,
      locale: "en-US",
      source: "website",
      notifiedAt: null,
    }),
    updateMany: async (args: { where: Record<string, unknown> }) => {
      stamps.push(args.where);
      return { count: 1 };
    },
  });
  const { calls, fetchImpl } = recordingFetch({ ok: true, status: 200 });
  /// 1025：创始人指定 lucas@sunnyshutter.ca 为对外联系人；没单独配提醒收件人时发到这里，不再静默丢弃
  const noFounder = { ...CONFIGURED, AIVORA_FOUNDER_EMAIL: "" } as NodeJS.ProcessEnv;
  assert.deepEqual(await notifyPilotApplication("pilot-1", { env: noFounder, fetchImpl, now: NOW }), { sent: true });
  assert.deepEqual((JSON.parse(String(calls[0].init.body)) as Record<string, unknown>).to, [DEFAULT_CONTACT_EMAIL]);

  assert.deepEqual(await notifyPilotApplication("pilot-1", { env: CONFIGURED, fetchImpl, now: NOW }), { sent: true });
  const body = JSON.parse(String(calls[1].init.body)) as Record<string, unknown>;
  assert.deepEqual(body.to, ["founder@aivora.test"]);
  assert.match(String(body.subject), /Sunny Shutter/);
  assert.match(String(body.text), /Under CA\$300/);
  assert.deepEqual(stamps, [{ id: "pilot-1", notifiedAt: null }, { id: "pilot-1", notifiedAt: null }]);
});

/** 1025 安全复核 LENS-4：被平台停用的账号不再收到访客的姓名、电话与留言。 */
test("🔴 owner 账号已停用：新询盘邮件不发给 owner，只回落给创始人（没单独配时是对外联系人）", async (t) => {
  const selects: Array<Record<string, unknown>> = [];
  patch(t, db.lead, {
    findUnique: async (args: { select: Record<string, unknown> }) => {
      selects.push(args.select);
      return leadRow({
        workspace: {
          name: "Sunny Shutter",
          owner: { email: "owner@sunnyshutter.test", disabledAt: new Date("2026-10-25T00:00:00.000Z") },
        },
      });
    },
    updateMany: async () => ({ count: 1 }),
  });
  const { calls, fetchImpl } = recordingFetch({ ok: true, status: 200 });
  assert.deepEqual(await notifyNewLead("lead-1", { env: CONFIGURED, fetchImpl, now: NOW }), { sent: true });
  const workspaceSelect = selects[0].workspace as { select: { owner: { select: Record<string, boolean> } } };
  assert.equal(workspaceSelect.select.owner.select.disabledAt, true);
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(body.to, ["founder@aivora.test"]);
  assert.equal("bcc" in body, false);
  assert.doesNotMatch(String(calls[0].init.body), /owner@sunnyshutter\.test/);

  const noFounder = { ...CONFIGURED, AIVORA_FOUNDER_EMAIL: "" } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(await notifyNewLead("lead-1", { env: noFounder, fetchImpl, now: NOW }), { sent: true });
  const fallback = JSON.parse(String(calls[1].init.body)) as Record<string, unknown>;
  assert.deepEqual(fallback.to, [DEFAULT_CONTACT_EMAIL]);
  assert.doesNotMatch(String(calls[1].init.body), /owner@sunnyshutter\.test/, "the disabled owner never receives it");
});

test("主题行清掉换行与制表符（防邮件头注入）", () => {
  assert.equal(safeSubject("新询盘\r\nBcc: x@y.z\t· 卷帘"), "新询盘 Bcc: x@y.z · 卷帘");
  assert.equal(safeSubject("x".repeat(300)).length, 140);
});

test("runAfterResponse：不在请求作用域（脚本 / 测试）时直接异步跑，任务异常被吞掉", async () => {
  let ran = false;
  runAfterResponse(async () => {
    ran = true;
    throw new Error("swallowed");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, true);
});
