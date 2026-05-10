/**
 * Wizard Fallback Messages —— 集中放 mock / draft / failure 时给用户看的中文文案。
 *
 * 设计目的：
 * - service 层只产出**结构化原因**（status + reason），UI 由 banner 决定如何呈现；
 * - 但脚本 / 分镜 / 渲染 三个 service 之前散落了相似措辞，文案漂移风险高；
 * - 这里集中以**纯字符串常量**形式存放，避免 service 层耦合到 UI logo / icon / color。
 *
 * 不要在这里写带 emoji / markdown / HTML 的内容 —— 这些 reason 会写进 DB、AIUsageLog、
 * 也会被 API 直接返回给前端 JSON。
 */

export const WIZARD_FALLBACK = {
  /** Step 3：未配置 OpenAI key，自动走 mock */
  scriptMissingKey:
    "OPENAI_API_KEY 未配置，已回退到 mock 脚本（仍可继续后续流程）",
  /** Step 3：LLM 调用 / parse 失败，已 mock */
  scriptLlmFailedPrefix: "LLM 调用失败已回退 mock",

  /** Step 4：未配置 OpenAI key，自动走 mock */
  storyboardMissingKey:
    "OPENAI_API_KEY 未配置，已回退到 mock 分镜（仍可继续后续流程）",
  /** Step 4：LLM 调用 / parse 失败，已 mock */
  storyboardLlmFailedPrefix: "LLM 调用失败已回退 mock 分镜",

  /** Step 6 DRAFT 默认原因 */
  renderDraftDefault:
    "Draft Preview：尚未启用真 FFmpeg 渲染，已用首个可用素材 + manifest 拼出可审核草稿。",
  /** Step 6 MOCK：完全没素材 */
  renderMockNoAssets:
    "Mock Preview：尚未上传任何可用素材，当前仅生成时间线 manifest 占位。请回到 Step 5 上传至少一个素材后重试。",
  /** Step 6 REAL 渲染失败已自动降级 */
  renderRealFailedPrefix: "渲染失败已降级为草稿预览",
  /** Step 6 全部 clip 都是占位 */
  renderRealNoUsableClips:
    "未找到可用 clip：所有 storyboard 镜头都没有匹配到上传素材，已降级为 Draft Preview。",
} as const;

export type WizardFallbackKey = keyof typeof WIZARD_FALLBACK;

/**
 * 拼一句带原始错误的 reason 字符串。用于 LLM 失败 / 渲染失败这类需要透出底层信息的场景。
 */
export function fallbackReasonWithError(
  prefix: string,
  err: unknown,
  maxLen = 200,
): string {
  const msg = (err as Error)?.message ?? String(err);
  const trimmed = msg.length > maxLen ? `${msg.slice(0, maxLen)}…` : msg;
  return `${prefix}：${trimmed}`;
}
