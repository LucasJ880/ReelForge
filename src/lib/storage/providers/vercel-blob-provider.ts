/**
 * Vercel Blob Storage Provider 适配器。
 *
 * 设计要点：
 * - 复用现有 @vercel/blob `put` / `del` API，保持与历史行为兼容。
 * - Vercel Blob 不区分 uploads / renders bucket（单一存储），用 key prefix 模拟：
 *     uploads/* / renders/*
 * - 没有真正的 signed URL（公开 URL 即 final URL）；getSignedDownloadUrl 返回 public URL。
 *   该限制写在文档里；中国大陆部署不会用 vercel_blob，所以不影响主路径。
 */

import type {
  StorageBucketKind,
  StorageObjectInfo,
  StorageProvider,
  StorageUploadOptions,
} from "../types";

const BUCKET_PREFIX: Record<StorageBucketKind, string> = {
  uploads: "uploads",
  renders: "renders",
};

function joinKey(bucket: StorageBucketKind, key: string): string {
  const prefix = BUCKET_PREFIX[bucket];
  /// 已经带前缀就不重复加
  if (key.startsWith(`${prefix}/`)) return key;
  return `${prefix}/${key.replace(/^\/+/, "")}`;
}

function assertToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN not configured; Vercel Blob storage unavailable",
    );
  }
  return token;
}

export class VercelBlobStorageProvider implements StorageProvider {
  readonly id = "vercel_blob" as const;
  readonly displayName = "Vercel Blob";

  isConfigured(): boolean {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  }

  async uploadFile(
    bucket: StorageBucketKind,
    file: File | Blob,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo> {
    const token = assertToken();
    const { put } = await import("@vercel/blob");
    const fullKey = joinKey(bucket, options.key);
    const blob = await put(fullKey, file, {
      access: "public", // Vercel Blob 当前只支持 public（其 SDK 类型如此）
      token,
      contentType: options.contentType,
      cacheControlMaxAge: options.cacheControl
        ? parseMaxAgeSeconds(options.cacheControl)
        : undefined,
      addRandomSuffix: options.addRandomSuffix ?? false,
      allowOverwrite: options.overwrite ?? false,
    });
    return { key: fullKey, url: blob.url, absolute: true };
  }

  async uploadBuffer(
    bucket: StorageBucketKind,
    buffer: Buffer | Uint8Array,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo> {
    const token = assertToken();
    const { put } = await import("@vercel/blob");
    const fullKey = joinKey(bucket, options.key);
    /// Vercel Blob 的 PutBody 类型只接受 Buffer / Blob / Readable，
    /// 这里把 Uint8Array 也归到 Buffer.from 包一层（无拷贝开销 → Buffer.from 复用底层 ArrayBuffer）
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const blob = await put(fullKey, body, {
      access: "public",
      token,
      contentType: options.contentType,
      cacheControlMaxAge: options.cacheControl
        ? parseMaxAgeSeconds(options.cacheControl)
        : undefined,
      addRandomSuffix: options.addRandomSuffix ?? false,
      allowOverwrite: options.overwrite ?? false,
    });
    return { key: fullKey, url: blob.url, absolute: true };
  }

  async getSignedUploadUrl(): Promise<string | null> {
    /// Vercel Blob 走 client-upload token，不通过本接口签 URL；返回 null 让 caller 走服务端中转
    return null;
  }

  async getSignedDownloadUrl(
    bucket: StorageBucketKind,
    key: string,
  ): Promise<string> {
    /// Vercel Blob 公开 URL 即下载 URL（没有真正的 signed URL）
    return this.getPublicUrl(bucket, key);
  }

  getPublicUrl(bucket: StorageBucketKind, key: string): string {
    /// 注意：Vercel Blob 的真实 URL 在 put 之后才能拿到（带 hash）。
    /// 这里返回一个相对路径占位（绝大多数 caller 会直接用 uploadFile 返回的 url，不调本方法）。
    return `/${joinKey(bucket, key)}`;
  }

  async deleteObject(bucket: StorageBucketKind, key: string): Promise<void> {
    const token = assertToken();
    const { del } = await import("@vercel/blob");
    const fullKey = joinKey(bucket, key);
    await del(fullKey, { token });
  }
}

function parseMaxAgeSeconds(cacheControl: string): number | undefined {
  const m = cacheControl.match(/max-age=(\d+)/i);
  if (!m) return undefined;
  return Number(m[1]);
}
