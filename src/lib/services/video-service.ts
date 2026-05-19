import {
  FinalVideoStatus,
  Prisma,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSeedanceStatus,
  submitSeedanceJobResilient,
  type SeedanceJobResult,
} from "@/lib/providers/seedance";
import { processReferenceImages } from "@/lib/providers/remove-bg";
import {
  parseDirectorPlan,
  type DirectorPlan,
  type SegmentPlan,
} from "@/lib/schemas/director-plan";
import { planSegments } from "@/lib/duration/segment-planner";

const I2V_MODEL_OVERRIDE = process.env.ARK_VIDEO_I2V_MODEL || undefined;

/// 触发渲染默认 15 分钟超时（用户友好上限；不强制 fail，只用于 UI「用时较长」提示）
const DEFAULT_TIMEOUT_MIN = Number(
  process.env.SEEDANCE_TIMEOUT_MIN ?? "15",
);
/// 连续 N 次轮询都失败 → 标记 FAILED，提供 retry。默认 3
const POLL_ERROR_THRESHOLD = Number(
  process.env.SEEDANCE_POLL_ERROR_THRESHOLD ?? "3",
);

/**
 * 总入口：根据 brief 配置自动选择单段 / 多段流水线。
 *
 * - 有 directorPlan + targetDurationSec > 15 → 走 dispatchMultiSegmentGeneration（PART 4）
 * - 否则（旧流程，含 Sunny Shutter）→ 走 dispatchVideoGeneration（基于 ScenePlan / VideoPrompt）
 *
 * 调用方应优先用 dispatchVideoForBrief，让 video-service 自己决定路径，
 * 避免在路由里重复判断逻辑。
 */
export async function dispatchVideoForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      targetDurationSec: true,
      directorPlan: true,
    },
  });
  if (!brief) throw new Error("Brief 不存在");

  const segments = planSegments(brief.targetDurationSec);
  const useMultiSegment =
    segments.length > 1 && brief.directorPlan != null;

  if (useMultiSegment) {
    return dispatchMultiSegmentGeneration(briefId);
  }
  return dispatchVideoGeneration(briefId);
}

/**
 * PART 4：多段视频生成 —— 基于 DirectorPlan.segmentPlan。
 *
 * 流程：
 * 1. 创建 FinalVideo 行（status=PENDING）
 * 2. 为每段创建 1 条 VideoJob（segmentIndex / segmentDurationSec / finalVideoId）
 * 3. 把每段 segmentPlan.seedancePrompt 直接发给 Seedance（不依赖 ScenePlan / VideoPrompt）
 * 4. 后续 reconcileVideoJob 在最后一段成功时触发 stitch（见 stitch-service）
 *
 * 幂等保护：
 * - 已经有 RUNNING 的多段任务时（finalVideoId 关联），不重新提交，直接 reconcile。
 */
export async function dispatchMultiSegmentGeneration(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
  });
  if (!brief) throw new Error("Brief 不存在");
  if (!brief.directorPlan) {
    throw new Error("Brief 尚未生成 DirectorPlan，无法分段生成");
  }

  let plan: DirectorPlan;
  try {
    plan = parseDirectorPlan(brief.directorPlan);
  } catch (err) {
    throw new Error(`DirectorPlan 解析失败: ${(err as Error).message}`);
  }

  /// 幂等：已有同 brief 的多段 inflight job → reconcile 后返回
  const inflightExisting = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      finalVideoId: { not: null },
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
  });
  if (inflightExisting.length > 0) {
    await reconcileBriefRenderStatus(briefId);
    return inflightExisting;
  }

  /// 创建（或重置）FinalVideo
  let finalVideoId = brief.finalVideoId;
  if (finalVideoId) {
    /// 旧 FinalVideo 重置为 PENDING（重新生成场景）
    await db.finalVideo.update({
      where: { id: finalVideoId },
      data: {
        status: FinalVideoStatus.PENDING,
        stitchedVideoUrl: null,
        thumbnailUrl: null,
        ffmpegError: null,
        startedAt: null,
        finishedAt: null,
        segmentCount: plan.segmentPlan.length,
        targetDurationSec: brief.targetDurationSec,
      },
    });
  } else {
    const finalVideo = await db.finalVideo.create({
      data: {
        targetDurationSec: brief.targetDurationSec,
        segmentCount: plan.segmentPlan.length,
        status: FinalVideoStatus.PENDING,
      },
    });
    finalVideoId = finalVideo.id;
    await db.videoBrief.update({
      where: { id: briefId },
      data: { finalVideoId },
    });
  }

  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.RENDER_QUEUED,
      errorMessage: null,
    },
  });

  /// 把上次该 brief 残留的孤立 QUEUED/RUNNING（externalJobId 为空）→ CANCELLED
  await db.videoJob.updateMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: null,
    },
    data: { status: VideoJobStatus.CANCELLED },
  });

  const created: Awaited<ReturnType<typeof submitSegmentJob>>[] = [];
  for (const segment of plan.segmentPlan) {
    const result = await submitSegmentJob({
      briefId,
      finalVideoId,
      aspectRatio: brief.aspectRatio,
      segment,
      segmentCount: plan.segmentPlan.length,
    });
    created.push(result);
  }

  await syncBriefStatus(briefId);
  return created;
}

async function submitSegmentJob(params: {
  briefId: string;
  finalVideoId: string;
  aspectRatio: string;
  segment: SegmentPlan;
  segmentCount: number;
}) {
  const { briefId, finalVideoId, aspectRatio, segment, segmentCount } = params;

  const job = await db.videoJob.create({
    data: {
      videoBriefId: briefId,
      provider: VideoProvider.SEEDANCE_T2V,
      status: VideoJobStatus.QUEUED,
      segmentIndex: segment.segmentIndex,
      segmentDurationSec: segment.durationSec,
      finalVideoId,
    },
  });

  try {
    const submittedAt = new Date();
    const { jobId } = await submitSeedanceJobResilient({
      prompt: segment.seedancePrompt,
      duration: segment.durationSec,
      ratio: aspectRatio,
      mockHints: {
        briefId,
        segmentIndex: segment.segmentIndex,
        segmentCount,
        durationSec: segment.durationSec,
        aspectRatio,
        purpose: segment.role,
      },
    });
    return db.videoJob.update({
      where: { id: job.id },
      data: {
        externalJobId: jobId,
        status: VideoJobStatus.RUNNING,
        submittedAt,
        startedAt: submittedAt,
        timeoutAt: new Date(submittedAt.getTime() + DEFAULT_TIMEOUT_MIN * 60_000),
        lastProviderStatus: "queued",
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    return db.videoJob.update({
      where: { id: job.id },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: message,
        userSafeError: friendlySubmitError(message),
        finishedAt: new Date(),
      },
    });
  }
}

/**
 * 触发一个 VideoBrief 的视频生成：把每个 scene 的 prompt 提交成一个 VideoJob。
 * 第一个 scene 若包含 I2V 参考图，会先经过抠图预处理。
 *
 * 幂等保护：
 * - 如果该 brief 已经存在 RUNNING 且 externalJobId 非空的 VideoJob，
 *   不再向 Provider 提交新任务，避免重复扣费；调用方应优先调 reconcileBriefRenderStatus。
 */
export async function dispatchVideoGeneration(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, take: 1 },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const script = brief.scripts[0];
  if (!script) throw new Error("Brief 尚未有脚本");

  const scenes = await db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
    include: { videoPrompts: true },
  });
  if (scenes.length === 0) throw new Error("请先生成分镜/Prompt");

  const inflightExisting = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
  });
  if (inflightExisting.length > 0) {
    /// 已经有付费在跑的 Provider 任务 → 不重新提交，直接调和现有状态后返回
    await reconcileBriefRenderStatus(briefId);
    return inflightExisting;
  }

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDER_QUEUED, errorMessage: null },
  });

  const processed = brief.referenceImageUrls?.length
    ? (await processReferenceImages(brief.referenceImageUrls)).map((p) => p.url)
    : [];

  /// 没有 externalJobId 的孤立 QUEUED/RUNNING（可能上次提交失败但残留）→ 标 CANCELLED
  await db.videoJob.updateMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: null,
    },
    data: { status: VideoJobStatus.CANCELLED },
  });

  const created = await Promise.all(
    scenes.map(async (scene) => {
      const prompt = scene.videoPrompts[0];
      if (!prompt) throw new Error(`Scene #${scene.sceneIndex} 没有 prompt`);

      const job = await db.videoJob.create({
        data: {
          videoBriefId: briefId,
          provider: prompt.provider,
          status: VideoJobStatus.QUEUED,
        },
      });

      try {
        const submittedAt = new Date();
        const ratio =
          (prompt.params as { ratio?: string } | null)?.ratio ?? brief.aspectRatio;
        const { jobId } = await submitSeedanceJobResilient({
          prompt: prompt.promptText,
          referenceImageUrls:
            prompt.provider === VideoProvider.SEEDANCE_I2V
              ? prompt.referenceImageUrl
                ? [prompt.referenceImageUrl, ...processed.slice(1)]
                : processed
              : undefined,
          duration: scene.durationSec,
          ratio,
          model:
            prompt.provider === VideoProvider.SEEDANCE_I2V
              ? I2V_MODEL_OVERRIDE
              : undefined,
          mockHints: {
            briefId,
            segmentIndex: scene.sceneIndex,
            segmentCount: scenes.length,
            durationSec: scene.durationSec,
            aspectRatio: ratio,
            purpose: "scene",
          },
        });
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            externalJobId: jobId,
            status: VideoJobStatus.RUNNING,
            submittedAt,
            startedAt: submittedAt,
            timeoutAt: new Date(
              submittedAt.getTime() + DEFAULT_TIMEOUT_MIN * 60_000,
            ),
            lastProviderStatus: "queued",
          },
        });
      } catch (err) {
        const message = (err as Error).message;
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.FAILED,
            errorMessage: message,
            userSafeError: friendlySubmitError(message),
            finishedAt: new Date(),
          },
        });
      }
    }),
  );

  await syncBriefStatus(briefId);
  return created;
}

/**
 * 调和单个 VideoJob 的 Provider 状态。
 * - 调用方负责处理批量、聚合到 brief 状态。
 * - 容错：Provider 查询失败时不会把 job 直接判 FAILED，
 *   而是累加 pollErrors，超过阈值才下线。
 */
export async function reconcileVideoJob(jobId: string) {
  const job = await db.videoJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (!job.externalJobId) return job;
  if (
    job.status !== VideoJobStatus.RUNNING &&
    job.status !== VideoJobStatus.QUEUED
  ) {
    return job;
  }

  let result: SeedanceJobResult;
  try {
    result = await getSeedanceStatus(job.externalJobId);
  } catch (err) {
    const newErrors = (job.pollErrors ?? 0) + 1;
    const exceeded = newErrors >= POLL_ERROR_THRESHOLD;
    return db.videoJob.update({
      where: { id: jobId },
      data: {
        pollErrors: newErrors,
        lastCheckedAt: new Date(),
        errorMessage: `轮询异常 (#${newErrors}): ${(err as Error).message}`,
        ...(exceeded
          ? {
              status: VideoJobStatus.FAILED,
              userSafeError:
                "我们暂时无法获取生成进度，请稍后点击「刷新状态」或「重试」。",
              finishedAt: new Date(),
            }
          : {}),
      },
    });
  }

  if (result.status === "completed") {
    const updated = await db.videoJob.update({
      where: { id: jobId },
      data: {
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: result.videoUrl ?? null,
        outputThumbUrl: result.thumbnailUrl ?? null,
        finishedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: result.rawProviderStatus,
        pollErrors: 0,
      },
    });
    /// 多段流的 fast-path：本段成功且是该 brief 最后一段时立即触发 stitch（无需等下一轮 cron）
    if (updated.finalVideoId) {
      await maybeTriggerStitch(updated.finalVideoId);
    }
    return updated;
  }

  if (result.status === "failed") {
    return db.videoJob.update({
      where: { id: jobId },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: result.errorMessage ?? "Seedance 返回失败",
        userSafeError: friendlyProviderError(
          result.rawProviderStatus,
          result.errorMessage,
        ),
        finishedAt: new Date(),
        lastCheckedAt: new Date(),
        lastProviderStatus: result.rawProviderStatus,
        pollErrors: 0,
      },
    });
  }

  /// 仍在 pending / processing —— 只更新观察字段
  return db.videoJob.update({
    where: { id: jobId },
    data: {
      lastCheckedAt: new Date(),
      lastProviderStatus: result.rawProviderStatus,
      pollErrors: 0,
    },
  });
}

/**
 * 调和单个 brief 的全部在飞 job，并把状态聚合回 VideoBrief。
 * UI 的「刷新状态」按钮调用这个。
 */
export async function reconcileBriefRenderStatus(briefId: string) {
  const inflight = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
  });
  for (const job of inflight) {
    await reconcileVideoJob(job.id);
  }
  await syncBriefStatus(briefId);
  return summarizeBriefRender(briefId);
}

/**
 * 重新提交单个失败的 VideoJob（保留同一 scene/prompt，避免影响其它 scene）。
 * - 提交前会再去 Provider 查一次最新状态；如果其实已经成功，则直接修正 DB，不重复提交。
 * - 防止用户在「失败」状态下点重试时，意外发起多次付费。
 */
export async function retryFailedVideoJob(jobId: string) {
  const job = await db.videoJob.findUnique({
    where: { id: jobId },
    include: { videoBrief: true },
  });
  if (!job) throw new Error("VideoJob 不存在");
  if (job.status !== VideoJobStatus.FAILED) {
    throw new Error("只允许重试已失败的视频任务");
  }

  /// 双保险：如果 externalJobId 还在，先去查一遍真实状态
  if (job.externalJobId) {
    try {
      const r = await getSeedanceStatus(job.externalJobId);
      if (r.status === "completed") {
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: r.videoUrl ?? null,
            outputThumbUrl: r.thumbnailUrl ?? null,
            errorMessage: null,
            userSafeError: null,
            finishedAt: new Date(),
            lastProviderStatus: r.rawProviderStatus,
          },
        });
      }
      if (r.status === "processing" || r.status === "pending") {
        /// Provider 还在跑 → 把 DB 状态恢复成 RUNNING，不重复扣费
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.RUNNING,
            errorMessage: null,
            userSafeError: null,
            finishedAt: null,
            lastProviderStatus: r.rawProviderStatus,
          },
        });
      }
    } catch {
      /// 查不到状态 → 走重新提交分支
    }
  }

  /// Provider 端确认失败 / 不存在 → 重新提交
  /// 多段流：优先用 directorPlan.segmentPlan 的对应段（防双重计费的关键 — 只重试该段）
  if (job.segmentIndex != null && job.finalVideoId) {
    const briefForRetry = await db.videoBrief.findUnique({
      where: { id: job.videoBriefId },
      select: { aspectRatio: true, directorPlan: true },
    });
    if (!briefForRetry?.directorPlan) {
      throw new Error("Brief 缺少 DirectorPlan，无法重试该段");
    }
    let plan: DirectorPlan;
    try {
      plan = parseDirectorPlan(briefForRetry.directorPlan);
    } catch (err) {
      throw new Error(`DirectorPlan 解析失败: ${(err as Error).message}`);
    }
    const segment = plan.segmentPlan.find(
      (s) => s.segmentIndex === job.segmentIndex,
    );
    if (!segment) {
      throw new Error(`找不到 segmentIndex=${job.segmentIndex} 的段计划`);
    }

    const submittedAt = new Date();
    try {
      const { jobId: newExternalId } = await submitSeedanceJobResilient({
        prompt: segment.seedancePrompt,
        duration: segment.durationSec,
        ratio: briefForRetry.aspectRatio,
        mockHints: {
          briefId: job.videoBriefId,
          segmentIndex: segment.segmentIndex,
          segmentCount: plan.segmentPlan.length,
          durationSec: segment.durationSec,
          aspectRatio: briefForRetry.aspectRatio,
          purpose: segment.role,
        },
      });
      const updated = await db.videoJob.update({
        where: { id: job.id },
        data: {
          externalJobId: newExternalId,
          status: VideoJobStatus.RUNNING,
          retryCount: (job.retryCount ?? 0) + 1,
          submittedAt,
          startedAt: submittedAt,
          finishedAt: null,
          timeoutAt: new Date(
            submittedAt.getTime() + DEFAULT_TIMEOUT_MIN * 60_000,
          ),
          errorMessage: null,
          userSafeError: null,
          lastProviderStatus: "queued",
          pollErrors: 0,
        },
      });
      /// 重置 FinalVideo 状态，避免还在 FAILED 卡住拼接重试
      await db.finalVideo.update({
        where: { id: job.finalVideoId },
        data: {
          status: FinalVideoStatus.PENDING,
          ffmpegError: null,
        },
      });
      return updated;
    } catch (err) {
      const message = (err as Error).message;
      return db.videoJob.update({
        where: { id: job.id },
        data: {
          errorMessage: message,
          userSafeError: friendlySubmitError(message),
        },
      });
    }
  }

  /// 单段流（旧路径，含 Sunny Shutter）：从 ScenePlan/VideoPrompt 重新读取并提交
  const scene = await db.scenePlan.findFirst({
    where: { script: { videoBriefId: job.videoBriefId } },
    include: { videoPrompts: true },
    orderBy: { sceneIndex: "asc" },
  });
  if (!scene) throw new Error("找不到对应的 scene plan，无法重试");
  const prompt = scene.videoPrompts[0];
  if (!prompt) throw new Error("找不到对应的 prompt，无法重试");

  const submittedAt = new Date();
  try {
    const ratio = (prompt.params as { ratio?: string } | null)?.ratio;
    const briefForRefs = await db.videoBrief.findUnique({
      where: { id: job.videoBriefId },
      select: { referenceImageUrls: true },
    });
    const processed = briefForRefs?.referenceImageUrls?.length
      ? (await processReferenceImages(briefForRefs.referenceImageUrls)).map(
          (p) => p.url,
        )
      : [];
    const { jobId: newExternalId } = await submitSeedanceJobResilient({
      prompt: prompt.promptText,
      referenceImageUrls:
        prompt.provider === VideoProvider.SEEDANCE_I2V
          ? prompt.referenceImageUrl
            ? [prompt.referenceImageUrl, ...processed.slice(1)]
            : processed
          : undefined,
      duration: scene.durationSec,
      ratio,
      model:
        prompt.provider === VideoProvider.SEEDANCE_I2V
          ? I2V_MODEL_OVERRIDE
          : undefined,
      mockHints: {
        briefId: job.videoBriefId,
        segmentIndex: scene.sceneIndex,
        segmentCount: 1,
        durationSec: scene.durationSec,
        aspectRatio: ratio ?? "9:16",
        purpose: "scene-retry",
      },
    });
    return db.videoJob.update({
      where: { id: job.id },
      data: {
        externalJobId: newExternalId,
        status: VideoJobStatus.RUNNING,
        retryCount: (job.retryCount ?? 0) + 1,
        submittedAt,
        startedAt: submittedAt,
        finishedAt: null,
        timeoutAt: new Date(submittedAt.getTime() + DEFAULT_TIMEOUT_MIN * 60_000),
        errorMessage: null,
        userSafeError: null,
        lastProviderStatus: "queued",
        pollErrors: 0,
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    return db.videoJob.update({
      where: { id: job.id },
      data: {
        errorMessage: message,
        userSafeError: friendlySubmitError(message),
      },
    });
  }
}

/**
 * Fast-path：当一段刚成功时，检查是否所有段都成功 → 立即触发 stitch。
 * 不直接 import stitch-service 避免循环；用动态 import。
 */
async function maybeTriggerStitch(finalVideoId: string): Promise<void> {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      segments: { select: { status: true } },
    },
  });
  if (!fv) return;
  if (fv.status !== FinalVideoStatus.PENDING) return;
  const allDone =
    fv.segments.length === fv.segmentCount &&
    fv.segments.every((s) => s.status === VideoJobStatus.SUCCEEDED);
  if (!allDone) return;
  try {
    const { stitchFinalVideo } = await import("./stitch-service");
    await stitchFinalVideo(finalVideoId);
  } catch (err) {
    console.warn(
      "[video-service] inline stitch trigger failed, will rely on cron",
      (err as Error).message,
    );
  }
}

/**
 * 段感知重试：只重提同 finalVideo 的 FAILED 段，不动其它段。
 * UI 的「重试失败片段」按钮调这个。
 */
export async function retryFailedSegmentsForBrief(briefId: string) {
  const failed = await db.videoJob.findMany({
    where: {
      videoBriefId: briefId,
      status: VideoJobStatus.FAILED,
    },
    orderBy: { segmentIndex: "asc" },
  });
  if (failed.length === 0) return [];

  const results = [];
  for (const job of failed) {
    try {
      const updated = await retryFailedVideoJob(job.id);
      results.push({ jobId: job.id, ok: true, status: updated?.status });
    } catch (err) {
      results.push({
        jobId: job.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  }
  await syncBriefStatus(briefId);
  return results;
}

/**
 * 轮询并更新所有 RUNNING 状态的 VideoJob。由 Vercel Cron 调用。
 */
export async function pollRunningJobs(limit = 30) {
  const running = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      externalJobId: { not: null },
    },
    orderBy: { startedAt: "asc" },
    take: limit,
  });

  let updated = 0;
  const affectedBriefs = new Set<string>();
  for (const job of running) {
    const before = job.status;
    const after = await reconcileVideoJob(job.id);
    if (after && after.status !== before) {
      updated += 1;
      affectedBriefs.add(job.videoBriefId);
    }
  }

  for (const id of affectedBriefs) {
    await syncBriefStatus(id);
  }
  return { polled: running.length, updated };
}

/**
 * 根据所有 scene 的 VideoJob 状态聚合成 Brief 级状态。
 *
 * 双流兼容：
 * - 多段流（brief.finalVideoId != null）：等所有段 SUCCEEDED → 触发 stitch；
 *   FinalVideo 状态机驱动 brief 状态。
 * - 旧单段流（brief.finalVideoId == null，含 Sunny Shutter）：
 *   首段 SUCCEEDED 即把 outputVideoUrl 写到 brief.finalVideoUrl，与改造前完全一致。
 *
 * 失败 / busy 行为对两条流都一样。
 */
export async function syncBriefStatus(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: { id: true, finalVideoId: true },
  });
  if (!brief) return;

  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: briefId },
  });
  if (jobs.length === 0) return;

  const succeeded = jobs.filter((j) => j.status === VideoJobStatus.SUCCEEDED);
  const failed = jobs.filter((j) => j.status === VideoJobStatus.FAILED);
  const busy = jobs.filter(
    (j) => j.status === VideoJobStatus.QUEUED || j.status === VideoJobStatus.RUNNING,
  );

  if (busy.length > 0) {
    await db.videoBrief.update({
      where: { id: briefId },
      data: { status: VideoBriefStatus.RENDERING },
    });
    return;
  }

  if (failed.length > 0) {
    await db.videoBrief.update({
      where: { id: briefId },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage:
          failed[0]?.userSafeError ?? failed[0]?.errorMessage ?? "部分片段生成失败",
      },
    });
    return;
  }

  if (succeeded.length === 0) return;

  /// 多段流：通知 stitch
  if (brief.finalVideoId) {
    await onAllSegmentsSucceeded(brief.finalVideoId, briefId);
    return;
  }

  /// 单段流（旧路径，Sunny Shutter 兼容）
  const first = succeeded[0];
  await db.videoBrief.update({
    where: { id: briefId },
    data: {
      status: VideoBriefStatus.QA_PENDING,
      finalVideoUrl: first.outputVideoUrl,
      finalThumbnailUrl: first.outputThumbUrl,
    },
  });
  await ensureQAPendingStub(briefId);
}

/**
 * 多段流成片：所有段 SUCCEEDED 后调用。
 * - 把 FinalVideo 标记为 PENDING（待拼接 / cron 拾取）
 * - VideoBrief.status → RENDERING（语义：所有片段就绪，正在合成完整视频）
 * - 真正的 ffmpeg 拼接由 stitch-service 异步执行（cron 或显式触发）
 *
 * 这里之所以不直接同步拼接：ffmpeg 在 Vercel serverless 中可能跑较久，
 * 应放到独立 cron / 后台任务避免阻塞 reconcileVideoJob。
 */
async function onAllSegmentsSucceeded(finalVideoId: string, briefId: string) {
  /// 仅在 PENDING 状态下推进；STITCHING / READY / FAILED 不动
  await db.finalVideo.updateMany({
    where: { id: finalVideoId, status: FinalVideoStatus.PENDING },
    data: {
      /// 保持 PENDING 等 cron 拾取；UI 文案显示「正在合成完整视频」
      status: FinalVideoStatus.PENDING,
    },
  });
  /// brief 仍标 RENDERING（用户视角：「正在合成完整视频」）
  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDERING },
  });
}

/**
 * 把 brief 的渲染任务聚合成一份「用户/UI 友好」的进度对象。
 * 不包含 provider 名 / external id 这些内部细节（它们在 jobs[].debug 里）。
 */
export type BriefRenderSummary = {
  briefId: string;
  briefStatus: VideoBriefStatus;
  totalJobs: number;
  succeeded: number;
  running: number;
  queued: number;
  failed: number;
  cancelled: number;
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  /// 任意一个仍在运行的 job 是否已经超过 timeoutAt
  hasStuckJob: boolean;
  /// 最近一次有效检查的时间
  lastCheckedAt: Date | null;
  /// 多段拼接信息（单段流为 null，与 Sunny Shutter 兼容）
  finalVideo: {
    id: string;
    status: FinalVideoStatus;
    targetDurationSec: number;
    segmentCount: number;
    segmentsCompleted: number;
    stitchedVideoUrl: string | null;
    thumbnailUrl: string | null;
    ffmpegError: string | null;
  } | null;
  jobs: Array<{
    id: string;
    sceneIndex?: number | null;
    segmentIndex: number | null;
    segmentDurationSec: number | null;
    status: VideoJobStatus;
    /// 用户安全的状态文本（不含 provider 名）
    userStatusKey: BriefRenderUserStatus;
    outputVideoUrl: string | null;
    outputThumbnailUrl: string | null;
    submittedAt: Date | null;
    lastCheckedAt: Date | null;
    finishedAt: Date | null;
    /// 友好错误（FAILED 时填）
    userSafeError: string | null;
    /// 是否已超时
    isStuck: boolean;
    /// debug 抽屉用 — 不要默认展示
    debug: {
      provider: VideoProvider;
      externalJobId: string | null;
      lastProviderStatus: string | null;
      adminError: string | null;
    };
  }>;
};

export type BriefRenderUserStatus =
  | "waiting"
  | "submitted"
  | "generating"
  | "ready"
  | "failed"
  | "stuck"
  | "cancelled";

export async function summarizeBriefRender(
  briefId: string,
): Promise<BriefRenderSummary> {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    select: {
      id: true,
      status: true,
      finalVideoUrl: true,
      finalThumbnailUrl: true,
      finalVideoId: true,
      finalVideo: true,
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const jobs = await db.videoJob.findMany({
    where: { videoBriefId: briefId },
    orderBy: [{ segmentIndex: "asc" }, { createdAt: "asc" }],
  });
  const now = Date.now();

  const counts = {
    succeeded: 0,
    running: 0,
    queued: 0,
    failed: 0,
    cancelled: 0,
  };
  let lastCheckedAt: Date | null = null;
  let hasStuckJob = false;

  const mapped = jobs.map((j) => {
    if (j.status === VideoJobStatus.SUCCEEDED) counts.succeeded++;
    else if (j.status === VideoJobStatus.RUNNING) counts.running++;
    else if (j.status === VideoJobStatus.QUEUED) counts.queued++;
    else if (j.status === VideoJobStatus.FAILED) counts.failed++;
    else if (j.status === VideoJobStatus.CANCELLED) counts.cancelled++;

    const isStuck =
      (j.status === VideoJobStatus.RUNNING ||
        j.status === VideoJobStatus.QUEUED) &&
      j.timeoutAt != null &&
      j.timeoutAt.getTime() < now;
    if (isStuck) hasStuckJob = true;

    if (j.lastCheckedAt && (!lastCheckedAt || j.lastCheckedAt > lastCheckedAt)) {
      lastCheckedAt = j.lastCheckedAt;
    }

    return {
      id: j.id,
      sceneIndex: null as number | null,
      segmentIndex: j.segmentIndex,
      segmentDurationSec: j.segmentDurationSec,
      status: j.status,
      userStatusKey: classifyUserStatus(j, isStuck),
      outputVideoUrl: j.outputVideoUrl,
      outputThumbnailUrl: j.outputThumbUrl,
      submittedAt: j.submittedAt ?? j.startedAt ?? j.createdAt,
      lastCheckedAt: j.lastCheckedAt,
      finishedAt: j.finishedAt,
      userSafeError: j.userSafeError ?? toUserSafeIfMissing(j.errorMessage),
      isStuck,
      debug: {
        provider: j.provider,
        externalJobId: j.externalJobId,
        lastProviderStatus: j.lastProviderStatus,
        adminError: j.errorMessage,
      },
    };
  });

  /// 多段拼接信息：仅当存在 FinalVideo（新流程）时填，旧 brief 留 null
  const finalVideo = brief.finalVideo
    ? {
        id: brief.finalVideo.id,
        status: brief.finalVideo.status,
        targetDurationSec: brief.finalVideo.targetDurationSec,
        segmentCount: brief.finalVideo.segmentCount,
        segmentsCompleted: jobs.filter(
          (j) =>
            j.finalVideoId === brief.finalVideoId &&
            j.status === VideoJobStatus.SUCCEEDED,
        ).length,
        stitchedVideoUrl: brief.finalVideo.stitchedVideoUrl,
        thumbnailUrl: brief.finalVideo.thumbnailUrl,
        ffmpegError: brief.finalVideo.ffmpegError,
      }
    : null;

  /// 用户视角的 final URL：优先 stitched（新流程），否则 brief.finalVideoUrl（旧流程，含 Sunny Shutter）
  const exposedFinalUrl =
    finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl ?? null;
  const exposedFinalThumb =
    finalVideo?.thumbnailUrl ?? brief.finalThumbnailUrl ?? null;

  return {
    briefId: brief.id,
    briefStatus: brief.status,
    totalJobs: jobs.length,
    succeeded: counts.succeeded,
    running: counts.running,
    queued: counts.queued,
    failed: counts.failed,
    cancelled: counts.cancelled,
    finalVideoUrl: exposedFinalUrl,
    finalThumbnailUrl: exposedFinalThumb,
    hasStuckJob,
    lastCheckedAt,
    finalVideo,
    jobs: mapped,
  };
}

function classifyUserStatus(
  job: {
    status: VideoJobStatus;
    submittedAt: Date | null;
    startedAt: Date | null;
    externalJobId: string | null;
  },
  isStuck: boolean,
): BriefRenderUserStatus {
  if (job.status === VideoJobStatus.SUCCEEDED) return "ready";
  if (job.status === VideoJobStatus.FAILED) return "failed";
  if (job.status === VideoJobStatus.CANCELLED) return "cancelled";
  if (isStuck) return "stuck";
  if (job.status === VideoJobStatus.RUNNING) {
    return job.externalJobId ? "generating" : "submitted";
  }
  if (job.status === VideoJobStatus.QUEUED) return "waiting";
  return "waiting";
}

/// 内部 admin 错误转用户安全提示（兜底，遇到没显式 userSafeError 的旧 job）
function toUserSafeIfMissing(adminError: string | null): string | null {
  if (!adminError) return null;
  return friendlyProviderError("unknown", adminError);
}

function friendlySubmitError(adminMessage: string): string {
  if (adminMessage.includes("OPENAI_API_KEY") || adminMessage.includes("ARK_API_KEY")) {
    return "视频生成服务暂未配置完成，请联系管理员检查 API 密钥。";
  }
  if (adminMessage.includes("rate") || adminMessage.includes("429")) {
    return "视频生成服务繁忙，请稍后再试。";
  }
  if (adminMessage.toLowerCase().includes("timeout")) {
    return "提交视频生成请求时超时，请点击「重试」。";
  }
  return "视频生成请求提交失败，请点击「重试」。如果反复失败请联系支持。";
}

function friendlyProviderError(
  rawStatus: string,
  message?: string | null,
): string {
  const lc = (message ?? "").toLowerCase();
  if (rawStatus === "expired" || lc.includes("expired")) {
    return "视频生成结果已过期，请点击「重试」重新生成。";
  }
  if (rawStatus === "cancelled" || rawStatus === "canceled") {
    return "视频生成已被取消，请点击「重试」重新生成。";
  }
  if (lc.includes("policy") || lc.includes("safety") || lc.includes("nsfw")) {
    return "提示词或参考图未通过内容安全审核，请调整脚本/参考图后重试。";
  }
  if (lc.includes("rate") || lc.includes("429")) {
    return "视频生成服务繁忙，请稍后点击「重试」。";
  }
  return "视频生成失败，请点击「重试」。如反复失败请联系支持。";
}

async function ensureQAPendingStub(briefId: string) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (existing) return;
  await db.qAReview.create({
    data: { videoBriefId: briefId, status: "PENDING" },
  });
}

/// 仅供测试导入
export const __test__ = {
  classifyUserStatus,
  friendlySubmitError,
  friendlyProviderError,
};

/// 让 TypeScript 知道 Prisma 重导出（避免 unused import 报错）
type _Reexport = Prisma.VideoJobCreateInput;
void (null as unknown as _Reexport);
