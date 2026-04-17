import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/api-auth";

/**
 * 客户端直传 Blob 的 token 路由
 *
 * 浏览器端 Free 通道合成完整 mp4 后，通过 @vercel/blob/client 的 upload() 直传，
 * Vercel 会回调本路由生成临时 client token。
 *
 * 参考 https://vercel.com/docs/storage/vercel-blob/client-upload
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const allowed =
          pathname.startsWith("free-output/") ||
          pathname.startsWith("user-assets/");
        if (!allowed) {
          throw new Error("仅允许上传到 free-output/ 或 user-assets/ 目录");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("[free-upload] blob uploaded:", blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 400 },
    );
  }
}
