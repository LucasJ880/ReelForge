/**
 * 判断 URL 是否为「带过期签名的临时地址」（如火山 TOS / S3 预签名，24h 失效）。
 * 这类 URL 绝不能直接写进 stitchedVideoUrl —— 过期后成片 403，用户视角等于视频丢失；
 * 只重拼也不能拿它当段原片——下载时多半已经 403。
 * 轻模块：stitch-service 与成品库服务共用，不带 ffmpeg 依赖。
 */
export function isEphemeralSignedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const params = u.searchParams;
    return (
      params.has("X-Tos-Expires") ||
      params.has("X-Amz-Expires") ||
      params.has("X-Tos-Signature") ||
      params.has("X-Amz-Signature") ||
      params.has("Expires")
    );
  } catch {
    return false;
  }
}
