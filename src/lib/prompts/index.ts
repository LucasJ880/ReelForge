/**
 * Prompt 模板版本中心。
 *
 * 每次升级 prompt 文本必须 bump 对应版本号；写入 AIUsageLog.promptVersion 后
 * 后续可以根据版本号回溯/对比生成质量。
 */
export const PROMPT_VERSIONS = {
  creativeEvidenceBreakdown: "v1.0.0",
  clientScript: "v1.0.0",
  storyboard: "v1.0.0",
  shootingGuide: "v1.0.0",
} as const;

export type PromptKey = keyof typeof PROMPT_VERSIONS;
