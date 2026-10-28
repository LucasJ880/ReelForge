/**
 * 视频生成 Provider 工厂入口。
 *
 * 业务代码：
 *   import { getVideoProvider } from "@/lib/video-generation/providers";
 *   const provider = getVideoProvider();
 *   const { providerJobId } = await provider.createVideoJob({ prompt, ... });
 *
 * 真实实现：BytePlus ModelArk（Seedance）、Shuyu（buddy 线路）、Runway（runway 线路，2026-10-28）。
 * 线路由快照决定（createVideoProviderByRouteSnapshot）；VIDEO_PROVIDER 只管默认运行时。
 */

import { getAppEnv } from "@/lib/config/env";
import { MockVideoProvider } from "./mock-video-provider";
import { BytePlusVideoProvider } from "./byteplus-video-provider";
import { ShuyuVideoProvider } from "./shuyu-video-provider";
import { RunwayVideoProvider } from "./runway-video-provider";
import { isRunwayVideoModel } from "@/lib/providers/runway";
import type { VideoProvider } from "./types";
import type { VideoRouteSnapshot } from "../video-route-registry";

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
    case "byteplus":
      return new BytePlusVideoProvider();
    case "shuyu":
      return new ShuyuVideoProvider();
    default: {
      const exhaustiveCheck: never = env.videoProvider;
      throw new Error(
        `[video] 未知 VIDEO_PROVIDER: ${String(exhaustiveCheck)}`,
      );
    }
  }
}

export function createVideoProviderById(
  id: "byteplus" | "shuyu" | "runway" | "mock",
): VideoProvider {
  if (id === "mock") return new MockVideoProvider();
  if (id === "shuyu") return new ShuyuVideoProvider();
  if (id === "runway") return new RunwayVideoProvider();
  return new BytePlusVideoProvider();
}

export function createVideoProviderByRouteSnapshot(
  snapshot: VideoRouteSnapshot,
): VideoProvider {
  if (snapshot.videoRouteSnapshot === "mock") {
    if (snapshot.videoProviderAdapterSnapshot !== "mock") {
      throw new Error("Mock route snapshot has an incompatible adapter");
    }
    return new MockVideoProvider();
  }
  if (snapshot.videoRouteSnapshot === "buddy") {
    if (snapshot.videoProviderAdapterSnapshot !== "shuyu") {
      throw new Error("Shuyu route snapshot has an incompatible adapter");
    }
    return new ShuyuVideoProvider(snapshot.videoModelSnapshot);
  }
  if (snapshot.videoRouteSnapshot === "runway") {
    if (snapshot.videoProviderAdapterSnapshot !== "runway") {
      throw new Error("Runway route snapshot has an incompatible adapter");
    }
    if (!isRunwayVideoModel(snapshot.videoModelSnapshot)) {
      throw new Error(`Runway route snapshot has an unknown model: ${snapshot.videoModelSnapshot}`);
    }
    return new RunwayVideoProvider(snapshot.videoModelSnapshot);
  }
  if (snapshot.videoProviderAdapterSnapshot !== "byteplus") {
    throw new Error("Seedance route snapshot has an incompatible adapter");
  }
  return new BytePlusVideoProvider(
    snapshot.videoRouteSnapshot,
    snapshot.videoModelSnapshot,
  );
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
