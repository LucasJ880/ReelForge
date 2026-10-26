/**
 * C3：stitch-dispatch 在 inprocess 模式下就是生产合成器。
 *
 *   - 认领用与 claimStitchTask 同一个 CAS（PENDING → STITCHING + attemptToken + startedAt）
 *   - 时间预算：剩余 < 150s 不开始新任务；第一条总会尝试；之后只挑估算放得下的
 *   - 合成 deadline = 硬上限 - 余量，传给合成器（超了中止并放回 PENDING）
 *   - 路由契约（strict schema）覆盖 inprocess 结果
 *
 * monkey-patch Prisma，不连数据库；合成器以依赖注入替身代替（不跑 ffmpeg / 不上传）。
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import {
  estimateComposeMs,
  runInprocessStitchTick,
  runStitchDispatchTick,
  STITCH_DISPATCH_MAX_DURATION_SEC,
  __test__ as dispatchTest,
} from "../src/lib/services/stitch-dispatch-service";
import { GET as stitchDispatchGET } from "../src/app/api/cron/stitch-dispatch/route";
import {
  stitchDispatchResponseSchema,
  stitchDispatchSuccessSchema,
} from "../src/lib/contracts/stitch-dispatch";
import type { StitchAttemptOutcome } from "../src/lib/services/stitch-service";

function patchModel(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

function withEnv(t: TestContext, next: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = env[key];
    if (next[key] === undefined) delete env[key];
    else env[key] = next[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete env[key];
      else env[key] = originals[key];
    }
  });
}

type Row = {
  id: string;
  status: FinalVideoStatus;
  segmentCount: number;
  targetDurationSec: number;
  stitchAttempts: number;
  stitchAttemptToken: string | null;
  startedAt: Date | null;
  postProduction: unknown;
  brief: { aspectRatio: string };
  segments: Array<{ segmentIndex: number; status: VideoJobStatus; outputVideoUrl: string; assignedAssets: null }>;
};

function readyRow(id: string, targetDurationSec = 15): Row {
  return {
    id,
    status: FinalVideoStatus.PENDING,
    segmentCount: 1,
    targetDurationSec,
    stitchAttempts: 0,
    stitchAttemptToken: null,
    startedAt: null,
    postProduction: null,
    brief: { aspectRatio: "9:16" },
    segments: [
      { segmentIndex: 0, status: VideoJobStatus.SUCCEEDED, outputVideoUrl: `https://cdn.example.com/${id}.mp4`, assignedAssets: null },
    ],
  };
}

/** 有状态的假 FinalVideo 表：findMany 只返回 PENDING；updateMany 做真正的 CAS */
function installFakeTable(t: TestContext, rows: Row[]) {
  const casCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => rows.filter((row) => row.status === FinalVideoStatus.PENDING),
    /// 并发上限查询：其它调用正在合成的条数（本测试里合成器替身会立刻把行推到 READY）
    count: async (args: { where: { status?: FinalVideoStatus; startedAt?: { gt: Date } } }) =>
      rows.filter(
        (row) =>
          row.status === args.where.status &&
          (!args.where.startedAt || (row.startedAt !== null && row.startedAt > args.where.startedAt.gt)),
      ).length,
    updateMany: async (args: { where: { id: string; status?: FinalVideoStatus }; data: Record<string, unknown> }) => {
      casCalls.push(args as unknown as { where: Record<string, unknown>; data: Record<string, unknown> });
      const row = rows.find((candidate) => candidate.id === args.where.id);
      if (!row || (args.where.status && row.status !== args.where.status)) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
  return casCalls;
}

const succeeded = (finalVideoId: string): StitchAttemptOutcome => ({
  kind: "succeeded",
  result: { finalVideoId, ok: true, status: FinalVideoStatus.READY },
});

test("estimateComposeMs：随成片时长线性增长（15s≈56s、60s≈146s）", () => {
  assert.equal(estimateComposeMs({ targetDurationSec: 15 }), 56_000);
  assert.equal(estimateComposeMs({ targetDurationSec: 60 }), 146_000);
  assert.ok(estimateComposeMs({ targetDurationSec: 0 }) > 20_000, "未知时长按至少 5s 估");
});

test("inprocess tick：用与 claimStitchTask 同一个 CAS 认领一条，并把 deadline 预算交给合成器", async (t) => {
  const rows = [readyRow("fv_cas")];
  const casCalls = installFakeTable(t, rows);
  const attempts: Array<{ finalVideoId: string; attemptToken: string; deadlineAt: number | null; reserveMs: number }> = [];
  const result = await runInprocessStitchTick({
    startedAt: 1_000_000,
    now: () => 1_000_000,
    runAttempt: async ({ finalVideoId, attemptToken, budget }) => {
      attempts.push({ finalVideoId, attemptToken, deadlineAt: budget.deadlineAt, reserveMs: budget.reserveMs });
      const row = rows.find((candidate) => candidate.id === finalVideoId)!;
      row.status = FinalVideoStatus.READY;
      return succeeded(finalVideoId);
    },
  });

  assert.equal(result.outcome, "stitched_inprocess");
  assert.equal(result.pending, 1);
  assert.equal(result.claimed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.stoppedBecause, "drained");

  assert.equal(casCalls.length, 1);
  assert.deepEqual(casCalls[0]?.where, { id: "fv_cas", status: FinalVideoStatus.PENDING });
  assert.equal(casCalls[0]?.data.status, FinalVideoStatus.STITCHING);
  assert.equal(typeof casCalls[0]?.data.stitchAttemptToken, "string");
  assert.ok(casCalls[0]?.data.startedAt instanceof Date, "startedAt 写入：清扫器 30 分钟超时从这里起算");
  assert.equal(casCalls[0]?.data.ffmpegError, null);

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.attemptToken, casCalls[0]?.data.stitchAttemptToken, "合成器拿到的就是这次 CAS 写入的 token");
  assert.equal(
    attempts[0]?.deadlineAt,
    1_000_000 + STITCH_DISPATCH_MAX_DURATION_SEC * 1000 - dispatchTest.DEFAULT_DEADLINE_SAFETY_MS,
    "合成 deadline = 硬上限 300s - 安全余量",
  );
  assert.ok((attempts[0]?.reserveMs ?? 0) > 0, "为上传 + 审核 + 落库预留时间");
});

test("inprocess tick：剩余不足 150s 不再开始新任务（函数被杀前停手）", async (t) => {
  const rows = [readyRow("fv_a"), readyRow("fv_b"), readyRow("fv_c")];
  installFakeTable(t, rows);
  let clock = 0;
  const started: Array<{ id: string; at: number }> = [];
  const result = await runInprocessStitchTick({
    startedAt: 0,
    now: () => clock,
    runAttempt: async ({ finalVideoId }) => {
      started.push({ id: finalVideoId, at: clock });
      clock += 100_000;
      rows.find((row) => row.id === finalVideoId)!.status = FinalVideoStatus.READY;
      return succeeded(finalVideoId);
    },
  });
  assert.deepEqual(started, [
    { id: "fv_a", at: 0 },
    { id: "fv_b", at: 100_000 },
  ]);
  assert.equal(result.claimed, 2);
  assert.equal(result.stoppedBecause, "budget");
  assert.equal(rows[2]?.status, FinalVideoStatus.PENDING, "第三条留给下一次 cron 调用（完整预算）");
});

test("inprocess tick：第一条总会尝试；之后只认领估算放得下的（大片留给下一次完整预算）", async (t) => {
  const rows = [readyRow("fv_first", 60), readyRow("fv_huge", 120), readyRow("fv_small", 15)];
  installFakeTable(t, rows);
  let clock = 0;
  const order: string[] = [];
  await runInprocessStitchTick({
    startedAt: 0,
    now: () => clock,
    runAttempt: async ({ finalVideoId }) => {
      order.push(finalVideoId);
      clock += 100_000;
      rows.find((row) => row.id === finalVideoId)!.status = FinalVideoStatus.READY;
      return succeeded(finalVideoId);
    },
  });
  /// t=100s：剩余到 deadline 275-100-20 = 155s；120s 成片估算 266s 放不下 → 跳过；15s 成片 56s → 认领
  assert.deepEqual(order, ["fv_first", "fv_small"]);
  assert.equal(rows[1]?.status, FinalVideoStatus.PENDING);
});

test("inprocess tick：一条估算超过整份预算的超长片仍会被首个认领（不会永远没人做）", async (t) => {
  const rows = [readyRow("fv_too_long", 600)];
  installFakeTable(t, rows);
  const order: string[] = [];
  await runInprocessStitchTick({
    startedAt: 0,
    now: () => 0,
    runAttempt: async ({ finalVideoId }) => {
      order.push(finalVideoId);
      rows[0]!.status = FinalVideoStatus.READY;
      return succeeded(finalVideoId);
    },
  });
  assert.deepEqual(order, ["fv_too_long"]);
});

test("inprocess tick：没有就绪任务 → no_pending，不认领、不合成", async () => {
  let claims = 0;
  const result = await runInprocessStitchTick({
    findPendingCount: async () => 0,
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  assert.equal(result.outcome, "no_pending");
  assert.equal(claims, 0);
});

test("inprocess tick：有就绪但都被并发调用认领 → inprocess_idle", async () => {
  const result = await runInprocessStitchTick({
    findPendingCount: async () => 2,
    countInflight: async () => 0,
    claim: async () => null,
    runAttempt: async () => {
      throw new Error("must not run");
    },
  });
  assert.equal(result.outcome, "inprocess_idle");
  assert.equal(result.claimed, 0);
  assert.equal(result.stoppedBecause, "drained");
});

test("inprocess tick：结果计数分别记成功 / 失败 / 放回 / 丢失，且受 maxTasks 约束", async () => {
  const kinds: StitchAttemptOutcome["kind"][] = ["failed", "requeued", "lost", "succeeded"];
  let n = 0;
  const result = await runInprocessStitchTick({
    startedAt: 0,
    now: () => 0,
    maxTasks: 3,
    findPendingCount: async () => 9,
    countInflight: async () => 0,
    claim: async () => ({ finalVideoId: `fv_${n}`, attemptToken: `tok_${n}` }),
    runAttempt: async ({ finalVideoId }) => {
      const kind = kinds[n++]!;
      return { kind, result: { finalVideoId, ok: kind === "succeeded", status: FinalVideoStatus.FAILED } };
    },
  });
  assert.equal(result.claimed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.requeued, 1);
  assert.equal(result.lost, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(result.stoppedBecause, "max_tasks");
});

test("inprocess tick：全局同时合成数达上限 → 本次不认领（stoppedBecause=concurrency），只数一个函数寿命内的认领", async () => {
  const sinceSeen: Date[] = [];
  let claims = 0;
  const result = await runInprocessStitchTick({
    startedAt: 1_000_000,
    now: () => 1_000_000,
    maxConcurrent: 3,
    findPendingCount: async () => 5,
    countInflight: async (since) => {
      sinceSeen.push(since);
      return 3;
    },
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  assert.equal(result.outcome, "inprocess_idle");
  assert.equal(result.stoppedBecause, "concurrency");
  assert.equal(claims, 0);
  assert.equal(
    sinceSeen[0]?.getTime(),
    1_000_000 - STITCH_DISPATCH_MAX_DURATION_SEC * 1000 - 60_000,
    "被平台杀掉的旧 STITCHING 行（超过一个函数寿命）不占名额",
  );
});

test("runStitchDispatchTick：inprocess 进程内合成；external 仍派发 GitHub；local 什么都不做", async () => {
  const inprocess = await runStitchDispatchTick({
    env: { STITCH_RUNTIME: "inprocess" },
    inprocess: { findPendingCount: async () => 0 },
  });
  assert.equal(inprocess.mode, "inprocess");

  const local = await runStitchDispatchTick({ env: { STITCH_RUNTIME: "local" } });
  assert.deepEqual(local, { mode: "local", dispatch: { outcome: "not_external", pending: 0 } });

  const external = await runStitchDispatchTick({
    env: { STITCH_RUNTIME: "external" },
    external: {
      findPendingCount: async () => 0,
      withLock: async (work) => ({ acquired: true, value: await work() }),
    },
  });
  assert.deepEqual(external, { mode: "external", dispatch: { outcome: "no_pending", pending: 0 } });
});

test("函数被平台杀掉：行停在 STITCHING → 清扫器 30 分钟后放回 PENDING；被杀那次的迟到回写一律 409", async (t) => {
  const row = readyRow("fv_killed");
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async (args: { where?: { status?: FinalVideoStatus } }) =>
      args.where?.status && row.status !== args.where.status ? [] : [{ ...row, brief: { id: "brief_killed", aspectRatio: "9:16" } }],
    findUnique: async () => ({ ...row, brief: null }),
    updateMany: async (args: { where: { status?: FinalVideoStatus; stitchAttemptToken?: string | null }; data: Record<string, unknown> }) => {
      if (args.where.status && row.status !== args.where.status) return { count: 0 };
      if ("stitchAttemptToken" in args.where && row.stitchAttemptToken !== args.where.stitchAttemptToken) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
  const { claimNextReadyFinalVideo, finishStitchTask } = await import("../src/lib/services/stitch-service");
  const claimed = await claimNextReadyFinalVideo({ prepare: () => null });
  assert.ok(claimed, "进程内合成认领");
  assert.equal(row.status, FinalVideoStatus.STITCHING);
  assert.ok(row.startedAt instanceof Date);

  /// 模拟函数在合成中途被杀：什么都没写回。31 分钟后清扫器运行。
  patchModel(t, db.videoJob as unknown as Record<string, unknown>, { findMany: async () => [] });
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, { findMany: async () => [] });
  const { sweepStuckTasks } = await import("../src/lib/services/sweep-service");
  const swept = await sweepStuckTasks(new Date(Date.now() + 31 * 60_000));
  assert.deepEqual(swept.requeuedStitching, ["fv_killed"]);
  assert.equal(row.status, FinalVideoStatus.PENDING);
  assert.equal(row.stitchAttempts, 1);
  assert.equal(row.stitchAttemptToken, null);

  /// 被杀那次如果其实还活着、迟到回写：token 已被收回 → stale，不覆盖
  const late = await finishStitchTask({
    finalVideoId: "fv_killed",
    attemptToken: claimed.attemptToken,
    stitchedVideoUrl: "https://blob.example.com/late.mp4",
  });
  assert.equal(late.conflict, true);
  assert.equal(row.status, FinalVideoStatus.PENDING);
});

// ---------------------------------------------------------------------------
// 路由契约
// ---------------------------------------------------------------------------

const SECRET = "stitch-inprocess-contract-secret";

function request() {
  return new NextRequest("http://localhost/api/cron/stitch-dispatch", {
    method: "GET",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

test("路由 inprocess：没有就绪任务 → 200 no_pending（严格契约，无 inprocess 计数块）", async (t) => {
  withEnv(t, { CRON_SECRET: SECRET, STITCH_RUNTIME: "inprocess" });
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [],
    updateMany: async () => {
      throw new Error("must not claim");
    },
  });
  const response = await stitchDispatchGET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(stitchDispatchSuccessSchema.parse(body), body);
  assert.equal(body.outcome, "no_pending");
  assert.equal(body.dispatched, false);
  assert.equal(body.inprocess, undefined);
  assert.equal(body.heartbeat.outcome, "skipped");
});

test("路由 inprocess：就绪任务被并发调用抢走（CAS 失败）→ 200 inprocess_idle 带计数", async (t) => {
  withEnv(t, { CRON_SECRET: SECRET, STITCH_RUNTIME: "inprocess" });
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [readyRow("fv_raced")],
    count: async () => 0,
    updateMany: async () => ({ count: 0 }),
  });
  const response = await stitchDispatchGET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(stitchDispatchResponseSchema.parse(body), body);
  assert.equal(body.outcome, "inprocess_idle");
  assert.equal(body.pending, 1);
  assert.equal(body.inprocess.claimed, 0);
  assert.equal(body.heartbeat.details.claimed, 0);
});

test("契约：inprocess 计数块只允许出现在 inprocess 结果上；stitched_inprocess 心跳为 ok", () => {
  const heartbeat = {
    event: "scheduler_heartbeat",
    scheduler: "stitch-dispatch",
    phase: "finished",
    runId: "run-1",
    timestamp: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    durationMs: 1,
    outcome: "ok",
    details: { outcome: "stitched_inprocess", pending: 2, claimed: 1, succeeded: 1, failed: 0, requeued: 0, lost: 0 },
  } as const;
  const counters = { claimed: 1, succeeded: 1, failed: 0, requeued: 0, lost: 0, stoppedBecause: "drained", elapsedMs: 1200 } as const;
  assert.equal(
    stitchDispatchSuccessSchema.safeParse({ ok: true, dispatched: false, outcome: "stitched_inprocess", pending: 2, inprocess: counters, heartbeat }).success,
    true,
  );
  assert.equal(
    stitchDispatchSuccessSchema.safeParse({ ok: true, dispatched: false, outcome: "stitched_inprocess", pending: 2, heartbeat }).success,
    false,
    "stitched_inprocess 必须带计数",
  );
  assert.equal(
    stitchDispatchSuccessSchema.safeParse({
      ok: true,
      dispatched: false,
      outcome: "no_pending",
      pending: 0,
      inprocess: counters,
      heartbeat: { ...heartbeat, outcome: "skipped", details: { outcome: "no_pending", pending: 0 } },
    }).success,
    false,
    "非 inprocess 结果不得带计数",
  );
});
