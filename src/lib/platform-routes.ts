export const PLATFORM_PRIMARY_NAV = [
  /// 2026-10-28 瘦身（学 LibTV，只留 SunnyShutter 真实用过的主线）：「询盘」（/app/leads，含询盘页与追踪链接）
  /// A 级下线——只撤导航，路由与代码保留可直达，要用时放回这里。
  /// 2026-11-16 第 3 批瘦身：「本周内容」（/app/plan）、「战绩」（/app/wins）、「投放赛马」（/app/racing）、
  /// 「产品图工作台」（/app/create/images）四个早就撤出导航的页面连同接口、服务一起删了（C 级）。
  /// 旧网址由 next.config.ts 转到创作页 / 成品库；要放回得从 git 历史取回代码，不是往这里加一行。
  { id: "create", label: "创作", href: "/app/create" },
  { id: "batches", label: "批量生产", href: "/app/batches" },
  { id: "library", label: "成品库", href: "/app/library" },
  /// 2026-11-10 商品档案：常拍的商品存一次（名字、卖点、尺寸、商品图），以后点一下就带进创作页。
  { id: "products", label: "商品", href: "/app/products" },
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
