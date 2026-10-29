import {
  isMockVideoRuntime,
  type VideoGenerationRuntimeUnavailableReason,
} from "@/lib/config/env";
import {
  resolveSeedanceArkBaseUrl,
  resolveSeedanceRuntimeProfile,
  seedanceApiKey,
} from "@/lib/config/seedance-runtime";
import { runwayApiKey } from "@/lib/providers/runway";
import {
  canChooseRunwayPremium,
  shuyuFallbackToRunwayEnabled,
  usesRunwayVideo,
  type RolloutAccount,
} from "./runway-rollout";
import { shuyuApiKey } from "@/lib/providers/shuyu";
import { getShuyuRouteRuntimeAvailability } from "./shuyu-runtime";
import {
  createVideoRouteSnapshot,
  type VideoRouteSnapshot,
} from "./video-route-registry";

export const STAFF_SELECTABLE_VIDEO_ROUTE_IDS = [
  "byteplus_international",
  "volcengine_cn_legacy",
  "buddy",
  "runway",
] as const;

/**
 * 客户的视频线路（2026-10-29 起）：默认一律 buddy（Shuyu）；VIDEO_CUSTOMER_ROUTE=runway 是全员切到 Runway 的运维开关。
 * 客户可以主动选「高质量」= runway（开关与名单见 runway-rollout.ts 的 canChooseRunwayPremium）；
 * 任何时候都能显式点名 buddy，任何时候都不能点名直连线路。
 */
export type CustomerVideoRouteId = "buddy" | "runway";

export function customerVideoRouteId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CustomerVideoRouteId {
  return usesRunwayVideo(env) ? "runway" : "buddy";
}

export type StaffSelectableVideoRouteId =
  (typeof STAFF_SELECTABLE_VIDEO_ROUTE_IDS)[number];

export class VideoRouteSelectionError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "INVALID_ROUTE" | "MOCK_ROUTE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "VideoRouteSelectionError";
  }
}

function isStaffSelectableRouteId(
  value: string,
): value is StaffSelectableVideoRouteId {
  return STAFF_SELECTABLE_VIDEO_ROUTE_IDS.some((routeId) => routeId === value);
}

export function selectCustomerVideoRouteSnapshot(args: {
  requestedRouteId?: unknown;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /// 发起人：「高质量（Runway）」在 RUNWAY_PREMIUM=pilot 时按灰度名单判（邮箱或 user id）
  account?: RolloutAccount | null;
}): VideoRouteSnapshot {
  const env = args.env ?? process.env;
  if (isMockVideoRuntime(env)) {
    if (args.requestedRouteId !== undefined) {
      throw new VideoRouteSelectionError(
        "MOCK_ROUTE_CONFLICT",
        "Mock rehearsal mode does not permit a real provider route override",
      );
    }
    return createVideoRouteSnapshot("mock");
  }
  const customerRoute = customerVideoRouteId(env);
  if (args.requestedRouteId === undefined) return createVideoRouteSnapshot(customerRoute);
  if (args.requestedRouteId === "buddy") return createVideoRouteSnapshot("buddy");
  if (
    args.requestedRouteId === "runway" &&
    (customerRoute === "runway" || canChooseRunwayPremium(args.account, env))
  ) {
    return createVideoRouteSnapshot("runway");
  }
  throw new VideoRouteSelectionError(
    "FORBIDDEN",
    "Customers may only use the platform's customer video route",
  );
}

/**
 * 客户线路的自动降级目标（PRD C1）。
 *
 * 边界：客户**仍然不能自己选**线路 —— `selectCustomerVideoRouteSnapshot` 对任何
 * 非 buddy 的显式请求照旧抛 FORBIDDEN。降级是平台在主线路不可用时替客户做的
 * 决定，不是把选择权交出去。2026-07 Shuyu 线路 7 天成功率 28.6%，而它是客户
 * 唯一线路 —— 单点没有出口。
 *
 * 为什么选 volcengine_cn_legacy 而不是 byteplus_international：只有它在生产
 * 配好了凭据（ARK_API_KEY）。两条线路的凭据分属不同账号域、绝不交叉接线，
 * 所以 byteplus 在 BYTEPLUS_ARK_API_KEY 配好之前只会返回 null，等于没有降级。
 * 换目标只需改这一个常量。
 */
export const CUSTOMER_FAILOVER_ROUTE_ID = "volcengine_cn_legacy" as const;

/**
 * 主线路不可用时可用的备用线路快照；备用线路自己也没配好时返回 null，
 * 由调用方走「提前告知不可用 + 免费取消」，而不是把用户丢进必死的提交。
 */
export function customerFailoverRouteSnapshot(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  /// 主线路：Runway 的备用是 Shuyu（10-28 晚）；Shuyu 的备用是 Runway（10-29 Evan：Shuyu 失败再换 Runway，
  /// SHUYU_FALLBACK_TO_RUNWAY=off 关）；其余主线路、以及 Runway 没开时照旧降到 CUSTOMER_FAILOVER_ROUTE_ID。
  primaryRouteId?: string,
): VideoRouteSnapshot | null {
  /// mock 演练不参与降级：演练线路必须保持确定性
  if (isMockVideoRuntime(env)) return null;
  const backupRouteId =
    primaryRouteId === "runway"
      ? "buddy"
      : primaryRouteId === "buddy" && shuyuFallbackToRunwayEnabled(env)
        ? "runway"
        : CUSTOMER_FAILOVER_ROUTE_ID;
  const snapshot = createVideoRouteSnapshot(backupRouteId);
  return isVideoRouteSnapshotRuntimeReady(snapshot, env) ? snapshot : null;
}

/**
 * Resolve one immutable route snapshot before idempotency/quota work begins.
 * Customer requests are Shuyu-only; legacy direct profiles remain available to
 * internal staff and historical snapshot readers.
 */
export function selectVideoRouteSnapshot(args: {
  requestedRouteId?: unknown;
  isInternalStaff: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  account?: RolloutAccount | null;
}): VideoRouteSnapshot {
  const env = args.env ?? process.env;
  if (!args.isInternalStaff) {
    return selectCustomerVideoRouteSnapshot({
      ...(args.requestedRouteId !== undefined
        ? { requestedRouteId: args.requestedRouteId }
        : {}),
      env,
      account: args.account ?? null,
    });
  }
  const hasOverride = args.requestedRouteId !== undefined;

  if (isMockVideoRuntime(env)) {
    if (hasOverride) {
      throw new VideoRouteSelectionError(
        "MOCK_ROUTE_CONFLICT",
        "Mock rehearsal mode does not permit a real provider route override",
      );
    }
    return createVideoRouteSnapshot("mock");
  }

  if (hasOverride) {
    if (
      typeof args.requestedRouteId !== "string" ||
      !isStaffSelectableRouteId(args.requestedRouteId)
    ) {
      throw new VideoRouteSelectionError(
        "INVALID_ROUTE",
        "videoRouteId is not in the audited public video route allowlist",
      );
    }
    return createVideoRouteSnapshot(args.requestedRouteId);
  }

  return createVideoRouteSnapshot(
    resolveSeedanceRuntimeProfile(env.SEEDANCE_RUNTIME_PROFILE),
  );
}

export function isVideoRouteSnapshotRuntimeReady(
  snapshot: VideoRouteSnapshot,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (snapshot.videoRouteSnapshot === "mock") {
    return isMockVideoRuntime(env);
  }
  if (snapshot.videoRouteSnapshot === "buddy") {
    return Boolean(shuyuApiKey(env));
  }
  if (snapshot.videoRouteSnapshot === "runway") {
    return Boolean(runwayApiKey(env));
  }
  if (!seedanceApiKey(snapshot.videoRouteSnapshot, env)) return false;
  try {
    resolveSeedanceArkBaseUrl(
      env.ARK_BASE_URL,
      snapshot.videoRouteSnapshot,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * An explicit route may bypass readiness only when the reported failure
 * belongs to a different provider/profile. Content-review and mock seals are
 * intentionally never bypassable.
 */
export function canVideoRouteOverrideDefaultRuntimeFailure(
  snapshot: VideoRouteSnapshot,
  reason: VideoGenerationRuntimeUnavailableReason,
): boolean {
  const byteplusFailure = [
    "byteplus_key_missing",
    "byteplus_endpoint_invalid",
  ].some((candidate) => candidate === reason);
  const volcengineFailure = [
    "volcengine_legacy_key_missing",
    "volcengine_legacy_endpoint_invalid",
  ].some((candidate) => candidate === reason);

  if (snapshot.videoRouteSnapshot === "buddy") {
    return byteplusFailure || volcengineFailure;
  }
  /// Runway 自有 key：默认运行时（Shuyu / Seedance 直连）的配置问题都不归它管
  if (snapshot.videoRouteSnapshot === "runway") {
    return (
      reason === "shuyu_key_missing" ||
      reason === "shuyu_insufficient_balance" ||
      reason === "shuyu_unavailable" ||
      byteplusFailure ||
      volcengineFailure
    );
  }
  if (snapshot.videoRouteSnapshot === "byteplus_international") {
    return reason === "shuyu_key_missing" || volcengineFailure;
  }
  if (snapshot.videoRouteSnapshot === "volcengine_cn_legacy") {
    return reason === "shuyu_key_missing" || byteplusFailure;
  }
  return false;
}

export async function getVideoRouteSnapshotRuntimeAvailability(args: {
  snapshot: VideoRouteSnapshot;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  shuyuRequiredPoints?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  available: boolean;
  funded: boolean | null;
  reason:
    | "not_configured"
    | "insufficient_balance"
    | "authentication_rejected"
    | "rate_limited"
    | "timeout"
    | "upstream_unavailable"
    | "invalid_response"
    | "price_contract_mismatch"
    | null;
}> {
  const env = args.env ?? process.env;
  if (args.snapshot.videoRouteSnapshot === "buddy") {
    const shuyu = await getShuyuRouteRuntimeAvailability({
      ...(args.env ? { env } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
      requiredPoints: args.shuyuRequiredPoints,
    });
    return {
      available: shuyu.available,
      funded: shuyu.funded,
      reason: shuyu.reason,
    };
  }
  const available = isVideoRouteSnapshotRuntimeReady(args.snapshot, env);
  return {
    available,
    funded: null,
    reason: available ? null : "not_configured",
  };
}

export type VideoRouteRuntimeAvailability = Awaited<
  ReturnType<typeof getVideoRouteSnapshotRuntimeAvailability>
>;

export interface RouteFailoverDeps {
  getAvailability: (args: {
    snapshot: VideoRouteSnapshot;
    shuyuRequiredPoints?: number;
  }) => Promise<VideoRouteRuntimeAvailability>;
  /// 按主线路给备用（Runway ⇄ Shuyu 互为备用；其余降到 CUSTOMER_FAILOVER_ROUTE_ID）
  failoverSnapshot: (primary: VideoRouteSnapshot) => VideoRouteSnapshot | null;
}

const DEFAULT_ROUTE_FAILOVER_DEPS: RouteFailoverDeps = {
  getAvailability: (args) => getVideoRouteSnapshotRuntimeAvailability(args),
  failoverSnapshot: (primary) => customerFailoverRouteSnapshot(process.env, primary.videoRouteSnapshot),
};

export interface RouteFailoverResolution {
  /// 原线路的可用性：调用方的拒绝文案/原因必须按它给，不按备用线路
  primaryAvailability: VideoRouteRuntimeAvailability;
  /// 最终用于提交的快照；未切换时与入参是同一个对象
  snapshot: VideoRouteSnapshot;
  failedOver: boolean;
}

/**
 * 主线路可用性检查 + 自动降级（PRD C1）。
 *
 * 客户依然无权自己选线路 —— 这是平台替客户做的决定。降级前必须确认备用线路
 * 真的可用，否则只是把必死的提交换了个地方死。备用线路也不行时保持原快照，
 * 由调用方按原线路的不可用原因拒绝。
 *
 * 余额不足不降级：那是账户问题，换线路只会把成本转嫁到另一条线上。
 *
 * 批量必须 `allowFailover:false`：批次的线路、计价与快照在建批次时一次定死，
 * 不可用就按原原因拒绝，绝不换线路。
 */
export async function resolveRouteWithFailover(args: {
  snapshot: VideoRouteSnapshot;
  shuyuRequiredPoints?: number;
  allowFailover: boolean;
  deps?: Partial<RouteFailoverDeps>;
}): Promise<RouteFailoverResolution> {
  const deps = { ...DEFAULT_ROUTE_FAILOVER_DEPS, ...args.deps };
  const primaryAvailability = await deps.getAvailability({
    snapshot: args.snapshot,
    shuyuRequiredPoints: args.shuyuRequiredPoints,
  });
  const unchanged = {
    primaryAvailability,
    snapshot: args.snapshot,
    failedOver: false,
  };
  if (
    primaryAvailability.available ||
    !args.allowFailover ||
    primaryAvailability.reason === "insufficient_balance"
  ) {
    return unchanged;
  }
  const failoverSnapshot = deps.failoverSnapshot(args.snapshot);
  if (!failoverSnapshot) return unchanged;
  const failoverAvailability = await deps.getAvailability({
    snapshot: failoverSnapshot,
  });
  if (!failoverAvailability.available) return unchanged;
  return { primaryAvailability, snapshot: failoverSnapshot, failedOver: true };
}
