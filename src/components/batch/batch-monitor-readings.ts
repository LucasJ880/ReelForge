import type { QuoteStat } from "@/components/exchange/quote-header";
import type { Locale } from "@/i18n/config";
import type { PlatformCopy } from "@/i18n/platform-copy";
import { stateWord } from "@/lib/exchange/state-vocab";

/** 读数墙只需要批次的这几项计数（与 BatchMonitorData 同名同义）。 */
export type BatchReadingCounts = {
  requestedCount: number;
  completedCount: number;
  runningCount: number;
  queuedCount: number;
  pausedCount: number;
  failedCount: number;
  cancelledCount: number;
};

/**
 * 批次详情的委托读数墙：总数 / 已成片 / 生成中 / 排队·暂停 / 失败 / 已取消 / 进度，零就写零。
 *
 * 每一条都要有去处：总数 = 已成片 + 生成中 + 排队·暂停 + 失败 + 已取消。
 * 进度把取消算作「已结束」，之前墙上却没有「已取消」这一格——取消了 3 条的批次读成
 * 「总数 4 · 已成片 1 · 其余全 0 · 进度 100%」，三条去向不明。
 * 纯函数、只引类型与状态词典：'use client' 的批次监控可以安全 import。
 */
export function batchMonitorReadings(
  batch: BatchReadingCounts,
  {
    copy,
    locale,
    progress,
    live,
  }: {
    copy: PlatformCopy["batches"]["monitor"];
    locale: Locale;
    /** 0–100，由批次监控按（已结束 + 生成中的完成度）÷ 总数算好。 */
    progress: number;
    /** 批次还在跑（非终态、非只读样片）：进度格用信号青。 */
    live: boolean;
  },
): QuoteStat[] {
  return [
    { label: copy.total, value: batch.requestedCount },
    { label: copy.completed, value: batch.completedCount, tone: batch.completedCount > 0 ? "filled" : "neutral" },
    { label: copy.running, value: batch.runningCount, tone: batch.runningCount > 0 ? "live" : "neutral" },
    { label: copy.queuedPaused, value: batch.queuedCount + batch.pausedCount },
    { label: copy.failed, value: batch.failedCount, tone: batch.failedCount > 0 ? "fault" : "neutral" },
    /// 取消是商家自己的决定，不是故障：中性色，词从状态词典取
    { label: stateWord("item", "cancelled", locale), value: batch.cancelledCount },
    { label: copy.progress, value: `${progress}%`, tone: live ? "live" : "neutral" },
  ];
}
