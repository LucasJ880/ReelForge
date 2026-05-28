/**
 * Storage Provider 抽象。
 *
 * 设计原则：
 * - 业务代码不直接 import @vercel/blob 或 @volcengine/tos-sdk。
 * - 区分两种 bucket：uploads（用户素材）/ renders（生成视频成品）。
 *   两个 bucket 默认可以指向同一个，但建议分开（uploads 限制更紧，renders 走 CDN）。
 * - 默认私有 bucket + signed URL；如果某个对象需要长期公开（如 demo 视频），
 *   显式 access: "public"。
 * - 中国大陆模式下，getPublicUrl 优先返回 CDN_BASE_URL 拼接的 URL。
 */

export type StorageBucketKind = "uploads" | "renders";

export interface StorageUploadOptions {
  /// 路径（不带 bucket，例如 "video-briefs/{id}/segment-0.mp4"）
  key: string;
  contentType?: string;
  /// 默认 "private"（需 signed URL 才能访问），显式 "public" 才会返回直链
  access?: "public" | "private";
  /// 缓存策略（如 "public, max-age=31536000, immutable"），按需
  cacheControl?: string;
  /// 是否允许覆盖已存在对象；默认 false（写入冲突时 throw）
  overwrite?: boolean;
  /// 是否在文件名末尾加随机后缀（防止覆盖；默认 false）
  addRandomSuffix?: boolean;
}

export interface StorageObjectInfo {
  key: string;
  url: string;
  /// 是否为完整 https:// URL（true）还是相对路径（false）
  absolute: boolean;
}

export interface StorageSignedUrlOptions {
  /// 有效期（秒），默认 600
  expiresInSeconds?: number;
  /// 仅 download 时可用；指定 Content-Disposition
  contentDisposition?: string;
}

export interface StorageProvider {
  readonly id: "vercel_blob" | "volcengine_tos";
  readonly displayName: string;

  isConfigured(): boolean;

  /**
   * 上传 File 对象（Web 标准 File / Blob）。Vercel Blob 原生支持；火山 TOS 内部读取 buffer。
   */
  uploadFile(
    bucket: StorageBucketKind,
    file: File | Blob,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo>;

  /**
   * 上传二进制 buffer。
   */
  uploadBuffer(
    bucket: StorageBucketKind,
    buffer: Buffer | Uint8Array,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo>;

  /**
   * 直传 / 客户端上传：生成 signed PUT URL。
   * 不支持时返回 null（caller 退回服务端中转）。
   */
  getSignedUploadUrl(
    bucket: StorageBucketKind,
    key: string,
    options?: StorageSignedUrlOptions & { contentType?: string },
  ): Promise<string | null>;

  /**
   * 生成签名下载链接（私有对象用）。
   */
  getSignedDownloadUrl(
    bucket: StorageBucketKind,
    key: string,
    options?: StorageSignedUrlOptions,
  ): Promise<string>;

  /**
   * 拼装公开 URL（仅 access=public 上传的对象有意义）。
   * 中国大陆模式下，如果配置了 CDN_BASE_URL，优先返回 CDN URL。
   */
  getPublicUrl(bucket: StorageBucketKind, key: string): string;

  /**
   * 删除对象。
   */
  deleteObject(bucket: StorageBucketKind, key: string): Promise<void>;

  /**
   * 复制对象（同 bucket 或跨 bucket）。
   * Vercel Blob 不直接支持，需要 download + upload；火山 TOS 原生支持。
   */
  copyObject?(
    sourceBucket: StorageBucketKind,
    sourceKey: string,
    destBucket: StorageBucketKind,
    destKey: string,
  ): Promise<StorageObjectInfo>;
}
