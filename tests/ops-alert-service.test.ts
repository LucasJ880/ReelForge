/**
 * 运维告警通道（src/lib/services/ops-alert-service.ts）。
 * 口径算错的后果是两头：该响的不响（10 月质检失明没人知道），或同一件事每分钟响一次没人再看。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  OPS_ALERT_BUCKET_PREFIX,
  capabilityTransitionAlert,
  isOpsAlertEnabled,
  opsAlertRequestBody,
  opsAlertText,
  opsAlertWebhookUrl,
  opsAlertWindowKey,
  scrubAlertLine,
  sendOpsAlert,
  shuyuLowBalanceAlert,
  shuyuMinVideosThreshold,
  type OpsAlert,
  type OpsAlertDeps,
} from "../src/lib/services/ops-alert-service";
import { keptAliveOverdueMinutes, KEPT_ALIVE_ALERT_MIN } from "../src/lib/services/sweep-service";

const NOW = new Date("2026-11-09T21:45:35.000Z");
const ALERT: OpsAlert = {
  kind: "frame_qa_unverified",
  dedupeKey: "frame-qa-unverified",
  title: "帧质检没检成，成片未质检直接交付",
  lines: ["任务 job_1", "原因：门禁执行异常：429 You have no credits remaining."],
};

function harness(overrides: Partial<OpsAlertDeps> = {}) {
  const claims: Array<[string, string]> = [];
  const posts: Array<{ url: string; body: unknown }> = [];
  const logs: string[] = [];
  const seen = new Set<string>();
  const deps: OpsAlertDeps = {
    enabled: () => true,
    webhookUrl: () => "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    claim: async (bucketKey, windowKey) => {
      claims.push([bucketKey, windowKey]);
      const key = `${bucketKey}|${windowKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    post: async (url, body) => {
      posts.push({ url, body });
      return { ok: true, status: 200 };
    },
    now: () => NOW,
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { deps, claims, posts, logs };
}

test("webhook 地址：只认 https；没配、写错、http 一律当没配", () => {
  assert.equal(opsAlertWebhookUrl({}), null);
  assert.equal(opsAlertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: "  " }), null);
  assert.equal(opsAlertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: "not a url" }), null);
  assert.equal(opsAlertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: "http://hooks.example.com/x" }), null);
  assert.equal(
    opsAlertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: " https://open.feishu.cn/open-apis/bot/v2/hook/abc " }),
    "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
  );
});

test("外发开关：单测子进程与本地 dev 不发；线上 Next 服务端发；FORCE 可显式开关", () => {
  assert.equal(isOpsAlertEnabled({ NODE_TEST_CONTEXT: "child", NEXT_RUNTIME: "nodejs", NODE_ENV: "production" }), false);
  assert.equal(isOpsAlertEnabled({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" }), false);
  assert.equal(isOpsAlertEnabled({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production" }), true);
  assert.equal(isOpsAlertEnabled({ OPS_ALERT_FORCE: "1" }), true);
  assert.equal(isOpsAlertEnabled({ OPS_ALERT_FORCE: "0", NEXT_RUNTIME: "nodejs", NODE_ENV: "production" }), false);
  assert.equal(isOpsAlertEnabled({ OPS_ALERT_FORCE: "1", NODE_TEST_CONTEXT: "child" }), false, "单测里永远不外发");
});

test("报文：按机器人域名选形状，认不出的发通用 JSON", () => {
  const text = opsAlertText(ALERT);
  assert.ok(text.startsWith("【Aivora 运维】帧质检没检成"));
  assert.deepEqual(opsAlertRequestBody("https://open.feishu.cn/open-apis/bot/v2/hook/x", ALERT), {
    msg_type: "text",
    content: { text },
  });
  assert.deepEqual(opsAlertRequestBody("https://qyapi.weixin.qq.com/cgi-bin/webhook/send", ALERT), {
    msgtype: "text",
    text: { content: text },
  });
  assert.deepEqual(opsAlertRequestBody("https://oapi.dingtalk.com/robot/send", ALERT), {
    msgtype: "text",
    text: { content: text },
  });
  assert.deepEqual(opsAlertRequestBody("https://hooks.slack.com/services/T/B/x", ALERT), { text });
  const generic = opsAlertRequestBody("https://alerts.example.com/in", ALERT);
  assert.equal(generic.kind, "frame_qa_unverified");
  assert.equal(generic.text, text);
});

test("报文纪律：形似密钥的片段与 URL 查询串被抹掉，单行截断", () => {
  const scrubbed = scrubAlertLine(
    "401 Incorrect API key provided: sk-proj-abcdefghijklmnop1234 see https://x.r2.dev/a.mp4?X-Amz-Signature=deadbeef&token=1 Bearer abcdefghijklmnopqrstuvwxyz",
  );
  assert.ok(!scrubbed.includes("abcdefghijklmnop1234"));
  assert.ok(!scrubbed.includes("deadbeef"));
  assert.ok(!scrubbed.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.ok(scrubbed.includes("https://x.r2.dev/a.mp4?…"));
  assert.equal(scrubAlertLine("x".repeat(1000)).length, 300);
  assert.ok(opsAlertText({ ...ALERT, lines: Array.from({ length: 30 }, (_, i) => `行 ${i}`) }).split("\n").length <= 9);
});

test("去重：同一个 dedupeKey 一个窗口只发第一条；窗口键按小时 / 按天", async () => {
  const { deps, posts, claims } = harness();
  assert.deepEqual(await sendOpsAlert(ALERT, deps), { outcome: "sent" });
  assert.deepEqual(await sendOpsAlert(ALERT, deps), { outcome: "duplicate" });
  assert.equal(posts.length, 1);
  assert.deepEqual(claims[0], [`${OPS_ALERT_BUCKET_PREFIX}frame-qa-unverified`, "2026-11-09T21"]);
  assert.equal(opsAlertWindowKey("day", NOW), "2026-11-09");

  await sendOpsAlert({ ...ALERT, dedupeKey: "job-kept-alive:job_1", window: "day" }, deps);
  assert.deepEqual(claims.at(-1), [`${OPS_ALERT_BUCKET_PREFIX}job-kept-alive:job_1`, "2026-11-09"]);
});

test("没配 webhook：照样去重，告警写进错误日志（Vercel 日志里搜得到）", async () => {
  const { deps, posts, logs } = harness({ webhookUrl: () => null });
  assert.deepEqual(await sendOpsAlert(ALERT, deps), { outcome: "logged" });
  assert.deepEqual(await sendOpsAlert(ALERT, deps), { outcome: "duplicate" });
  assert.equal(posts.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /^\[ops-alert\] \(未配置 OPS_ALERT_WEBHOOK_URL\) frame_qa_unverified /);
});

test("非线上环境：不占闩锁、不外发，只打日志", async () => {
  const { deps, posts, claims, logs } = harness({ enabled: () => false });
  assert.deepEqual(await sendOpsAlert(ALERT, deps), { outcome: "disabled" });
  assert.equal(claims.length, 0);
  assert.equal(posts.length, 0);
  assert.equal(logs.length, 1);
});

test("永不抛出：闩锁读写失败照发（宁可重复不可漏报）；外发失败 / 抛错只返回 failed", async () => {
  const claimBroken = harness({
    claim: async () => {
      throw new Error("db down");
    },
  });
  assert.deepEqual(await sendOpsAlert(ALERT, claimBroken.deps), { outcome: "sent" });
  assert.equal(claimBroken.posts.length, 1);

  const http500 = harness({ post: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(await sendOpsAlert(ALERT, http500.deps), { outcome: "failed", detail: "http_500" });
  assert.equal(http500.logs.length, 1);

  const timeout = harness({
    post: async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.deepEqual(await sendOpsAlert(ALERT, timeout.deps), { outcome: "failed", detail: "TimeoutError" });
});

test("能力状态翻转：正常→暂停 报；暂停→正常 报恢复；同状态刷新、未配置都不报", () => {
  const down = capabilityTransitionAlert(
    { status: "available" },
    { key: "vision", status: "unavailable", reason: "quota", detail: { provider: "openai", httpStatus: 429 } },
  );
  assert.equal(down?.kind, "capability_down");
  assert.equal(down?.dedupeKey, "capability:vision:unavailable");
  assert.ok(down?.lines?.some((line) => line.includes("帧质检")), "看图能力停了要点明质检会失明");
  assert.ok(down?.lines?.some((line) => line.includes("HTTP 429")));

  assert.equal(
    capabilityTransitionAlert({ status: "unavailable" }, { key: "vision", status: "unavailable", reason: "quota" }),
    null,
    "同状态刷新不重复报",
  );
  assert.equal(
    capabilityTransitionAlert(null, { key: "video", status: "degraded", reason: "unknown" })?.kind,
    "capability_down",
    "冷实例第一次就观测到不稳也要报",
  );
  const recovered = capabilityTransitionAlert({ status: "unavailable" }, { key: "vision", status: "available", reason: "ok" });
  assert.equal(recovered?.kind, "capability_recovered");
  assert.equal(capabilityTransitionAlert({ status: "available" }, { key: "vision", status: "available", reason: "ok" }), null);
  assert.equal(capabilityTransitionAlert({ status: "available" }, { key: "email", status: "not_configured", reason: "not_configured" }), null);
  assert.equal(capabilityTransitionAlert(null, { key: "text", status: "available", reason: "ok" }), null);
});

test("保活告警线：过了截止 45 分钟才报；没有截止时间不报（10 月两条 5 小时任务的形状）", () => {
  const timeoutAt = new Date("2026-10-26T01:16:00.000Z");
  assert.equal(KEPT_ALIVE_ALERT_MIN, 45);
  assert.equal(keptAliveOverdueMinutes(null, NOW), null);
  assert.equal(keptAliveOverdueMinutes(timeoutAt, new Date(timeoutAt.getTime() + 44 * 60_000)), null);
  assert.equal(keptAliveOverdueMinutes(timeoutAt, new Date(timeoutAt.getTime() + 45 * 60_000)), 45);
  assert.equal(keptAliveOverdueMinutes(timeoutAt, new Date(timeoutAt.getTime() + 308 * 60_000)), 308);
});

test("Shuyu 余额预警：还够不到 20 条 15 秒视频就提醒，按天一条；余额或单价拿不到不报", () => {
  /// 余额充足（够 100 条）：不报
  assert.equal(shuyuLowBalanceAlert({ balancePoints: 126_000, videoCostPoints: 1260, minVideos: 20 }), null);
  const low = shuyuLowBalanceAlert({ balancePoints: 24_000, videoCostPoints: 1260, minVideos: 20 });
  assert.equal(low?.kind, "provider_low_balance");
  assert.equal(low?.window, "day");
  assert.match(low?.title ?? "", /只够约 19 条/);
  assert.equal(shuyuLowBalanceAlert({ balancePoints: 25_200, videoCostPoints: 1260, minVideos: 20 }), null, "正好 20 条不报");
  assert.equal(shuyuLowBalanceAlert({ balancePoints: null, videoCostPoints: 1260, minVideos: 20 }), null);
  assert.equal(shuyuLowBalanceAlert({ balancePoints: 100, videoCostPoints: null, minVideos: 20 }), null);
  assert.equal(shuyuLowBalanceAlert({ balancePoints: 100, videoCostPoints: 1260, minVideos: 0 }), null, "0 = 关掉预警");

  assert.equal(shuyuMinVideosThreshold({}), 20);
  assert.equal(shuyuMinVideosThreshold({ OPS_ALERT_SHUYU_MIN_VIDEOS: "50" }), 50);
  assert.equal(shuyuMinVideosThreshold({ OPS_ALERT_SHUYU_MIN_VIDEOS: "0" }), 0);
  assert.equal(shuyuMinVideosThreshold({ OPS_ALERT_SHUYU_MIN_VIDEOS: "abc" }), 20);
});
