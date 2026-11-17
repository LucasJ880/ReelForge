/**
 * Storage Provider 工厂入口。
 *
 * 业务代码：
 *   import { getStorageProvider } from "@/lib/storage";
 *   const storage = getStorageProvider();
 *   const blob = await storage.uploadBuffer("renders", buffer, { key, contentType });
 *   return blob.url;
 *
 * Provider 选择由 STORAGE_PROVIDER 决定：
 *   - vercel_blob（默认，也是唯一实现；火山 TOS 随国内版部署 2026-11-16 一起删了，
 *     写别的值在 env 解析时就报错）
 */

import { getAppEnv } from "@/lib/config/env";
import { VercelBlobStorageProvider } from "./providers/vercel-blob-provider";
import type { StorageProvider } from "./types";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  cached = createStorageProvider();
  return cached;
}

export function createStorageProvider(): StorageProvider {
  const env = getAppEnv();
  switch (env.storageProvider) {
    case "vercel_blob":
      return new VercelBlobStorageProvider();
    default: {
      const exhaustiveCheck: never = env.storageProvider;
      throw new Error(
        `[storage] 未知 STORAGE_PROVIDER: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

export function __resetStorageProviderForTests(): void {
  cached = null;
}

export type {
  StorageProvider,
  StorageObjectInfo,
  StorageUploadOptions,
  StorageBucketKind,
  StorageSignedUrlOptions,
} from "./types";
