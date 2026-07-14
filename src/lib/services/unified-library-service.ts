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

export async function loadUnifiedLibrary(
  userId: string,
): Promise<UnifiedLibraryRow[]> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId, productCategory: "unified_input" },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: unifiedLibraryOrderSelect,
  });

  return orders
    .map(toUnifiedLibraryRow)
    .filter((row): row is UnifiedLibraryRow => row !== null);
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
