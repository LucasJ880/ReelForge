/**
 * 视频生成 Provider 工厂入口。
 *
 * 业务代码：
 *   import { getVideoProvider } from "@/lib/video-generation/providers";
 *   const provider = getVideoProvider();
 *   const { providerJobId } = await provider.createVideoJob({ prompt, ... });
 *
 * 真实实现：BytePlus ModelArk（Seedance）、Shuyu（buddy 线路）。
 * 线路由快照决定（createVideoProviderByRouteSnapshot）；VIDEO_PROVIDER 只管默认运行时。
 * runway 线路 2026-11-16 下线、适配器已删：旧记录上的 runway 快照到这里会被明确拒绝。
 */

import { getAppEnv } from "@/lib/config/env";
import { MockVideoProvider } from "./mock-video-provider";
import { BytePlusVideoProvider } from "./byteplus-video-provider";
import { ShuyuVideoProvider } from "./shuyu-video-provider";
import type { VideoProvider } from "./types";
import { isRetiredVideoRouteId, type VideoRouteSnapshot } from "../video-route-registry";

/** 旧记录上的线路已下线：没有适配器可用，任何供应商调用都到此为止（不落到别的适配器分支上）。 */
export class RetiredVideoRouteError extends Error {
  constructor(readonly routeId: string) {
    super(`视频线路 ${routeId} 已下线，不能再向它提交或查询任务`);
    this.name = "RetiredVideoRouteError";
  }
}

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
  id: "byteplus" | "shuyu" | "mock",
): VideoProvider {
  if (id === "mock") return new MockVideoProvider();
  if (id === "shuyu") return new ShuyuVideoProvider();
  return new BytePlusVideoProvider();
}

export function createVideoProviderByRouteSnapshot(
  snapshot: VideoRouteSnapshot,
): VideoProvider {
  /// 先于一切分支：线路 id 或适配器名任一个是已下线的那家，都不许落到下面的 Seedance 直连分支
  if (
    snapshot.videoRouteSnapshot === "runway" ||
    isRetiredVideoRouteId(snapshot.videoRouteSnapshot) ||
    snapshot.videoProviderAdapterSnapshot === "runway"
  ) {
    throw new RetiredVideoRouteError(snapshot.videoRouteSnapshot);
  }
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
