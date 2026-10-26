import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { DeliveryOrderStatus, FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { cancelBrollDelivery } from "../src/lib/services/broll-assembly-service";
import { orderFailureWhere } from "../src/lib/services/exchange-readings";
import {
  CUSTOMER_CANCEL_MESSAGE,
  CUSTOMER_CANCELLED_CLASS,
} from "../src/lib/services/single-video-cancel-service";
import { isCancelledOrderJobs } from "../src/lib/services/unified-library-service";

/**
 * 1025 审计 B1：取消一条实拍图库（b-roll）视频被记成了失败——FinalVideo 置 FAILED、段置 CANCELLED，
 * 但没打 customer_cancelled 标记、也没有 CAS，于是读数把它算进失败 / 需要处理 / 成片率，成品库却写「已取消」。
 * 这里锁住改后的约定：与单条取消（cancelUnifiedOrderForUser）同一个标记、CAS、brief / 订单状态与即时返还。
 */
type Calls = {
  briefWhere?: unknown;
  finalVideo?: { where: unknown; data: Record<string, unknown> };
  jobs?: { where: unknown; data: Record<string, unknown> };
  brief?: { where: unknown; data: Record<string, unknown> };
  order?: { where: unknown; data: Record<string, unknown> };
  transactions: number;
  refunds: string[];
};

/// db 是惰性代理：按仓库惯例直接替换方法，测试结束还原。
function patch(t: TestContext, target: Record<string, unknown>, key: string, fn: unknown) {
  const original = target[key];
  target[key] = fn;
  t.after(() => {
    target[key] = original;
  });
}

function brollBrief(overrides: { route?: string | null; finalStatus?: FinalVideoStatus | null } = {}) {
  const finalStatus = overrides.finalStatus === undefined ? FinalVideoStatus.PENDING : overrides.finalStatus;
  return {
    id: "brief-1",
    videoRouteSnapshot: overrides.route === undefined ? "broll" : overrides.route,
    finalVideo: finalStatus ? { id: "broll_fv-1", status: finalStatus } : null,
    contentAngle: { round: { deliveryOrderId: "order-1" } },
  };
}

function stubDb(t: TestContext, brief: unknown, finalVideoCount = 1): Calls {
  const calls: Calls = { transactions: 0, refunds: [] };
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  patch(t, anyDb.videoBrief, "findFirst", async (args: { where: unknown }) => {
    calls.briefWhere = args.where;
    return brief;
  });
  const tx = {
    finalVideo: {
      updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.finalVideo = args;
        return { count: finalVideoCount };
      },
    },
    videoJob: {
      updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.jobs = args;
        return { count: 3 };
      },
    },
    videoBrief: {
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.brief = args;
        return {};
      },
    },
    deliveryOrder: {
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.order = args;
        return {};
      },
    },
  };
  patch(t, db as unknown as Record<string, unknown>, "$transaction", async (fn: (client: typeof tx) => Promise<unknown>) => {
    calls.transactions += 1;
    return fn(tx);
  });
  return calls;
}

const NOW = new Date("2026-10-25T21:00:00.000Z");

test("排队等合成的 b-roll：CAS 取消 + 客户取消标记 + brief 失败 + 订单取消 + 立即返还", async (t) => {
  const calls = stubDb(t, brollBrief());
  const result = await cancelBrollDelivery(
    { userId: "user-1", briefId: "brief-1", now: NOW },
    { refund: async (briefId) => { calls.refunds.push(briefId); return "stamped"; } },
  );
  assert.deepEqual(result, { ok: true, state: "cancelled", refunded: false });

  assert.deepEqual(
    calls.briefWhere,
    {
      id: "brief-1",
      contentAngle: { round: { deliveryOrder: { createdById: "user-1", productCategory: "unified_input" } } },
    },
    "只查本人的自助单（与单条取消同一个归属口径）",
  );

  assert.deepEqual(calls.finalVideo?.where, {
    id: "broll_fv-1",
    status: { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] },
  });
  assert.equal(calls.finalVideo?.data.status, FinalVideoStatus.FAILED);
  assert.equal(calls.finalVideo?.data.ffmpegError, CUSTOMER_CANCEL_MESSAGE);
  assert.equal((calls.finalVideo?.data.finishedAt as Date).toISOString(), NOW.toISOString());

  assert.deepEqual(calls.jobs?.where, {
    finalVideoId: "broll_fv-1",
    status: {
      in: [VideoJobStatus.QUEUED, VideoJobStatus.PAUSED, VideoJobStatus.RUNNING, VideoJobStatus.SUCCEEDED],
    },
  });
  assert.equal(calls.jobs?.data.status, VideoJobStatus.CANCELLED);
  assert.equal(calls.jobs?.data.submissionErrorClass, CUSTOMER_CANCELLED_CLASS);
  assert.equal(calls.jobs?.data.userSafeError, CUSTOMER_CANCEL_MESSAGE);
  assert.equal(calls.jobs?.data.leaseOwner, null);

  assert.deepEqual(calls.brief?.where, { id: "brief-1" });
  assert.equal(calls.brief?.data.status, VideoBriefStatus.RENDER_FAILED);
  assert.match(String(calls.brief?.data.errorMessage), /已取消.*保留/);
  assert.deepEqual(calls.order?.where, { id: "order-1" });
  assert.equal(calls.order?.data.status, DeliveryOrderStatus.CANCELLED);

  assert.deepEqual(calls.refunds, ["brief-1"], "与单条取消一样立即走 refundFailedBrief");
});

test("合成中也能取消；返还真的退回额度时如实返回 refunded", async (t) => {
  const calls = stubDb(t, brollBrief({ finalStatus: FinalVideoStatus.STITCHING }));
  const result = await cancelBrollDelivery(
    { userId: "user-1", briefId: "brief-1", now: NOW },
    { refund: async (briefId) => { calls.refunds.push(briefId); return "refunded"; } },
  );
  assert.deepEqual(result, { ok: true, state: "cancelled", refunded: true });
});

test("只重拼中取消（P05-B 第五个回滚出口）：回滚到旧成片 + 旧快照，不开事务、不取消订单、不返还", async (t) => {
  const OLD_URL = "https://abc.public.blob.vercel-storage.com/final-videos/broll_fv-1/old.mp4";
  const OLD_PLAN = { audio: { voiceover: { enabled: false, voiceId: "warm-confident", language: "zh", script: "" }, bgm: { trackId: "none", volume: 0 } }, captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: false } };
  const calls = stubDb(t, {
    ...brollBrief({ finalStatus: FinalVideoStatus.STITCHING }),
    finalVideo: { id: "broll_fv-1", status: FinalVideoStatus.STITCHING, previousStitchedVideoUrl: OLD_URL },
  });
  const rollbacks: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const anyDb = db as unknown as Record<string, Record<string, unknown>>;
  patch(t, anyDb.finalVideo, "findUnique", async () => ({ previousStitchedVideoUrl: OLD_URL, previousPostProduction: OLD_PLAN }));
  patch(t, anyDb.finalVideo, "updateMany", async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { rollbacks.push(args); return { count: 1 }; });
  t.mock.method(console, "warn", () => undefined);

  const result = await cancelBrollDelivery(
    { userId: "user-1", briefId: "brief-1", now: NOW },
    { refund: async (briefId) => { calls.refunds.push(briefId); return "refunded"; } },
  );
  assert.deepEqual(result, { ok: true, state: "restitch_rolled_back", refunded: false });
  assert.equal(calls.transactions, 0, "不开取消事务：段 / brief / 订单都不动");
  assert.deepEqual(calls.refunds, [], "成片一直都在，没有额度可返还");
  assert.equal(rollbacks.length, 1);
  assert.deepEqual(rollbacks[0].where, {
    id: "broll_fv-1",
    previousStitchedVideoUrl: OLD_URL,
    status: { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] },
  });
  assert.equal(rollbacks[0].data.status, FinalVideoStatus.READY);
  assert.equal(rollbacks[0].data.stitchedVideoUrl, OLD_URL);
  assert.deepEqual(rollbacks[0].data.postProduction, OLD_PLAN, "后期快照回到旧版");
  assert.equal(rollbacks[0].data.previousStitchedVideoUrl, null);
});

test("合成刚好结束（CAS 落空）：already_finished，不碰段、brief、订单，也不返还", async (t) => {
  const calls = stubDb(t, brollBrief({ finalStatus: FinalVideoStatus.STITCHING }), 0);
  const result = await cancelBrollDelivery(
    { userId: "user-1", briefId: "brief-1", now: NOW },
    { refund: async (briefId) => { calls.refunds.push(briefId); return "refunded"; } },
  );
  assert.deepEqual(result, { ok: false, reason: "already_finished" });
  assert.equal(calls.jobs, undefined);
  assert.equal(calls.brief, undefined);
  assert.equal(calls.order, undefined);
  assert.deepEqual(calls.refunds, []);
});

test("已成片 / 已失败：already_finished，不进事务", async (t) => {
  for (const finalStatus of [FinalVideoStatus.READY, FinalVideoStatus.FAILED]) {
    const calls = stubDb(t, brollBrief({ finalStatus }));
    assert.deepEqual(
      await cancelBrollDelivery({ userId: "user-1", briefId: "brief-1", now: NOW }),
      { ok: false, reason: "already_finished" },
    );
    assert.equal(calls.transactions, 0);
  }
});

test("别人的 / 不存在：not_found；不是 b-roll：not_broll（都不进事务）", async (t) => {
  const missing = stubDb(t, null);
  assert.deepEqual(await cancelBrollDelivery({ userId: "user-1", briefId: "x", now: NOW }), { ok: false, reason: "not_found" });
  assert.equal(missing.transactions, 0);

  const notBroll = stubDb(t, brollBrief({ route: "seedance" }));
  assert.deepEqual(
    await cancelBrollDelivery({ userId: "user-1", briefId: "brief-1", now: NOW }),
    { ok: false, reason: "not_broll" },
  );
  assert.equal(notBroll.transactions, 0);
});

test("返还失败不影响取消本身（清扫器会补）", async (t) => {
  stubDb(t, brollBrief());
  t.mock.method(console, "warn", () => undefined);
  const result = await cancelBrollDelivery(
    { userId: "user-1", briefId: "brief-1", now: NOW },
    { refund: async () => { throw new Error("serialization"); } },
  );
  assert.deepEqual(result, { ok: true, state: "cancelled", refunded: false });
});

test("取消≠失败：写下的标记正好是读数排除取消的那一条，成品库也判「已取消」", async (t) => {
  const calls = stubDb(t, brollBrief());
  await cancelBrollDelivery({ userId: "user-1", briefId: "brief-1", now: NOW }, { refund: async () => "stamped" });

  /// 读数（失败 / 需要处理 / 成片率）里的排除条件：有客户取消标记的 CANCELLED 段、且没有 FAILED 段
  const failure = orderFailureWhere("user-1", { gte: new Date(NOW.getTime() - 7 * 86_400_000) });
  assert.deepEqual(failure.NOT, {
    videoJobs: {
      some: { status: "CANCELLED", submissionErrorClass: CUSTOMER_CANCELLED_CLASS },
      none: { status: "FAILED" },
    },
  });
  assert.equal(calls.jobs?.data.status, "CANCELLED");
  assert.equal(calls.jobs?.data.submissionErrorClass, CUSTOMER_CANCELLED_CLASS);
  const touched = (calls.jobs?.where as { status: { in: string[] } }).status.in;
  assert.ok(!touched.includes("FAILED"), "真失败的段不被取消改写");

  /// 成品库：段全部取消、没有在跑 / 失败的 → 已取消
  assert.equal(isCancelledOrderJobs(["CANCELLED", "CANCELLED", "CANCELLED"]), true);
});

test("接线：路由鉴权并把返还结果带回；创作页卡片的调用口径不变", async () => {
  const route = await readFile("src/app/api/broll/cancel/route.ts", "utf8");
  assert.match(route, /requireAuth\(\)/);
  assert.match(route, /cancelBrollDelivery\(\{\s*userId: guard\.session\.user\.id,/);
  assert.match(route, /refunded: result\.refunded/);
  const service = await readFile("src/lib/services/broll-assembly-service.ts", "utf8");
  assert.doesNotMatch(service, /db\.finalVideo\.update\(\{\s*where: \{ id: brief\.finalVideo\.id \}/, "不再无条件覆盖成片状态");
});
