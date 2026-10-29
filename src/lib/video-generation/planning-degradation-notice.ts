/**
 * 出方案降级的客户面提示（2026-10-29）：方案卡「请注意」与故事板面板说同一套话。
 *
 * 只告诉商家这次哪一步 AI 没用上、画面可能差在哪；原因原文（供应商报错）只进方案 JSON 与运维日志，不给商家看。
 * 质量评审里存英文（与其它提醒一致），方案卡按界面语言换成中文。只引类型：客户端组件也从这里取文案。
 */
import type { PlanningStage } from "@/types/video-generation";

const ISSUE_CODE_PREFIX = "planning_degraded_";

const NOTICES: Record<PlanningStage, { zh: string; en: string }> = {
  creative_brief: {
    zh: "这次 AI 没写成创意方向，开场和卖点直接取自你的描述。",
    en: "AI couldn't draft the creative direction this time, so the opening and selling points come straight from your description.",
  },
  visual_reference: {
    zh: "这次 AI 没看成你上传的图，商品只能按文件名来描述，画面里的商品可能和实拍有出入。",
    en: "AI couldn't look at your uploaded photos this time, so the product is described from file names only and may not match your photos.",
  },
  consistency_bible: {
    zh: "这次 AI 没写成人物、场景和商品的统一设定，改用通用设定，镜头之间可能不够一致。",
    en: "AI couldn't set one consistent look for the person, place and product this time, so a generic one is used and shots may not match each other.",
  },
  segment_prompts: {
    zh: "这次 AI 没写成详细的镜头安排，改用通用模板。",
    en: "AI couldn't write the detailed shot plan this time, so a standard template is used.",
  },
  shot_cards: {
    zh: "这次 AI 没写成每一帧的拍法，分镜按通用节奏出图，前后镜头的动作可能接不上。确认前可以重做不满意的帧。",
    en: "AI couldn't plan how to shoot each frame this time, so frames follow a standard rhythm and actions may not carry over between shots. Redo any frame you don't like before approving.",
  },
};

export function planningDegradationNotice(stage: PlanningStage, locale: "zh" | "en"): string {
  return NOTICES[stage][locale];
}

/** 质量评审里这类提醒的 code：一步一个。 */
export function planningDegradationIssueCode(stage: PlanningStage): string {
  return `${ISSUE_CODE_PREFIX}${stage}`;
}

/** 质量评审 code → 是哪一步降级；不是这类提醒 → null。 */
export function planningStageFromIssueCode(code: string): PlanningStage | null {
  if (!code.startsWith(ISSUE_CODE_PREFIX)) return null;
  const stage = code.slice(ISSUE_CODE_PREFIX.length);
  return Object.hasOwn(NOTICES, stage) ? (stage as PlanningStage) : null;
}
