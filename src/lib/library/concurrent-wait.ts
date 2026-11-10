/**
 * 同时在生成几条时的等待提示（2026-11-10）。
 *
 * 实测（近 14 天生产数据）：单独一条从提交到出片中位 11 分钟；几分钟内连着提交 3–4 条时，
 * 出片线路按顺序处理，后面几条要 30–67 分钟。页面原来只有一句「一般 10–15 分钟」，
 * 商家连着提交几条后看着进度条不动，不知道是在排队。
 *
 * 这里只负责判断要不要多说一句、说几条：数字用壳层同一个「生成中」读数（exchange-readings），不另算。
 * 纯函数：页面与测试共用。
 */
export function concurrentWaitCount(args: {
  /** 这条成片现在的状态（成品库口径） */
  status: string;
  /** 本工作区正在生成的条数（含这一条）；读不到传 null */
  generating: number | null | undefined;
}): number | null {
  if (args.status !== "generating") return null;
  const count = typeof args.generating === "number" && Number.isFinite(args.generating) ? Math.floor(args.generating) : 0;
  /// 只有自己这一条：不用多说
  return count >= 2 ? count : null;
}
