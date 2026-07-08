import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { sweepStuckTasks, __test__ as sweepTest } from "../src/lib/services/sweep-service";
import { MAX_STITCH_ATTEMPTS } from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";

/**
 * 孤儿清扫器（sweep-service）回归测试。
 *
 * 覆盖第三阶段审计项 1（超时与心跳）+ 5（孤儿清扫器）：
 *  - RUNNING/QUEUED VideoJob 超过 timeoutAt + 宽限 → FAILED + 人话 userSafeError
 *  - STITCHING FinalVideo 超时：还有尝试预算 → 转回 PENDING（续跑，不重新生成）
 *  - STITCHING FinalVideo 超时且预算耗尽 → FAILED + brief RENDER_FAILED（人话）
 *  - PENDING 且所有段 SUCCEEDED 但等待合成超时（本次事故形态）→ FAILED
 *
 * 全部 monkey-patch Prisma，不触真实 DB，AIVORA_DRY_RUN=1 下零计费。
 */

function patchModel(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, (...args: never[]) => unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      model[key] = originals[key];
    }
  });
}

/// 默认让三个 sweeper 各自查询返回空，单测里按需覆盖某一类
function patchEmptyDefaults(t: TestContext) {
  patchModel(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: (async () => []) as never,
  });
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async () => []) as never,
  });
}

const NOW = new Date("2026-07-08T12:00:00Z");
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/// ---------- 1. VideoJob 超时 ----------

test("sweep：超时的 RUNNING job → FAILED + 人话 userSafeError + brief 同步", async (t) => {
  patchEmptyDefaults(t);

  const jobUpdates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  patchModel(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: (async () => [
      { id: "job_stuck", videoBriefId: "brief_1" },
    ]) as never,
    updateMany: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      jobUpdates.push(args);
      return { count: 1 };
    }) as never,
  });

  /// syncBriefStatus 会读 brief + jobs —— 打成无 job 的空 brief，走安全路径
  const briefUpdates: string[] = [];
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: (async () => ({
      id: "brief_1",
      status: VideoBriefStatus.RENDERING,
    })) as never,
    update: (async (args: { where: { id: string } }) => {
      briefUpdates.push(args.where.id);
      return {};
    }) as never,
  });
  patchModel(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: (async (args?: { where?: { status?: unknown } }) => {
      /// 第一次调用来自 sweeper（带 OR 超时条件），后续来自 syncBriefStatus
      if (args?.where && "OR" in (args.where as object)) {
        return [{ id: "job_stuck", videoBriefId: "brief_1" }];
      }
      return [
        {
          id: "job_stuck",
          status: VideoJobStatus.FAILED,
          errorMessage: "sweep: job timed out",
        },
      ];
    }) as never,
    updateMany: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      jobUpdates.push(args);
      return { count: 1 };
    }) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.timedOutJobs, ["job_stuck"]);
  assert.equal(jobUpdates.length, 1);
  assert.equal(jobUpdates[0].data.status, VideoJobStatus.FAILED);
  assert.equal(
    jobUpdates[0].data.userSafeError,
    sweepTest.JOB_TIMEOUT_USER_ERROR,
  );
  /// 人话校验：不含内部术语
  const { containsBannedPersonalTerm } = await import(
    "../src/lib/video-generation/personal-status"
  );
  assert.equal(
    containsBannedPersonalTerm(String(jobUpdates[0].data.userSafeError)),
    false,
  );
});

test("sweep：timeoutAt 缺失的老 RUNNING job 按 createdAt 兜底清扫（无豁免通道）", async (t) => {
  patchEmptyDefaults(t);

  const capturedWheres: unknown[] = [];
  patchModel(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: (async (args?: { where?: Record<string, unknown> }) => {
      if (args?.where && "OR" in args.where) {
        capturedWheres.push(args.where);
        return [];
      }
      return [];
    }) as never,
  });

  await sweepStuckTasks(NOW);
  assert.equal(capturedWheres.length, 1);
  const or = (capturedWheres[0] as { OR: unknown[] }).OR;
  assert.equal(or.length, 2, "查询必须同时覆盖 timeoutAt 超时与 timeoutAt=null 兜底");
  assert.ok(
    or.some(
      (c) => (c as { timeoutAt?: unknown }).timeoutAt === null,
    ),
    "必须有 timeoutAt=null + createdAt 兜底分支",
  );
});

/// ---------- 2. STITCHING 超时 ----------

test("sweep：STITCHING 超时且还有预算 → 转回 PENDING 续跑（不重新生成）", async (t) => {
  patchEmptyDefaults(t);

  const fvUpdates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async (args: { where: { status?: unknown } }) => {
      if (args.where.status === FinalVideoStatus.STITCHING) {
        return [
          {
            id: "fv_stitching",
            status: FinalVideoStatus.STITCHING,
            stitchAttempts: 0,
            startedAt: HOURS_AGO(1),
            createdAt: HOURS_AGO(2),
            brief: { id: "brief_2" },
          },
        ];
      }
      return [];
    }) as never,
    updateMany: (async (args: { where: unknown; data: Record<string, unknown> }) => {
      fvUpdates.push(args);
      return { count: 1 };
    }) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.requeuedStitching, ["fv_stitching"]);
  assert.equal(result.failedStitching.length, 0);
  assert.equal(fvUpdates[0].data.status, FinalVideoStatus.PENDING);
  assert.equal(fvUpdates[0].data.stitchAttempts, 1);
});

test("sweep：STITCHING 超时且预算耗尽 → FAILED + brief RENDER_FAILED（人话）", async (t) => {
  patchEmptyDefaults(t);

  const fvUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async (args: { where: { status?: unknown } }) => {
      if (args.where.status === FinalVideoStatus.STITCHING) {
        return [
          {
            id: "fv_exhausted",
            status: FinalVideoStatus.STITCHING,
            stitchAttempts: MAX_STITCH_ATTEMPTS - 1,
            startedAt: HOURS_AGO(1),
            createdAt: HOURS_AGO(2),
            brief: { id: "brief_3" },
          },
        ];
      }
      return [];
    }) as never,
    updateMany: (async (args: { data: Record<string, unknown> }) => {
      fvUpdates.push(args);
      return { count: 1 };
    }) as never,
  });

  const briefUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    update: (async (args: { data: Record<string, unknown> }) => {
      briefUpdates.push(args);
      return {};
    }) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.failedStitching, ["fv_exhausted"]);
  assert.equal(fvUpdates[0].data.status, FinalVideoStatus.FAILED);
  assert.equal(fvUpdates[0].data.ffmpegError, sweepTest.STITCH_TIMEOUT_ERROR);
  assert.equal(briefUpdates.length, 1);
  assert.equal(briefUpdates[0].data.status, VideoBriefStatus.RENDER_FAILED);
  assert.equal(
    briefUpdates[0].data.errorMessage,
    sweepTest.BRIEF_STITCH_FAILED_MESSAGE,
  );
});

/// ---------- 3. 等待合成超时（本次事故形态） ----------

test("sweep：段全部成功但等待合成超时 → FAILED（不再永远 85%）", async (t) => {
  patchEmptyDefaults(t);

  const fvUpdates: Array<{ data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async (args: { where: { status?: unknown } }) => {
      if (args.where.status === FinalVideoStatus.PENDING) {
        return [
          {
            id: "fv_orphan",
            status: FinalVideoStatus.PENDING,
            segmentCount: 1,
            createdAt: HOURS_AGO(3),
            brief: { id: "brief_4" },
            segments: [
              {
                status: VideoJobStatus.SUCCEEDED,
                finishedAt: HOURS_AGO(2),
              },
            ],
          },
        ];
      }
      return [];
    }) as never,
    updateMany: (async (args: { data: Record<string, unknown> }) => {
      fvUpdates.push(args);
      return { count: 1 };
    }) as never,
  });
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    update: (async () => ({})) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.failedAwaitingStitch, ["fv_orphan"]);
  assert.equal(fvUpdates[0].data.status, FinalVideoStatus.FAILED);
  assert.equal(
    fvUpdates[0].data.ffmpegError,
    sweepTest.AWAIT_STITCH_TIMEOUT_ERROR,
  );
});

test("sweep：段全部成功但还没到等待超时 → 不动（避免误杀正常排队）", async (t) => {
  patchEmptyDefaults(t);

  let updateManyCalled = 0;
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async (args: { where: { status?: unknown } }) => {
      if (args.where.status === FinalVideoStatus.PENDING) {
        return [
          {
            id: "fv_fresh",
            status: FinalVideoStatus.PENDING,
            segmentCount: 1,
            createdAt: HOURS_AGO(1),
            brief: { id: "brief_5" },
            segments: [
              {
                status: VideoJobStatus.SUCCEEDED,
                /// 5 分钟前才完成，远未到 45 分钟等待超时
                finishedAt: new Date(NOW.getTime() - 5 * 60_000),
              },
            ],
          },
        ];
      }
      return [];
    }) as never,
    updateMany: (async () => {
      updateManyCalled++;
      return { count: 1 };
    }) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.equal(result.failedAwaitingStitch.length, 0);
  assert.equal(updateManyCalled, 0);
});

test("sweep：还有段没完成的 PENDING → 不动（不属于孤儿）", async (t) => {
  patchEmptyDefaults(t);

  let updateManyCalled = 0;
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: (async (args: { where: { status?: unknown } }) => {
      if (args.where.status === FinalVideoStatus.PENDING) {
        return [
          {
            id: "fv_generating",
            status: FinalVideoStatus.PENDING,
            segmentCount: 2,
            createdAt: HOURS_AGO(3),
            brief: { id: "brief_6" },
            segments: [
              { status: VideoJobStatus.SUCCEEDED, finishedAt: HOURS_AGO(2) },
              { status: VideoJobStatus.RUNNING, finishedAt: null },
            ],
          },
        ];
      }
      return [];
    }) as never,
    updateMany: (async () => {
      updateManyCalled++;
      return { count: 1 };
    }) as never,
  });

  const result = await sweepStuckTasks(NOW);
  assert.equal(result.failedAwaitingStitch.length, 0);
  assert.equal(updateManyCalled, 0);
});

/// ---------- 清扫文案全部是人话 ----------

test("sweep：所有用户可见文案不含内部术语", async () => {
  const { containsBannedPersonalTerm } = await import(
    "../src/lib/video-generation/personal-status"
  );
  for (const text of [
    sweepTest.JOB_TIMEOUT_USER_ERROR,
    sweepTest.STITCH_TIMEOUT_ERROR,
    sweepTest.AWAIT_STITCH_TIMEOUT_ERROR,
    sweepTest.BRIEF_STITCH_FAILED_MESSAGE,
  ]) {
    assert.equal(containsBannedPersonalTerm(text), false, text);
  }
});
