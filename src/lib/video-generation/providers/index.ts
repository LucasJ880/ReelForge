/**
 * 视频生成 Provider 工厂入口。
 *
 * 业务代码：
 *   import { createVideoProviderByRouteSnapshot } from "@/lib/video-generation/providers";
 *   const provider = createVideoProviderByRouteSnapshot(snapshot);
 *   const { providerJobId } = await provider.createVideoJob({ prompt, ... });
 *
 * 真实实现只有 Shuyu（buddy 线路）；mock 只给本地联调与测试（生产被 env.ts 拦着）。
 * 适配器只由持久化的线路快照决定；没有「按 VIDEO_PROVIDER 取默认适配器」的入口了
 *（原来只有健康检查在用，它现在直接按 env 报）。
 * runway（2026-11-16）与两条直连 Seedance 线路（2026-11-17）已下线、适配器已删：
 * 旧记录上的这些快照到这里会被明确拒绝（RetiredVideoRouteError），不落到任何还在的适配器上。
 */

import { MockVideoProvider } from "./mock-video-provider";
import { ShuyuVideoProvider } from "./shuyu-video-provider";
import type { VideoProvider } from "./types";
import {
  isRetiredVideoProviderAdapter,
  isRetiredVideoRouteId,
  type VideoRouteSnapshot,
} from "../video-route-registry";

/** 旧记录上的线路已下线：没有适配器可用，任何供应商调用都到此为止（不落到别的适配器分支上）。 */
export class RetiredVideoRouteError extends Error {
  constructor(readonly routeId: string) {
    super(`视频线路 ${routeId} 已下线，不能再向它提交或查询任务`);
    this.name = "RetiredVideoRouteError";
  }
}

export function createVideoProviderByRouteSnapshot(
  snapshot: VideoRouteSnapshot,
): VideoProvider {
  /// 先于一切分支：线路 id 或适配器名任一个是已下线的那几家，都不许落到下面还在的适配器上
  if (
    isRetiredVideoRouteId(snapshot.videoRouteSnapshot) ||
    isRetiredVideoProviderAdapter(snapshot.videoProviderAdapterSnapshot)
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
  /// 登记在册的线路只有上面两条还在用；走到这里是数据错误，不猜适配器
  throw new Error(
    `Video route snapshot ${String(snapshot.videoRouteSnapshot)} has no provider adapter`,
  );
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
