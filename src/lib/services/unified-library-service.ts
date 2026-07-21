import type {
  FinalVideoStatus,
  Prisma,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  type PersonalVideoStatus,
} from "@/lib/video-generation/personal-status";
import { summarizeRunningJobs } from "@/lib/video-generation/business-status";
import {
  unifiedLibraryRowSchema,
  type UnifiedLibraryRow,
} from "@/lib/contracts/unified-library";

export type { UnifiedLibraryRow } from "@/lib/contracts/unified-library";

const unifiedLibraryOrderSelect = {
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
          videoBrief: {
            select: {
              id: true,
              status: true,
              durationSec: true,
              aspectRatio: true,
              finalVideoUrl: true,
              finalThumbnailUrl: true,
              brandedVideoUrl: true,
              takedownAt: true,
              finalVideo: {
                select: {
                  status: true,
                  stitchedVideoUrl: true,
                  thumbnailUrl: true,
                  segmentCount: true,
                },
              },
              videoJobs: {
                select: {
                  status: true,
                  lastProgress: true,
                  submittedAt: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DeliveryOrderSelect;

type UnifiedLibraryOrder = Prisma.DeliveryOrderGetPayload<{
  select: typeof unifiedLibraryOrderSelect;
}>;

export function toUnifiedLibraryRow(
  order: UnifiedLibraryOrder,
): UnifiedLibraryRow | null {
  const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
  if (brief?.takedownAt) return null;
  const finalVideo = brief?.finalVideo ?? null;
  const jobStatuses = (brief?.videoJobs.map((job) => job.status) ?? []) as VideoJobStatus[];
  const segmentCount = finalVideo?.segmentCount ?? jobStatuses.length;
  const segmentsSucceeded = jobStatuses.filter((status) => status === "SUCCEEDED").length;
  const failedSceneCount = jobStatuses.filter((status) => status === "FAILED").length;
  const derived = derivePersonalStatus({
    briefStatus: (brief?.status ?? null) as VideoBriefStatus | null,
    finalVideoStatus: (finalVideo?.status ?? null) as FinalVideoStatus | null,
    segmentsSucceeded,
    segmentsTotal: segmentCount,
    jobStatuses,
    ...summarizeRunningJobs(brief?.videoJobs ?? []),
  });

  return unifiedLibraryRowSchema.parse({
    id: order.id,
    briefId: brief?.id ?? null,
    source: "order",
    videoJobId: null,
    batchId: null,
    brandedVideoUrl: customerSafeFinalVideoUrl(brief?.brandedVideoUrl ?? null),
    title: order.title,
    updatedAt: order.updatedAt,
    status: derived.status satisfies PersonalVideoStatus,
    label: derived.label,
    progress: Math.round(derived.progressHint * 100),
    videoUrl: customerSafeFinalVideoUrl(
      finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null,
    ),
    thumbnailUrl: customerSafeFinalVideoUrl(
      finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
    ),
    durationSec: brief?.durationSec ?? null,
    aspectRatio: brief?.aspectRatio ?? null,
    failedSceneCount,
    canRetry: derived.status === "failed" || failedSceneCount > 0,
  });
}

/// 批量生产的 VideoJob → 成品库行。成品库文案承诺「单条与批量都汇总在这里」，
/// 因此批量视频与订单行合并展示；品牌封装按 videoJobId 粒度操作。
function batchJobStatusToLibraryStatus(
  status: VideoJobStatus,
): "planning" | "generating" | "ready" | "failed" {
  if (status === "SUCCEEDED") return "ready";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  if (status === "QUEUED") return "planning";
  return "generating";
}

type BatchLibraryJob = Prisma.VideoJobGetPayload<{
  select: typeof batchLibraryJobSelect;
}>;

const batchLibraryJobSelect = {
  id: true,
  batchIndex: true,
  status: true,
  lastProgress: true,
  outputVideoUrl: true,
  outputThumbUrl: true,
  brandedVideoUrl: true,
  templateSnapshot: true,
  updatedAt: true,
  batchJob: {
    select: {
      id: true,
      productName: true,
      template: { select: { nameZh: true, name: true } },
    },
  },
} satisfies Prisma.VideoJobSelect;

export function toBatchLibraryRow(job: BatchLibraryJob): UnifiedLibraryRow | null {
  if (!job.batchJob) return null;
  const status = batchJobStatusToLibraryStatus(job.status);
  const snapshot = (job.templateSnapshot ?? null) as {
    durationSec?: number;
    aspectRatio?: string;
  } | null;
  const templateName =
    job.batchJob.template.nameZh ?? job.batchJob.template.name;
  const index = (job.batchIndex ?? 0) + 1;
  return unifiedLibraryRowSchema.parse({
    id: `batch-${job.id}`,
    briefId: null,
    source: "batch",
    videoJobId: job.id,
    batchId: job.batchJob.id,
    brandedVideoUrl: customerSafeFinalVideoUrl(job.brandedVideoUrl),
    title: `${job.batchJob.productName ?? templateName} · ${templateName} #${index}`,
    updatedAt: job.updatedAt,
    status,
    label: status,
    progress:
      status === "ready" ? 100 : Math.round((job.lastProgress ?? 0)),
    videoUrl: customerSafeFinalVideoUrl(job.outputVideoUrl),
    thumbnailUrl: customerSafeFinalVideoUrl(job.outputThumbUrl),
    durationSec: snapshot?.durationSec ?? null,
    aspectRatio: snapshot?.aspectRatio ?? null,
    failedSceneCount: 0,
    canRetry: false,
  });
}

export async function loadUnifiedLibrary(
  userId: string,
): Promise<UnifiedLibraryRow[]> {
  const [orders, batchJobs] = await Promise.all([
    db.deliveryOrder.findMany({
      where: { createdById: userId, productCategory: "unified_input" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: unifiedLibraryOrderSelect,
    }),
    db.videoJob.findMany({
      where: { batchJob: { userId } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: batchLibraryJobSelect,
    }),
  ]);

  return [
    ...orders
      .map(toUnifiedLibraryRow)
      .filter((row): row is UnifiedLibraryRow => row !== null),
    ...batchJobs
      .map(toBatchLibraryRow)
      .filter((row): row is UnifiedLibraryRow => row !== null),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function getUnifiedLibraryItem(userId: string, orderId: string) {
  const order = await db.deliveryOrder.findFirst({
    where: {
      id: orderId,
      createdById: userId,
      productCategory: "unified_input",
    },
    select: unifiedLibraryOrderSelect,
  });
  return order ? toUnifiedLibraryRow(order) : null;
}
