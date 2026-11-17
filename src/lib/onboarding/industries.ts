/**
 * 自助注册与上手向导的行业选项。纯数据：注册页（客户端）与服务端共用；展示文案在 onboarding-copy。
 * 2026-11-17：出片方式定成「照着商品实拍图拍」之后，把卖商品的几类排到前面（之前只有上门服务，卖家纺、母婴的商家没有可选的）；
 * 上门服务几类照旧保留，老账号存的值都还认。
 */
export const BUSINESS_INDUSTRIES = [
  "home_textiles",
  "baby",
  "beauty",
  "food",
  "apparel",
  "home_goods",
  "electronics",
  "window_coverings",
  "renovation",
  "cleaning",
  "landscaping",
  "handyman",
  "moving",
  "other",
] as const;

export type BusinessIndustry = (typeof BUSINESS_INDUSTRIES)[number];

export function isBusinessIndustry(value: unknown): value is BusinessIndustry {
  return typeof value === "string" && (BUSINESS_INDUSTRIES as readonly string[]).includes(value);
}
