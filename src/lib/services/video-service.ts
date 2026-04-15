import { db } from "@/lib/db";
import { ProjectStatus, VideoJobStatus } from "@prisma/client";
import {
  submitVideoGeneration,
  getVideoJobStatus,
} from "@/lib/providers/jimeng";

export interface VideoParams {
  duration?: number;
  resolution?: string;
  ratio?: string;
}

const DEFAULT_PARAMS: Required<VideoParams> = {
  duration: 15,
  resolution: "1080p",
  ratio: "9:16",
};

export async function submitVideoJob(
  projectId: string,
  params?: VideoParams
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { contentPlan: true, videoJob: true, product: true },
  });

  if (!project) throw new Error("项目不存在");
  if (!project.contentPlan) throw new Error("请先生成内容方案");

  if (
    project.status !== ProjectStatus.CONTENT_GENERATED &&
    project.status !== ProjectStatus.VIDEO_FAILED
  ) {
    throw new Error(`当前状态 ${project.status} 不允许生成视频`);
  }

  const duration = params?.duration || DEFAULT_PARAMS.duration;
  const resolution = params?.resolution || DEFAULT_PARAMS.resolution;
  const ratio = params?.ratio || DEFAULT_PARAMS.ratio;

  const { jobId } = await submitVideoGeneration({
    prompt: project.contentPlan.videoPrompt,
    referenceImageUrl: project.product?.imageUrl || undefined,
    duration,
    resolution,
    ratio,
  });

  if (project.videoJob) {
    const updated = await db.videoJob.update({
      where: { projectId },
      data: {
        providerJobId: jobId,
        status: VideoJobStatus.PROCESSING,
        videoUrl: null,
        thumbnailUrl: null,
        duration,
        resolution,
        ratio,
        errorMessage: null,
        completedAt: null,
        retryCount: { increment: 1 },
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.VIDEO_GENERATING, errorMessage: null },
    });

    return updated;
  }

  const [videoJob] = await db.$transaction([
    db.videoJob.create({
      data: {
        projectId,
        provider: "jimeng",
        providerJobId: jobId,
        status: VideoJobStatus.PROCESSING,
        duration,
        resolution,
        ratio,
      },
    }),
    db.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.VIDEO_GENERATING, errorMessage: null },
    }),
  ]);

  return videoJob;
}

export async function checkVideoStatus(projectId: string) {
  const videoJob = await db.videoJob.findUnique({ where: { projectId } });

  if (!videoJob) throw new Error("没有视频生成任务");
  if (!videoJob.providerJobId) throw new Error("缺少 providerJobId");

  if (
    videoJob.status === VideoJobStatus.COMPLETED ||
    videoJob.status === VideoJobStatus.FAILED
  ) {
    return videoJob;
  }

  const result = await getVideoJobStatus(videoJob.providerJobId);

  if (result.status === "completed" && result.videoUrl) {
    const updated = await db.videoJob.update({
      where: { projectId },
      data: {
        status: VideoJobStatus.COMPLETED,
        videoUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl || null,
        completedAt: new Date(),
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.VIDEO_READY },
    });

    return { ...updated, progress: 100 };
  }

  if (result.status === "failed") {
    const updated = await db.videoJob.update({
      where: { projectId },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: result.errorMessage || "视频生成失败",
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.VIDEO_FAILED,
        errorMessage: result.errorMessage || "视频生成失败",
      },
    });

    return updated;
  }

  return { ...videoJob, status: "PROCESSING" as const, progress: result.progress || 0 };
}
