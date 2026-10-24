import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { batchFailureWhere, orderFailureWhere } from "../src/lib/services/exchange-readings";
import { syncBriefStatus } from "../src/lib/services/video-service";

/**
 * runtime LENS-4：「看过了」要真的清掉。徽标、「需要处理」与 failed7d 按「失败那一刻」
 *（finishedAt）计时，不按 updatedAt——返还打标、刷新状态这些与失败无关的写入
 * 会刷新 updatedAt，让已确认的失败重新冒出来、7 天窗口重新起算。
 *
 * 用一个小 where 解释器在内存行上真正执行计数用的同一份查询条件；不连数据库。
 */

type Row = Record<string, unknown>;

function scalar(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function matchField(value: unknown, cond: unknown): boolean {
  const isNull = value === null || value === undefined;
  if (cond === null) return isNull;
  if (cond instanceof Date || typeof cond !== "object") return !isNull && scalar(value) === scalar(cond);
  return Object.entries(cond as Row).every(([op, operand]) => {
    if (operand === undefined) return true;
    switch (op) {
      case "in":
        return !isNull && (operand as unknown[]).includes(value);
      case "not":
        return operand === null ? !isNull : !isNull && scalar(value) !== scalar(operand);
      case "gte":
        return !isNull && (scalar(value) as number) >= (scalar(operand) as number);
      case "lt":
        return !isNull && (scalar(value) as number) < (scalar(operand) as number);
      default:
        throw new Error(`解释器不支持算子 ${op}`);
    }
  });
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((c) => matches(row, c as Row));
    if (key === "NOT") {
      return Array.isArray(cond) ? cond.every((c) => !matches(row, c as Row)) : !matches(row, cond as Row);
    }
    if (key === "batchJob" || key === "contentAngle") {
      /// 归属过滤：测试行都属于同一个用户
      return true;
    }
    if (key === "videoJobs") {
      const jobs = (row.videoJobs as Row[] | undefined) ?? [];
      const c = cond as { some?: Row; none?: Row; every?: Row };
      if (c.some && !jobs.some((job) => matches(job, c.some!))) return false;
      if (c.none && jobs.some((job) => matches(job, c.none!))) return false;
      if (c.every && !jobs.every((job) => matches(job, c.every!))) return false;
      return true;
    }
    if (key === "finalVideo") {
      const finalVideo = row.finalVideo as Row | null | undefined;
      return !!finalVideo && matches(finalVideo, (cond as { is: Row }).is);
    }
    return matchField(row[key], cond);
  });
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
/// 用户 6 小时前点了「看过了」
const ACKED_AT = at(6);
const since = { gte: ACKED_AT };

test("runtime LENS-4：批量失败按 finishedAt 计时——看过之后的返还打标不让它重新冒出来", () => {
  const where = batchFailureWhere("user-1", since) as Row;
  const failedThenStamped = {
    status: VideoJobStatus.FAILED,
    finishedAt: at(8),
    /// 清扫器的按条返还在看过之后才打标，刷新了 updatedAt
    updatedAt: at(1),
  };
  assert.equal(matches(failedThenStamped, where), false, "已确认的失败不再计入徽标");

  const retriedAndFailedAgain = { status: VideoJobStatus.FAILED, finishedAt: at(2), updatedAt: at(2) };
  assert.equal(matches(retriedAndFailedAgain, where), true, "看过之后的新失败照常计入");

  const legacyNoFinishedAt = { status: VideoJobStatus.FAILED, finishedAt: null, updatedAt: at(2) };
  assert.equal(matches(legacyNoFinishedAt, where), true, "旧数据没有 finishedAt 才退回 updatedAt");

  /// 7 天窗口同理：8 天前失败、昨天才被打标的行不算近 7 天失败
  const week = batchFailureWhere("user-1", { gte: new Date(NOW.getTime() - 7 * DAY) }) as Row;
  assert.equal(matches({ status: VideoJobStatus.FAILED, finishedAt: at(8 * 24), updatedAt: at(24) }, week), false);
});

function failedBrief(overrides: Row = {}): Row {
  return {
    id: "brief-1",
    status: VideoBriefStatus.RENDER_FAILED,
    takedownAt: null,
    finalVideoId: "fv-1",
    finalVideo: { status: "PENDING", finishedAt: null, updatedAt: at(8) },
    videoJobs: [
      { status: VideoJobStatus.FAILED, finishedAt: at(8), updatedAt: at(8) },
      { status: VideoJobStatus.SUCCEEDED, finishedAt: at(9), updatedAt: at(9) },
    ],
    updatedAt: at(8),
    ...overrides,
  };
}

test("runtime LENS-4：单条订单失败按失败分段 / 成片的 finishedAt 计时，刷新状态与返还打标不算新失败", () => {
  const where = orderFailureWhere("user-1", since) as Row;

  assert.equal(matches(failedBrief(), where), false, "看过之前的失败");
  assert.equal(
    matches(failedBrief({ updatedAt: at(1) }), where),
    false,
    "「刷新状态」或返还打标刷新了 brief.updatedAt，仍是看过的那次失败",
  );

  const failedAgain = failedBrief({
    videoJobs: [
      { status: VideoJobStatus.FAILED, finishedAt: at(1), updatedAt: at(1) },
      { status: VideoJobStatus.SUCCEEDED, finishedAt: at(9), updatedAt: at(9) },
    ],
    updatedAt: at(1),
  });
  assert.equal(matches(failedAgain, where), true, "看过之后重试又失败：照常计入");

  const stitchFailed = failedBrief({
    finalVideo: { status: "FAILED", finishedAt: at(1), updatedAt: at(1) },
    videoJobs: [{ status: VideoJobStatus.SUCCEEDED, finishedAt: at(9), updatedAt: at(9) }],
  });
  assert.equal(matches(stitchFailed, where), true, "合成失败按成片的 finishedAt");

  /// 无任务 brief（派发中途中断）没有任何失败时间戳：退回 brief 自己的 updatedAt
  const jobless = { ...failedBrief({ finalVideoId: null, finalVideo: null, videoJobs: [] }) };
  assert.equal(matches({ ...jobless, updatedAt: at(1) }, where), true);
  assert.equal(matches({ ...jobless, updatedAt: at(8) }, where), false);
});

function stubBrief(t: TestContext, brief: Row, jobs: Row[]) {
  const writes: Row[] = [];
  const briefModel = db.videoBrief as unknown as Record<string, unknown>;
  const jobModel = db.videoJob as unknown as Record<string, unknown>;
  const originals = {
    findUnique: briefModel.findUnique,
    update: briefModel.update,
    findMany: jobModel.findMany,
  };
  briefModel.findUnique = async () => ({ ...brief });
  briefModel.update = async (args: { data: Row }) => {
    writes.push(args.data);
    Object.assign(brief, args.data);
    return { ...brief };
  };
  jobModel.findMany = async () => jobs.map((job) => ({ ...job }));
  t.after(() => {
    briefModel.findUnique = originals.findUnique;
    briefModel.update = originals.update;
    jobModel.findMany = originals.findMany;
  });
  return writes;
}

test("runtime LENS-4：失败已落定时「刷新状态」不再写 brief（不刷新 updatedAt）；原因变了才写", async (t) => {
  const failedJob = {
    id: "seg-0",
    status: VideoJobStatus.FAILED,
    userSafeError: "视频生成失败，请稍后重试。",
    errorMessage: "[provider:failed] boom",
  };
  const brief = {
    id: "brief-1",
    finalVideoId: "fv-1",
    status: VideoBriefStatus.RENDER_FAILED,
    errorMessage: "视频生成失败，请稍后重试。",
  };
  const writes = stubBrief(t, brief, [failedJob]);

  await syncBriefStatus("brief-1");
  assert.equal(writes.length, 0, "同一个失败不重复写");

  failedJob.userSafeError = "画面质检未通过（检测到异常文字），已自动拦截。点击「重试」可重新生成本段。";
  await syncBriefStatus("brief-1");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, VideoBriefStatus.RENDER_FAILED);
  assert.equal(writes[0].errorMessage, failedJob.userSafeError);
});
