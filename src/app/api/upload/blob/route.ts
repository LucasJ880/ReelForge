import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { quotaErrorResponse } from "@/lib/api-quota";
import { assertQuotaForSession } from "@/lib/services/quota-service";
import { getStorageProvider } from "@/lib/storage";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpe?g|webp)|audio\/(mpeg|mp4|x-m4a|wav|aac))$/i;

/**
 * 通用素材上传：前端以 POST multipart/form-data 上传单文件。
 * 用于产品参考图、自定义参考图等。
 *
 * Phase 2A：从直接 import @vercel/blob 改为走 storage provider 抽象层。
 *   - 海外部署：STORAGE_PROVIDER=vercel_blob → 走 Vercel Blob
 *   - 国内部署：STORAGE_PROVIDER=volcengine_tos → 走火山 TOS
 *
 * 鉴权：任何已登录账号（含 BUSINESS / PERSONAL / 内部 staff）均可调用，
 * 由 size + MIME 白名单 + 文件名 prefix 兜底防滥用。Phase 7a 已加单用户配额。
 *
 * Response 形状保持向后兼容：`{ url, pathname }`（pathname 现在等价于 storage key）。
 */
export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    return NextResponse.json(
      {
        error:
          "素材上传暂不可用：当前 STORAGE_PROVIDER 未完整配置。请联系运营核对部署配置。",
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
  const key = `${prefix}/${Date.now()}-${file.name}`;

  try {
    await assertQuotaForSession(guard.session, "BLOB_UPLOAD_BYTES", file.size);
  } catch (err) {
    const quotaRes = quotaErrorResponse(err);
    if (quotaRes) return quotaRes;
    throw err;
  }

  /// 用户上传素材走 uploads bucket（与生成视频成品的 renders bucket 隔离）
  /// access=public：当前业务模型里素材 URL 需要长期可被 AI provider 拉取（Seedance / Ark vision），
  /// 不能用短时效 signed URL。生产环境推荐 TOS bucket 公开读 + 单独 ACL，或外挂 CDN。
  const result = await storage.uploadFile("uploads", file, {
    key,
    access: "public",
    contentType: file.type || undefined,
  });
  return NextResponse.json({ url: result.url, pathname: result.key });
}
