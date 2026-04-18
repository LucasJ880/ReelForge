import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateContentPlan } from "@/lib/services/content-service";
import { submitVideoJob } from "@/lib/services/video-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requirePro } from "@/lib/api-auth";
import { ProjectStatus } from "@prisma/client";

export const maxDuration = 60;

/**
 * 一键生成：content + video，一次请求走完整个流程起点。
 *
 * 输入：
 *   {
 *     duration?: number,
 *     resolution?: string,
 *     ratio?: string,
 *     targetDuration?: number,
 *   }
 *
 * 流程：
 *   1. 若无 contentPlan -> 调用 generateContentPlan
 *   2. 提交视频生成任务（Seedance）
 *   3. 前端再通过 GET /video 轮询进度
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: {
    duration?: number;
    resolution?: string;
    ratio?: string;
    targetDuration?: number;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }

  try {
    const project = await db.project.findUnique({
      where: { id },
      include: { contentPlan: true, videoJob: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    if (!project.contentPlan) {
      console.log(`[auto-generate] Step 1: generating content for ${id}`);
      await generateContentPlan(id, body.targetDuration);
    }

    if (project.status === ProjectStatus.VIDEO_FAILED) {
      await db.project.update({
        where: { id },
        data: { status: ProjectStatus.CONTENT_GENERATED, errorMessage: null },
      });
    }

    console.log(`[auto-generate] Step 2: submitting video job for ${id}`);
    const videoJob = await submitVideoJob(id, {
      duration: body.duration,
      resolution: body.resolution,
      ratio: body.ratio,
    });
    return NextResponse.json({ success: true, videoJob });
  } catch (error) {
    return handleApiError(error, "一键生成");
  }
}
