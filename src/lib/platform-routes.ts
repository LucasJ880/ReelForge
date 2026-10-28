export const PLATFORM_PRIMARY_NAV = [
  /// 2026-10-28 瘦身（学 LibTV，只留 SunnyShutter 真实用过的主线）：「本周内容」（/app/plan）与「询盘」
  ///（/app/leads，含询盘页与追踪链接）A 级下线——只撤导航，路由与代码保留可直达，要用时放回这里。
  { id: "create", label: "创作", href: "/app/create" },
  { id: "batches", label: "批量生产", href: "/app/batches" },
  /// R5 战绩页替换旧「投放与赛马」（PRD §10.4 A 级下线：导航移除，/app/racing 路由保留可直达）。
  /// 「战绩」（/app/wins）入口也暂时下线（2026-10-25 审计 B5，A 级：只撤导航、不删代码）：
  /// 表现数据回流（青砚同步）还没开，这页现在只能是零；路由保留可直达，空态如实说明。
  /// 有真实表现数据回流之后再把 { id: "wins", label: "战绩", href: "/app/wins" } 放回这里。
  { id: "library", label: "成品库", href: "/app/library" },
  { id: "brands", label: "品牌", href: "/app/brands" },
  { id: "templates", label: "模板库", href: "/app/templates" },
  /// 2026-10-28 CEO 要的客户使用指南（学 LibTV「学院」）：侧栏底部，顶栏问号也直达。
  { id: "guide", label: "使用指南", href: "/app/guide" },
] as const;

export type PlatformNavId = (typeof PLATFORM_PRIMARY_NAV)[number]["id"];

export function platformPathAfterGeneration(orderId?: string): string {
  return orderId
    ? `/app/library?highlight=${encodeURIComponent(orderId)}`
    : "/app/library";
}
