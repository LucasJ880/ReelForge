/**
 * 火山引擎 TOS（Tinder Object Storage）Provider 适配器。
 *
 * 接入 @volcengine/tos-sdk 2.9+：
 *   - putObject / deleteObject / copyObject / headObject / headBucket
 *   - getPreSignedUrl (同步，GET / PUT)
 *
 * 设计要点：
 * 1. **lazy import**：SDK 仅在第一次实际调用时才加载，海外部署不会因为 import 失败炸场。
 * 2. **client 单例缓存**：避免每次调用都 new TosClient（内部带 axios + agent）。
 * 3. **uploads / renders 拆 bucket**：业务侧只关心逻辑 bucket，物理 bucket 名走 env。
 * 4. **公开 URL 顺序**：CDN_BASE_URL > VOLCENGINE_TOS_PUBLIC_BASE_URL > 默认 https://bucket.endpoint
 * 5. **签名 URL 默认 600s**：避免 caller 忘记设 expires 时签出永久 URL。
 * 6. **forbidOverwrite 默认 true**（与 overwrite=false 对齐）；overwrite=true 时关闭。
 * 7. **错误信息脱敏**：抛出的 Error message 不带 AccessKey / Secret。
 * 8. **bucket 名 / region / endpoint 不写死**：全部走 env，缺失时给清晰错误。
 */

import { randomBytes } from "node:crypto";
import type {
  StorageBucketKind,
  StorageObjectInfo,
  StorageProvider,
  StorageSignedUrlOptions,
  StorageUploadOptions,
} from "../types";

interface TosConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketUploads: string;
  bucketRenders: string;
  publicBaseUrl: string | null;
  cdnBaseUrl: string | null;
}

function readConfig(): TosConfig | null {
  const accessKeyId = process.env.VOLCENGINE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.VOLCENGINE_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.VOLCENGINE_TOS_ENDPOINT?.trim();
  const region = process.env.VOLCENGINE_TOS_REGION?.trim() || "cn-beijing";
  const bucketUploads = process.env.VOLCENGINE_TOS_BUCKET_UPLOADS?.trim();
  const bucketRenders = process.env.VOLCENGINE_TOS_BUCKET_RENDERS?.trim();
  if (
    !accessKeyId ||
    !secretAccessKey ||
    !endpoint ||
    !bucketUploads ||
    !bucketRenders
  ) {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    bucketUploads,
    bucketRenders,
    publicBaseUrl: process.env.VOLCENGINE_TOS_PUBLIC_BASE_URL?.trim() || null,
    cdnBaseUrl: process.env.CDN_BASE_URL?.trim() || null,
  };
}

function requireConfig(method: string): TosConfig {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(
      `[volcengine-tos] ${method} 调用失败：缺少必要环境变量。\n` +
        `  请确认以下变量已配置：\n` +
        `  - VOLCENGINE_ACCESS_KEY_ID\n` +
        `  - VOLCENGINE_SECRET_ACCESS_KEY\n` +
        `  - VOLCENGINE_TOS_ENDPOINT\n` +
        `  - VOLCENGINE_TOS_BUCKET_UPLOADS\n` +
        `  - VOLCENGINE_TOS_BUCKET_RENDERS\n` +
        `  参考 .env.china.example 与 docs/CHINA_DEPLOYMENT.md 的"对象存储"章节。`,
    );
  }
  return cfg;
}

function getBucketName(cfg: TosConfig, kind: StorageBucketKind): string {
  return kind === "uploads" ? cfg.bucketUploads : cfg.bucketRenders;
}

function normalizeKey(key: string): string {
  /// TOS object key 不能以 "/" 起头；空白会被 SDK 报错
  return key.replace(/^\/+/, "").trim();
}

function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

function appendRandomSuffix(key: string): string {
  const idx = key.lastIndexOf(".");
  const suffix = randomBytes(6).toString("hex");
  if (idx <= 0) return `${key}-${suffix}`;
  return `${key.slice(0, idx)}-${suffix}${key.slice(idx)}`;
}

/// 把 SDK 异常转成简短、不含密钥的中文错误（保留 status code / requestId 便于排查）
function sanitizeError(method: string, err: unknown): Error {
  const e = err as {
    statusCode?: number;
    code?: string;
    message?: string;
    requestId?: string;
    name?: string;
  };
  const parts = [
    `[volcengine-tos] ${method} 失败`,
    e.statusCode ? `status=${e.statusCode}` : null,
    e.code ? `code=${e.code}` : null,
    e.requestId ? `requestId=${e.requestId}` : null,
  ].filter(Boolean);
  const baseMsg = parts.join(" ");
  const detail = (e.message || "").slice(0, 240);
  /// 防御性：剥掉任何看着像 AccessKey 的串（AKxxx / 长 base64）
  const sanitizedDetail = detail
    .replace(/AK[A-Za-z0-9]{16,}/g, "AK***")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "***");
  const out = new Error(`${baseMsg}: ${sanitizedDetail}`);
  out.name = "VolcengineTosError";
  return out;
}

/// 懒加载并缓存 TosClient 实例（按 endpoint+region+ak 哈希避免误用旧 client）
type TosClientInstance = {
  putObject: (input: Record<string, unknown>) => Promise<unknown>;
  deleteObject: (input: Record<string, unknown>) => Promise<unknown>;
  copyObject: (input: Record<string, unknown>) => Promise<unknown>;
  headObject: (input: Record<string, unknown>) => Promise<unknown>;
  headBucket: (bucket?: string) => Promise<unknown>;
  getPreSignedUrl: (input: Record<string, unknown>) => string;
};

let cachedClient: { key: string; client: TosClientInstance } | null = null;

async function getClient(cfg: TosConfig): Promise<TosClientInstance> {
  const cacheKey = `${cfg.endpoint}|${cfg.region}|${cfg.accessKeyId.slice(0, 8)}`;
  if (cachedClient && cachedClient.key === cacheKey) return cachedClient.client;
  let TosClient: new (cfg: Record<string, unknown>) => TosClientInstance;
  try {
    /// dynamic import：让海外部署的 deps 解析不会强依赖这个 SDK
    const mod = (await import("@volcengine/tos-sdk")) as unknown as {
      TosClient: new (cfg: Record<string, unknown>) => TosClientInstance;
    };
    TosClient = mod.TosClient;
  } catch (err) {
    throw new Error(
      `[volcengine-tos] @volcengine/tos-sdk 未安装或加载失败：${(err as Error).message}\n` +
        `  解决方案：在中国大陆部署机器上 \`npm install @volcengine/tos-sdk\`，或在 Docker 镜像中 npm ci。`,
    );
  }
  const client = new TosClient({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.secretAccessKey,
    region: cfg.region,
    endpoint: cfg.endpoint,
  });
  cachedClient = { key: cacheKey, client };
  return client;
}

/// 仅测试用：清掉 client 缓存（让测试可以切换 endpoint / mock）
export function __resetVolcengineTosClientForTests(): void {
  cachedClient = null;
}

export class VolcengineTosStorageProvider implements StorageProvider {
  readonly id = "volcengine_tos" as const;
  readonly displayName = "火山引擎 TOS";

  isConfigured(): boolean {
    return readConfig() !== null;
  }

  async uploadFile(
    bucket: StorageBucketKind,
    file: File | Blob,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      options.contentType ||
      (typeof (file as File).type === "string" ? (file as File).type : undefined);
    return this.uploadBuffer(bucket, buffer, {
      ...options,
      contentType,
    });
  }

  async uploadBuffer(
    bucket: StorageBucketKind,
    buffer: Buffer | Uint8Array,
    options: StorageUploadOptions,
  ): Promise<StorageObjectInfo> {
    const cfg = requireConfig("uploadBuffer");
    const client = await getClient(cfg);
    const baseKey = normalizeKey(options.key);
    const finalKey = options.addRandomSuffix ? appendRandomSuffix(baseKey) : baseKey;
    const physicalBucket = getBucketName(cfg, bucket);
    /// SDK 接受 Buffer / Stream / string；统一包成 Buffer 避免 Uint8Array 类型分歧
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    /// overwrite=true 时不传 forbidOverwrite；false（默认）→ forbidOverwrite=true 让冲突立刻报错
    const forbidOverwrite = options.overwrite === true ? undefined : true;

    try {
      await client.putObject({
        bucket: physicalBucket,
        key: finalKey,
        body,
        contentType: options.contentType,
        cacheControl: options.cacheControl,
        forbidOverwrite,
      });
    } catch (err) {
      throw sanitizeError("uploadBuffer", err);
    }

    /// 上传后返回 URL：access=public 用 CDN/公开域名；其余返回 endpoint 直链
    const access = options.access ?? "private";
    const url =
      access === "public"
        ? this.getPublicUrl(bucket, finalKey)
        : defaultEndpointUrl(cfg, physicalBucket, finalKey);
    return { key: finalKey, url, absolute: true };
  }

  async getSignedUploadUrl(
    bucket: StorageBucketKind,
    key: string,
    options?: StorageSignedUrlOptions & { contentType?: string },
  ): Promise<string | null> {
    const cfg = requireConfig("getSignedUploadUrl");
    const client = await getClient(cfg);
    const physicalBucket = getBucketName(cfg, bucket);
    const expires = options?.expiresInSeconds ?? 600;
    try {
      /// 注：TOS PUT signed URL 不强制 contentType（与 S3 不同）；
      /// 但客户端若要把 Content-Type 写进 PUT header，签名时要带上，否则可能签名不匹配。
      /// 当 caller 显式传 contentType 时，我们把它放到 query → 由客户端通过 PUT header 提交同名
      const input: Record<string, unknown> = {
        method: "PUT",
        bucket: physicalBucket,
        key: normalizeKey(key),
        expires,
      };
      if (options?.contentType) {
        /// TOS SDK 允许 query 透传自定义参数；contentType 仍由客户端 PUT header 提供
        input.query = { "Content-Type": options.contentType };
      }
      return client.getPreSignedUrl(input);
    } catch (err) {
      throw sanitizeError("getSignedUploadUrl", err);
    }
  }

  async getSignedDownloadUrl(
    bucket: StorageBucketKind,
    key: string,
    options?: StorageSignedUrlOptions,
  ): Promise<string> {
    const cfg = requireConfig("getSignedDownloadUrl");
    const client = await getClient(cfg);
    const physicalBucket = getBucketName(cfg, bucket);
    const expires = options?.expiresInSeconds ?? 600;
    try {
      const input: Record<string, unknown> = {
        method: "GET",
        bucket: physicalBucket,
        key: normalizeKey(key),
        expires,
      };
      if (options?.contentDisposition) {
        input.response = { contentDisposition: options.contentDisposition };
      }
      return client.getPreSignedUrl(input);
    } catch (err) {
      throw sanitizeError("getSignedDownloadUrl", err);
    }
  }

  getPublicUrl(bucket: StorageBucketKind, key: string): string {
    const cfg = requireConfig("getPublicUrl");
    const normalizedKey = normalizeKey(key);
    /// CDN 优先（推荐生产用法：renders bucket 后挂 CDN）
    if (cfg.cdnBaseUrl) return joinUrl(cfg.cdnBaseUrl, normalizedKey);
    if (cfg.publicBaseUrl) return joinUrl(cfg.publicBaseUrl, normalizedKey);
    /// 退回 TOS 默认 endpoint（要求 bucket ACL 公开，或后挂 CDN）
    const physicalBucket = getBucketName(cfg, bucket);
    return defaultEndpointUrl(cfg, physicalBucket, normalizedKey);
  }

  async deleteObject(
    bucket: StorageBucketKind,
    key: string,
  ): Promise<void> {
    const cfg = requireConfig("deleteObject");
    const client = await getClient(cfg);
    try {
      await client.deleteObject({
        bucket: getBucketName(cfg, bucket),
        key: normalizeKey(key),
      });
    } catch (err) {
      throw sanitizeError("deleteObject", err);
    }
  }

  async copyObject(
    sourceBucket: StorageBucketKind,
    sourceKey: string,
    destBucket: StorageBucketKind,
    destKey: string,
  ): Promise<StorageObjectInfo> {
    const cfg = requireConfig("copyObject");
    const client = await getClient(cfg);
    const destPhysical = getBucketName(cfg, destBucket);
    const finalKey = normalizeKey(destKey);
    try {
      await client.copyObject({
        bucket: destPhysical,
        key: finalKey,
        srcBucket: getBucketName(cfg, sourceBucket),
        srcKey: normalizeKey(sourceKey),
      });
    } catch (err) {
      throw sanitizeError("copyObject", err);
    }
    return {
      key: finalKey,
      url: defaultEndpointUrl(cfg, destPhysical, finalKey),
      absolute: true,
    };
  }

  /**
   * 健康检查专用：对 renders bucket 做一次 `headBucket`。
   *
   * - 成功 → bucket 存在 + AK/SK + 网络全通
   * - 404 → bucket 不存在
   * - 403 → 权限不足
   * - 其它 → 网络 / 配置问题
   *
   * 不在 StorageProvider interface 上声明，避免污染 vercel-blob 一侧。
   * /api/health 通过 `instanceof VolcengineTosStorageProvider` 调用。
   */
  async pingBucket(bucket: StorageBucketKind = "renders"): Promise<{
    ok: boolean;
    error?: string;
  }> {
    const cfg = readConfig();
    if (!cfg) {
      return {
        ok: false,
        error: "TOS env 未配置（缺 ACCESS_KEY/SECRET/ENDPOINT/BUCKET）",
      };
    }
    try {
      const client = await getClient(cfg);
      await client.headBucket(getBucketName(cfg, bucket));
      return { ok: true };
    } catch (err) {
      /// 故意不调 sanitizeError(throw)：健康检查需要把错误吞掉返回 ok=false
      const e = err as { statusCode?: number; code?: string; message?: string };
      const code = e.statusCode ?? e.code ?? "unknown";
      return { ok: false, error: `headBucket status=${code}` };
    }
  }
}

function defaultEndpointUrl(
  cfg: TosConfig,
  physicalBucket: string,
  key: string,
): string {
  /// 容错：endpoint 可能写 "tos-cn-beijing.volces.com" 或 "https://tos-cn-beijing.volces.com"
  const endpointHost = cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${physicalBucket}.${endpointHost}/${key.replace(/^\/+/, "")}`;
}
