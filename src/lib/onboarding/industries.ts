/**
 * 自助注册与上手向导的行业选项（上门服务为主）。纯数据：注册页（客户端）与服务端共用。
 * 展示文案在 onboarding-copy；这里只放 key 与「按行业推荐什么」。
 */
export const BUSINESS_INDUSTRIES = [
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
