import { OnCameraMode, Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";

const ON_CAMERA_MAP: Record<string, OnCameraMode> = {
  NONE: OnCameraMode.NONE,
  SELF_RAW: OnCameraMode.SELF_RAW,
  SELF_VOICE_REPLACED: OnCameraMode.SELF_VOICE_REPLACED,
  SELF_SUBTITLED: OnCameraMode.SELF_SUBTITLED,
  UGC_AVATAR: OnCameraMode.UGC_AVATAR,
  PRODUCT_ONLY: OnCameraMode.PRODUCT_ONLY,
};

/**
 * 为一个 ContentAngle 创建初始 VideoBrief。
 * 默认从 angle 的 locale_notes 里读取出镜建议；读不出就按 PRODUCT_ONLY 兜底。
 */
export async function ensureBriefForAngle(angleId: string) {
  const angle = await db.contentAngle.findUnique({
    where: { id: angleId },
    include: { videoBrief: true },
  });
  if (!angle) throw new Error("Angle 不存在");
  if (angle.videoBrief) return angle.videoBrief;

  const onCameraRec =
    (angle.localeNotes as Record<string, unknown> | null)?.on_camera_recommendation;
  const onCameraMode =
    typeof onCameraRec === "string" && ON_CAMERA_MAP[onCameraRec]
      ? ON_CAMERA_MAP[onCameraRec]
      : OnCameraMode.PRODUCT_ONLY;

  return db.videoBrief.create({
    data: {
      contentAngleId: angle.id,
      status: VideoBriefStatus.BRIEF_PENDING,
      durationSec: 20,
      aspectRatio: "9:16",
      onCameraMode,
    },
  });
}

export async function ensureBriefsForRound(roundId: string) {
  const angles = await db.contentAngle.findMany({
    where: { roundId },
    orderBy: { sortOrder: "asc" },
  });
  const briefs = [] as Awaited<ReturnType<typeof ensureBriefForAngle>>[];
  for (const angle of angles) {
    briefs.push(await ensureBriefForAngle(angle.id));
  }
  return briefs;
}

export async function updateBriefStatus(
  id: string,
  status: VideoBriefStatus,
  extra?: { errorMessage?: string | null; finalVideoUrl?: string | null; finalThumbnailUrl?: string | null },
) {
  return db.videoBrief.update({
    where: { id },
    data: {
      status,
      ...(extra ?? {}),
    },
  });
}

export async function setReferenceImages(
  briefId: string,
  urls: string[],
) {
  return db.videoBrief.update({
    where: { id: briefId },
    data: {
      referenceImageUrls: urls,
    },
  });
}

export type { OnCameraMode };
export const ON_CAMERA_LABELS: Record<OnCameraMode, string> = {
  NONE: "不出镜",
  SELF_RAW: "本人出镜 · 原声",
  SELF_VOICE_REPLACED: "本人出镜 · AI 换声",
  SELF_SUBTITLED: "本人出镜 · 字幕优化",
  UGC_AVATAR: "UGC / AI 数字人",
  PRODUCT_ONLY: "仅产品/场景",
};

export function getBriefInclude() {
  return {
    contentAngle: {
      include: {
        round: { include: { deliveryOrder: true } },
      },
    },
    scripts: { where: { isCurrent: true } },
    videoJobs: { orderBy: { createdAt: "desc" as const } },
    qaReviews: { orderBy: { createdAt: "desc" as const } },
    publishRecords: { orderBy: { createdAt: "desc" as const } },
  } satisfies Prisma.VideoBriefInclude;
}
