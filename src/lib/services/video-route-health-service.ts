import { VideoJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  VIDEO_ROUTE_IDS,
  type VideoRouteId,
} from "@/lib/video-generation/video-route-registry";

/**
 * 线路健康画像（PRD C1 的「尺子」）。
 *
 * 每条生成任务已经把线路证据落在 VideoJob 上（videoRouteSnapshot /
 * videoModelSnapshot / providerUnitPriceUsd / submittedAt / finishedAt），
 * 这里只做只读聚合，回答三个问题：
 *
 *   1. 这条线路最近还活着吗（成功率、连续失败）
 *   2. 出一条片要多久（P50 / P95）
 *   3. 出一条片要多少钱（单条成本）
 *
 * 设计约束：
 * - 纯聚合，不写库、不调供应商、不做选路决策。选路由调用方结合运行时可用性判断，
 *   健康度只是输入之一 —— 一条线路可以「健康但没配置」，也可以「配置好但在挂」。
 * - 聚合逻辑与 DB 分离（`summarizeVideoRouteHealth` 是纯函数），便于单测覆盖
 *   边界：零样本、全失败、时钟倒挂、缺价格。
 * - 永远兜底，不抛错：可观测性不能成为生产链路的新故障点。
 */

/** 终态：进入统计的样本 */
const TERMINAL_STATUSES = [
  VideoJobStatus.SUCCEEDED,
  VideoJobStatus.FAILED,
  VideoJobStatus.CANCELLED,
] as const;

export const DEFAULT_ROUTE_HEALTH_WINDOW_HOURS = 24;
/** 低于这个样本数时，成功率没有统计意义，不应据此切线路 */
export const MIN_ROUTE_HEALTH_SAMPLES = 5;

export interface VideoRouteJobSample {
  videoRouteSnapshot: string | null;
  videoModelSnapshot: string | null;
  status: VideoJobStatus;
  submittedAt: Date | null;
  finishedAt: Date | null;
  providerUnitPriceUsd: number | null;
}

export interface VideoRouteHealth {
  routeId: string;
  model: string | null;
  samples: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** 成功 / (成功 + 失败)；取消不计入分母（用户主动放弃不算线路的错） */
  successRate: number | null;
  /** 提交 → 终态的耗时分位（毫秒），只统计成功样本 */
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  /** 成功样本的平均单条成本（USD），缺价格的样本被跳过 */
  avgCostUsd: number | null;
  /** 样本足够且成功率达标 —— 只是「可以优先用」，不代表运行时可用 */
  healthy: boolean;
  /** 样本不足以判断，调用方应回退到配置默认值而不是判它有罪 */
  insufficientData: boolean;
}

export interface VideoRouteHealthReport {
  windowHours: number;
  generatedAt: Date;
  routes: VideoRouteHealth[];
}

/** 成功率低于该值即视为不健康，触发降级 */
export const UNHEALTHY_SUCCESS_RATE = 0.5;

function percentile(sortedValues: number[], fraction: number): number | null {
  if (sortedValues.length === 0) return null;
  /// 最近秩法：小样本下比线性插值更稳，且不会造出没出现过的耗时
  const rank = Math.ceil(fraction * sortedValues.length);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index];
}

function durationMs(sample: VideoRouteJobSample): number | null {
  if (!sample.submittedAt || !sample.finishedAt) return null;
  const value = sample.finishedAt.getTime() - sample.submittedAt.getTime();
  /// 时钟倒挂 / 数据回填会产生负数，宁可丢样本也不要污染分位数
  return value >= 0 ? value : null;
}

/**
 * 纯函数：终态任务样本 → 每条线路的健康画像。
 *
 * 没有样本的线路也会出现在结果里（samples=0, insufficientData=true），
 * 这样调用方永远能拿到完整的线路清单，不必自己补齐缺失项。
 */
export function summarizeVideoRouteHealth(
  samples: VideoRouteJobSample[],
  options: { windowHours?: number; generatedAt?: Date } = {},
): VideoRouteHealthReport {
  const byRoute = new Map<string, VideoRouteJobSample[]>();
  for (const routeId of VIDEO_ROUTE_IDS) byRoute.set(routeId, []);
  for (const sample of samples) {
    /// 历史行的 videoRouteSnapshot 为空，且注释明确说不能从 provider 反推
    if (!sample.videoRouteSnapshot) continue;
    const bucket = byRoute.get(sample.videoRouteSnapshot);
    if (bucket) bucket.push(sample);
    else byRoute.set(sample.videoRouteSnapshot, [sample]);
  }

  const routes: VideoRouteHealth[] = [];
  for (const [routeId, rows] of byRoute) {
    const succeeded = rows.filter((row) => row.status === VideoJobStatus.SUCCEEDED);
    const failed = rows.filter((row) => row.status === VideoJobStatus.FAILED);
    const cancelled = rows.filter((row) => row.status === VideoJobStatus.CANCELLED);
    const decided = succeeded.length + failed.length;
    const successRate = decided > 0 ? succeeded.length / decided : null;

    const durations = succeeded
      .map(durationMs)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);

    const costs = succeeded
      .map((row) => row.providerUnitPriceUsd)
      .filter((value): value is number => typeof value === "number" && value >= 0);

    const insufficientData = decided < MIN_ROUTE_HEALTH_SAMPLES;
    routes.push({
      routeId,
      model: rows.find((row) => row.videoModelSnapshot)?.videoModelSnapshot ?? null,
      samples: rows.length,
      succeeded: succeeded.length,
      failed: failed.length,
      cancelled: cancelled.length,
      successRate,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      avgCostUsd: costs.length
        ? costs.reduce((sum, value) => sum + value, 0) / costs.length
        : null,
      /// 样本不足时按「无罪推定」处理：不阻断，交给运行时可用性去判断
      healthy: insufficientData || (successRate ?? 0) >= UNHEALTHY_SUCCESS_RATE,
      insufficientData,
    });
  }

  routes.sort((left, right) => left.routeId.localeCompare(right.routeId));
  return {
    windowHours: options.windowHours ?? DEFAULT_ROUTE_HEALTH_WINDOW_HOURS,
    generatedAt: options.generatedAt ?? new Date(),
    routes,
  };
}

export function findRouteHealth(
  report: VideoRouteHealthReport,
  routeId: VideoRouteId | string,
): VideoRouteHealth | null {
  return report.routes.find((route) => route.routeId === routeId) ?? null;
}

/**
 * 读库版本。失败时返回空画像而不是抛错 —— 拿不到健康度只应导致「退回默认选路」，
 * 不应该让用户的生成请求整个失败。
 */
export async function getVideoRouteHealthReport(
  options: { windowHours?: number; maxScan?: number } = {},
): Promise<VideoRouteHealthReport> {
  const windowHours = options.windowHours ?? DEFAULT_ROUTE_HEALTH_WINDOW_HOURS;
  const since = new Date(Date.now() - windowHours * 3_600_000);
  try {
    const rows = await db.videoJob.findMany({
      where: {
        status: { in: [...TERMINAL_STATUSES] },
        videoRouteSnapshot: { not: null },
        finishedAt: { gte: since },
      },
      orderBy: { finishedAt: "desc" },
      take: options.maxScan ?? 2_000,
      select: {
        videoRouteSnapshot: true,
        videoModelSnapshot: true,
        status: true,
        submittedAt: true,
        finishedAt: true,
        providerUnitPriceUsd: true,
      },
    });
    return summarizeVideoRouteHealth(
      rows.map((row) => ({
        videoRouteSnapshot: row.videoRouteSnapshot,
        videoModelSnapshot: row.videoModelSnapshot,
        status: row.status,
        submittedAt: row.submittedAt,
        finishedAt: row.finishedAt,
        /// Prisma Decimal → number；成本量级远小于 Number 精度上限
        providerUnitPriceUsd:
          row.providerUnitPriceUsd === null
            ? null
            : Number(row.providerUnitPriceUsd),
      })),
      { windowHours },
    );
  } catch {
    return summarizeVideoRouteHealth([], { windowHours });
  }
}
