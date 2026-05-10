import type { AIUsageStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * AIUsage Dashboard 聚合层。
 *
 * 设计：
 * - 一次性查 raw rows（dashboard 体量小，最多近 1000 条最近记录），在内存里做聚合，
 *   避免堆叠多个 groupBy SQL；一旦数据量大可以再换 SQL groupBy。
 * - 全部聚合都基于「最近 N 天」窗口（默认 30 天），避免历史数据稀释。
 * - 永远兜底成空数组/0，不抛错。
 */

export interface AIUsageStatsFilter {
  feature?: string | null;
  status?: AIUsageStatus | null;
  /// 最近 N 天，默认 30
  windowDays?: number;
  /// 顶部 totals 用的最大记录数（保护 RAM）。recent 列表另算。
  maxScan?: number;
}

export interface AIUsageStats {
  windowDays: number;
  totals: {
    calls: number;
    successCalls: number;
    failedCalls: number;
    mockCalls: number;
    totalCostUsd: number;
    totalTokens: number;
  };
  byFeature: Array<{
    feature: string;
    calls: number;
    successCalls: number;
    failedCalls: number;
    mockCalls: number;
    costUsd: number;
  }>;
  byModel: Array<{
    model: string;
    calls: number;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
  }>;
}

/**
 * 纯函数：rows → AIUsageStats。无 DB 依赖，便于单测。
 */
export interface AIUsageRowForStats {
  feature: string;
  model: string | null;
  status: AIUsageStatus;
  costEstimateUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export function aggregateAIUsageRows(
  rows: readonly AIUsageRowForStats[],
  windowDays: number,
): AIUsageStats {
  const featureMap = new Map<string, AIUsageStats["byFeature"][number]>();
  const modelMap = new Map<string, AIUsageStats["byModel"][number]>();
  let calls = 0;
  let success = 0;
  let failed = 0;
  let mock = 0;
  let totalCost = 0;
  let totalTokens = 0;

  for (const r of rows) {
    calls += 1;
    if (r.status === "SUCCESS") success += 1;
    else if (r.status === "FAILED") failed += 1;
    else if (r.status === "MOCK") mock += 1;
    totalCost += r.costEstimateUsd ?? 0;
    totalTokens += r.totalTokens ?? 0;

    const f = featureMap.get(r.feature) ?? {
      feature: r.feature,
      calls: 0,
      successCalls: 0,
      failedCalls: 0,
      mockCalls: 0,
      costUsd: 0,
    };
    f.calls += 1;
    if (r.status === "SUCCESS") f.successCalls += 1;
    else if (r.status === "FAILED") f.failedCalls += 1;
    else if (r.status === "MOCK") f.mockCalls += 1;
    f.costUsd += r.costEstimateUsd ?? 0;
    featureMap.set(r.feature, f);

    const modelKey = r.model ?? "(unknown)";
    const m = modelMap.get(modelKey) ?? {
      model: modelKey,
      calls: 0,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
    m.calls += 1;
    m.costUsd += r.costEstimateUsd ?? 0;
    m.promptTokens += r.promptTokens ?? 0;
    m.completionTokens += r.completionTokens ?? 0;
    modelMap.set(modelKey, m);
  }

  return {
    windowDays,
    totals: {
      calls,
      successCalls: success,
      failedCalls: failed,
      mockCalls: mock,
      totalCostUsd: round6(totalCost),
      totalTokens,
    },
    byFeature: Array.from(featureMap.values()).sort((a, b) => b.calls - a.calls),
    byModel: Array.from(modelMap.values()).sort((a, b) => b.calls - a.calls),
  };
}

export async function getAIUsageStats(
  filter: AIUsageStatsFilter = {},
): Promise<AIUsageStats> {
  const windowDays = filter.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const maxScan = filter.maxScan ?? 1000;

  const rows = await db.aIUsageLog.findMany({
    where: {
      createdAt: { gte: since },
      ...(filter.feature ? { feature: filter.feature } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: maxScan,
    select: {
      feature: true,
      model: true,
      status: true,
      costEstimateUsd: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
    },
  });

  return aggregateAIUsageRows(rows, windowDays);
}

export interface AIUsageRecentRow {
  id: string;
  feature: string;
  model: string | null;
  status: AIUsageStatus;
  costEstimateUsd: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: Date;
  deliveryOrderId: string | null;
  deliveryOrderTitle: string | null;
}

export async function getRecentAIUsage(
  filter: AIUsageStatsFilter = {},
  limit = 50,
): Promise<AIUsageRecentRow[]> {
  const windowDays = filter.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.aIUsageLog.findMany({
    where: {
      createdAt: { gte: since },
      ...(filter.feature ? { feature: filter.feature } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      feature: true,
      model: true,
      status: true,
      costEstimateUsd: true,
      totalTokens: true,
      durationMs: true,
      errorMessage: true,
      createdAt: true,
      deliveryOrderId: true,
      deliveryOrder: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    feature: r.feature,
    model: r.model,
    status: r.status,
    costEstimateUsd: r.costEstimateUsd,
    totalTokens: r.totalTokens,
    durationMs: r.durationMs,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
    deliveryOrderId: r.deliveryOrderId,
    deliveryOrderTitle: r.deliveryOrder?.title ?? null,
  }));
}

/**
 * 已知 feature 列表（供下拉选项使用）；
 * 永远返回，不依赖 DB（DB 里没有也不影响）。
 */
export const KNOWN_AI_FEATURES = [
  "creative_evidence_breakdown",
  "client_script",
  "storyboard",
  "shooting_guide",
  "asset_qa",
  "director",
  "reviewer",
  "qa",
] as const;

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
