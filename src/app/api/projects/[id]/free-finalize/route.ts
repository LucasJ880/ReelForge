import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ProjectStatus, VideoJobStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/api-auth";
import { handleApiError } from "@/lib/utils/api-error";

export const maxDuration = 30;

/**
 * Free 通道：浏览器合成完毕后回传最终 mp4 公共 URL（已通过 /api/upload 上传到 Blob）
 *
 * 请求体：
 *   { videoUrl: string, thumbnailUrl?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: { videoUrl?: string; thumbnailUrl?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  if (!body.videoUrl) {
    return NextResponse.json({ error: "缺少 videoUrl" }, { status: 400 });
  }

  try {
    const project = await db.project.findUnique({
      where: { id },
      include: { videoJob: true },
    });
    if (!project?.videoJob) {
      return NextResponse.json({ error: "未找到视频任务" }, { status: 404 });
    }
    if (project.videoJob.channel !== "free") {
      return NextResponse.json(
        { error: "当前任务非 Free 通道" },
        { status: 400 },
      );
    }

    await db.videoJob.update({
      where: { projectId: id },
      data: {
        status: VideoJobStatus.COMPLETED,
        videoUrl: body.videoUrl,
        thumbnailUrl: body.thumbnailUrl ?? project.videoJob.thumbnailUrl,
        completedAt: new Date(),
      },
    });

    await db.project.update({
      where: { id },
      data: {
        status: ProjectStatus.VIDEO_READY,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Free 通道回传");
  }
}

/**
 * Free 通道：浏览器端合成失败时调用
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: { error?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }

  try {
    await db.videoJob.update({
      where: { projectId: id },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: body.error ?? "浏览器合成失败",
      },
    });
    await db.project.update({
      where: { id },
      data: {
        status: ProjectStatus.VIDEO_FAILED,
        errorMessage: body.error ?? "浏览器合成失败",
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "Free 通道失败上报");
  }
}
