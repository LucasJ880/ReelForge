import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePro } from "@/lib/api-auth";

/**
 * Brand Lock 合成协调 API
 *
 * GET —— 返回当前 project 的合成所需信息（raw video url + 品牌配置）
 *         前端拿到后在浏览器 ffmpeg.wasm 里合成
 * POST —— 合成完成后回填 brandedVideoUrl
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      videoJob: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          stitchedVideoUrl: true,
          brandedVideoUrl: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (!project.videoJob) {
    return NextResponse.json(
      { error: "该项目还没有生成的视频" },
      { status: 400 },
    );
  }

  const rawVideoUrl =
    project.videoJob.stitchedVideoUrl || project.videoJob.videoUrl;

  if (!rawVideoUrl) {
    return NextResponse.json(
      { error: "视频 URL 不存在，请先完成视频生成" },
      { status: 400 },
    );
  }

  if (!project.brandLockEnabled || project.brandLockTemplate === "none") {
    return NextResponse.json(
      { error: "本项目未启用 Brand Lock 合成" },
      { status: 400 },
    );
  }

  const logoUrl = project.logoUrl || project.primaryImageUrl;
  if (!logoUrl) {
    return NextResponse.json(
      {
        error:
          "缺少品牌 Logo / 产品参考图，至少上传一张才能合成品牌层。请到项目设置里补充。",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    projectId: project.id,
    videoJobId: project.videoJob.id,
    rawVideoUrl,
    alreadyBranded: project.videoJob.brandedVideoUrl,
    config: {
      template: project.brandLockTemplate,
      logoUrl,
      productImageUrl: project.primaryImageUrl,
      position: project.brandLockPosition,
      opacity: project.brandLockOpacity,
      slogan: project.brandLockSlogan,
    },
  });
}

/**
 * 合成完成回传：前端上传 branded mp4 到 Blob 后，把 URL 提交过来。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const brandedVideoUrl = body?.brandedVideoUrl;

  if (typeof brandedVideoUrl !== "string" || !brandedVideoUrl.startsWith("http")) {
    return NextResponse.json(
      { error: "brandedVideoUrl 无效" },
      { status: 400 },
    );
  }

  const project = await db.project.findUnique({
    where: { id },
    include: { videoJob: { select: { id: true } } },
  });

  if (!project || !project.videoJob) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  await db.videoJob.update({
    where: { id: project.videoJob.id },
    data: { brandedVideoUrl },
  });

  return NextResponse.json({ ok: true, brandedVideoUrl });
}
