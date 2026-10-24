import { db } from "@/lib/db";
import { loadUnifiedLibrary } from "@/lib/services/unified-library-service";
import type { UnifiedLibraryRow } from "@/lib/contracts/unified-library";

const LIVE_BATCH_STATUSES = ["EXPANDING", "RUNNING", "PAUSED"] as const;
const IN_FLIGHT = new Set<UnifiedLibraryRow["status"]>(["planning", "generating", "assembling"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 交易台读数的唯一口径：大屏、创作台、批量页共用，别在页面里各算一套。
 * 只数访问者本人的数据（成品库样片 isShowcase 一律不计）；零就是零。
 */
export type ExchangeReadings = {
  /** 进行中批次：扩展中 / 生成中 / 暂停。 */
  liveBatches: number;
  /** 正在出片的条数（单条创作 + 批量里尚未成片的成品库行）。 */
  inFlight: number;
  filled24h: number;
  filled7d: number;
  filled30d: number;
  /** 近 7 天失败条数：批量失败直接数 VideoJob（成品库按 PRD §10.1 折叠了它们），取消不算失败。 */
  failed7d: number;
  /** 近 7 天成片成功率 = 成片 ÷ (成片 + 失败)，0–100；没有样本时为 null，界面写「—」。 */
  successRate7d: number | null;
  /** 上一个同长窗口（24–48 小时前 / 7–14 天前）的同口径读数，用来画涨跌方向。 */
  previous: { filled24h: number; filled7d: number; failed7d: number };
  /** 最近成片（可播放的真实媒体），按更新时间倒序。 */
  media: UnifiedLibraryRow[];
  /** 成交回报：最近有动静的视频行（成片 / 失败 / 生成中），按更新时间倒序；默认不取。 */
  recent: UnifiedLibraryRow[];
};

export async function loadExchangeReadings(
  userId: string,
  { now = new Date(), mediaLimit = 6, recentLimit = 0 }: { now?: Date; mediaLimit?: number; recentLimit?: number } = {},
): Promise<ExchangeReadings> {
  const at = now.getTime();
  const [liveBatches, batchFailed7d, batchFailedPrev7d, rows] = await Promise.all([
    db.batchJob.count({ where: { userId, status: { in: [...LIVE_BATCH_STATUSES] } } }),
    db.videoJob.count({
      where: { status: "FAILED", batchJob: { userId }, updatedAt: { gte: new Date(at - 7 * DAY_MS) } },
    }),
    db.videoJob.count({
      where: {
        status: "FAILED",
        batchJob: { userId },
        updatedAt: { gte: new Date(at - 14 * DAY_MS), lt: new Date(at - 7 * DAY_MS) },
      },
    }),
    loadUnifiedLibrary(userId),
  ]);

  const own = rows
    .filter((row) => !row.isShowcase)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const within = (row: UnifiedLibraryRow, ms: number) => at - row.updatedAt.getTime() <= ms;
  const between = (row: UnifiedLibraryRow, fromMs: number, toMs: number) => {
    const age = at - row.updatedAt.getTime();
    return age > fromMs && age <= toMs;
  };
  const ready = own.filter((row) => row.status === "ready");
  const filled7d = ready.filter((row) => within(row, 7 * DAY_MS)).length;
  const failed7d =
    batchFailed7d +
    own.filter((row) => row.status === "failed" && row.source !== "batch" && within(row, 7 * DAY_MS)).length;

  return {
    liveBatches,
    inFlight: own.filter((row) => IN_FLIGHT.has(row.status)).length,
    filled24h: ready.filter((row) => within(row, DAY_MS)).length,
    filled7d,
    filled30d: ready.filter((row) => within(row, 30 * DAY_MS)).length,
    failed7d,
    successRate7d: filled7d + failed7d > 0 ? Math.round((filled7d / (filled7d + failed7d)) * 100) : null,
    previous: {
      filled24h: ready.filter((row) => between(row, DAY_MS, 2 * DAY_MS)).length,
      filled7d: ready.filter((row) => between(row, 7 * DAY_MS, 14 * DAY_MS)).length,
      failed7d:
        batchFailedPrev7d +
        own.filter((row) => row.status === "failed" && row.source !== "batch" && between(row, 7 * DAY_MS, 14 * DAY_MS)).length,
    },
    media: ready.filter((row) => row.source !== "post" && row.videoUrl).slice(0, mediaLimit),
    recent: own.filter((row) => row.source !== "post").slice(0, recentLimit),
  };
}
