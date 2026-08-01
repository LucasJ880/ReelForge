export const PLATFORM_PRIMARY_NAV = [
  /// 一句话进、一周排完（PRD §3 O1）。放在最前：它是新定位的主入口 ——
  /// 小商家的痛点是发不出去、发得不连续，不是单条不够好。
  { id: "plan", label: "本周内容", href: "/app/plan" },
  { id: "create", label: "创作", href: "/app/create" },
  { id: "batches", label: "批量生产", href: "/app/batches" },
  /// R5 战绩页替换旧「投放与赛马」（PRD §10.4 A 级下线：导航移除，
  /// /app/racing 路由保留可直达）。旧页是代运营轮次模型，新页是配方胜负结论。
  { id: "wins", label: "战绩", href: "/app/wins" },
  { id: "library", label: "成品库", href: "/app/library" },
  { id: "brands", label: "品牌", href: "/app/brands" },
  { id: "templates", label: "模板库", href: "/app/templates" },
] as const;

export type PlatformNavId = (typeof PLATFORM_PRIMARY_NAV)[number]["id"];

export function platformPathAfterGeneration(orderId?: string): string {
  return orderId
    ? `/app/library?highlight=${encodeURIComponent(orderId)}`
    : "/app/library";
}
