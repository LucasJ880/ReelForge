import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  try {
    const project = await db.project.findUnique({
      where: { id },
      include: { videoJob: true },
    });

    if (!project?.videoJob) {
      return NextResponse.json({ error: "视频任务不存在" }, { status: 404 });
    }

    if (project.videoJob.stitchedVideoUrl) {
      return NextResponse.json({
        stitchedVideoUrl: project.videoJob.stitchedVideoUrl,
        cached: true,
      });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "缺少视频文件" }, { status: 400 });
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json({ error: "文件类型错误" }, { status: 400 });
    }

    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "文件过大，不能超过 100MB" },
        { status: 400 },
      );
    }

    const filename = `stitched/${id}-${Date.now()}.mp4`;
    const blob = await put(filename, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: "video/mp4",
    });

    await db.videoJob.update({
      where: { id: project.videoJob.id },
      data: { stitchedVideoUrl: blob.url },
    });

    return NextResponse.json({ stitchedVideoUrl: blob.url });
  } catch (error) {
    console.error("[stitch] Error:", error);
    const message = error instanceof Error ? error.message : "拼接保存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
