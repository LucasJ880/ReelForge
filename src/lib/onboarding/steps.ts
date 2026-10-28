import type { OnboardingState } from "@/lib/services/onboarding-service";

export type OnboardingStepKey = keyof OnboardingState["steps"];

/**
 * 上手引导实际展示的步骤：客户端步骤列表与 /app/welcome 的进度读数共用这一份。
 *
 * 2026-10-28 询盘入口 A 级下线：询盘页一步撤掉（组件与接口保留）。
 * 同日商品主体轮 P0：品牌一步随品牌尾卡一起撤掉（lib/brand/brand-end-card-policy.ts）——
 * 品牌包只喂尾卡，尾卡撤了，这一步就只剩让人传一个用不上的 logo。P1 商品库上线后这里放「第一个商品」。
 * 改步骤时同步改 onboarding-copy 的 welcome.subtitle（写着几步）。
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepKey[] = ["business", "video"];
