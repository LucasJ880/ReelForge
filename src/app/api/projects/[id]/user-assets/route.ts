import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePro } from "@/lib/api-auth";
import { handleApiError } from "@/lib/utils/api-error";
import { del } from "@vercel/blob";

/**
 * 用户视频素材池（保留接口，供未来 b-roll 混剪用）。
 * 当前 Pro 主流程不再消费这里的素材，但数据字段 `userVideoAssets` 仍保留。
 *
 * GET    列出当前素材 URL
 * POST   追加素材 URL（先由浏览器用 /api/upload/video-token 直传 Blob）
 * DELETE 移除指定 URL（同时清理 Blob）
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const project = await db.project.findUnique({
    where: { id },
    select: { userVideoAssets: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ assets: project.userVideoAssets });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: { url?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  if (!body.url || !/^https?:\/\//.test(body.url)) {
    return NextResponse.json({ error: "url 参数无效" }, { status: 400 });
  }

  try {
    const project = await db.project.update({
      where: { id },
      data: {
        userVideoAssets: { push: body.url },
      },
      select: { userVideoAssets: true },
    });
    return NextResponse.json({ assets: project.userVideoAssets });
  } catch (error) {
    return handleApiError(error, "添加素材");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "缺少 url" }, { status: 400 });
  }

  try {
    const project = await db.project.findUnique({
      where: { id },
      select: { userVideoAssets: true },
    });
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const next = project.userVideoAssets.filter((u) => u !== url);
    await db.project.update({
      where: { id },
      data: { userVideoAssets: next },
    });

    // 清理 Blob（非致命失败）
    if (url.includes(".blob.vercel-storage.com")) {
      try {
        await del(url);
      } catch (e) {
        console.warn("[user-assets] del blob failed:", e);
      }
    }

    return NextResponse.json({ assets: next });
  } catch (error) {
    return handleApiError(error, "删除素材");
  }
}
