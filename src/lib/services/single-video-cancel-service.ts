import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  refundFailedBrief,
  refundFailedSegmentRedo,
} from "@/lib/services/quota-refund-service";
import { isCurrentSegmentJob, isSegmentRedoCandidate } from "@/lib/video-generation/segment-redo";

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
 *
 * P05-B 只重拼中取消：段都已成功、没有可取消的任务，FinalVideo 在 PENDING / STITCHING 且
 * previousStitchedVideoUrl 非空 → 回滚到旧成片（rollbackRestitch）。这不是取消订单：
 * 成片一直都在，订单 / brief / 额度都不动，只是放弃这次换设置。
 *
 * P05-C 重做某一段中取消：只取消重做候选行（打 segment_redo_cancelled，清掉 logicalJobKey 这个幂等键，
 * 下一次重做不受它影响），立即退回这 1 段；订单、brief、成片都不动——旧成片一直是 READY。
 * 候选行已换挂、正在重拼时取消，走上面的只重拼回滚（新段留在成片上，成片回到旧片）。
 */
export const CUSTOMER_CANCELLED_CLASS = "customer_cancelled";
export const CUSTOMER_CANCEL_MESSAGE = "已取消：素材与描述已保留，可以修改后重新提交。";
export const SEGMENT_REDO_CANCELLED_CLASS = "segment_redo_cancelled";
export const SEGMENT_REDO_CANCEL_MESSAGE = "已取消这次重做，成片保持原样，这 1 段额度已退回。";

const CANCELLABLE_JOB_STATUSES: VideoJobStatus[] = [
  VideoJobStatus.QUEUED,
  VideoJobStatus.PAUSED,
  VideoJobStatus.RUNNING,
];

export type CancelUnifiedOrderResult =
  | {
      ok: true;
      cancelledJobs: number;
      refundedBriefs: number;
      restitchRolledBack?: number;
      cancelledRedos?: number;
    }
  | { ok: false; reason: "not_found" | "already_finished" };

const RESTITCH_IN_FLIGHT_STATUSES: FinalVideoStatus[] = [
  FinalVideoStatus.PENDING,
  FinalVideoStatus.STITCHING,
];
export const RESTITCH_CANCEL_MESSAGE = "已取消本次换字幕 / 配乐，成片保持原样。";

export async function cancelUnifiedOrderForUser(
  userId: string,
  orderId: string,
  now = new Date(),
  deps: {
    refund: typeof refundFailedBrief;
    refundRedo?: typeof refundFailedSegmentRedo;
  } = { refund: refundFailedBrief, refundRedo: refundFailedSegmentRedo },
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
                  videoJobs: {
                    select: {
                      id: true,
                      status: true,
                      replacesJobId: true,
                      finalVideoId: true,
                      supersededAt: true,
                    },
                  },
                  finalVideo: { select: { status: true, previousStitchedVideoUrl: true } },
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
  /// 订单级取消只看「当前段」：重做候选行在跑不代表这一单还没交付（旧成片是 READY）
  const cancellable = briefs.filter((brief) =>
    brief.videoJobs.some(
      (job) => isCurrentSegmentJob(job) && CANCELLABLE_JOB_STATUSES.includes(job.status),
    ),
  );
  if (cancellable.length === 0) {
    /// 重做某一段中取消 = 只取消候选行并退回这 1 段；同一单里若还有只重拼在途，一并回滚。
    const cancelledRedoIds: string[] = [];
    for (const brief of briefs) {
      const redoIds = brief.videoJobs
        .filter((job) => isSegmentRedoCandidate(job) && CANCELLABLE_JOB_STATUSES.includes(job.status))
        .map((job) => job.id);
      if (redoIds.length === 0) continue;
      const cancelled = await db.videoJob.updateMany({
        where: {
          id: { in: redoIds },
          replacesJobId: { not: null },
          finalVideoId: null,
          status: { in: CANCELLABLE_JOB_STATUSES },
        },
        data: {
          status: VideoJobStatus.CANCELLED,
          submissionErrorClass: SEGMENT_REDO_CANCELLED_CLASS,
          userSafeError: SEGMENT_REDO_CANCEL_MESSAGE,
          finishedAt: now,
          /// 清幂等键：候选行的 `…:redo:n` 不再占位（n 按历史候选数算，不会撞回来）
          logicalJobKey: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (cancelled.count > 0) cancelledRedoIds.push(...redoIds);
    }
    const refundRedo = deps.refundRedo ?? refundFailedSegmentRedo;
    for (const jobId of cancelledRedoIds) {
      try {
        await refundRedo(jobId, { now, reason: "cancelled" });
      } catch (error) {
        console.warn(`[single-cancel] redo refund for ${jobId} deferred to sweep:`, (error as Error).message);
      }
    }

    /// 只重拼中取消 = 回滚到旧片，不取消订单、不返还、不改 brief。
    const restitching = briefs.filter(
      (brief) =>
        brief.finalVideoId &&
        brief.finalVideo &&
        RESTITCH_IN_FLIGHT_STATUSES.includes(brief.finalVideo.status) &&
        Boolean(brief.finalVideo.previousStitchedVideoUrl),
    );
    let restitchRolledBack = 0;
    if (restitching.length > 0) {
      /// 动态 import：stitch-service 带着合成器依赖，不让取消路由的函数包背上它
      const { rollbackRestitch } = await import("@/lib/services/stitch-service");
      for (const brief of restitching) {
        const rolled = await rollbackRestitch(brief.finalVideoId as string, RESTITCH_CANCEL_MESSAGE, {
          status: RESTITCH_IN_FLIGHT_STATUSES,
          now,
        });
        if (rolled.rolledBack) restitchRolledBack += 1;
      }
    }
    if (restitchRolledBack > 0 || cancelledRedoIds.length > 0) {
      return {
        ok: true,
        cancelledJobs: cancelledRedoIds.length,
        refundedBriefs: 0,
        restitchRolledBack,
        ...(cancelledRedoIds.length > 0 ? { cancelledRedos: cancelledRedoIds.length } : {}),
      };
    }
    return { ok: false, reason: "already_finished" };
  }

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
