/**
 * Pure, environment-independent contract for persisted video routing evidence.
 *
 * This registry describes route identity only. It does not select a provider,
 * read credentials, call an adapter, or bypass runtime/cost gates. In
 * particular, a registered route is not proof that its production account is
 * configured.
 */

export const VIDEO_ROUTE_IDS = [
  "byteplus_international",
  "volcengine_cn_legacy",
  "mock",
  "buddy",
  /// 只为读旧记录留着（见 ROUTES.runway）
  "runway",
] as const;

/**
 * 已下线的线路：出片代码已经删了，登记只为读旧记录——readVideoRouteSnapshot 遇到认不得的线路 id 会抛，
 * 而旧的 brief / 段任务 / 批次上还记着它。不能再建新快照，也不再调供应商。
 */
export const RETIRED_VIDEO_ROUTE_IDS: readonly VideoRouteId[] = ["runway"];

export type VideoRouteId = (typeof VIDEO_ROUTE_IDS)[number];
export type EnabledVideoRouteId = VideoRouteId;

export type VideoProviderAdapterSnapshot = "byteplus" | "shuyu" | "runway" | "mock";

export interface VideoRouteContract {
  readonly id: VideoRouteId;
  readonly enabled: boolean;
  /** Stable adapter identity persisted for reconciliation, not a class name. */
  readonly providerAdapter: VideoProviderAdapterSnapshot;
  /** Null means the provider contract/model is still unknown and unusable. */
  readonly model: string | null;
  readonly processingRegion: "ap-southeast" | "cn-beijing" | "local" | null;
}

const ROUTES = {
  byteplus_international: {
    id: "byteplus_international",
    enabled: true,
    providerAdapter: "byteplus",
    model: "dreamina-seedance-2-0-260128",
    processingRegion: "ap-southeast",
  },
  volcengine_cn_legacy: {
    id: "volcengine_cn_legacy",
    enabled: true,
    // The current audited adapter is shared; the route snapshot distinguishes
    // the explicit legacy account/endpoint/model profile.
    providerAdapter: "byteplus",
    model: "doubao-seedance-2-0-260128",
    processingRegion: "cn-beijing",
  },
  mock: {
    id: "mock",
    enabled: true,
    providerAdapter: "mock",
    model: "aivora-deterministic-mock-v1",
    processingRegion: "local",
  },
  buddy: {
    id: "buddy",
    enabled: true,
    providerAdapter: "shuyu",
    // The public /prices contract currently exposes exactly this one video
    // plan. The upstream request selects it by model; plan_id is metadata only
    // and must never be sent in POST /videos/generations.
    model: "studio-video",
    processingRegion: null,
  },
  /// 只读（2026-11-16 起）：Runway 出片 2026-10-28 ~ 11-16 用过（Kling O3 Pro），11-16 下线并删掉了全部出片代码。
  /// 这条定义、上面的线路 id 与适配器名 "runway" 只为读旧记录留着；enabled=false，所以建新快照会抛、
  /// 供应商调用一律被拒。旧成片照常看、照常只重新合成；重做 / 重试某一段会被明确拒绝（video-service）。
  runway: {
    id: "runway",
    enabled: false,
    providerAdapter: "runway",
    model: "klingO3_pro",
    processingRegion: null,
  },
} as const satisfies Record<VideoRouteId, VideoRouteContract>;

export const VIDEO_ROUTE_REGISTRY: Readonly<
  Record<VideoRouteId, VideoRouteContract>
> = Object.freeze(ROUTES);

export interface VideoRouteSnapshot {
  readonly videoRouteSnapshot: EnabledVideoRouteId;
  readonly videoModelSnapshot: string;
  readonly videoProviderAdapterSnapshot: VideoProviderAdapterSnapshot;
}

export interface PersistedVideoRouteSnapshotInput {
  readonly videoRouteSnapshot?: string | null;
  readonly videoModelSnapshot?: string | null;
  readonly videoProviderAdapterSnapshot?: string | null;
}

export type ReadVideoRouteSnapshot =
  | {
      readonly state: "historical_unknown";
      readonly route: null;
      readonly videoRouteSnapshot: null;
      readonly videoModelSnapshot: null;
      readonly videoProviderAdapterSnapshot: null;
    }
  | {
      readonly state: "persisted";
      readonly route: VideoRouteContract;
      readonly videoRouteSnapshot: VideoRouteId;
      readonly videoModelSnapshot: string;
      readonly videoProviderAdapterSnapshot: VideoProviderAdapterSnapshot;
    };

function isVideoRouteId(value: string): value is VideoRouteId {
  return Object.prototype.hasOwnProperty.call(ROUTES, value);
}

function isProviderAdapterSnapshot(
  value: string,
): value is VideoProviderAdapterSnapshot {
  return value === "byteplus" || value === "shuyu" || value === "runway" || value === "mock";
}

export function getVideoRouteContract(routeId: VideoRouteId): VideoRouteContract {
  return VIDEO_ROUTE_REGISTRY[routeId];
}

/** 这条线路 id 是不是登记在册、但已经下线（只读旧记录）。认不得的 id 返回 false：那是数据错误，由 readVideoRouteSnapshot 报。 */
export function isRetiredVideoRouteId(routeId: string | null | undefined): boolean {
  return typeof routeId === "string" && RETIRED_VIDEO_ROUTE_IDS.some((retired) => retired === routeId);
}

export function isEnabledVideoRouteId(
  routeId: VideoRouteId,
): routeId is EnabledVideoRouteId {
  const route = getVideoRouteContract(routeId);
  return route.enabled && route.model !== null;
}

export function createVideoRouteSnapshot(
  routeId: VideoRouteId,
): VideoRouteSnapshot {
  const route = getVideoRouteContract(routeId);
  if (isRetiredVideoRouteId(routeId)) {
    throw new Error(
      `Video route ${routeId} is retired: it stays registered only so historical records can be read, and no new snapshot may be created`,
    );
  }
  if (!isEnabledVideoRouteId(routeId) || route.model === null) {
    throw new Error(
      `Video route ${routeId} is registered but disabled until its provider model contract is confirmed`,
    );
  }
  return Object.freeze({
    videoRouteSnapshot: routeId,
    videoModelSnapshot: route.model,
    videoProviderAdapterSnapshot: route.providerAdapter,
  });
}

/**
 * Read persisted evidence without borrowing today's default.
 *
 * Only the all-null shape is valid historical unknown. A partial snapshot is a
 * data-integrity error because it cannot safely determine the billed route.
 */
export function readVideoRouteSnapshot(
  input: PersistedVideoRouteSnapshotInput,
): ReadVideoRouteSnapshot {
  const routeId = input.videoRouteSnapshot ?? null;
  const model = input.videoModelSnapshot ?? null;
  const adapter = input.videoProviderAdapterSnapshot ?? null;

  if (routeId === null && model === null && adapter === null) {
    return {
      state: "historical_unknown",
      route: null,
      videoRouteSnapshot: null,
      videoModelSnapshot: null,
      videoProviderAdapterSnapshot: null,
    };
  }

  if (routeId === null || model === null || adapter === null) {
    throw new Error("Incomplete persisted video route snapshot");
  }
  if (!isVideoRouteId(routeId)) {
    throw new Error(`Unknown persisted video route snapshot: ${routeId}`);
  }
  if (!isProviderAdapterSnapshot(adapter)) {
    throw new Error(`Unknown persisted video provider adapter snapshot: ${adapter}`);
  }

  return {
    state: "persisted",
    route: getVideoRouteContract(routeId),
    videoRouteSnapshot: routeId,
    // Preserve exact historical evidence. Model upgrades must create a new
    // snapshot; readers must not replace it with the registry's current model.
    videoModelSnapshot: model,
    videoProviderAdapterSnapshot: adapter,
  };
}
