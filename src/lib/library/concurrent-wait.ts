/**
 * 同时在生成几条时的等待提示（2026-11-10）。
 *
 * 实测（2026-11-10 晚，20 条真实任务，并向合作方查了它自己记的起止时间）：出片中位 11.9 分钟，
 * 20 条里有 4 条用了 30–67 分钟。慢的那几条和提交先后无关——同一分钟提交、排在它后面的照样 8–11 分钟出片；
 * 合作方记的完成时间和我们记的相差不到 20 秒，所以慢在合作方那边，不是我们发现得晚。
 * （这里原来写的是「出片线路按顺序处理，后面几条要等」，那是只看了耗时分布猜的，已改正。）
 * 同时在做的条数越多，碰上一条慢的机会越大；页面只在同时做两条以上时多说一句，免得商家以为卡住了。
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
