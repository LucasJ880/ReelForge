import { VideoBriefStatus, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSeedanceStatus,
  submitSeedanceJob,
} from "@/lib/providers/seedance";
import { processReferenceImages } from "@/lib/providers/remove-bg";

const I2V_MODEL_OVERRIDE = process.env.ARK_VIDEO_I2V_MODEL || undefined;

/**
 * 触发一个 VideoBrief 的视频生成：把每个 scene 的 prompt 提交成一个 VideoJob。
 * 第一个 scene 若包含 I2V 参考图，会先经过抠图预处理。
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

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.RENDER_QUEUED, errorMessage: null },
  });

  // 预处理参考图
  const processed = brief.referenceImageUrls?.length
    ? (await processReferenceImages(brief.referenceImageUrls)).map((p) => p.url)
    : [];

  // 清理旧的 queued/running job（重新发起时）
  await db.videoJob.updateMany({
    where: {
      videoBriefId: briefId,
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
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
        const { jobId } = await submitSeedanceJob({
          prompt: prompt.promptText,
          referenceImageUrls:
            prompt.provider === VideoProvider.SEEDANCE_I2V
              ? prompt.referenceImageUrl
                ? [prompt.referenceImageUrl, ...processed.slice(1)]
                : processed
              : undefined,
          duration: scene.durationSec,
          ratio: (prompt.params as { ratio?: string } | null)?.ratio ?? brief.aspectRatio,
          model:
            prompt.provider === VideoProvider.SEEDANCE_I2V
              ? I2V_MODEL_OVERRIDE
              : undefined,
        });
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            externalJobId: jobId,
            status: VideoJobStatus.RUNNING,
            startedAt: new Date(),
          },
        });
      } catch (err) {
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            status: VideoJobStatus.FAILED,
            errorMessage: (err as Error).message,
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
 * 轮询并更新所有 RUNNING 状态的 VideoJob。由 Vercel Cron 调用。
 */
export async function pollRunningJobs(limit = 30) {
  const running = await db.videoJob.findMany({
    where: { status: VideoJobStatus.RUNNING },
    orderBy: { startedAt: "asc" },
    take: limit,
  });

  const results = await Promise.all(
    running.map(async (job) => {
      if (!job.externalJobId) return null;
      try {
        const r = await getSeedanceStatus(job.externalJobId);
        if (r.status === "completed") {
          return db.videoJob.update({
            where: { id: job.id },
            data: {
              status: VideoJobStatus.SUCCEEDED,
              outputVideoUrl: r.videoUrl,
              outputThumbUrl: r.thumbnailUrl,
              finishedAt: new Date(),
            },
          });
        }
        if (r.status === "failed") {
          return db.videoJob.update({
            where: { id: job.id },
            data: {
              status: VideoJobStatus.FAILED,
              errorMessage: r.errorMessage ?? "Seedance 返回失败",
              finishedAt: new Date(),
            },
          });
        }
        return null;
      } catch (err) {
        return db.videoJob.update({
          where: { id: job.id },
          data: {
            errorMessage: `轮询异常: ${(err as Error).message}`,
          },
        });
      }
    }),
  );

  const affectedBriefs = Array.from(
    new Set(
      running
        .filter((_, i) => results[i] !== null)
        .map((j) => j.videoBriefId),
    ),
  );
  await Promise.all(affectedBriefs.map((id) => syncBriefStatus(id)));
  return { polled: running.length, updated: results.filter(Boolean).length };
}

/**
 * 根据所有 scene 的 VideoJob 状态聚合成 Brief 级状态。
 * - 所有 succeeded  → RENDER_SUCCEEDED → QA_PENDING（自动入审）
 * - 任意 failed    → RENDER_FAILED
 * - 仍有 queued/running → RENDERING
 */
export async function syncBriefStatus(briefId: string) {
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
        errorMessage: failed[0]?.errorMessage ?? "部分 scene 渲染失败",
      },
    });
    return;
  }

  if (succeeded.length > 0) {
    // MVP 阶段不做拼接，直接把第一个 scene 的成片作为 finalVideoUrl
    const first = succeeded[0];
    await db.videoBrief.update({
      where: { id: briefId },
      data: {
        status: VideoBriefStatus.QA_PENDING,
        finalVideoUrl: first.outputVideoUrl,
        finalThumbnailUrl: first.outputThumbUrl,
      },
    });
    // 自动创建 QA pending 记录（若尚未有 PENDING）
    await ensureQAPendingStub(briefId);
  }
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
