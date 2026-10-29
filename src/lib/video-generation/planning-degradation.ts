/**
 * 出方案阶段的 AI 降级记录（2026-10-29）。
 *
 * 出方案要调几次 AI：创意简报、看参考图、一致性设定（bible）、段提示词；建故事板时还有镜头卡。每一步失败都有兜底
 *（启发式 / 模板），以前只打一行 console.warn，方案照常出——商家和运维都不知道这次降级了。10-29 视频评测集里：
 * OpenAI 拉图 3 秒超时、推理模型把额度全用在思考上，商品描述只能凭文件名写，商品因此跑样。
 *
 * 这里定一个形状（PlanningDegradation：哪一步、为什么、退回了什么），各步失败时交给调用方传进来的 onDegraded；
 * 出方案收进 VideoGenerationPlan.planningDegradations，镜头卡收进 StoryboardRun.planningDegradations。
 * 不改任何一步的成功路径。
 *
 * 看得到的出口：商家在方案卡「请注意」与故事板面板看到一句人话（planning-degradation-notice）；
 * 运维按 PLANNING_DEGRADED_LOG_PREFIX 搜日志，一次方案 / 一轮故事板一行 JSON，带原因原文。
 */
import { safeNote } from "@/lib/capabilities/classify";
import type { PlanningDegradation, PlanningFallback, PlanningStage } from "@/types/video-generation";

export type RecordPlanningDegradation = (degradation: PlanningDegradation) => void;

/** 流水线顺序：一次方案里的记录按它排，不随并行调用的先后变。 */
export const PLANNING_STAGES: readonly PlanningStage[] = [
  "creative_brief",
  "visual_reference",
  "consistency_bible",
  "segment_prompts",
  "shot_cards",
];

export const PLANNING_FALLBACK_BY_STAGE: Record<PlanningStage, PlanningFallback> = {
  /// hook / 卖点按商家描述原文抽
  creative_brief: "heuristic_brief",
  /// 不看图：后面几步只拿到文件名和分类器备注
  visual_reference: "no_visual_analysis",
  /// 通用人物与场景，商品描述凭文件名写
  consistency_bible: "heuristic_bible",
  /// 模板镜头表
  segment_prompts: "heuristic_segment_prompts",
  /// 故事板按模板节奏出帧
  shot_cards: "template_beats",
};

/// 原因进方案 JSON、进库：压成一行、抹掉疑似密钥（与能力状态的运维 note 同一规则），截到这么长。
const REASON_MAX_CHARS = 300;

/** 错误 → 原因：直接用错误信息（provider 层已写明 finish_reason / 拉图失败）；调用方自己写的原因也走这里。 */
export function planningDegradationReason(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);
  return safeNote(raw, REASON_MAX_CHARS) ?? "unknown error";
}

export function planningDegradation(stage: PlanningStage, cause: unknown): PlanningDegradation {
  return { stage, reason: planningDegradationReason(cause), fallback: PLANNING_FALLBACK_BY_STAGE[stage] };
}

/** 库里的 JSON（StoryboardRun.planningDegradations）→ 记录；null、旧数据、认不出的条目都跳过。 */
export function readPlanningDegradations(value: unknown): PlanningDegradation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PlanningDegradation[] => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const stage = PLANNING_STAGES.find((candidate) => candidate === record?.stage);
    if (!record || !stage) return [];
    return [{
      stage,
      reason: typeof record.reason === "string" ? record.reason : "",
      fallback: PLANNING_FALLBACK_BY_STAGE[stage],
    }];
  });
}

/// 运维按这个前缀搜日志（Vercel Logs）：后面跟一行 JSON。
export const PLANNING_DEGRADED_LOG_PREFIX = "[planning] degraded";

/** 一次方案 / 一轮故事板有降级时打一行结构化日志（带原因原文）；没有降级不打。 */
export function logPlanningDegradations(
  context: { source: "plan"; planId: string } | { source: "storyboard"; runId: string },
  degradations: readonly PlanningDegradation[],
): void {
  if (degradations.length === 0) return;
  console.warn(`${PLANNING_DEGRADED_LOG_PREFIX} ${JSON.stringify({ ...context, degradations })}`);
}

/** 一次出方案的收集器：record 交给各步，list() 按流水线顺序给出。 */
export function createPlanningDegradationLog(): {
  record: RecordPlanningDegradation;
  list: () => PlanningDegradation[];
} {
  const entries: PlanningDegradation[] = [];
  return {
    record: (degradation) => {
      entries.push(degradation);
    },
    list: () =>
      entries
        .map((degradation, index) => ({ degradation, index }))
        .sort(
          (a, b) =>
            PLANNING_STAGES.indexOf(a.degradation.stage) - PLANNING_STAGES.indexOf(b.degradation.stage) ||
            a.index - b.index,
        )
        .map(({ degradation }) => degradation),
  };
}
