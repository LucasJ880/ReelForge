import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateContentPlan } from "@/lib/services/content-service";
import { submitVideoJob } from "@/lib/services/video-service";
import { handleApiError } from "@/lib/utils/api-error";
import { requireAdmin } from "@/lib/api-auth";
import { ProjectStatus } from "@prisma/client";

export const maxDuration = 60;

/**
 * 一键生成：content + video，一次请求走完整个流程起点
 * 输入:
 *   {
 *     channel?: "pro" | "free",          // 默认 "pro"
 *     duration?: number, resolution?, ratio?,
 *     targetDuration?: number,
 *   }
 * 流程:
 *   1. 若无 contentPlan -> 调用 generateContentPlan
 *   2. 调用 submitVideoJob 提交视频生成（Pro 通道，走 Seedance 或 Mock）
 *   3. 返回 projectId 和当前 status；前端后续通过 GET /video 轮询进度
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: {
    channel?: "pro" | "free";
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

  const channel = body.channel ?? "pro";

  try {
    const project = await db.project.findUnique({
      where: { id },
      include: { contentPlan: true, videoJob: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    // Step 1: ensure content plan exists
    if (!project.contentPlan) {
      console.log(`[auto-generate] Step 1: generating content for ${id}`);
      await generateContentPlan(id, body.targetDuration);
    }

    // Step 2: submit video job (only pro channel here — free channel is client-side)
    if (channel === "pro") {
      // Reset any failed previous state so submitVideoJob is happy
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
      return NextResponse.json({ success: true, channel, videoJob });
    }

    // Free channel: backend only prepares manifest; actual render happens client-side
    return NextResponse.json({
      success: true,
      channel: "free",
      message: "Free 通道已就绪，素材与脚本由浏览器端合成",
    });
  } catch (error) {
    return handleApiError(error, "一键生成");
  }
}
