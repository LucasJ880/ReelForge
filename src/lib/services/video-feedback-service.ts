import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  summarizeVideoFeedback,
  toVideoFeedbackView,
  type VideoFeedbackInput,
  type VideoFeedbackSummary,
  type VideoFeedbackView,
} from "@/lib/contracts/video-feedback";

/** 评价表还没建（迁移没跑）：只有评价功能不可用，调用方据此如实提示，不当成普通故障。 */
export class VideoFeedbackUnavailableError extends Error {
  constructor() {
    super("video feedback storage is not ready");
    this.name = "VideoFeedbackUnavailableError";
  }
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

/** 读这条成片的评价；没评过、或评价表还没建 → null（详情页照常渲染）。 */
export async function getVideoFeedback(videoBriefId: string): Promise<VideoFeedbackView | null> {
  try {
    const row = await db.videoFeedback.findUnique({
      where: { videoBriefId },
      select: { rating: true, reasons: true, note: true },
    });
    return toVideoFeedbackView(row);
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/** 记下（或覆盖）商家对这条成片的评价。归属校验在路由层做完才调这里。 */
export async function saveVideoFeedback(
  userId: string,
  videoBriefId: string,
  input: VideoFeedbackInput,
): Promise<VideoFeedbackView> {
  try {
    const row = await db.videoFeedback.upsert({
      where: { videoBriefId },
      create: { videoBriefId, userId, rating: input.rating, reasons: input.reasons, note: input.note },
      update: { userId, rating: input.rating, reasons: input.reasons, note: input.note },
      select: { rating: true, reasons: true, note: true },
    });
    return toVideoFeedbackView(row)!;
  } catch (error) {
    if (isMissingTable(error)) throw new VideoFeedbackUnavailableError();
    throw error;
  }
}

/** 一段时间内的评价汇总（运维读数：满意率 + 各原因次数）。只读。 */
export async function loadVideoFeedbackSummary(since: Date): Promise<VideoFeedbackSummary> {
  const rows = await db.videoFeedback.findMany({
    where: { updatedAt: { gte: since } },
    select: { rating: true, reasons: true },
  });
  return summarizeVideoFeedback(rows);
}
