import { db } from "@/lib/db";
import { ProjectStatus, VideoJobStatus } from "@prisma/client";
import {
  submitVideoGeneration,
  getVideoJobStatus,
} from "@/lib/providers/jimeng";
import { persistRemoteVideo, persistRemoteImage } from "@/lib/utils/persist-video";

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

const SEGMENT_DURATION = 15;

function isChainedVideo(duration: number): boolean {
  return duration > SEGMENT_DURATION;
}

export async function submitVideoJob(
  projectId: string,
  params?: VideoParams
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { contentPlan: true, videoJob: true },
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
  const chained = isChainedVideo(duration);

  const { jobId } = await submitVideoGeneration({
    prompt: project.contentPlan.videoPrompt,
    referenceImageUrl: project.primaryImageUrl || undefined,
    duration: SEGMENT_DURATION,
    resolution,
    ratio,
    returnLastFrame: chained,
  });

  const jobData = {
    provider: "jimeng",
    channel: "pro",
    providerJobId: jobId,
    providerJobId2: null as string | null,
    status: VideoJobStatus.PROCESSING,
    videoUrl: null as string | null,
    videoUrl2: null as string | null,
    thumbnailUrl: null as string | null,
    lastFrameUrl: null as string | null,
    duration,
    resolution,
    ratio,
    segment: chained ? 1 : null,
    errorMessage: null as string | null,
    completedAt: null as Date | null,
  };

  if (project.videoJob) {
    const updated = await db.videoJob.update({
      where: { projectId },
      data: { ...jobData, retryCount: { increment: 1 } },
    });
    await db.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.VIDEO_GENERATING, errorMessage: null },
    });
    return updated;
  }

  const [videoJob] = await db.$transaction([
    db.videoJob.create({ data: { projectId, ...jobData } }),
    db.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.VIDEO_GENERATING, errorMessage: null },
    }),
  ]);

  return videoJob;
}

export async function checkVideoStatus(projectId: string) {
  const videoJob = await db.videoJob.findUnique({
    where: { projectId },
    include: { project: { include: { contentPlan: true } } },
  });

  if (!videoJob) throw new Error("没有视频生成任务");

  if (
    videoJob.status === VideoJobStatus.COMPLETED ||
    videoJob.status === VideoJobStatus.FAILED
  ) {
    return videoJob;
  }

  const chained = videoJob.segment !== null;

  if (chained && videoJob.segment === 2 && videoJob.providerJobId2) {
    return handleSegment2Poll(videoJob);
  }

  if (!videoJob.providerJobId) throw new Error("缺少 providerJobId");
  const result = await getVideoJobStatus(videoJob.providerJobId);

  if (result.status === "completed" && result.videoUrl) {
    if (chained) {
      try {
        return await handleSegment1Complete(videoJob, result.videoUrl, result.lastFrameUrl);
      } catch (e) {
        console.error("[video-service] Segment 2 submission failed, falling back:", e);
        return markFailed(
          videoJob.projectId,
          `第二段提交失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    let persistedVideoUrl = result.videoUrl;
    let persistedThumb: string | null = result.thumbnailUrl || null;
    try {
      persistedVideoUrl = await persistRemoteVideo(result.videoUrl, `videos/${projectId}-final`);
      console.log(`[video-service] videoUrl persisted -> ${persistedVideoUrl}`);
    } catch (e) {
      console.warn("[video-service] persist video failed, keeping original URL:", e);
    }
    if (persistedThumb) {
      try {
        persistedThumb = await persistRemoteImage(persistedThumb, `thumbs/${projectId}`);
      } catch (e) {
        console.warn("[video-service] persist thumb failed:", e);
      }
    }

    const updated = await db.videoJob.update({
      where: { projectId },
      data: {
        status: VideoJobStatus.COMPLETED,
        videoUrl: persistedVideoUrl,
        thumbnailUrl: persistedThumb,
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
    return markFailed(videoJob.projectId, result.errorMessage || "视频生成失败");
  }

  const segmentProgress = result.progress || 0;
  const overallProgress = chained
    ? Math.floor(segmentProgress / 2)
    : segmentProgress;

  return { ...videoJob, status: "PROCESSING" as const, progress: overallProgress };
}

async function handleSegment1Complete(
  videoJob: Awaited<ReturnType<typeof db.videoJob.findUnique>> & { project: { contentPlan: { videoPromptPart2: string | null; videoPrompt: string } | null } },
  videoUrl: string,
  lastFrameUrl?: string,
) {
  const part2Prompt = videoJob.project.contentPlan?.videoPromptPart2
    || `Continue from the previous scene. ${videoJob.project.contentPlan?.videoPrompt || ""}`;

  const { jobId: jobId2 } = await submitVideoGeneration({
    prompt: part2Prompt,
    firstFrameUrl: lastFrameUrl || undefined,
    duration: SEGMENT_DURATION,
    ratio: videoJob.ratio,
  });

  console.log(`[video-service] Segment 1 done, submitting segment 2: ${jobId2}`);

  let persistedUrl = videoUrl;
  try {
    persistedUrl = await persistRemoteVideo(videoUrl, `videos/${videoJob.projectId}-part1`);
    console.log(`[video-service] Segment 1 persisted -> ${persistedUrl}`);
  } catch (e) {
    console.warn("[video-service] persist segment 1 failed, keeping original URL:", e);
  }

  const updated = await db.videoJob.update({
    where: { projectId: videoJob.projectId },
    data: {
      videoUrl: persistedUrl,
      lastFrameUrl: lastFrameUrl || null,
      providerJobId2: jobId2,
      segment: 2,
    },
  });

  return { ...updated, status: "PROCESSING" as const, progress: 50 };
}

async function handleSegment2Poll(
  videoJob: NonNullable<Awaited<ReturnType<typeof db.videoJob.findUnique>>>,
) {
  if (!videoJob.providerJobId2) throw new Error("缺少 providerJobId2");
  const result = await getVideoJobStatus(videoJob.providerJobId2);

  if (result.status === "completed" && result.videoUrl) {
    let persistedUrl2 = result.videoUrl;
    try {
      persistedUrl2 = await persistRemoteVideo(result.videoUrl, `videos/${videoJob.projectId}-part2`);
      console.log(`[video-service] Segment 2 persisted -> ${persistedUrl2}`);
    } catch (e) {
      console.warn("[video-service] persist segment 2 failed, keeping original URL:", e);
    }

    const updated = await db.videoJob.update({
      where: { projectId: videoJob.projectId },
      data: {
        videoUrl2: persistedUrl2,
        status: VideoJobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    await db.project.update({
      where: { id: videoJob.projectId },
      data: { status: ProjectStatus.VIDEO_READY },
    });
    return { ...updated, progress: 100 };
  }

  if (result.status === "failed") {
    return markFailed(videoJob.projectId, result.errorMessage || "第二段视频生成失败");
  }

  const segmentProgress = result.progress || 0;
  return { ...videoJob, status: "PROCESSING" as const, progress: 50 + Math.floor(segmentProgress / 2) };
}

async function markFailed(projectId: string, errorMessage: string) {
  const updated = await db.videoJob.update({
    where: { projectId },
    data: { status: VideoJobStatus.FAILED, errorMessage },
  });
  await db.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.VIDEO_FAILED, errorMessage },
  });
  return updated;
}
