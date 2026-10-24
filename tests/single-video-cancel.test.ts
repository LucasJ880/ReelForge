import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  CUSTOMER_CANCELLED_CLASS,
  cancelUnifiedOrderForUser,
} from "../src/lib/services/single-video-cancel-service";

/**
 * 1025 真机验收：单条视频提交后客户无处取消（铁律 #7）。这里锁住补上的取消：
 * 只动本人自助单、CAS 未结束的段、打客户取消标记、brief 置失败、立即按条返还。
 */
type Calls = { jobWhere?: unknown; jobData?: Record<string, unknown>; finalVideo?: unknown; brief?: unknown; order?: unknown; refunds: string[] };

/// db 是惰性代理：按仓库惯例直接替换方法，测试结束还原。
function patch(t: TestContext, target: Record<string, unknown>, key: string, fn: unknown) {
  const original = target[key];
  target[key] = fn;
  t.after(() => { target[key] = original; });
}

function stubDb(t: TestContext, order: unknown, jobCount = 1): Calls {
  const calls: Calls = { refunds: [] };
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  patch(t, anyDb.deliveryOrder, "findFirst", async (args: { where: Record<string, unknown> }) => {
    assert.deepEqual(
      { createdById: args.where.createdById, productCategory: args.where.productCategory },
      { createdById: "user-1", productCategory: "unified_input" },
      "只查本人自助单",
    );
    return order;
  });
  patch(t, anyDb.deliveryOrder, "update", async (args: unknown) => { calls.order = args; return {}; });
  const tx = {
    videoJob: { updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => { calls.jobWhere = args.where; calls.jobData = args.data; return { count: jobCount }; } },
    finalVideo: { updateMany: async (args: unknown) => { calls.finalVideo = args; return { count: 1 }; } },
    videoBrief: { update: async (args: unknown) => { calls.brief = args; return {}; } },
  };
  patch(t, db as unknown as Record<string, unknown>, "$transaction", async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  return calls;
}

function order(jobs: Array<{ status: VideoJobStatus }>, finalVideoId: string | null = null) {
  return {
    id: "order-1",
    rounds: [{ angles: [{ videoBrief: { id: "brief-1", finalVideoId, videoJobs: jobs.map((job, i) => ({ id: `job-${i}`, ...job })) } }] }],
  };
}

const NOW = new Date("2026-10-24T21:00:00.000Z");

test("生成中的单条：CAS 取消 + 客户取消标记 + brief 失败 + 订单取消 + 立即返还", async (t) => {
  const calls = stubDb(t, order([{ status: VideoJobStatus.RUNNING }], "final-1"));
  const result = await cancelUnifiedOrderForUser("user-1", "order-1", NOW, {
    refund: async (briefId) => { calls.refunds.push(briefId); return "refunded"; },
  });
  assert.deepEqual(result, { ok: true, cancelledJobs: 1, refundedBriefs: 1 });
  assert.deepEqual(calls.jobWhere, {
    videoBriefId: "brief-1",
    status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED, VideoJobStatus.RUNNING] },
  });
  assert.equal(calls.jobData?.status, VideoJobStatus.CANCELLED);
  assert.equal(calls.jobData?.submissionErrorClass, CUSTOMER_CANCELLED_CLASS);
  assert.equal((calls.jobData?.finishedAt as Date).toISOString(), NOW.toISOString());
  assert.deepEqual((calls.finalVideo as { where: unknown }).where, {
    id: "final-1",
    status: { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] },
  });
  assert.equal((calls.brief as { data: { status: string } }).data.status, VideoBriefStatus.RENDER_FAILED);
  assert.match((calls.brief as { data: { errorMessage: string } }).data.errorMessage, /已取消.*保留/);
  assert.equal((calls.order as { data: { status: string } }).data.status, "CANCELLED");
  assert.deepEqual(calls.refunds, ["brief-1"]);
});

test("别人的单 / 样片：not_found，不碰任何任务", async (t) => {
  const calls = stubDb(t, null);
  assert.deepEqual(await cancelUnifiedOrderForUser("user-1", "order-x", NOW), { ok: false, reason: "not_found" });
  assert.equal(calls.jobWhere, undefined);
});

test("已经成片 / 已失败：already_finished，不改订单也不返还", async (t) => {
  const calls = stubDb(t, order([{ status: VideoJobStatus.SUCCEEDED }]));
  assert.deepEqual(await cancelUnifiedOrderForUser("user-1", "order-1", NOW), { ok: false, reason: "already_finished" });
  assert.equal(calls.order, undefined);
});

test("期间刚好结束（CAS 落空）：already_finished，不把订单标成取消", async (t) => {
  const calls = stubDb(t, order([{ status: VideoJobStatus.RUNNING }]), 0);
  assert.deepEqual(await cancelUnifiedOrderForUser("user-1", "order-1", NOW), { ok: false, reason: "already_finished" });
  assert.equal(calls.brief, undefined);
  assert.equal(calls.order, undefined);
});

test("返还失败不影响取消本身（清扫器会补）", async (t) => {
  stubDb(t, order([{ status: VideoJobStatus.QUEUED }]));
  t.mock.method(console, "warn", () => undefined);
  const result = await cancelUnifiedOrderForUser("user-1", "order-1", NOW, { refund: async () => { throw new Error("serialization"); } });
  assert.deepEqual(result, { ok: true, cancelledJobs: 1, refundedBriefs: 0 });
});

test("接线：路由鉴权、详情页只在生成中 / 暂停时给取消、轮询不拼接客户取消过的半成品", async () => {
  const route = await readFile("src/app/api/library/[id]/cancel/route.ts", "utf8");
  assert.match(route, /requireAuth\(\)/);
  assert.match(route, /cancelUnifiedOrderForUser\(guard\.session\.user\.id, id\)/);
  const page = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(page, /canCancel = !item\.isShowcase && \(item\.status === "generating" \|\| item\.status === "paused"\)/);
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.match(service, /j\.submissionErrorClass === CUSTOMER_CANCELLED_CLASS/);
  const button = await readFile("src/components/library/cancel-video-button.tsx", "utf8");
  assert.doesNotMatch(button, /window\.confirm/);
});
