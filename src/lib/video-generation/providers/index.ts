/**
 * 视频生成 Provider 工厂入口。
 *
 * 业务代码：
 *   import { getVideoProvider } from "@/lib/video-generation/providers";
 *   const provider = getVideoProvider();
 *   const { providerJobId } = await provider.createVideoJob({ prompt, ... });
 *
 * 当前唯一实现：volcengine（即梦 / Seedance）
 * 未来如果接入其他 video model（Runway / Pika），在此添加并扩展 VIDEO_PROVIDER 枚举。
 */

import { getAppEnv } from "@/lib/config/env";
import { MockVideoProvider } from "./mock-video-provider";
import { VolcengineVideoProvider } from "./volcengine-video-provider";
import type { VideoProvider } from "./types";

let cached: VideoProvider | null = null;

export function getVideoProvider(): VideoProvider {
  if (cached) return cached;
  cached = createVideoProvider();
  return cached;
}

export function createVideoProvider(): VideoProvider {
  const env = getAppEnv();
  switch (env.videoProvider) {
    case "mock":
      return new MockVideoProvider();
    case "volcengine":
      return new VolcengineVideoProvider();
    default: {
      const exhaustiveCheck: never = env.videoProvider;
      throw new Error(
        `[video] 未知 VIDEO_PROVIDER: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

export function createVideoProviderById(
  id: "volcengine" | "mock",
): VideoProvider {
  return id === "mock"
    ? new MockVideoProvider()
    : new VolcengineVideoProvider();
}

export function __resetVideoProviderForTests(): void {
  cached = null;
}

export type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  NormalizedVideoStatus,
  VideoJobStatusResult,
  VideoJobReferenceImage,
  VideoProvider,
} from "./types";
export { normalizeStatusBuiltin } from "./types";
