export const PLATFORM_PRIMARY_NAV = [
  { id: "create", label: "创作", href: "/app/create" },
  { id: "batches", label: "批量生产", href: "/app/batches" },
  { id: "racing", label: "投放与赛马", href: "/app/racing" },
  { id: "library", label: "成品库", href: "/app/library" },
  { id: "templates", label: "模板库", href: "/app/templates" },
] as const;

export type PlatformNavId = (typeof PLATFORM_PRIMARY_NAV)[number]["id"];

export function platformPathAfterGeneration(orderId?: string): string {
  return orderId
    ? `/app/library?highlight=${encodeURIComponent(orderId)}`
    : "/app/library";
}
