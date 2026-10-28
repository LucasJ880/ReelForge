/**
 * 故事板「查看提示词」给商家看的分镜原文（2026-10-28 晚，上线审核 §3：同行直接把提示词给用户看）。
 *
 * 照原样给，只去掉供应商模型名——客户面禁词表不许出现模型名，去掉也不改变这一帧画什么。
 * 纯函数、不碰服务端模块，客户端组件可以直接用。
 */
const MODEL_NAME_CLAUSE = /\s+with\s+GPT[\s-]*Image[\s-]*\d+(?:\.\d+)?/giu;
const MODEL_NAME = /\bGPT[\s-]*Image[\s-]*\d+(?:\.\d+)?/giu;

export function customerVisibleFramePrompt(prompt: string): string {
  return prompt
    .replace(MODEL_NAME_CLAUSE, "")
    .replace(MODEL_NAME, "the image model")
    .trim();
}
