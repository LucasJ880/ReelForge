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
 *   - vercel_blob (默认海外)
 *   - volcengine_tos (默认 cn region；Phase 2A 已接入 @volcengine/tos-sdk 真实 API)
 */

import { getAppEnv } from "@/lib/config/env";
import { VercelBlobStorageProvider } from "./providers/vercel-blob-provider";
import { VolcengineTosStorageProvider } from "./providers/volcengine-tos-provider";
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
    case "volcengine_tos":
      return new VolcengineTosStorageProvider();
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
