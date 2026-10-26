import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  FinalVideoStatus,
  Prisma,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { readDirectorPlanVoiceoverChunks } from "@/lib/schemas/director-plan";
import { postProductionPlanSchema } from "@/lib/schemas/unified-input";
import type { PostProductionPlan } from "@/types/video-generation";
import {
  canRestitchBriefStatus,
  isDeliveredBriefStatus,
  isPreDeliveryBriefStatus,
} from "@/lib/video-generation/brief-delivery-state";
import {
  newPendingFinalFrameQa,
  pendingFinalFrameQaMark,
  readFinalFrameQaMark,
} from "@/lib/video-generation/final-frame-qa-mark";
import { mergeFinalFrameQaReview } from "@/lib/services/qa-review-merge";
import { writeQaReview } from "@/lib/services/qa-review-write";
import { isEphemeralSignedUrl } from "@/lib/media/ephemeral-url";

/// 原本定义在这里；抽成轻模块后原样再导出，调用方（scripts / tests）不用改。
export { isEphemeralSignedUrl };
import {
  mergeRestitchPatch,
  parseRestitchPatch,
  RestitchRejectedError,
  restitchPatchIsNoop,
} from "@/lib/video-generation/restitch-patch";
import type { BrollClaimSegment } from "@/lib/video-generation/broll-segment-compose";
import {
  composeTimeline,
  resolveAspectResolution,
  stepTimeout,
  StitchBudgetExceededError,
  StitchCompositionError,
  type MediaBudget,
  type TimelineClip,
  type TimelineClipReport,
  type TimelineClipRole,
} from "@/lib/media/stitch-pipeline";
import {
  resolveStitchRuntimeMode,
  type StitchRuntimeMode,
} from "@/lib/media/stitch-runtime";

/**
 * Stitch Service —— 多段成片的状态机 + 唯一的成功写入点。
 *
 * C3（2026-10-25）：生产只有一套合成实现 —— 应用内合成器（本文件 + stitch-composer +
 * src/lib/media/stitch-pipeline），跑在专用 Vercel 函数里（/api/cron/stitch-dispatch）。
 *
 *   运行模式（src/lib/media/stitch-runtime.ts）：
 *     inprocess（生产默认）—— 用户请求 / poll-videos 里只把 FinalVideo 留在 PENDING（就绪），
 *                不写库、不跑 ffmpeg；stitch-dispatch cron 用 claim 同一套 CAS 认领后进程内合成。
 *     external（回滚）    —— 与改造前完全一致：写「awaiting external stitcher」占位，
 *                由 GitHub Actions runner（scripts/stitch-runner.ts）经 internal API 认领。
 *     local（开发）       —— 在触发它的请求里直接认领 + 合成（与 inprocess 同一合成器）。
 *
 *   entrypoint：
 *     1) stitchFinalVideo(id)         —— 按模式决定：占位 / 留 PENDING / 内联合成
 *     2) claimStitchTask()            —— 外部 runner 认领（CAS PENDING→STITCHING + attemptToken）
 *        claimNextReadyFinalVideo()   —— 同一个 CAS，进程内合成器用（可按剩余预算挑任务）
 *     3) finishStitchTask(...)        —— 唯一成功写入点：审核 → READY + 成片 / 缩略图 / 字幕
 *                                        → brief QA_PENDING（markBriefReady）。runner 回调与
 *                                        进程内合成都走这里，失败同样在这里落 FAILED。
 *     4) runClaimedStitchAttempt(...) —— 进程内 / 本地：合成 → finishStitchTask；预算不够
 *                                        → 放回 PENDING；任务被取消 / 收回 → 不写任何东西。
 *     5) restitchReadyFinalVideo(...)  —— P05-B 只重拼：READY 成片换字幕样式 / 配乐，
 *                                        CAS READY → PENDING 并把旧成片 URL 存进
 *                                        previousStitchedVideoUrl，再走同一套合成器。
 *        rollbackRestitch(...)         —— 只重拼的统一回滚出口：失败 / 清扫超时 / 取消都回到
 *                                        READY + 旧成片，不改 brief；四处调用见函数注释。
 *
 *   失败处理：拼接失败累计 stitchAttempts；>=3 不再自动重试，UI 暴露重试按钮。
 *   函数被平台杀掉 → 行停在 STITCHING → sweep-service 超时后转回 PENDING 续跑。
 *   只重拼（previousStitchedVideoUrl 非空）的失败一律回滚到旧片，永远不落 FAILED。
 */

export const MAX_STITCH_ATTEMPTS = 3;
export const STALE_STITCH_ATTEMPT_CODE = "STALE_STITCH_ATTEMPT";
export const STITCH_ATTEMPT_LOST_CODE = "STITCH_ATTEMPT_LOST";
export const STITCH_CANDIDATE_PAGE_SIZE = 20;
const AWAITING_EXTERNAL_STITCHER = "awaiting external stitcher";

type StitchReadinessCandidate = {
  segmentCount: number;
  segments: ReadonlyArray<{
    status: VideoJobStatus;
    outputVideoUrl: string | null;
  }>;
};

/**
 * Readiness remains an application-level invariant because Prisma cannot
 * compare the relation count with FinalVideo.segmentCount in a where clause.
 * Callers should still pre-filter obviously incomplete segments in SQL, then
 * use this exact-count check before claiming or dispatching work.
 */
export function isStitchCandidateReady(
  candidate: StitchReadinessCandidate,
): boolean {
  return (
    candidate.segments.length === candidate.segmentCount &&
    candidate.segments.every(
      (segment) =>
        segment.status === VideoJobStatus.SUCCEEDED &&
        Boolean(segment.outputVideoUrl),
    )
  );
}

export interface StitchResult {
  finalVideoId: string;
  ok: boolean;
  status: FinalVideoStatus;
  stitchedVideoUrl?: string | null;
  subtitleFileUrl?: string | null;
  error?: string | null;
  skipped?: boolean;
  /// 外部 runner 的 attempt token 已过期；调用方应返回 HTTP 409，不得重放写入。
  conflict?: boolean;
  /// external 模式：已记录占位，等 GH Action 拉
  awaitingExternal?: boolean;
  /// inprocess 模式：已就绪留在 PENDING，等 stitch-dispatch 函数认领合成
  awaitingInprocess?: boolean;
  /// 只重拼失败：已回滚到旧成片（status 回 READY，stitchedVideoUrl 为旧 URL）
  rolledBack?: boolean;
}

export interface ClaimedStitchTask {
  finalVideoId: string;
  attemptToken: string;
  segmentUrls: string[];
  aspectRatio: string;
  targetDurationSec: number;
  postProduction: PostProductionPlan | null;
  /// b-roll 任务附带：runner 需要先「素材+TTS→段合成」再进拼接后期。
  /// null/缺省 = 普通任务（段已是成品视频）。
  brollSegments?: BrollClaimSegment[] | null;
  /// P04-C：派发时持久化的各段台词（stitchTaskPayload 从 brief.directorPlan 读）；缺省 = runner 按段时长切字幕。
  /// 与 scripts/stitch-runner.ts 的 StitchTask 同形。
  voiceoverChunks?: string[] | null;
}

/**
 * 从段任务的 assignedAssets 提取 b-roll 输入（全部段都带 broll 标记才算
 * b-roll 任务；混合形态不存在——startBrollDelivery 整链同源写入）。
 */
export function extractBrollClaimSegments(
  segments: Array<{
    segmentIndex: number | null;
    outputVideoUrl: string | null;
    assignedAssets: unknown;
  }>,
): BrollClaimSegment[] | null {
  if (segments.length === 0) return null;
  const out: BrollClaimSegment[] = [];
  for (const [index, segment] of segments.entries()) {
    const assets = segment.assignedAssets;
    const broll =
      assets && typeof assets === "object"
        ? (assets as { broll?: { ttsAudioUrl?: unknown } }).broll
        : null;
    const ttsAudioUrl =
      broll && typeof broll === "object" && typeof broll.ttsAudioUrl === "string"
        ? broll.ttsAudioUrl
        : null;
    if (!ttsAudioUrl || !segment.outputVideoUrl) return null;
    out.push({
      segmentIndex: segment.segmentIndex ?? index,
      clipUrl: segment.outputVideoUrl,
      ttsAudioUrl,
    });
  }
  return out;
}

/**
 * runner 任务载荷（纯映射，不写库）：生产认领 claimStitchTask 与运维重烧字幕
 * （scripts/ops/reburn-final-video-captions.ts）共用这一份，两边合成输入不会漂移。
 * 段须按 segmentIndex 升序传入。
 */
export function stitchTaskPayload(fv: {
  targetDurationSec: number;
  postProduction: unknown;
  brief: { aspectRatio: string | null; directorPlan?: unknown } | null;
  segments: Array<{ segmentIndex: number | null; outputVideoUrl: string | null; assignedAssets: unknown }>;
}) {
  /// P04-C：派发时持久化的各段台词（查询没带 directorPlan / 旧计划没有 → 不带，runner 按段时长切）
  const voiceoverChunks = readDirectorPlanVoiceoverChunks(fv.brief?.directorPlan);
  return {
    segmentUrls: fv.segments.map((s) => s.outputVideoUrl as string),
    aspectRatio: fv.brief?.aspectRatio ?? "9:16",
    targetDurationSec: fv.targetDurationSec,
    postProduction: parsePersistedPostProduction(fv.postProduction),
    brollSegments: extractBrollClaimSegments(fv.segments),
    ...(voiceoverChunks ? { voiceoverChunks } : {}),
  };
}

export function parsePersistedPostProduction(
  input: unknown,
): PostProductionPlan | null {
  if (input == null) return null;
  const parsed = postProductionPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("FinalVideo contains an invalid post-production snapshot");
  }
  return parsed.data;
}

/**
 * 拾取并处理所有 ready-to-stitch 的 FinalVideo（遗留 stitch-videos cron，仅 local 模式调用）。
 */
export async function processPendingFinalVideos(limit = 5): Promise<{
  scanned: number;
  stitched: number;
  failed: number;
  skipped: number;
  awaiting: number;
}> {
  const candidates = await db.finalVideo.findMany({
    where: {
      status: FinalVideoStatus.PENDING,
      stitchAttempts: { lt: MAX_STITCH_ATTEMPTS },
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  let stitched = 0;
  let failed = 0;
  let skipped = 0;
  let awaiting = 0;
  for (const fv of candidates) {
    const result = await stitchFinalVideo(fv.id);
    if (result.awaitingExternal || result.awaitingInprocess) awaiting++;
    else if (result.skipped) skipped++;
    else if (result.ok) stitched++;
    else failed++;
  }
  return { scanned: candidates.length, stitched, failed, skipped, awaiting };
}

export type StitchDecision =
  /// external（或演示模式下的 b-roll）：写占位，等外部 runner 认领
  | "await_external"
  /// inprocess：什么都不写，留 PENDING 等 stitch-dispatch 函数认领
  | "await_inprocess"
  /// legacy 单段 + 持久 URL：直接复用首段（external / local 的旧捷径，保持不变）
  | "reuse_single_segment"
  /// ENABLE_VIDEO_STITCHING=false 演示模式：复用首段 URL
  | "reuse_first_segment_demo"
  /// local：在本请求里认领 + 合成
  | "compose_inline";

/**
 * 纯决策：一条就绪的 FinalVideo 在当前运行模式下怎么推进。
 * external / local 的分支顺序与改造前逐条一致（回滚 = 原样）；inprocess 一律不内联合成。
 */
export function decideStitchPath(args: {
  mode: StitchRuntimeMode;
  isBroll: boolean;
  isUnified: boolean;
  segmentCount: number;
  firstSegmentUrl: string | null;
  demo: boolean;
}): StitchDecision {
  if (args.isBroll) {
    /// b-roll 段是「素材 + TTS 输入」而非成品视频，必须先合成 ——
    /// 绝不能落进单段捷径/演示捷径（把图库原片直接当成片交付）。
    if (args.mode === "external" || args.demo) return "await_external";
    return args.mode === "inprocess" ? "await_inprocess" : "compose_inline";
  }
  if (args.isUnified) {
    if (args.mode === "external") return "await_external";
    return args.mode === "inprocess" ? "await_inprocess" : "compose_inline";
  }
  if (args.mode === "inprocess") {
    /// 生产：单段也走合成器（语音安全裁尾杀假名片 + 成片缩略图 + 转存持久存储）
    return args.demo ? "reuse_first_segment_demo" : "await_inprocess";
  }
  /// 单段：直接复用首段 URL。临时签名 URL（Seedance TOS 24h 过期）除外 ——
  /// 过期后 403，用户视角等于视频丢失；这类必须走真实 stitch 转存持久存储。
  if (
    args.segmentCount === 1 &&
    args.firstSegmentUrl &&
    !isEphemeralSignedUrl(args.firstSegmentUrl)
  ) {
    return "reuse_single_segment";
  }
  if (args.demo) return "reuse_first_segment_demo";
  return args.mode === "external" ? "await_external" : "compose_inline";
}

/**
 * 拼接一个 FinalVideo：状态机入口（reconcile / poll-videos / 重试 / 本地 cron 都调这里）。
 */
export async function stitchFinalVideo(
  finalVideoId: string,
): Promise<StitchResult> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: { select: { id: true } },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });
  if (!fv) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "FinalVideo 不存在",
    };
  }

  if (fv.status !== FinalVideoStatus.PENDING) {
    return { finalVideoId, ok: false, status: fv.status, skipped: true };
  }

  /// 段必须齐 + 全 SUCCEEDED，否则跳过（等下一轮 cron）
  const allSucceeded =
    fv.segments.length === fv.segmentCount &&
    fv.segments.every(
      (s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl,
    );
  if (!allSucceeded) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.PENDING,
      skipped: true,
    };
  }

  const mode = stitchRuntimeMode();
  const isBroll = extractBrollClaimSegments(fv.segments) !== null;
  /// 只有 b-roll 之外才需要查 unified plan（与改造前的判定顺序一致）
  const isUnified = !isBroll && (await briefHasUnifiedAssembly(fv.brief?.id));
  const decision = decideStitchPath({
    mode,
    isBroll,
    isUnified,
    segmentCount: fv.segmentCount,
    firstSegmentUrl: fv.segments[0]?.outputVideoUrl ?? null,
    demo: process.env.ENABLE_VIDEO_STITCHING === "false",
  });

  switch (decision) {
    case "await_inprocess":
      return {
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.PENDING,
        awaitingInprocess: true,
      };
    case "await_external":
      await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.PENDING },
        data: { ffmpegError: AWAITING_EXTERNAL_STITCHER },
      });
      return {
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.PENDING,
        awaitingExternal: true,
        error: AWAITING_EXTERNAL_STITCHER,
      };
    case "reuse_single_segment":
    case "reuse_first_segment_demo": {
      const first = fv.segments[0];
      await reviewGeneratedVideo(
        first.outputVideoUrl as string,
        first.outputThumbUrl,
        finalVideoId,
      );
      await db.finalVideo.update({
        where: { id: fv.id },
        data: {
          status: FinalVideoStatus.READY,
          stitchedVideoUrl: first.outputVideoUrl,
          thumbnailUrl: first.outputThumbUrl,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
      if (fv.brief) await markBriefReady(fv.brief.id);
      return {
        finalVideoId,
        ok: true,
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: first.outputVideoUrl,
      };
    }
    case "compose_inline": {
      const attemptToken = await claimFinalVideoForStitch(fv.id);
      if (!attemptToken) {
        return { finalVideoId, ok: false, status: fv.status, skipped: true };
      }
      const outcome = await runClaimedStitchAttempt({ finalVideoId, attemptToken });
      return outcome.result;
    }
  }
}

/**
 * local 模式：对指定 FinalVideo 做与 claimStitchTask 同一个 CAS
 * （PENDING → STITCHING + attemptToken + startedAt）。抢不到返回 null。
 */
export async function claimFinalVideoForStitch(
  finalVideoId: string,
): Promise<string | null> {
  const attemptToken = randomUUID();
  const claim = await db.finalVideo.updateMany({
    where: { id: finalVideoId, status: FinalVideoStatus.PENDING },
    data: {
      status: FinalVideoStatus.STITCHING,
      stitchAttemptToken: attemptToken,
      startedAt: new Date(),
      ffmpegError: null,
    },
  });
  return claim.count > 0 ? attemptToken : null;
}

type StitchCandidateRow = {
  id: string;
  segmentCount: number;
  targetDurationSec: number;
  stitchAttempts: number;
  postProduction: unknown;
  brief: { aspectRatio: string | null; directorPlan?: unknown } | null;
  segments: Array<{
    segmentIndex: number | null;
    status: VideoJobStatus;
    outputVideoUrl: string | null;
    assignedAssets: unknown;
  }>;
};

/**
 * 认领核心（外部 runner 与进程内合成器共用同一个 CAS）：
 *   - 找 PENDING + 所有段 SUCCEEDED + stitchAttempts < MAX 的 FinalVideo（稳定分页，防饿死）
 *   - accept 返回 false 的候选跳过（进程内合成器按剩余预算挑「放得下」的任务）
 *   - prepare 在 CAS 之前计算载荷：载荷算不出来就不认领，不会留下认领了却没法合成的行
 *   - CAS PENDING → STITCHING + attemptToken + startedAt（防多个 worker 抢同一条）
 */
export async function claimNextReadyFinalVideo<T>(options: {
  prepare: (candidate: StitchCandidateRow) => T;
  accept?: (candidate: StitchCandidateRow) => boolean;
}): Promise<{ finalVideoId: string; attemptToken: string; prepared: T } | null> {
  let cursor: string | undefined;
  while (true) {
    const candidates = (await db.finalVideo.findMany({
      where: {
        status: FinalVideoStatus.PENDING,
        stitchAttempts: { lt: MAX_STITCH_ATTEMPTS },
        /// Exclude rows with a known non-ready segment at the database layer.
        /// A relation-count equality check is still required below for rows
        /// whose expected segment has not been created yet.
        segments: {
          every: {
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: { not: null },
          },
        },
      },
      take: STITCH_CANDIDATE_PAGE_SIZE,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        /// P04-C：带上 directorPlan，外部 runner 的载荷（stitchTaskPayload）才有各段台词 voiceoverChunks；
        /// 否则 runner 按段时长均分字幕——首次合成与只重拼（P05-B）都一样。进程内合成器自己从库里读。
        brief: { select: { aspectRatio: true, directorPlan: true } },
        segments: { orderBy: { segmentIndex: "asc" } },
      },
    })) as unknown as StitchCandidateRow[];

    for (const fv of candidates) {
      if (!isStitchCandidateReady(fv)) continue;
      if (options.accept && !options.accept(fv)) continue;
      /// 注意：不再跳过单段任务（历史 bug：带 unified assemblyPlan 的单段 brief 在
      /// 生产环境被 stitchFinalVideo 打上「awaiting external stitcher」占位 —— 该判定
      /// 先于单段捷径 —— 而这里又跳过 segmentCount<=1，导致没有任何 worker 认领，
      /// 任务永久卡在「正在合成 85%」）。单段走合成器会被归一化并转存持久存储，
      /// 顺带避免把 24h 过期的 Seedance 签名 URL 直接当成片 URL。
      const prepared = options.prepare(fv);

      /// CAS：从 PENDING → STITCHING；若已被别的 worker 抢走则继续找下一条
      const attemptToken = randomUUID();
      const claim = await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.PENDING },
        data: {
          status: FinalVideoStatus.STITCHING,
          stitchAttemptToken: attemptToken,
          startedAt: new Date(),
          ffmpegError: null,
        },
      });
      if (claim.count === 0) continue;

      return { finalVideoId: fv.id, attemptToken, prepared };
    }

    if (candidates.length < STITCH_CANDIDATE_PAGE_SIZE) break;
    const nextCursor = candidates.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return null;
}

/**
 * 外部 runner（GH Action）拉取一个就绪任务（返回段 URL 列表 + aspectRatio + 后期快照）。
 * 返回 null 表示当前没有可拼任务，runner 可以直接退出。
 */
export async function claimStitchTask(): Promise<ClaimedStitchTask | null> {
  const claimed = await claimNextReadyFinalVideo({
    prepare: (fv) => stitchTaskPayload(fv),
  });
  if (!claimed) return null;
  return {
    finalVideoId: claimed.finalVideoId,
    attemptToken: claimed.attemptToken,
    ...claimed.prepared,
  };
}

/**
 * 唯一的成功写入点（外部 runner 回调与进程内 / 本地合成共用）：
 *   - 成功：内容审核 → 写 stitchedVideoUrl + thumbnailUrl + subtitleFileUrl + status=READY
 *           → brief QA_PENDING + finalVideoUrl / finalThumbnailUrl（markBriefReady）
 *   - 失败：写 ffmpegError + status=FAILED（stitchAttempts++）
 *   - 两者都对 STITCHING + attemptToken 做 CAS：取消 / 清扫收回 / 重新认领之后的旧回调一律 409。
 */
export async function finishStitchTask(args: {
  finalVideoId: string;
  attemptToken?: string;
  stitchedVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  subtitleFileUrl?: string | null;
  error?: string | null;
}): Promise<StitchResult> {
  const {
    finalVideoId,
    attemptToken,
    stitchedVideoUrl,
    thumbnailUrl,
    subtitleFileUrl,
    error,
  } = args;
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: { brief: { select: { id: true } } },
  });
  if (!fv) {
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: "FinalVideo 不存在",
    };
  }

  /// attempt token 是这一次 STITCHING 的所有权凭证。
  /// 先快速拒绝明显 stale 回调；最终写入仍会再做一次 CAS，
  /// 防止内容审核期间 sweep/reclaim 导致的 TOCTOU 竞态。
  const expectedAttemptToken = attemptToken ?? null;
  if (
    fv.status !== FinalVideoStatus.STITCHING ||
    fv.stitchAttemptToken !== expectedAttemptToken
  ) {
    return staleStitchAttempt(finalVideoId, fv.status);
  }

  if (error || !stitchedVideoUrl) {
    const failure = error ?? "external stitcher returned no URL";
    /// P05-B：只重拼失败不落 FAILED——回滚到旧成片（READY + 旧 URL），brief 不动。
    if (fv.previousStitchedVideoUrl) {
      const rolled = await rollbackRestitch(finalVideoId, `restitch failed: ${failure}`, {
        status: [FinalVideoStatus.STITCHING],
        attemptToken: expectedAttemptToken,
      });
      if (!rolled.rolledBack) {
        return staleStitchAttempt(finalVideoId, fv.status);
      }
      return {
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.READY,
        stitchedVideoUrl: rolled.stitchedVideoUrl,
        error: failure,
        rolledBack: true,
      };
    }
    const finished = await db.finalVideo.updateMany({
      where: {
        id: fv.id,
        status: FinalVideoStatus.STITCHING,
        stitchAttemptToken: expectedAttemptToken,
      },
      data: {
        status: FinalVideoStatus.FAILED,
        ffmpegError: failure,
        finishedAt: new Date(),
        stitchAttempts: { increment: 1 },
        stitchAttemptToken: null,
      },
    });
    if (finished.count === 0) {
      return staleStitchAttempt(finalVideoId, fv.status);
    }
    return {
      finalVideoId,
      ok: false,
      status: FinalVideoStatus.FAILED,
      error: failure,
    };
  }

  await reviewGeneratedVideo(
    stitchedVideoUrl,
    thumbnailUrl ?? fv.thumbnailUrl,
    finalVideoId,
  );

  const finished = await db.finalVideo.updateMany({
    where: {
      id: fv.id,
      status: FinalVideoStatus.STITCHING,
      stitchAttemptToken: expectedAttemptToken,
    },
    data: {
      status: FinalVideoStatus.READY,
      stitchedVideoUrl,
      thumbnailUrl: thumbnailUrl ?? fv.thumbnailUrl,
      subtitleFileUrl: subtitleFileUrl ?? null,
      finishedAt: new Date(),
      stitchAttempts: { increment: 1 },
      ffmpegError: null,
      stitchAttemptToken: null,
      /// 只重拼成功：新片已就位，两份回滚依据都不再需要
      previousStitchedVideoUrl: null,
      previousPostProduction: Prisma.DbNull,
    },
  });
  if (finished.count === 0) {
    return staleStitchAttempt(finalVideoId, fv.status);
  }
  if (fv.brief) await markBriefReady(fv.brief.id);
  return {
    finalVideoId,
    ok: true,
    status: FinalVideoStatus.READY,
    stitchedVideoUrl,
    subtitleFileUrl: subtitleFileUrl ?? null,
  };
}

function staleStitchAttempt(
  finalVideoId: string,
  status: FinalVideoStatus,
): StitchResult {
  return {
    finalVideoId,
    ok: false,
    status,
    conflict: true,
    error: STALE_STITCH_ATTEMPT_CODE,
  };
}

/** 任务在合成途中被取消 / 被清扫器收回 / 被重新认领：立刻停手，不写任何东西。 */
export class StitchAttemptLostError extends Error {
  readonly code = STITCH_ATTEMPT_LOST_CODE;
  constructor(readonly finalVideoId: string) {
    super(`${STITCH_ATTEMPT_LOST_CODE}: ${finalVideoId} is no longer owned by this attempt`);
    this.name = "StitchAttemptLostError";
  }
}

/**
 * 合成途中的所有权检查点（每个重步骤之前调用）：行已不是 STITCHING + 本 token
 * （客户取消 → FAILED、清扫超时 → PENDING、重试重新认领）就中止。铁律 #7：每轮任务可取消。
 */
export function stitchOwnershipCheckpoint(
  finalVideoId: string,
  attemptToken: string,
): () => Promise<void> {
  return async () => {
    const owned = await db.finalVideo.count({
      where: {
        id: finalVideoId,
        status: FinalVideoStatus.STITCHING,
        stitchAttemptToken: attemptToken,
      },
    });
    if (owned === 0) throw new StitchAttemptLostError(finalVideoId);
  };
}

/**
 * 预算耗尽时把本次认领放回 PENDING（stitchAttempts+1，与清扫器同语义）；
 * 达上限转 FAILED（经 finishStitchTask，与其它失败同一写入点）。
 */
export async function requeueStitchAttempt(args: {
  finalVideoId: string;
  attemptToken: string;
  reason: string;
  now?: Date;
}): Promise<{ outcome: "requeued" | "failed" | "stale" }> {
  const now = args.now ?? new Date();
  const fv = await db.finalVideo.findUnique({
    where: { id: args.finalVideoId },
    select: { status: true, stitchAttemptToken: true, stitchAttempts: true },
  });
  if (
    !fv ||
    fv.status !== FinalVideoStatus.STITCHING ||
    fv.stitchAttemptToken !== args.attemptToken
  ) {
    return { outcome: "stale" };
  }
  const attempts = fv.stitchAttempts + 1;
  if (attempts < MAX_STITCH_ATTEMPTS) {
    const updated = await db.finalVideo.updateMany({
      where: {
        id: args.finalVideoId,
        status: FinalVideoStatus.STITCHING,
        stitchAttemptToken: args.attemptToken,
      },
      data: {
        status: FinalVideoStatus.PENDING,
        stitchAttempts: attempts,
        stitchAttemptToken: null,
        /// PENDING 上的 startedAt = 重新排队时刻（排队超时从这里起算）
        startedAt: now,
        ffmpegError: `inprocess: ${args.reason}, requeued (attempt ${attempts}/${MAX_STITCH_ATTEMPTS})`,
      },
    });
    return { outcome: updated.count > 0 ? "requeued" : "stale" };
  }
  const result = await finishStitchTask({
    finalVideoId: args.finalVideoId,
    attemptToken: args.attemptToken,
    error: `${args.reason}; gave up after ${MAX_STITCH_ATTEMPTS} attempts`,
  });
  return { outcome: result.conflict ? "stale" : "failed" };
}

export type StitchAttemptOutcome = {
  kind: "succeeded" | "failed" | "requeued" | "lost";
  result: StitchResult;
};

/** 失败落库的说明：稳定机器码优先，不带任何 URL / 签名参数。 */
export function stitchFailureMessage(err: unknown): string {
  if (err instanceof StitchCompositionError) return err.message.slice(0, 500);
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .slice(0, 500);
}

/**
 * 进程内 / 本地：对已认领的任务跑应用内合成器，结果只经 finishStitchTask 写回。
 *   - 合成成功 → finishStitchTask（审核 → READY → brief QA_PENDING）
 *   - 合成失败 → finishStitchTask({ error })（FAILED, attempts++，UI 暴露重试）
 *   - 预算不够 → requeueStitchAttempt（放回 PENDING，下一轮函数从头拿完整预算）
 *   - 任务被取消 / 收回 → 不写任何东西（素材已在 Blob，不删）
 */
export async function runClaimedStitchAttempt(args: {
  finalVideoId: string;
  attemptToken: string;
  budget?: MediaBudget;
  compose?: (input: {
    finalVideoId: string;
    budget?: MediaBudget;
    checkpoint?: () => Promise<void>;
  }) => Promise<{
    stitchedVideoUrl: string;
    thumbnailUrl: string | null;
    subtitleFileUrl: string | null;
  }>;
  checkpoint?: () => Promise<void>;
  finish?: typeof finishStitchTask;
  requeue?: typeof requeueStitchAttempt;
}): Promise<StitchAttemptOutcome> {
  const { finalVideoId, attemptToken } = args;
  const finish = args.finish ?? finishStitchTask;
  const requeue = args.requeue ?? requeueStitchAttempt;
  const checkpoint =
    args.checkpoint ?? stitchOwnershipCheckpoint(finalVideoId, attemptToken);
  const compose =
    args.compose ??
    (async (input) => {
      /// 动态 import 断开 stitch-composer ↔ stitch-service 的模块环
      const { composeFinalVideoForStitch } = await import(
        "@/lib/services/stitch-composer"
      );
      return composeFinalVideoForStitch(input);
    });

  let output: Awaited<ReturnType<typeof compose>>;
  try {
    output = await compose({ finalVideoId, budget: args.budget, checkpoint });
  } catch (err) {
    if (err instanceof StitchAttemptLostError) {
      return { kind: "lost", result: staleStitchAttempt(finalVideoId, FinalVideoStatus.STITCHING) };
    }
    if (err instanceof StitchBudgetExceededError) {
      const requeued = await requeue({
        finalVideoId,
        attemptToken,
        reason: `${err.code} at ${err.step}`,
      });
      const status =
        requeued.outcome === "requeued"
          ? FinalVideoStatus.PENDING
          : requeued.outcome === "failed"
            ? FinalVideoStatus.FAILED
            : FinalVideoStatus.STITCHING;
      return {
        kind: requeued.outcome === "stale" ? "lost" : requeued.outcome,
        result: {
          finalVideoId,
          ok: false,
          status,
          error: err.code,
          conflict: requeued.outcome === "stale" || undefined,
        },
      };
    }
    const message = stitchFailureMessage(err);
    console.error("[stitch] composition failed", { finalVideoId, error: message });
    const result = await finish({ finalVideoId, attemptToken, error: message });
    return { kind: result.conflict ? "lost" : "failed", result };
  }

  try {
    const result = await finish({
      finalVideoId,
      attemptToken,
      stitchedVideoUrl: output.stitchedVideoUrl,
      thumbnailUrl: output.thumbnailUrl,
      subtitleFileUrl: output.subtitleFileUrl,
    });
    if (result.conflict) return { kind: "lost", result };
    return { kind: result.ok ? "succeeded" : "failed", result };
  } catch (err) {
    /// 成功写入抛错（内容审核拒绝 / 审核不可用 / 数据库抖动）：成片已在 Blob，
    /// 记一次失败让 UI 暴露重试，而不是让行卡在 STITCHING 等 30 分钟清扫。
    const message = `completion_failed: ${stitchFailureMessage(err)}`.slice(0, 500);
    console.error("[stitch] completion failed", { finalVideoId, error: message });
    const result = await finish({ finalVideoId, attemptToken, error: message }).catch(
      (): StitchResult => ({
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.STITCHING,
        error: message,
      }),
    );
    return { kind: result.conflict ? "lost" : "failed", result };
  }
}

/**
 * 重置 FinalVideo 拼接状态以便再次尝试（不重新提交 Seedance）。
 * 用户在「合成失败」UI 上点重试时调用。
 */
export async function retryStitch(finalVideoId: string) {
  const fv = await db.finalVideo.findUnique({ where: { id: finalVideoId } });
  if (!fv) throw new Error("FinalVideo 不存在");
  if (fv.status !== FinalVideoStatus.FAILED) {
    throw new Error("只有失败的成片合成任务可以重试");
  }
  const reset = await db.finalVideo.updateMany({
    where: {
      id: finalVideoId,
      status: FinalVideoStatus.FAILED,
      stitchAttemptToken: fv.stitchAttemptToken,
    },
    data: {
      status: FinalVideoStatus.PENDING,
      ffmpegError: null,
      stitchAttemptToken: null,
      /// 用户主动重试 → 重置尝试预算，否则 attempts>=MAX 的任务重试后
      /// 永远不会被 runner 领取（claim 过滤 attempts < MAX），又回到死区
      stitchAttempts: 0,
      /// PENDING 上的 startedAt = 重新排队时刻：排队超时从这里起算，不然段早已完成、
      /// 重试后下一轮清扫就判「排队超时」（1025 真机验收）
      startedAt: new Date(),
      finishedAt: null,
      subtitleFileUrl: null,
    },
  });
  if (reset.count !== 1) {
    throw new Error("成片状态已变化，请刷新后重试");
  }
  return stitchFinalVideo(finalVideoId);
}

/**
 * P05-B 只重拼：READY 成片换字幕样式 / 配乐，零生成计费（段都在，只跑合成器）。
 *
 *   - 只放行 captions / bgm（parseRestitchPatch；带口播一律 INVALID_STATE）；
 *   - brief 必须在可改成片的状态（canRestitchBriefStatus：交付前渲染态或已交付态，
 *     归档 / 弃用一律拒绝）；
 *   - 段原片若是会过期的临时签名地址（isEphemeralSignedUrl）直接拒绝——下载时多半已 403；
 *   - 用 decideStitchPath 判一次：会直接复用首段 URL 的行（reuse_single_segment /
 *     reuse_first_segment_demo）没有经过合成器，换了设置也不会体现 → 直接拒绝；
 *   - CAS READY → PENDING，同时写 previousStitchedVideoUrl = 当前成片、previousPostProduction = 当前快照
 *     （两份回滚依据）、stitchAttempts: 0、startedAt: now（排队超时从这里起算）与合并后的 postProduction；
 *   - 然后走 stitchFinalVideo：inprocess 留 PENDING 等 stitch-dispatch 认领，local 内联合成。
 *
 * 分两段：prepareRestitch 只读（解析 + 校验 + 算合并快照），commitRestitch 才写——路由把限流放在两者之间，
 * 不合法的补丁与明显不能重拼的状态不消耗限频名额（#16 审查 item 10）。
 * 旧成片 URL 在重拼期间仍留在 stitchedVideoUrl：成品库照常能看能下载；
 * 成功由 finishStitchTask 覆盖并清掉两个 previous 字段，失败走 rollbackRestitch。
 */
export interface PreparedRestitch {
  finalVideoId: string;
  briefId: string | null;
  /// CAS 期望值：READY 行的当前成片与（应为 null 的）attempt token
  expect: { stitchedVideoUrl: string; stitchAttemptToken: string | null };
  previousPostProduction: PostProductionPlan;
  merged: PostProductionPlan;
}

export async function prepareRestitch(
  finalVideoId: string,
  patchInput: unknown,
): Promise<PreparedRestitch> {
  const patch = parseRestitchPatch(patchInput);
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: { select: { id: true, status: true } },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });
  if (!fv) {
    throw new RestitchRejectedError("RESOURCE_NOT_FOUND", "成片不存在。");
  }
  if (fv.status !== FinalVideoStatus.READY || !fv.stitchedVideoUrl) {
    throw new RestitchRejectedError(
      "INVALID_STATE",
      fv.previousStitchedVideoUrl
        ? "这条成片正在按新设置重拼，完成后再改。"
        : "只有已完成的成片可以更换字幕样式 / 配乐；正在合成或失败的请先等它完成或重试。",
    );
  }
  if (fv.brief && !canRestitchBriefStatus(fv.brief.status)) {
    throw new RestitchRejectedError("INVALID_STATE", "这条视频已归档或弃用，不能再更改成片。");
  }
  if (!isStitchCandidateReady(fv)) {
    throw new RestitchRejectedError("INVALID_STATE", "分段素材不完整，不能只重拼。");
  }
  if (fv.segments.some((segment) => segment.outputVideoUrl && isEphemeralSignedUrl(segment.outputVideoUrl))) {
    throw new RestitchRejectedError(
      "INVALID_STATE",
      "分段原片是会过期的临时地址，可能已失效，不能只重拼；请重新生成。",
    );
  }
  let base: PostProductionPlan | null;
  try {
    base = parsePersistedPostProduction(fv.postProduction);
  } catch (err) {
    throw new RestitchRejectedError("INVALID_STATE", (err as Error).message);
  }
  if (!base) {
    throw new RestitchRejectedError(
      "INVALID_STATE",
      "这条成片没有后期设置快照（旧流程产物），不能只重拼；请重新生成。",
    );
  }

  const mode = stitchRuntimeMode();
  const isBroll = extractBrollClaimSegments(fv.segments) !== null;
  const isUnified = !isBroll && (await briefHasUnifiedAssembly(fv.brief?.id));
  const decision = decideStitchPath({
    mode,
    isBroll,
    isUnified,
    segmentCount: fv.segmentCount,
    firstSegmentUrl: fv.segments[0]?.outputVideoUrl ?? null,
    demo: process.env.ENABLE_VIDEO_STITCHING === "false",
  });
  if (decision === "reuse_single_segment" || decision === "reuse_first_segment_demo") {
    throw new RestitchRejectedError(
      "INVALID_STATE",
      "这条成片直接复用了单段原片，没有经过合成器，更换字幕 / 配乐不会生效。",
    );
  }

  const merged = mergeRestitchPatch(base, patch);
  if (restitchPatchIsNoop(base, merged)) {
    throw new RestitchRejectedError(
      "VALIDATION_FAILED",
      "字幕与配乐设置和当前成片一致，没有需要重拼的改动。",
    );
  }
  return {
    finalVideoId,
    briefId: fv.brief?.id ?? null,
    expect: { stitchedVideoUrl: fv.stitchedVideoUrl, stitchAttemptToken: fv.stitchAttemptToken },
    previousPostProduction: base,
    merged,
  };
}

export async function commitRestitch(
  prepared: PreparedRestitch,
  options: { now?: Date } = {},
): Promise<StitchResult> {
  const now = options.now ?? new Date();
  const reset = await db.finalVideo.updateMany({
    where: {
      id: prepared.finalVideoId,
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: prepared.expect.stitchedVideoUrl,
      stitchAttemptToken: prepared.expect.stitchAttemptToken,
    },
    data: {
      status: FinalVideoStatus.PENDING,
      /// 两份回滚依据：失败 / 超时 / 取消都回到这一版成片 + 这一版设置
      previousStitchedVideoUrl: prepared.expect.stitchedVideoUrl,
      previousPostProduction: prepared.previousPostProduction as unknown as Prisma.InputJsonValue,
      postProduction: prepared.merged as unknown as Prisma.InputJsonValue,
      /// 照抄 retryStitch：重置尝试预算，否则 claim 的 attempts < MAX 过滤会跳过它
      stitchAttempts: 0,
      stitchAttemptToken: null,
      /// PENDING 上的 startedAt = 重新排队时刻（排队超时从这里起算）
      startedAt: now,
      finishedAt: null,
      ffmpegError: null,
    },
  });
  if (reset.count !== 1) {
    throw new RestitchRejectedError("INVALID_STATE", "成片状态已变化，请刷新后重试。");
  }
  return stitchFinalVideo(prepared.finalVideoId);
}

export async function restitchReadyFinalVideo(
  finalVideoId: string,
  patchInput: unknown,
  options: { now?: Date; beforeCommit?: (prepared: PreparedRestitch) => Promise<void> } = {},
): Promise<StitchResult> {
  const prepared = await prepareRestitch(finalVideoId, patchInput);
  await options.beforeCommit?.(prepared);
  return commitRestitch(prepared, { now: options.now });
}

export interface RollbackRestitchOptions {
  /// 事务内调用时传 tx（single-video-cancel-service）
  client?: Pick<Prisma.TransactionClient, "finalVideo">;
  /// 只在这些状态下回滚（CAS 条件之一）；缺省 = 任何状态
  status?: FinalVideoStatus[];
  /// 只在仍持有这个 attempt token 时回滚（finishStitchTask / 清扫 STITCHING 超时）；
  /// undefined = 不检查 token
  attemptToken?: string | null;
  now?: Date;
}

/**
 * P05-B 统一回滚出口：只重拼没成（合成失败 / 清扫超时 / 客户取消）→ 回到旧成片。
 *
 *   识别依据 previousStitchedVideoUrl != null；CAS 钉住这个 URL（Prisma 不能列对列赋值，
 *   先读再按读到的值做条件写）。同一个 CAS 里写回 status: READY、stitchedVideoUrl = 旧 URL、
 *   postProduction = previousPostProduction（旧快照，#16 blocker 1：否则回滚后快照是一套从没渲染成功的设置，
 *   配乐署名等读数会错）、清空两个 previous 字段、ffmpegError = reason；**不改 brief 状态**——
 *   客户视角成片一直都在，只是这次换设置没成。
 *
 *   五处调用：finishStitchTask 失败分支、sweepStuckStitching（STITCHING 超时达上限）、
 *   sweepAwaitingStitchTimeout（等合成超时）、cancelUnifiedOrderForUser 与 cancelBrollDelivery（重拼中取消）。
 */
export async function rollbackRestitch(
  finalVideoId: string,
  reason: string,
  options: RollbackRestitchOptions = {},
): Promise<{ rolledBack: boolean; stitchedVideoUrl: string | null }> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const row = await client.finalVideo.findUnique({
    where: { id: finalVideoId },
    select: { previousStitchedVideoUrl: true, previousPostProduction: true },
  });
  const previous = row?.previousStitchedVideoUrl ?? null;
  if (!previous) return { rolledBack: false, stitchedVideoUrl: null };
  const previousPostProduction = row?.previousPostProduction ?? null;

  const updated = await client.finalVideo.updateMany({
    where: {
      id: finalVideoId,
      previousStitchedVideoUrl: previous,
      ...(options.status ? { status: { in: options.status } } : {}),
      ...(options.attemptToken !== undefined ? { stitchAttemptToken: options.attemptToken } : {}),
    },
    data: {
      status: FinalVideoStatus.READY,
      stitchedVideoUrl: previous,
      previousStitchedVideoUrl: null,
      /// 旧快照写回（没存到就不动 postProduction——迁移前的在途行）
      ...(previousPostProduction != null
        ? { postProduction: previousPostProduction as Prisma.InputJsonValue }
        : {}),
      previousPostProduction: Prisma.DbNull,
      ffmpegError: reason.replace(/https?:\/\/\S+/g, "<url>").slice(0, 500),
      stitchAttemptToken: null,
      finishedAt: now,
    },
  });
  const rolledBack = updated.count > 0;
  if (rolledBack) {
    console.warn("[stitch] restitch rolled back to previous video", { finalVideoId, reason });
  }
  return { rolledBack, stitchedVideoUrl: previous };
}

async function reviewGeneratedVideo(
  videoUrl: string,
  thumbnailUrl: string | null,
  finalVideoId: string,
) {
  const { reviewMediaOrThrow } = await import("@/lib/content-review");
  return reviewMediaOrThrow({
    kind: "generated_video",
    mediaUrl: videoUrl,
    mediaType: "video",
    context: {
      finalVideoId,
      ...(thumbnailUrl ? { previewImageUrl: thumbnailUrl } : {}),
    },
  });
}

/**
 * 成片就位 → brief 同步（#16 审查 item 6 改成白名单）。
 *   - 交付前渲染态（RENDER_QUEUED / RENDERING / RENDER_SUCCEEDED / RENDER_FAILED / QA_PENDING / QA_REJECTED）：
 *     brief → QA_PENDING + 成片 / 缩略图 URL，建 QA 桩（挂成片级复检标记）。
 *   - 已交付（QA_APPROVED / PUBLISH_PENDING / PUBLISHED / METRICS_COLLECTING / SCORED）：状态不动、不建 QA 桩，
 *     只刷新 URL；复检标记挂到最近一条 QAReview 上（item 12）。
 *   - 其它（ARCHIVED / DROPPED / 更早阶段）：只刷新 URL，状态一律不动。
 *   - 已有品牌封装成片（brandedVideoUrl）的：封装的是旧片，**保留指针**只记日志「需要重新品牌封装」
 *     （item 9；brandedAt 也不动）。
 */
async function markBriefReady(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { finalVideoId: true, status: true, brandedVideoUrl: true, finalVideo: true },
  });
  if (!brief?.finalVideo) return;
  const preDelivery = isPreDeliveryBriefStatus(brief.status);
  if (brief.brandedVideoUrl) {
    console.warn("[stitch] 需要重新品牌封装：成片已更新，现有品牌封装成片对应的是旧片（指针保留）", {
      briefId,
      briefStatus: brief.status,
    });
  }
  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      ...(preDelivery ? { status: VideoBriefStatus.QA_PENDING } : {}),
      finalVideoUrl: brief.finalVideo.stitchedVideoUrl,
      finalThumbnailUrl: brief.finalVideo.thumbnailUrl,
    },
  });
  if (preDelivery) {
    await ensureQAPendingStub(briefId);
    return;
  }
  if (isDeliveredBriefStatus(brief.status)) {
    await stampFinalFrameQaOnLatestReview(briefId);
  }
}

/**
 * QA 桩 + 成片级复检标记（P01-E 影子）：成片就位时在 aiScoreBreakdown 上挂
 * finalFrameQa = { status: "pending", requestedAt }，由 poll-videos cron 在帧质检预算内消费。
 * 已有 PENDING 桩（只重拼换了成片）就整体覆盖 finalFrameQa 对象并清掉上一版成片的「[成片复检]」问题，
 * 8 维打分与别人的问题原样（按归属合并，见 qa-review-merge）。
 * video-service.ts 里旧单段路径的同名副本不在此改（留给 C4）。
 */
async function ensureQAPendingStub(briefId: string) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (existing) {
    /// 已经在排队复检就不重复写（避免每次刷新都刷 updatedAt）
    if (readFinalFrameQaMark(existing.aiScoreBreakdown)?.status === "pending") return;
    await stampFinalFrameQa(existing.id);
    return;
  }
  await db.qAReview.create({
    data: {
      videoBriefId: briefId,
      status: "PENDING",
      aiScoreBreakdown: pendingFinalFrameQaMark() as unknown as Prisma.InputJsonValue,
    },
  });
}

/** 已交付 brief 只重拼成功：复检标记挂到最近一条 QAReview（不新建 PENDING 桩，不进审核队列）。 */
async function stampFinalFrameQaOnLatestReview(briefId: string) {
  const latest = await db.qAReview.findFirst({
    where: { videoBriefId: briefId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return;
  await stampFinalFrameQa(latest.id);
}

async function stampFinalFrameQa(reviewId: string) {
  const mark = newPendingFinalFrameQa();
  await writeQaReview(
    (tx) => tx.qAReview.findUnique({ where: { id: reviewId } }),
    (fresh) => ({ data: mergeFinalFrameQaReview(fresh, { mark, issues: [] }), result: true }),
  );
}

/** 运行时模式（唯一判定见 src/lib/media/stitch-runtime.ts） */
function stitchRuntimeMode(): StitchRuntimeMode {
  return resolveStitchRuntimeMode();
}

// ---------------------------------------------------------------------------
// 合成 + 持久化（所有调用方共用：拼接器 / 品牌封装 / b-roll 同步交付）
// ---------------------------------------------------------------------------

export interface NormalizeAndConcatClip {
  url: string;
  /// 期望该 clip 在最终视频里的时长；非 null 时配合 trimToFit 决定是否截断
  intendedDurationSec: number | null;
  /// true = 该 clip 长度可能超出，按 intendedDurationSec 裁剪；false = 用原长
  trimToFit: boolean;
  /// 片段来源（AI 段 / 客户上传 / 尾卡 / b-roll）：决定裁尾与口播守卫
  role?: TimelineClipRole;
  /// AI 生成段的语音安全裁尾秒数（见 stitch-pipeline TimelineClip.tailTrimSec）
  tailTrimSec?: number;
  /// 必须带真实音轨（b-roll 配音）
  requireAudio?: boolean;
  /// 尾卡 / CTA 卡：不背字幕
  excludeFromCaptions?: boolean;
  /// 音轨取自这个 URL（b-roll TTS 配音），片段原声丢弃
  audioUrl?: string;
  /// 画面循环补长（b-roll 素材短于口播）
  loopVideo?: boolean;
  /// 显式输出时长（b-roll：配音时长 + 呼吸间隙）
  targetDurationSec?: number;
  /// 计划时长（legacy 段 = VideoJob.segmentDurationSec）：旧数据没有持久化台词时字幕按它切，不按裁尾后的实测
  plannedDurationSec?: number | null;
}

export interface ComposedTimelineUrls {
  stitchedVideoUrl: string;
  subtitleFileUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number;
  /// 字幕实际铺到的秒数（null = 铺满全片）
  captionWindowSec: number | null;
  clips: TimelineClipReport[];
  timings: Record<string, number>;
}

/**
 * 下载片段 → 应用内单遍合成（逐段归一化 + 拼接 + 字幕混音，只编码一次 / 缩略图）→ 上传。
 * 不写库：落库只经 finishStitchTask（拼接器）或调用方自己的写入（品牌封装 / b-roll 同步交付）。
 */
export async function composeAndPersistTimeline(params: {
  finalVideoId: string;
  aspectRatio: string;
  clips: NormalizeAndConcatClip[];
  postProduction?: PostProductionPlan | null;
  /**
   * 字幕只允许铺到成片的前 N 秒（= 口播所在主片段的时长）。
   * 不传 = 按 excludeFromCaptions 片段的实际时长自动扣除；都没有则铺满全片。
   */
  captionWindowSec?: number | null;
  /// 强制帧率（b-roll：30）；不传 = 主片源帧率
  frameRate?: string;
  /// P04-C：派发时持久化的各 AI 段台词（DirectorPlan.segmentPlan[].voiceoverChunk，按段序）；字幕逐段对齐用
  voiceoverChunks?: ReadonlyArray<string> | null;
  extractThumbnail?: boolean;
  budget?: MediaBudget;
  checkpoint?: () => Promise<void>;
}): Promise<ComposedTimelineUrls> {
  const tmpDir = path.join(
    os.tmpdir(),
    `aivora-stitch-${params.finalVideoId.replace(/[^A-Za-z0-9_-]/g, "_")}-${Date.now()}`,
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const localClips: TimelineClip[] = [];
    for (const [i, clip] of params.clips.entries()) {
      await params.checkpoint?.();
      const ext = path.extname(safePathFromUrl(clip.url) ?? ".mp4") || ".mp4";
      const localInput = path.join(tmpDir, `in-${i}${ext}`);
      await downloadToFile(clip.url, localInput, { index: i, budget: params.budget });
      let localAudio: string | undefined;
      if (clip.audioUrl) {
        const audioExt = path.extname(safePathFromUrl(clip.audioUrl) ?? ".mp3") || ".mp3";
        localAudio = path.join(tmpDir, `in-${i}-audio${audioExt}`);
        await downloadToFile(clip.audioUrl, localAudio, { index: i, budget: params.budget });
      }
      localClips.push({
        path: localInput,
        intendedDurationSec: clip.intendedDurationSec,
        trimToFit: clip.trimToFit,
        role: clip.role,
        tailTrimSec: clip.tailTrimSec,
        requireAudio: clip.requireAudio,
        excludeFromCaptions: clip.excludeFromCaptions,
        audioPath: localAudio,
        loopVideo: clip.loopVideo,
        targetDurationSec: clip.targetDurationSec,
        plannedDurationSec: clip.plannedDurationSec,
      });
    }

    const composed = await composeTimeline({
      clips: localClips,
      aspectRatio: params.aspectRatio,
      postProduction: params.postProduction ?? null,
      captionWindowSec: params.captionWindowSec ?? null,
      voiceoverChunks: params.voiceoverChunks ?? null,
      workDir: path.join(tmpDir, "work"),
      frameRate: params.frameRate,
      budget: params.budget,
      checkpoint: params.checkpoint,
      extractThumbnail: params.extractThumbnail ?? false,
    });

    await params.checkpoint?.();
    const stamp = Date.now();
    const keyBase = `final-videos/${params.finalVideoId}/${stamp}`;
    const stitchedVideoUrl = await persistStitchedFile(composed.videoPath, `${keyBase}.mp4`);
    const [subtitleFileUrl, thumbnailUrl] = await Promise.all([
      composed.srtPath
        ? persistStitchedSubtitleFile(composed.srtPath, `${keyBase}.srt`)
        : Promise.resolve(null),
      composed.thumbnailPath
        ? persistStitchedThumbnail(composed.thumbnailPath, `${keyBase}.jpg`)
        : Promise.resolve(null),
    ]);
    return {
      stitchedVideoUrl,
      subtitleFileUrl,
      thumbnailUrl,
      durationSec: composed.durationSec,
      captionWindowSec: composed.captionWindowSec,
      clips: composed.clips,
      timings: composed.timings,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 兼容入口：只要成片 URL（assembly logo 角标转存等）。
 */
export async function runFfmpegNormalizeAndConcat(params: {
  finalVideoId: string;
  aspectRatio: string;
  clips: NormalizeAndConcatClip[];
}): Promise<string> {
  const result = await composeAndPersistTimeline(params);
  return result.stitchedVideoUrl;
}

/**
 * 兼容入口：品牌封装 / b-roll 同步交付沿用的签名（成片 + 可选 SRT）。
 */
export async function runFfmpegNormalizeAndConcatWithPostProduction(params: {
  finalVideoId: string;
  aspectRatio: string;
  clips: NormalizeAndConcatClip[];
  postProduction?: PostProductionPlan | null;
  captionWindowSec?: number | null;
}): Promise<{
  stitchedVideoUrl: string;
  subtitleFileUrl: string | null;
}> {
  const result = await composeAndPersistTimeline(params);
  return {
    stitchedVideoUrl: result.stitchedVideoUrl,
    subtitleFileUrl: result.subtitleFileUrl,
  };
}

function safePathFromUrl(url: string): string | null {
  try {
    if (url.startsWith("file://")) return fileURLToPath(url);
    const u = new URL(url);
    return u.pathname;
  } catch {
    return null;
  }
}

/**
 * 支持 http(s) 和 file:// 两种 URL：
 *  - http(s) → fetch 下载到 dest（带超时，封顶在预算内）
 *  - file:// → copyFile 复制到 dest（尾卡缓存 / b-roll 合成段 / 品牌封装裁尾产物）
 * 错误信息只带片段序号与 HTTP 状态，不带 URL（签名参数不进日志 / 库字段）。
 */
async function downloadToFile(
  url: string,
  dest: string,
  opts: { index: number; budget?: MediaBudget },
) {
  if (url.startsWith("file://")) {
    await copyFile(fileURLToPath(url), dest);
    return;
  }
  const { timeoutMs, capped } = stepTimeout(opts.budget, "download", 1);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      if (capped) throw new StitchBudgetExceededError("download");
      throw new Error(`下载段失败：clip #${opts.index} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`下载段失败：clip #${opts.index} ${(err as Error)?.message ?? "fetch failed"}`);
  }
  if (!res.ok) {
    throw new Error(
      `下载段失败：clip #${opts.index} (${res.status} ${res.statusText})`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/**
 * 检查 brief 是否带有 unified VideoGenerationPlan.assemblyPlan，是 → 走 assembly 分支。
 * 旧 Sunny Shutter / 没经过 unified-input dispatch 的 brief 返回 false → 走 legacy 分支。
 */
async function briefAspectRatio(
  briefId: string | null | undefined,
): Promise<string> {
  if (!briefId) return "9:16";
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { aspectRatio: true },
  });
  return brief?.aspectRatio || "9:16";
}

/** 纯函数：plan 里是否有可执行的 assemblyPlan.clips */
export function planHasUnifiedAssembly(plan: unknown): boolean {
  const typed = plan as { assemblyPlan?: { clips?: unknown[] } } | null | undefined;
  return Array.isArray(typed?.assemblyPlan?.clips) && (typed?.assemblyPlan?.clips?.length ?? 0) > 0;
}

async function briefHasUnifiedAssembly(briefId: string | null | undefined): Promise<boolean> {
  if (!briefId) return false;
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { videoGenerationPlan: true },
  });
  return planHasUnifiedAssembly(brief?.videoGenerationPlan);
}

async function uploadRender(
  filePath: string,
  blobPath: string,
  contentType: string,
  what: string,
): Promise<string> {
  const { getStorageProvider } = await import("@/lib/storage");
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    throw new Error(
      `Storage provider "${storage.id}" not configured; refusing to ${what}`,
    );
  }
  const buffer = await readFile(filePath);
  const obj = await storage.uploadBuffer("renders", buffer, {
    key: blobPath,
    access: "public",
    contentType,
    overwrite: true,
  });
  return obj.url;
}

/**
 * 把本地 mp4 上传到对象存储（Vercel Blob / 火山 TOS，按 STORAGE_PROVIDER 自动选择），
 * 返回可在 DB 中持久化的 URL。
 *
 * 强约束：storage provider 必须已配置 → 直接 throw，绝不再回退到 file:// 静默兜底
 * （旧逻辑会写 `file:///tmp/...mp4` 进数据库，导致前端永远播不出）。
 */
async function persistStitchedFile(
  filePath: string,
  blobPath: string,
): Promise<string> {
  return uploadRender(
    filePath,
    blobPath,
    "video/mp4",
    "silently persist stitched mp4 to file://",
  );
}

async function persistStitchedSubtitleFile(
  filePath: string,
  blobPath: string,
): Promise<string> {
  return uploadRender(
    filePath,
    blobPath,
    "text/plain; charset=utf-8",
    "persist subtitle output",
  );
}

async function persistStitchedThumbnail(
  filePath: string,
  blobPath: string,
): Promise<string> {
  return uploadRender(filePath, blobPath, "image/jpeg", "persist thumbnail output");
}

/// 仅供测试导入
export const __test__ = {
  stitchRuntimeMode,
  persistStitchedFile,
  AWAITING_EXTERNAL_STITCHER,
  resolveAspectResolution,
  briefHasUnifiedAssembly,
  briefAspectRatio,
};
