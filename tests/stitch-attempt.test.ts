/**
 * C3：进程内 / 本地合成的一次尝试 —— 结果只经唯一成功写入点 finishStitchTask 写回。
 *
 *   - 合成成功 → finishStitchTask（READY + 成片 / 缩略图 / 字幕 → brief QA_PENDING + finalThumbnailUrl）
 *   - 合成失败 → finishStitchTask({ error })（FAILED，attempts++）
 *   - 预算不够 → requeueStitchAttempt（放回 PENDING，attempts+1；到上限转 FAILED）
 *   - 被取消 / 收回 → 什么都不写（铁律 #7：可取消、素材保留）
 *   - 成功写入抛错（审核拒绝 / 审核不可用）→ 记失败，不让行卡在 STITCHING 等清扫
 *
 * 合成器以依赖注入替身代替；Prisma 方法 monkey-patch，不连数据库。
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  StitchBudgetExceededError,
  StitchCompositionError,
} from "../src/lib/media/stitch-pipeline";
import {
  finishStitchTask,
  MAX_STITCH_ATTEMPTS,
  requeueStitchAttempt,
  runClaimedStitchAttempt,
  StitchAttemptLostError,
  stitchFailureMessage,
  stitchOwnershipCheckpoint,
  type StitchResult,
} from "../src/lib/services/stitch-service";

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

const okCheckpoint = async () => {};
const urls = {
  stitchedVideoUrl: "https://blob.example.com/final-videos/fv/1.mp4",
  thumbnailUrl: "https://blob.example.com/final-videos/fv/1.jpg",
  subtitleFileUrl: "https://blob.example.com/final-videos/fv/1.srt",
};

function recordingFinish(result: Partial<StitchResult> = {}) {
  const calls: Array<Parameters<typeof finishStitchTask>[0]> = [];
  const finish = (async (args: Parameters<typeof finishStitchTask>[0]) => {
    calls.push(args);
    return {
      finalVideoId: args.finalVideoId,
      ok: !args.error,
      status: args.error ? FinalVideoStatus.FAILED : FinalVideoStatus.READY,
      ...result,
    } satisfies StitchResult;
  }) as typeof finishStitchTask;
  return { calls, finish };
}

test("成功：合成产物（成片 + 缩略图 + 字幕）只经 finishStitchTask 写回", async () => {
  const { calls, finish } = recordingFinish();
  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_ok",
    attemptToken: "tok_ok",
    checkpoint: okCheckpoint,
    compose: async () => urls,
    finish,
    requeue: async () => {
      throw new Error("must not requeue");
    },
  });
  assert.equal(outcome.kind, "succeeded");
  assert.deepEqual(calls, [{ finalVideoId: "fv_ok", attemptToken: "tok_ok", ...urls }]);
});

test("合成失败：稳定机器码落 FAILED（经同一写入点），不带 URL", async () => {
  const { calls, finish } = recordingFinish();
  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_fail",
    attemptToken: "tok_fail",
    checkpoint: okCheckpoint,
    compose: async () => {
      throw new StitchCompositionError("CAPTION_FONT_MISSING", "bundled CJK caption font is missing");
    },
    finish,
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.error ?? "", /^CAPTION_FONT_MISSING:/);
  assert.equal(calls[0]?.stitchedVideoUrl, undefined);
});

test("预算不够：放回 PENDING（不判失败），不写成片", async () => {
  const { calls, finish } = recordingFinish();
  const requeues: Array<{ reason: string }> = [];
  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_budget",
    attemptToken: "tok_budget",
    checkpoint: okCheckpoint,
    compose: async () => {
      throw new StitchBudgetExceededError("encode");
    },
    finish,
    requeue: async (args) => {
      requeues.push({ reason: args.reason });
      return { outcome: "requeued" };
    },
  });
  assert.equal(outcome.kind, "requeued");
  assert.equal(outcome.result.status, FinalVideoStatus.PENDING);
  assert.equal(calls.length, 0);
  assert.match(requeues[0]?.reason ?? "", /STITCH_TIME_BUDGET_EXCEEDED at encode/);
});

test("任务被取消 / 清扫收回：立刻停手，什么都不写", async () => {
  const { calls, finish } = recordingFinish();
  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_lost",
    attemptToken: "tok_lost",
    checkpoint: okCheckpoint,
    compose: async () => {
      throw new StitchAttemptLostError("fv_lost");
    },
    finish,
    requeue: async () => {
      throw new Error("must not requeue");
    },
  });
  assert.equal(outcome.kind, "lost");
  assert.equal(calls.length, 0);
});

test("成功写入抛错（审核拒绝 / 审核不可用）→ 记失败，不让行卡在 STITCHING", async () => {
  const calls: Array<Parameters<typeof finishStitchTask>[0]> = [];
  const finish = (async (args: Parameters<typeof finishStitchTask>[0]) => {
    calls.push(args);
    if (!args.error) throw new Error("内容审核未通过（generated_video）：violence");
    return { finalVideoId: args.finalVideoId, ok: false, status: FinalVideoStatus.FAILED };
  }) as typeof finishStitchTask;
  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_review",
    attemptToken: "tok_review",
    checkpoint: okCheckpoint,
    compose: async () => urls,
    finish,
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.error ?? "", /^completion_failed: /);
});

test("stitchFailureMessage：剥掉 URL（签名参数不进库字段）", () => {
  const message = stitchFailureMessage(
    new Error("下载段失败 https://ark.example.com/a.mp4?X-Tos-Signature=secret 403"),
  );
  assert.doesNotMatch(message, /X-Tos-Signature|secret|https?:\/\//);
  assert.match(message, /<url>/);
});

test("所有权检查点：行已不是 STITCHING + 本 token（客户取消 / 清扫收回）→ StitchAttemptLostError", async (t) => {
  let owned = 1;
  const queries: Array<Record<string, unknown>> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    count: async (args: { where: Record<string, unknown> }) => {
      queries.push(args.where);
      return owned;
    },
  });
  const checkpoint = stitchOwnershipCheckpoint("fv_owned", "tok_owned");
  await checkpoint();
  assert.deepEqual(queries[0], {
    id: "fv_owned",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_owned",
  });
  owned = 0;
  await assert.rejects(checkpoint, StitchAttemptLostError);
});

test("requeueStitchAttempt：未到上限 → CAS 放回 PENDING（attempts+1、清 token、startedAt=重新排队时刻）", async (t) => {
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => ({ status: FinalVideoStatus.STITCHING, stitchAttemptToken: "tok_rq", stitchAttempts: 0 }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      return { count: 1 };
    },
  });
  const now = new Date("2026-10-25T12:00:00Z");
  const result = await requeueStitchAttempt({ finalVideoId: "fv_rq", attemptToken: "tok_rq", reason: "STITCH_TIME_BUDGET_EXCEEDED at encode", now });
  assert.deepEqual(result, { outcome: "requeued" });
  assert.deepEqual(writes[0]?.where, { id: "fv_rq", status: FinalVideoStatus.STITCHING, stitchAttemptToken: "tok_rq" });
  assert.equal(writes[0]?.data.status, FinalVideoStatus.PENDING);
  assert.equal(writes[0]?.data.stitchAttempts, 1);
  assert.equal(writes[0]?.data.stitchAttemptToken, null);
  assert.equal(writes[0]?.data.startedAt, now);
  assert.match(String(writes[0]?.data.ffmpegError), /requeued \(attempt 1\/3\)/);
});

test("requeueStitchAttempt：到上限 → 经 finishStitchTask 落 FAILED；token 已失效 → stale 不写", async (t) => {
  let row: Record<string, unknown> = {
    id: "fv_rq_max",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_max",
    stitchAttempts: MAX_STITCH_ATTEMPTS - 1,
    thumbnailUrl: null,
    brief: null,
  };
  const writes: Array<Record<string, unknown>> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => row,
    updateMany: async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return { count: 1 };
    },
  });
  const exhausted = await requeueStitchAttempt({ finalVideoId: "fv_rq_max", attemptToken: "tok_max", reason: "budget" });
  assert.deepEqual(exhausted, { outcome: "failed" });
  assert.equal(writes[0]?.status, FinalVideoStatus.FAILED);
  assert.deepEqual(writes[0]?.stitchAttempts, { increment: 1 });
  assert.match(String(writes[0]?.ffmpegError), /gave up after 3 attempts/);

  row = { ...row, stitchAttemptToken: "someone-else" };
  writes.length = 0;
  const stale = await requeueStitchAttempt({ finalVideoId: "fv_rq_max", attemptToken: "tok_max", reason: "budget" });
  assert.deepEqual(stale, { outcome: "stale" });
  assert.equal(writes.length, 0);
});

test("唯一成功写入点：缩略图同时写进 FinalVideo.thumbnailUrl 与 brief.finalThumbnailUrl", async (t) => {
  const row: Record<string, unknown> = {
    id: "fv_writer",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_writer",
    stitchAttempts: 0,
    thumbnailUrl: null,
    stitchedVideoUrl: null,
    brief: { id: "brief_writer" },
  };
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => row,
    updateMany: async (args: { data: Record<string, unknown> }) => {
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
  const briefWrites: Array<Record<string, unknown>> = [];
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    findUnique: async () => ({ finalVideoId: "fv_writer", finalVideo: row }),
    update: async (args: { data: Record<string, unknown> }) => {
      briefWrites.push(args.data);
      return {};
    },
  });
  patchModel(t, db.qAReview as unknown as Record<string, unknown>, {
    findFirst: async () => null,
    create: async () => ({}),
  });

  const outcome = await runClaimedStitchAttempt({
    finalVideoId: "fv_writer",
    attemptToken: "tok_writer",
    checkpoint: okCheckpoint,
    compose: async () => urls,
  });
  assert.equal(outcome.kind, "succeeded");
  assert.equal(row.status, FinalVideoStatus.READY);
  assert.equal(row.thumbnailUrl, urls.thumbnailUrl);
  assert.equal(row.subtitleFileUrl, urls.subtitleFileUrl);
  assert.equal(briefWrites[0]?.status, VideoBriefStatus.QA_PENDING);
  assert.equal(briefWrites[0]?.finalVideoUrl, urls.stitchedVideoUrl);
  assert.equal(briefWrites[0]?.finalThumbnailUrl, urls.thumbnailUrl);
});
