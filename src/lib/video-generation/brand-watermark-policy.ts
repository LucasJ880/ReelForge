/**
 * 角标水印平台策略。
 *
 * 0805 产品决策（CEO）：品牌 logo 走「印在产品上」（产品图工作台 imprint +
 * 静帧英雄镜头），封装侧用户唯一的选择是「要不要结尾联系方式帧」。
 * 画面角落的 logo 水印（左/右上角印法）平台管线一律停用。
 *
 * 「暂时」性质的决策：实现全部保留，回摆只需把这里翻回 true；
 * scripts 验收链路里显式 opt-in 的角标（applyBrandOverlay 直调）不受此开关约束。
 */
export const CORNER_LOGO_WATERMARK_ENABLED: boolean = false;
