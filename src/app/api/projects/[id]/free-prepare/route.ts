import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ProjectStatus, VideoJobStatus } from "@prisma/client";
import { generateContentPlan } from "@/lib/services/content-service";
import { buildFreeChannelManifest } from "@/lib/services/free-channel-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requireAdmin } from "@/lib/api-auth";

export const maxDuration = 60;

/**
 * Free 通道：准备素材清单（浏览器端 ffmpeg.wasm 合成的 manifest）
 *
 * 流程：
 *   1. 若无 contentPlan -> 先生成
 *   2. 切句 + 并行走 Edge TTS + Pexels
 *   3. manifest 存到 VideoJob.manifest，project 状态置为 VIDEO_GENERATING（等待浏览器回传）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: { voiceId?: string; rate?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }

  try {
    const project = await db.project.findUnique({
      where: { id },
      include: { contentPlan: true, videoJob: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // Step 1: ensure content
    if (!project.contentPlan) {
      await generateContentPlan(id);
    }

    const refreshed = await db.project.findUnique({
      where: { id },
      include: { contentPlan: true },
    });
    if (!refreshed?.contentPlan) {
      return NextResponse.json({ error: "内容生成失败" }, { status: 500 });
    }

    // Step 2: build manifest
    const manifest = await buildFreeChannelManifest({
      projectId: id,
      script: refreshed.contentPlan.script,
      keyword: refreshed.keyword,
      voiceId: body.voiceId,
      rate: body.rate,
      userVideoAssets: refreshed.userVideoAssets ?? [],
    });

    // Step 3: persist to VideoJob (channel=free)
    const videoJob = await db.videoJob.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        provider: "free-channel",
        status: VideoJobStatus.PROCESSING,
        channel: "free",
        duration: Math.ceil(manifest.totalDurationMs / 1000),
        resolution: "1080x1920",
        ratio: "9:16",
        manifest: manifest as unknown as object,
      },
      update: {
        provider: "free-channel",
        status: VideoJobStatus.PROCESSING,
        channel: "free",
        duration: Math.ceil(manifest.totalDurationMs / 1000),
        resolution: "1080x1920",
        ratio: "9:16",
        manifest: manifest as unknown as object,
        videoUrl: null,
        errorMessage: null,
      },
    });

    await db.project.update({
      where: { id },
      data: {
        status: ProjectStatus.VIDEO_GENERATING,
        errorMessage: null,
      },
    });

    return NextResponse.json({
      success: true,
      channel: "free",
      videoJobId: videoJob.id,
      manifest,
    });
  } catch (error) {
    return handleApiError(error, "Free 通道准备");
  }
}
