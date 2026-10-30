import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";
import type { UploadTicketResponse } from "@/lib/contracts/upload-blob";
import { validateMediaMagicBytes } from "@/lib/upload/media-file-validation";

export interface BlobUploadResult {
  assetId: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export class BlobUploadHttpError extends Error {
  constructor(
    message: string,
    readonly details: {
      status: number;
      code?: string;
      retryable?: boolean;
      action?: CustomerRecoveryAction;
    },
  ) {
    super(message);
    this.name = "BlobUploadHttpError";
  }
}

export interface BlobUploadOptions {
  file: File;
  endpoint?: string;
  prefix?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

/// 超过这个大小走分片直传：分片并行、失败分片自动重试，手机网络传大视频更稳。
const MULTIPART_THRESHOLD_BYTES = 32 * 1024 * 1024;
const NETWORK_FAILURE_MESSAGE = "上传失败，请检查网络后重试";

interface AssetPayload {
  asset?: {
    id?: string;
    url?: string;
    mimeType?: string;
    width?: number | null;
    height?: number | null;
  };
  error?: string;
  code?: string;
  retryable?: boolean;
  action?: CustomerRecoveryAction;
}

/**
 * 全站素材上传的唯一入口（创作页、品牌包、上手引导、批量、商品锚点、产品图共用）。
 *
 * 10-30 CEO 演示翻车：手机原图 3–8MB，而 Vercel 函数请求体上限是 4.5MB——文件只要
 * 穿过 /api/upload/blob，平台就直接回 413 FUNCTION_PAYLOAD_TOO_LARGE，我们的代码根本
 * 没被调用；本地 next dev 没有这个上限，所以本地怎么测都是好的。现在文件不经过函数：
 *   1. POST {endpoint}/ticket   只报类型与大小，换一张限定路径 / 类型 / 大小的写入凭证
 *   2. 浏览器直接 PUT 到 Vercel Blob（100MB 以内都行）
 *   3. POST {endpoint}/complete 服务端验签名、扣额度、登记资产，返回资产 ID
 * 存储不支持直传（国内 TOS）时 ticket 回 mode=server，退回 multipart 中转。
 */
export async function uploadBlobWithProgress({
  file,
  endpoint = "/api/upload/blob",
  prefix = "unified-input",
  signal,
  onProgress,
}: BlobUploadOptions): Promise<BlobUploadResult> {
  if (signal?.aborted) throw abortError();
  const contentType = await uploadContentType(file);
  const ticket = await postJson<UploadTicketResponse>(
    `${endpoint}/ticket`,
    { contentType, size: file.size, prefix },
    signal,
  );
  if (ticket.mode === "server") {
    return uploadThroughServer({ file, endpoint, prefix, signal, onProgress });
  }

  const { put } = await import("@vercel/blob/client");
  try {
    await put(ticket.pathname, file, {
      access: "public",
      token: ticket.clientToken,
      contentType,
      multipart: file.size > MULTIPART_THRESHOLD_BYTES,
      abortSignal: signal,
      onUploadProgress: ({ percentage }) => {
        /// 100 留给登记完成：对象传完、资产还没入库时不该显示「已完成」
        onProgress?.(Math.min(99, Math.round(percentage)));
      },
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    console.warn("[upload] direct upload failed", error instanceof Error ? error.name : error);
    throw new Error(NETWORK_FAILURE_MESSAGE);
  }

  const completed = await postJson<AssetPayload>(
    `${endpoint}/complete`,
    { ticket: ticket.ticket },
    signal,
  );
  const result = toUploadResult(completed);
  if (!result) throw new Error(NETWORK_FAILURE_MESSAGE);
  onProgress?.(100);
  return result;
}

function abortError(): DOMException {
  return new DOMException("上传已取消", "AbortError");
}

/// 手机相册、微信转存常见「.png 名字、JPEG 内容」：以文件签名为准声明类型，
/// 与服务端中转同一口径（签名对不上的交给 complete 拒收并删对象）。
async function uploadContentType(file: File): Promise<string> {
  try {
    const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    const magic = validateMediaMagicBytes(header, file.type);
    if (magic.ok && magic.detected.startsWith("image/")) return magic.detected;
  } catch {
    // 读不到文件头就按浏览器报的类型走，由服务端兜底校验
  }
  return file.type;
}

function toUploadResult(payload: AssetPayload): BlobUploadResult | null {
  const asset = payload.asset;
  if (!asset?.id || !asset.url || !asset.mimeType) return null;
  return {
    assetId: asset.id,
    url: asset.url,
    mimeType: asset.mimeType,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

function statusMessage(status: number): string {
  if (status === 413) return "文件超过服务器单次上传上限，请压缩后重试。";
  if (status === 401) return "登录已失效，请刷新页面重新登录。";
  return `上传失败 (${status})`;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) throw abortError();
    throw new Error(NETWORK_FAILURE_MESSAGE);
  }
  const payload = (await response.json().catch(() => null)) as
    | (AssetPayload & { ok?: boolean })
    | null;
  if (!response.ok || !payload || payload.ok !== true) {
    throw new BlobUploadHttpError(payload?.error ?? statusMessage(response.status), {
      status: response.status,
      code: payload?.code,
      retryable: payload?.retryable,
      action: payload?.action,
    });
  }
  return payload as T;
}

/** 服务端中转（multipart）：只给不支持直传的存储用，见 uploadBlobWithProgress。 */
function uploadThroughServer({
  file,
  endpoint = "/api/upload/blob",
  prefix = "unified-input",
  signal,
  onProgress,
}: BlobUploadOptions): Promise<BlobUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("prefix", prefix);

    const abort = () => {
      xhr.abort();
      reject(abortError());
    };

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onerror = () => reject(new Error(NETWORK_FAILURE_MESSAGE));
    xhr.onabort = () => reject(abortError());
    xhr.onload = () => {
      if (signal) signal.removeEventListener("abort", abort);
      let payload: AssetPayload = {};
      try {
        payload = JSON.parse(xhr.responseText) as AssetPayload;
      } catch {
        reject(new BlobUploadHttpError(statusMessage(xhr.status), { status: xhr.status }));
        return;
      }
      const result = toUploadResult(payload);
      if (xhr.status < 200 || xhr.status >= 300 || !result) {
        reject(
          new BlobUploadHttpError(payload.error ?? statusMessage(xhr.status), {
            status: xhr.status,
            code: payload.code,
            retryable: payload.retryable,
            action: payload.action,
          }),
        );
        return;
      }
      resolve(result);
    };

    xhr.open("POST", endpoint);
    xhr.send(form);
  });
}
