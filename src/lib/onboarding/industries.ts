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

/**
 * 上手第 3 步按行业推荐的风格模板（按顺序取前 3 个「有真机样片」的）。
 * 上门服务的成交靠「看得见的结果」与「人」：前后对比、空间焕新、真人口播排在前面。
 */
export const INDUSTRY_TEMPLATE_PREFERENCES: Record<BusinessIndustry, readonly string[]> = {
  window_coverings: [
    "commerce-before-after-match",
    "commerce-home-space-styling",
    "commerce-talking-head-review",
    "commerce-dark-luxury-light",
    "commerce-morning-routine",
  ],
  renovation: [
    "commerce-before-after-match",
    "commerce-founder-story",
    "commerce-talking-head-review",
    "commerce-home-space-styling",
  ],
  cleaning: [
    "commerce-before-after-match",
    "commerce-talking-head-review",
    "commerce-pov-immersive",
    "commerce-street-interview",
  ],
  landscaping: [
    "commerce-before-after-match",
    "commerce-outdoor-rugged",
    "commerce-founder-story",
    "commerce-talking-head-review",
  ],
  handyman: [
    "commerce-talking-head-review",
    "commerce-before-after-match",
    "commerce-founder-story",
    "commerce-pov-immersive",
  ],
  moving: [
    "commerce-talking-head-review",
    "commerce-street-interview",
    "commerce-founder-story",
    "commerce-pov-immersive",
  ],
  other: [
    "commerce-talking-head-review",
    "commerce-before-after-match",
    "commerce-founder-story",
  ],
};

/** 所有行业都兜底的通用顺序：偏好里的模板没有真机样片时，从这里补齐 3 个。 */
export const FALLBACK_TEMPLATE_ORDER: readonly string[] = [
  "commerce-talking-head-review",
  "commerce-before-after-match",
  "commerce-founder-story",
  "commerce-pov-immersive",
  "commerce-street-interview",
  "commerce-outdoor-rugged",
];
