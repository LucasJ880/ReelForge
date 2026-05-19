import type { VideoJobStatus } from "@prisma/client";
import type { Locale } from "@/i18n/config";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { translate } from "@/i18n/translate";
import { db } from "@/lib/db";
import {
  deriveBusinessStatus,
  type BusinessVideoStatus,
} from "@/lib/video-generation/business-status";
import type { ContentMetricsInput } from "@/lib/services/metrics-service";

export interface BusinessVideoInsight {
  orderId: string;
  title: string;
  briefId: string | null;
  status: BusinessVideoStatus;
  statusLabel: string;
  updatedAt: Date;
  views: number | null;
  completionRate: number | null;
  hook: string | null;
}

export interface BusinessInsightsSummary {
  totalVideos: number;
  readyCount: number;
  inProgressCount: number;
  failedCount: number;
  withMetricsCount: number;
  totalViews: number;
  avgCompletionRate: number | null;
}

export interface BusinessRecommendation {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}

export interface BusinessInsightsBundle {
  summary: BusinessInsightsSummary;
  videos: BusinessVideoInsight[];
  recommendations: BusinessRecommendation[];
}

function parseMetrics(raw: unknown): ContentMetricsInput | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as ContentMetricsInput;
}

function shellT(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return translate(getDictionary(locale), key, params);
}

export async function loadBusinessInsights(
  userId: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<BusinessInsightsBundle> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              hook: true,
              videoBrief: {
                select: {
                  id: true,
                  status: true,
                  persona: true,
                  finalVideo: { select: { status: true } },
                  videoJobs: { select: { status: true } },
                  publishRecords: {
                    select: {
                      metricsSnapshots: {
                        orderBy: { windowHours: "desc" },
                        take: 1,
                        select: { metrics: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const videos: BusinessVideoInsight[] = [];
  let readyCount = 0;
  let inProgressCount = 0;
  let failedCount = 0;
  let withMetricsCount = 0;
  let totalViews = 0;
  const completionSamples: number[] = [];

  for (const order of orders) {
    const brief = order.rounds[0]?.angles[0]?.videoBrief;
    if (brief?.persona === "PERSONAL") continue;

    const jobs = brief?.videoJobs ?? [];
    const segmentsTotal = jobs.length;
    const segmentsSucceeded = jobs.filter(
      (j) => j.status === "SUCCEEDED",
    ).length;
    const biz = deriveBusinessStatus({
      briefStatus: brief?.status ?? null,
      finalVideoStatus: brief?.finalVideo?.status ?? null,
      segmentsTotal,
      segmentsSucceeded,
      jobStatuses: jobs.map((j) => j.status) as VideoJobStatus[],
    });

    if (biz.status === "ready") readyCount += 1;
    else if (biz.status === "failed") failedCount += 1;
    else inProgressCount += 1;

    let views: number | null = null;
    let completionRate: number | null = null;
    const snap = brief?.publishRecords[0]?.metricsSnapshots[0]?.metrics;
    const metrics = parseMetrics(snap);
    if (metrics?.views != null) {
      views = metrics.views;
      totalViews += metrics.views;
      withMetricsCount += 1;
    }
    if (metrics?.completion_rate != null) {
      completionRate = metrics.completion_rate;
      completionSamples.push(metrics.completion_rate);
    }

    videos.push({
      orderId: order.id,
      title: order.title,
      briefId: brief?.id ?? null,
      status: biz.status,
      statusLabel: shellT(locale, `shell.businessStatus.${biz.status}.short`),
      updatedAt: order.updatedAt,
      views,
      completionRate,
      hook: order.rounds[0]?.angles[0]?.hook ?? null,
    });
  }

  const summary: BusinessInsightsSummary = {
    totalVideos: videos.length,
    readyCount,
    inProgressCount,
    failedCount,
    withMetricsCount,
    totalViews,
    avgCompletionRate:
      completionSamples.length > 0
        ? completionSamples.reduce((a, b) => a + b, 0) / completionSamples.length
        : null,
  };

  return {
    summary,
    videos,
    recommendations: buildRecommendations(locale, summary, videos),
  };
}

export function buildRecommendations(
  locale: Locale,
  summary: BusinessInsightsSummary,
  videos: BusinessVideoInsight[],
): BusinessRecommendation[] {
  const out: BusinessRecommendation[] = [];

  if (summary.totalVideos === 0) {
    out.push({
      id: "first-ad",
      priority: "high",
      title: shellT(locale, "shell.rec.firstAdTitle"),
      body: shellT(locale, "shell.rec.firstAdBody"),
      actionLabel: shellT(locale, "shell.rec.actionNewAd"),
      actionHref: "/business/create-ad-video",
    });
    return out;
  }

  const failed = videos.filter((v) => v.status === "failed");
  if (failed.length > 0) {
    const target = failed[0];
    out.push({
      id: "retry-failed",
      priority: "high",
      title: shellT(locale, "shell.rec.retryTitle"),
      body: shellT(locale, "shell.rec.retryBody", { title: target.title }),
      actionLabel: shellT(locale, "shell.rec.actionViewProduct"),
      actionHref: target.briefId
        ? `/business/products/${target.orderId}`
        : "/business/products",
    });
  }

  const readyNoMetrics = videos.filter(
    (v) => v.status === "ready" && v.views == null,
  );
  if (readyNoMetrics.length > 0) {
    out.push({
      id: "add-metrics",
      priority: "medium",
      title: shellT(locale, "shell.rec.metricsTitle"),
      body: shellT(locale, "shell.rec.metricsBody", {
        count: readyNoMetrics.length,
      }),
      actionLabel: shellT(locale, "shell.rec.actionIntegrations"),
      actionHref: "/business/integrations",
    });
  }

  const top = videos
    .filter((v) => v.completionRate != null)
    .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))[0];
  if (top && (top.completionRate ?? 0) >= 0.35) {
    out.push({
      id: "double-down-hook",
      priority: "medium",
      title: shellT(locale, "shell.rec.winningTitle"),
      body: top.hook
        ? shellT(locale, "shell.rec.winningBodyHook", {
            hook: top.hook.slice(0, 120),
          })
        : shellT(locale, "shell.rec.winningBodyGeneric"),
      actionLabel: shellT(locale, "shell.rec.actionStudio"),
      actionHref: "/business/creative-studio",
    });
  }

  const inProgress = videos.filter(
    (v) =>
      v.status === "generating" ||
      v.status === "assembling" ||
      v.status === "planning",
  );
  if (inProgress.length > 0 && out.length < 3) {
    out.push({
      id: "check-progress",
      priority: "low",
      title: shellT(locale, "shell.rec.progressTitle"),
      body: shellT(locale, "shell.rec.progressBody", { count: inProgress.length }),
      actionLabel: shellT(locale, "shell.rec.actionProducts"),
      actionHref: "/business/products",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "new-variant",
      priority: "low",
      title: shellT(locale, "shell.rec.angleTitle"),
      body: shellT(locale, "shell.rec.angleBody"),
      actionLabel: shellT(locale, "shell.rec.actionNewAd"),
      actionHref: "/business/create-ad-video",
    });
  }

  return out.slice(0, 5);
}
