export interface BlobUploadResult {
  url: string;
  pathname?: string;
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
      let payload: { url?: string; pathname?: string; error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        reject(new Error(`上传失败 (${xhr.status})`));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !payload.url) {
        reject(new Error(payload.error ?? `上传失败 (${xhr.status})`));
        return;
      }
      resolve({ url: payload.url, pathname: payload.pathname });
    };

    xhr.open("POST", endpoint);
    xhr.send(form);
  });
}
