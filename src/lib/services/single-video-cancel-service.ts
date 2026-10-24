import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { refundFailedBrief } from "@/lib/services/quota-refund-service";

/**
 * 客户取消一条已提交的单条视频（铁律 #7：每一轮任务都必须可取消）。
 *
 * 1025 真机验收发现：成品库写着「点进去可以看进度或取消」，但单条视频一旦提交就只剩
 * 内部运营台能取消（而且只改订单状态、不停任务）。这里补上客户侧的取消：
 *  - 只动本人的自助单（DeliveryOrder.createdById + unified_input），样片 / 他人单一律 not_found；
 *  - 未结束的段（排队 / 暂停 / 生成中）CAS 成 CANCELLED 并打 customer_cancelled 标记：
 *    轮询的终态写入都带 status 条件，供应商晚到的结果不会把它救活；
 *    syncBriefStatus 见到这个标记不再拼接半成品；
 *  - 未完成的 FinalVideo 置 FAILED，brief 置 RENDER_FAILED（人话写明「已取消、素材保留」）；
 *  - 立即按条返还本月额度（D1），不等下一轮清扫——客户点完取消就能看到额度回来；
 *  - 素材（上传图、故事板、描述）一律保留，不删除任何东西。
 */
export const CUSTOMER_CANCELLED_CLASS = "customer_cancelled";
export const CUSTOMER_CANCEL_MESSAGE = "已取消：素材与描述已保留，可以修改后重新提交。";

const CANCELLABLE_JOB_STATUSES: VideoJobStatus[] = [
  VideoJobStatus.QUEUED,
  VideoJobStatus.PAUSED,
  VideoJobStatus.RUNNING,
];

export type CancelUnifiedOrderResult =
  | { ok: true; cancelledJobs: number; refundedBriefs: number }
  | { ok: false; reason: "not_found" | "already_finished" };

export async function cancelUnifiedOrderForUser(
  userId: string,
  orderId: string,
  now = new Date(),
  deps: { refund: typeof refundFailedBrief } = { refund: refundFailedBrief },
): Promise<CancelUnifiedOrderResult> {
  const order = await db.deliveryOrder.findFirst({
    where: { id: orderId, createdById: userId, productCategory: "unified_input" },
    select: {
      id: true,
      rounds: {
        select: {
          angles: {
            select: {
              videoBrief: {
                select: {
                  id: true,
                  finalVideoId: true,
                  videoJobs: { select: { id: true, status: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return { ok: false, reason: "not_found" };

  const briefs = order.rounds
    .flatMap((round) => round.angles)
    .map((angle) => angle.videoBrief)
    .filter((brief): brief is NonNullable<typeof brief> => Boolean(brief));
  const cancellable = briefs.filter((brief) =>
    brief.videoJobs.some((job) => CANCELLABLE_JOB_STATUSES.includes(job.status)),
  );
  if (cancellable.length === 0) return { ok: false, reason: "already_finished" };

  let cancelledJobs = 0;
  const cancelledBriefIds: string[] = [];
  for (const brief of cancellable) {
    const cancelled = await db.$transaction(async (tx) => {
      const jobs = await tx.videoJob.updateMany({
        where: { videoBriefId: brief.id, status: { in: CANCELLABLE_JOB_STATUSES } },
        data: {
          status: VideoJobStatus.CANCELLED,
          submissionErrorClass: CUSTOMER_CANCELLED_CLASS,
          userSafeError: CUSTOMER_CANCEL_MESSAGE,
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (jobs.count === 0) return 0;
      if (brief.finalVideoId) {
        await tx.finalVideo.updateMany({
          where: {
            id: brief.finalVideoId,
            status: { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] },
          },
          data: { status: FinalVideoStatus.FAILED, ffmpegError: CUSTOMER_CANCEL_MESSAGE, finishedAt: now },
        });
      }
      await tx.videoBrief.update({
        where: { id: brief.id },
        data: { status: VideoBriefStatus.RENDER_FAILED, errorMessage: CUSTOMER_CANCEL_MESSAGE },
      });
      return jobs.count;
    });
    if (cancelled > 0) {
      cancelledJobs += cancelled;
      cancelledBriefIds.push(brief.id);
    }
  }
  if (cancelledJobs === 0) return { ok: false, reason: "already_finished" };

  await db.deliveryOrder.update({
    where: { id: order.id },
    data: { status: "CANCELLED", errorMessage: CUSTOMER_CANCEL_MESSAGE },
  });

  /// 立即返还；失败也不影响取消本身——清扫器的对账会补上。
  let refundedBriefs = 0;
  for (const briefId of cancelledBriefIds) {
    try {
      if ((await deps.refund(briefId, { now })) === "refunded") refundedBriefs += 1;
    } catch (error) {
      console.warn(`[single-cancel] refund for brief ${briefId} deferred to sweep:`, (error as Error).message);
    }
  }
  return { ok: true, cancelledJobs, refundedBriefs };
}
