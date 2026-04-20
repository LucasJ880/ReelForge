import { PublishStatus, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * 发布流程 MVP（半自动）：
 *  1. QA 通过 → 自动创建 PublishRecord (PENDING)
 *  2. 运营点击 /publish/[id]/download → 标记 DOWNLOADED
 *  3. 运营在 TikTok 上传后，在 UI 回填 post_id + url → 标记 UPLOADED
 *  4. 运营确认发布上线 → PUBLISHED；同时触发 MetricsWindow 待抓取
 */

export async function markDownloaded(id: string) {
  return db.publishRecord.update({
    where: { id },
    data: { status: PublishStatus.DOWNLOADED },
  });
}

export async function submitExternalPost(
  id: string,
  params: {
    publishedById: string;
    externalPostId: string;
    publishUrl?: string;
    operatorNote?: string;
  },
) {
  const record = await db.publishRecord.update({
    where: { id },
    data: {
      status: PublishStatus.UPLOADED,
      externalPostId: params.externalPostId,
      publishUrl: params.publishUrl ?? null,
      publishedById: params.publishedById,
      operatorNote: params.operatorNote ?? null,
    },
  });
  return record;
}

export async function confirmPublished(id: string) {
  const record = await db.publishRecord.update({
    where: { id },
    data: {
      status: PublishStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await db.videoBrief.update({
    where: { id: record.videoBriefId },
    data: { status: VideoBriefStatus.PUBLISHED },
  });
  // 触发数据回流：立即创建 metrics 窗口占位由 metrics-service 负责
  return record;
}

export async function failPublish(id: string, reason: string) {
  return db.publishRecord.update({
    where: { id },
    data: { status: PublishStatus.FAILED, operatorNote: reason },
  });
}

export async function listPendingPublish() {
  return db.publishRecord.findMany({
    where: {
      status: {
        in: [PublishStatus.PENDING, PublishStatus.DOWNLOADED, PublishStatus.UPLOADED],
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      videoBrief: {
        include: {
          contentAngle: {
            include: { round: { include: { deliveryOrder: true } } },
          },
        },
      },
    },
  });
}

/**
 * 启动赛马轮次 LIVE 状态（当该轮全部 PublishRecord 都 PUBLISHED 时）。
 */
export async function tryTransitionRoundToLive(publishRecordId: string) {
  const record = await db.publishRecord.findUnique({
    where: { id: publishRecordId },
    include: {
      videoBrief: {
        include: { contentAngle: true },
      },
    },
  });
  if (!record) return;
  const roundId = record.videoBrief.contentAngle.roundId;
  const all = await db.contentAngle.findMany({
    where: { roundId },
    include: {
      videoBrief: {
        include: {
          publishRecords: {
            where: { status: PublishStatus.PUBLISHED },
            take: 1,
          },
        },
      },
    },
  });
  const allPublished = all.every(
    (a) => a.videoBrief && a.videoBrief.publishRecords.length > 0,
  );
  if (allPublished) {
    await db.round.update({
      where: { id: roundId },
      data: {
        status: "LIVE",
        startedAt: new Date(),
      },
    });
  }
}
