import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";

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

export function uploadBlobWithProgress({
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
      reject(new DOMException("上传已取消", "AbortError"));
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

    xhr.onerror = () => reject(new Error("上传失败，请检查网络后重试"));
    xhr.onabort = () => reject(new DOMException("上传已取消", "AbortError"));
    xhr.onload = () => {
      if (signal) signal.removeEventListener("abort", abort);
      let payload: {
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
      } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        reject(new Error(`上传失败 (${xhr.status})`));
        return;
      }
      if (
        xhr.status < 200 ||
        xhr.status >= 300 ||
        !payload.asset?.id ||
        !payload.asset.url ||
        !payload.asset.mimeType
      ) {
        reject(
          new BlobUploadHttpError(
            payload.error ?? `上传失败 (${xhr.status})`,
            {
              status: xhr.status,
              code: payload.code,
              retryable: payload.retryable,
              action: payload.action,
            },
          ),
        );
        return;
      }
      resolve({
        assetId: payload.asset.id,
        url: payload.asset.url,
        mimeType: payload.asset.mimeType,
        width: payload.asset.width ?? null,
        height: payload.asset.height ?? null,
      });
    };

    xhr.open("POST", endpoint);
    xhr.send(form);
  });
}
