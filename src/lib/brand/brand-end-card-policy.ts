/**
 * 品牌尾卡（创作页「结尾联系方式帧」/ 成品库「品牌封装」）的入口开关。
 *
 * 2026-10-28 商品主体轮 P0（Evan 与 CEO 定）：尾部追加一帧品牌卡和整条片子脱节——品牌包挂在工作区上、
 * 跟商品无关，CEO 拍保温杯时片尾冒出窗帘厂的 logo 和「免费上门量尺」。方向改为「品牌跟着商品走」：
 * 商品实拍自带的 logo 随商品进视频，P2 用同画风的「商品定格」取代尾卡
 *（docs/roadmap/2026-10-28-product-subject-plan.md）。
 *
 * A 级下线：只撤入口（创作页那一步、成品库的封装按钮），渲染器、接口与数据全保留；
 * 已封装过的成片照旧能下载。放回时改成 true，并把上手引导的品牌一步一起放回（lib/onboarding/steps.ts）。
 *
 * 纯常量模块：客户端组件也引用，不得引入服务端依赖。
 */
export const BRAND_END_CARD_ENTRY_ENABLED = false;

/**
 * 2026-11-09 抖音发布包：尾卡入口对商家保持关闭，只给 Aivora 自己的矩阵账号放开
 *（片尾一张「Aivora · 主页看更多」，不放网址和二维码——站外引流会被平台限流）。
 * 是不是矩阵账号由服务端按 DOUYIN_MATRIX_ACCOUNTS 名单判定（lib/brand/douyin-matrix-access），
 * 这里只接一个布尔值，保持纯常量 / 纯函数。
 */
export function brandEndCardEntryEnabledFor(args: { matrixAccount: boolean }): boolean {
  return BRAND_END_CARD_ENTRY_ENABLED || args.matrixAccount;
}

/** 矩阵账号的 Aivora 尾卡文案：只有品牌名和一句站内引导。 */
export const AIVORA_MATRIX_END_CARD = {
  brandName: "Aivora",
  cta: "主页看更多",
  durationSeconds: 2,
} as const;
