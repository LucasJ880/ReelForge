import { put } from "@vercel/blob";

/**
 * 把 Seedance（或任何外部）的临时视频 URL 下载并上传到 Vercel Blob
 * 返回持久化的 public URL，不再依赖上游的签名过期
 */
export async function persistRemoteVideo(
  remoteUrl: string,
  keyPrefix: string,
): Promise<string> {
  if (!remoteUrl) throw new Error("persistRemoteVideo: 缺少 remoteUrl");

  if (remoteUrl.includes(".public.blob.vercel-storage.com") ||
      remoteUrl.includes(".blob.vercel-storage.com")) {
    return remoteUrl;
  }

  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`下载远端视频失败: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "video/mp4";
  const buf = await res.arrayBuffer();

  const filename = `${keyPrefix}-${Date.now()}.mp4`;
  const blob = await put(filename, new Blob([buf], { type: contentType }), {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  return blob.url;
}

export async function persistRemoteImage(
  remoteUrl: string,
  keyPrefix: string,
): Promise<string> {
  if (!remoteUrl) throw new Error("persistRemoteImage: 缺少 remoteUrl");

  if (remoteUrl.includes(".public.blob.vercel-storage.com") ||
      remoteUrl.includes(".blob.vercel-storage.com")) {
    return remoteUrl;
  }

  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`下载远端图片失败: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buf = await res.arrayBuffer();
  const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";

  const filename = `${keyPrefix}-${Date.now()}.${ext}`;
  const blob = await put(filename, new Blob([buf], { type: contentType }), {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  return blob.url;
}
