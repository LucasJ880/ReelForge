/**
 * 素材上传的统一口径：服务端中转（POST /api/upload/blob）与浏览器直传
 * （/api/upload/blob/ticket → 对象存储 → /api/upload/blob/complete）共用一份。
 * 纯常量与纯函数，客户端也可以引用。
 */

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const SUPPORTED_UPLOAD_TYPES =
  /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpe?g|webp)|audio\/(mpeg|mp4|x-m4a|wav|aac))$/i;

export const SAFE_UPLOAD_PREFIX =
  /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export const UPLOAD_TOO_LARGE_MESSAGE =
  "素材上传失败：单个文件不能超过 100MB。请压缩视频、裁短素材，或拆分后重新上传以获取服务器资产 ID。";

export const UPLOAD_UNSUPPORTED_TYPE_MESSAGE =
  "素材上传失败：当前 MVP 仅支持 mp4、mov、webm、png、jpg、webp、mp3、wav、m4a、aac。请转换格式后重试。";

export function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg":
    case "image/jpg": return ".jpg";
    case "image/webp": return ".webp";
    case "video/mp4": return ".mp4";
    case "video/quicktime": return ".mov";
    case "video/webm": return ".webm";
    case "video/x-m4v": return ".m4v";
    case "audio/mpeg": return ".mp3";
    case "audio/mp4":
    case "audio/x-m4a": return ".m4a";
    case "audio/wav": return ".wav";
    case "audio/aac": return ".aac";
    default: return "";
  }
}

/** uploads 桶里的对象路径：与 Vercel Blob provider 的 joinKey 同一规则（已带 uploads/ 就不重复加）。 */
export function uploadsObjectPathname(prefix: string, id: string, mimeType: string): string {
  const key = `${prefix}/${id}${extensionForMime(mimeType)}`;
  return key.startsWith("uploads/") ? key : `uploads/${key}`;
}
