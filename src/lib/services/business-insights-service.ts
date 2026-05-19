import type { VideoJobStatus } from "@prisma/client";
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

export async function loadBusinessInsights(
  userId: string,
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
      statusLabel: biz.shortLabel,
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
    recommendations: buildRecommendations(summary, videos),
  };
}

export function buildRecommendations(
  summary: BusinessInsightsSummary,
  videos: BusinessVideoInsight[],
): BusinessRecommendation[] {
  const out: BusinessRecommendation[] = [];

  if (summary.totalVideos === 0) {
    out.push({
      id: "first-ad",
      priority: "high",
      title: "Create your first ad video",
      body: "Start with a 30s vertical ad and an auto end card. Aivora will split it into scenes and stitch the final cut.",
      actionLabel: "New ad video",
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
      title: "Retry a failed video",
      body: `"${target.title}" did not finish. Open the product detail and retry failed segments, or create a fresh variant.`,
      actionLabel: "View product",
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
      title: "Connect performance data",
      body: `${readyNoMetrics.length} ready video(s) have no view metrics yet. Link TikTok or import CSV so Recommendations can learn what works.`,
      actionLabel: "Integrations",
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
      title: "Double down on a winning hook",
      body: top.hook
        ? `Your best completion rate uses this opening: "${top.hook.slice(0, 120)}". Try a variant in Creative Studio.`
        : "Your top video has strong completion. Generate a hook variant in Creative Studio.",
      actionLabel: "Creative Studio",
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
      title: "Videos still rendering",
      body: `${inProgress.length} video(s) are in progress. Check Products for live segment progress.`,
      actionLabel: "Your products",
      actionHref: "/business/products",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "new-variant",
      priority: "low",
      title: "Test a new creative angle",
      body: "Ship another 30s ad with a different hook or CTA to compare performance once metrics are in.",
      actionLabel: "New ad video",
      actionHref: "/business/create-ad-video",
    });
  }

  return out.slice(0, 5);
}
