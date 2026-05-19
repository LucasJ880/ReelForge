import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertQuotaForSession } from "@/lib/services/quota-service";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpe?g|webp)|audio\/(mpeg|mp4|x-m4a|wav|aac))$/i;

/**
 * 简易 Vercel Blob 上传：前端以 POST multipart/form-data 上传单文件。
 * 用于产品参考图、自定义参考图等。
 *
 * Phase 5 鉴权：任何已登录账号（含 BUSINESS / PERSONAL / 内部 staff）均可调用，
 * 由 size + MIME 白名单 + 文件名 prefix 兜底防滥用。后续 Phase 7a 加单用户配额。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "素材上传暂不可用：服务器未配置 BLOB_READ_WRITE_TOKEN。请先配置 Vercel Blob，或临时使用公开素材 URL 登记。",
      },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error:
          "素材上传失败：单个文件不能超过 100MB。请压缩视频、裁短素材，或改用可公开访问的素材 URL 登记。",
      },
      { status: 413 },
    );
  }
  if (!SUPPORTED_UPLOAD_TYPES.test(file.type)) {
    return NextResponse.json(
      {
        error:
          "素材上传失败：当前 MVP 仅支持 mp4、mov、webm、png、jpg、webp、mp3、wav、m4a、aac。请转换格式后重试。",
      },
      { status: 415 },
    );
  }
  const prefix = (form.get("prefix") as string | null) ?? "uploads";
  const filename = `${prefix}/${Date.now()}-${file.name}`;

  try {
    await assertQuotaForSession(guard.session, "BLOB_UPLOAD_BYTES", file.size);
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) return quotaRes;
    throw err;
  }

  const blob = await put(filename, file, {
    access: "public",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return NextResponse.json({ url: blob.url, pathname: blob.pathname });
}
