import { db } from "@/lib/db";
import { BatchStatus, ProjectStatus } from "@prisma/client";
import { generateContentPlan } from "./content-service";
import { submitVideoJob, checkVideoStatus } from "./video-service";
import type { VideoParams } from "./video-service";
import { deleteProjectWithAssets } from "./project-service";

export interface CreateBatchInput {
  name: string;
  keywords: string[];
  /** 批次内所有 project 共享的品牌/产品/场景描述（纯文本，可选） */
  brandDescription?: string | null;
  /** 批次内所有 project 共享的语气 */
  tone?: string | null;
  /** 批次内所有 project 共享的语言 */
  language?: string | null;
  /** 批次内所有 project 共享的 Brand Lock 合成配置 */
  brandLock?: {
    logoUrl?: string | null;
    enabled?: boolean;
    template?: string;
    position?: string;
    opacity?: number;
  };
  videoParams?: VideoParams;
  concurrency?: number;
  autoGenerateVideo?: boolean;
}

export async function createBatch(input: CreateBatchInput) {
  const {
    name,
    keywords,
    brandDescription,
    tone,
    language,
    brandLock,
    videoParams,
    concurrency = 2,
    autoGenerateVideo = true,
  } = input;

  if (!keywords.length) throw new Error("至少需要一个关键词");
  if (keywords.length > 50) throw new Error("单批次最多 50 个关键词");

  const brandLockDefaults = {
    logoUrl: brandLock?.logoUrl || null,
    brandLockEnabled: brandLock?.enabled !== false,
    brandLockTemplate: brandLock?.template || "corner_watermark",
    brandLockPosition: brandLock?.position || "bottom-right",
    brandLockOpacity:
      typeof brandLock?.opacity === "number" ? brandLock.opacity : 85,
  };

  const batch = await db.batch.create({
    data: {
      name: name.trim(),
      totalCount: keywords.length,
      videoParams: videoParams ? JSON.parse(JSON.stringify(videoParams)) : undefined,
      concurrency,
      autoGenerateVideo,
      projects: {
        create: keywords.map((kw, i) => ({
          keyword: kw.trim(),
          batchIndex: i,
          brandDescription: brandDescription || null,
          tone: tone || "auto",
          language: language || "auto",
          ...brandLockDefaults,
        })),
      },
    },
    include: { projects: { orderBy: { batchIndex: "asc" } } },
  });

  return batch;
}

export async function getBatchWithProjects(batchId: string) {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: {
      projects: {
        orderBy: { batchIndex: "asc" },
        include: {
          contentPlan: { select: { id: true, caption: true, videoPrompt: true } },
          videoJob: { select: { id: true, status: true, videoUrl: true, providerJobId: true } },
        },
      },
    },
  });

  if (!batch) throw new Error("批次不存在");
  return batch;
}

export async function listBatches(page = 1, pageSize = 20) {
  const [batches, total] = await Promise.all([
    db.batch.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { projects: true } } },
    }),
    db.batch.count(),
  ]);

  return { batches, total, page, pageSize };
}

/**
 * Execute a batch: generate content and optionally videos for all projects.
 * Uses concurrency limiter to avoid API rate limits.
 * This is a long-running function — call it without awaiting from the API route.
 */
export async function executeBatch(batchId: string) {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: { projects: { orderBy: { batchIndex: "asc" } } },
  });

  if (!batch) throw new Error("批次不存在");
  if (batch.status === BatchStatus.RUNNING) throw new Error("批次正在执行中");

  await db.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.RUNNING, startedAt: new Date(), errorMessage: null },
  });

  const videoParams = batch.videoParams as VideoParams | null;
  const concurrency = Math.max(1, Math.min(batch.concurrency, 5));
  const autoVideo = batch.autoGenerateVideo;
  const batchTotal = batch.totalCount;

  let completedCount = 0;
  let failedCount = 0;

  async function processProject(projectId: string) {
    try {
      // Step 1: Generate content
      if (
        (await getProjectStatus(projectId)) === ProjectStatus.DRAFT
      ) {
        await generateContentPlan(projectId);
      }

      // Step 2: Generate video (if enabled)
      if (autoVideo) {
        const currentStatus = await getProjectStatus(projectId);
        if (
          currentStatus === ProjectStatus.CONTENT_GENERATED ||
          currentStatus === ProjectStatus.VIDEO_FAILED
        ) {
          await submitVideoJob(projectId, videoParams ?? undefined);
          await waitForVideo(projectId);
        }
      }

      completedCount++;
    } catch (error) {
      failedCount++;
      const msg = error instanceof Error ? error.message : "未知错误";
      await db.project.update({
        where: { id: projectId },
        data: { errorMessage: msg },
      }).catch(() => {});
      console.error(`[batch:${batchId}] 项目 ${projectId} 失败:`, msg);
    }

    await db.batch.update({
      where: { id: batchId },
      data: { completedCount, failedCount },
    });
  }

  // Run with concurrency limiter
  const queue = [...batch.projects.map((p) => p.id)];
  const running = new Set<Promise<void>>();

  for (const projectId of queue) {
    const current = await db.batch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (current?.status === BatchStatus.PAUSED) {
      console.log(`[batch:${batchId}] 批次已暂停`);
      break;
    }

    const task = processProject(projectId);
    running.add(task);
    task.finally(() => running.delete(task));

    if (running.size >= concurrency) {
      await Promise.race(running);
    }
  }

  await Promise.allSettled(running);

  const finalStatus =
    failedCount === batch.totalCount
      ? BatchStatus.FAILED
      : BatchStatus.COMPLETED;

  await db.batch.update({
    where: { id: batchId },
    data: {
      status: finalStatus,
      completedCount,
      failedCount,
      completedAt: new Date(),
    },
  });

  console.log(
    `[batch:${batchId}] 执行完成: ${completedCount} 成功, ${failedCount} 失败`
  );

  return { completedCount, failedCount };
}

export async function pauseBatch(batchId: string) {
  return db.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.PAUSED },
  });
}

export async function retryFailedInBatch(batchId: string) {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: {
      projects: {
        where: {
          status: { in: [ProjectStatus.VIDEO_FAILED, ProjectStatus.DRAFT] },
        },
      },
    },
  });

  if (!batch) throw new Error("批次不存在");
  if (batch.projects.length === 0) throw new Error("没有需要重试的项目");

  await db.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.RUNNING, completedAt: null, errorMessage: null },
  });

  const retryVideoParams = batch.videoParams as VideoParams | null;
  const retryConcurrency = Math.max(1, Math.min(batch.concurrency, 5));
  const retryAutoVideo = batch.autoGenerateVideo;

  let retried = 0;
  let retrFailed = 0;

  async function retryProject(projectId: string) {
    try {
      const status = await getProjectStatus(projectId);
      if (status === ProjectStatus.DRAFT) {
        await generateContentPlan(projectId);
      }
      if (retryAutoVideo) {
        const current = await getProjectStatus(projectId);
        if (current === ProjectStatus.CONTENT_GENERATED || current === ProjectStatus.VIDEO_FAILED) {
          await submitVideoJob(projectId, retryVideoParams ?? undefined);
          await waitForVideo(projectId);
        }
      }
      retried++;
    } catch {
      retrFailed++;
    }
  }

  const retryQueue = batch.projects.map((p) => p.id);
  const retryRunning = new Set<Promise<void>>();

  for (const pid of retryQueue) {
    const task = retryProject(pid);
    retryRunning.add(task);
    task.finally(() => retryRunning.delete(task));
    if (retryRunning.size >= retryConcurrency) await Promise.race(retryRunning);
  }

  await Promise.allSettled(retryRunning);

  const newCompleted = batch.completedCount + retried;
  const newFailed = batch.failedCount - retried + retrFailed;

  await db.batch.update({
    where: { id: batchId },
    data: {
      status: BatchStatus.COMPLETED,
      completedCount: newCompleted,
      failedCount: Math.max(0, newFailed),
      completedAt: new Date(),
    },
  });

  return { retried, retrFailed };
}

/**
 * 删除批次。
 * - cascade=false（默认）：只删 batch 本身，把 projects 解绑（batchId=null），
 *   已完成的作品会继续留在「作品库」里。适合清理失败批次时保留尚可用的作品。
 * - cascade=true：连同 batch 下所有 project + Blob 资产一并删除。
 */
export async function deleteBatch(
  batchId: string,
  options: { cascade?: boolean } = {},
) {
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: { projects: { select: { id: true } } },
  });
  if (!batch) throw new Error("批次不存在");

  if (options.cascade) {
    for (const p of batch.projects) {
      try {
        await deleteProjectWithAssets(p.id);
      } catch (err) {
        console.error(`[batch:${batchId}] 级联删除 project ${p.id} 失败:`, err);
      }
    }
  } else {
    await db.project.updateMany({
      where: { batchId },
      data: { batchId: null },
    });
  }

  await db.batch.delete({ where: { id: batchId } });

  return {
    deletedBatch: batchId,
    projectsHandled: batch.projects.length,
    mode: options.cascade ? "cascade" : "unlink",
  };
}

// --- helpers ---

async function getProjectStatus(projectId: string): Promise<ProjectStatus> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { status: true } });
  return p?.status ?? ProjectStatus.DRAFT;
}

async function waitForVideo(projectId: string, maxWaitMs = 300_000) {
  const startTime = Date.now();
  const pollInterval = 10_000;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await checkVideoStatus(projectId);
    if (result.status === "COMPLETED" || result.status === "FAILED") {
      return result;
    }
    await sleep(pollInterval);
  }

  throw new Error("视频生成超时");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
