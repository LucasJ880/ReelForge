import type {
  FinalVideoStatus,
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

export interface UnifiedLibraryRow {
  id: string;
  briefId: string | null;
  title: string;
  updatedAt: Date;
  status: PersonalVideoStatus;
  label: string;
  progress: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  aspectRatio: string | null;
  failedSceneCount: number;
  canRetry: boolean;
}

export async function loadUnifiedLibrary(
  userId: string,
): Promise<UnifiedLibraryRow[]> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId, productCategory: "unified_input" },
    orderBy: { updatedAt: "desc" },
    take: 100,
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
    },
  });

  return orders.map((order) => {
    const brief = order.rounds[0]?.angles[0]?.videoBrief ?? null;
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
    if (brief?.takedownAt) return null;
    return {
      id: order.id,
      briefId: brief?.id ?? null,
      title: order.title,
      updatedAt: order.updatedAt,
      status: derived.status,
      label: derived.label,
      progress: derived.progressHint,
      videoUrl: customerSafeFinalVideoUrl(
        finalVideo?.stitchedVideoUrl ?? brief?.finalVideoUrl ?? null,
      ),
      thumbnailUrl: finalVideo?.thumbnailUrl ?? brief?.finalThumbnailUrl ?? null,
      durationSec: brief?.durationSec ?? null,
      aspectRatio: brief?.aspectRatio ?? null,
      failedSceneCount,
      canRetry: derived.status === "failed" || failedSceneCount > 0,
    } satisfies UnifiedLibraryRow;
  }).filter((row): row is UnifiedLibraryRow => row !== null);
}

export async function getUnifiedLibraryItem(userId: string, orderId: string) {
  const rows = await loadUnifiedLibrary(userId);
  return rows.find((row) => row.id === orderId) ?? null;
}
