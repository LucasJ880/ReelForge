/**
 * 抖音发布文案：中文标题 + 正文 + 3–5 个话题（2026-11-09 · 抖音发布包）。
 *
 * 用 fast 档起稿（经 AI provider 抽象 @/lib/ai，当前即 providers/openai 的 fast 档）。**失败就明确失败**：LLM 不可用、输出不成形，都抛 DouyinCopyError 给界面，
 * 绝不静默回退到模板文案——模板文案发出去就是矩阵号之间的同质化内容，比没有文案更糟。
 *
 * 生成结果不在这里做极限词拦截（那是 ad-law-terms 的事，调用方统一检查并把命中词指给运营看）；
 * 提示词里会要求模型避开，但不信它。
 */

import { chatJsonByTier, type AiChatJsonByTierOptions } from "@/lib/ai";
import { AD_LAW_TERMS } from "@/lib/compliance/ad-law-terms";
import {
  DOUYIN_BODY_MAX,
  DOUYIN_HASHTAG_MAX,
  DOUYIN_HASHTAG_MIN,
  DOUYIN_TITLE_MAX,
  douyinCopySchema,
  type DouyinCopy,
} from "@/lib/contracts/douyin-publish-kit";

export type DouyinCopyErrorCode = "LLM_UNAVAILABLE" | "LLM_INVALID_OUTPUT" | "INPUT_EMPTY";

export class DouyinCopyError extends Error {
  constructor(
    readonly code: DouyinCopyErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "DouyinCopyError";
  }
}

export interface DouyinCopyInput {
  /** 成片标题 / 商家对这条片的描述 */
  productBrief: string;
  /** 成片口播稿（有就给，文案与片子说的是同一件事） */
  voiceoverScript?: string | null;
}

type ChatFn = (options: AiChatJsonByTierOptions) => Promise<{ data: unknown; modelUsed: string }>;

const SYSTEM_PROMPT = `你是抖音电商短视频的文案编辑。根据一条商品短视频的信息，写发布用的标题、正文和话题。

要求：
- 全部用简体中文，口语化，像真人在分享，不要营销腔。
- title：${DOUYIN_TITLE_MAX} 个字以内，一句话说清这条视频的看点，会被印在封面上。
- body：${DOUYIN_BODY_MAX} 个字以内，2–4 句，讲清商品是什么、解决什么问题、适合谁；不编造参数、价格、销量、功效。
- hashtags：${DOUYIN_HASHTAG_MIN}–${DOUYIN_HASHTAG_MAX} 个话题，不带 # 号、不含空格，从品类词到场景词由大到小。
- 严禁广告法极限词与绝对化承诺，例如：${AD_LAW_TERMS.join("、")}。
- 严禁站外引流：不出现网址、二维码、微信号、手机号，不写「私信」「加我」。
- 不承诺疗效、收益，不贬低同行。

只输出 JSON：{"title": string, "body": string, "hashtags": string[]}`;

function userPrompt(input: DouyinCopyInput): string {
  const lines = [`【视频内容 / 商品描述】\n${input.productBrief.trim().slice(0, 1200)}`];
  const script = input.voiceoverScript?.trim();
  if (script) lines.push(`【视频口播稿】\n${script.slice(0, 1200)}`);
  return lines.join("\n\n");
}

/**
 * 起一版发布文案。
 * @throws DouyinCopyError 输入为空 / LLM 调用失败 / 输出不成形
 */
export async function generateDouyinCopy(
  input: DouyinCopyInput,
  deps: { chat?: ChatFn } = {},
): Promise<{ copy: DouyinCopy; modelUsed: string }> {
  if (!input.productBrief.trim()) {
    throw new DouyinCopyError("INPUT_EMPTY", "这条成片没有可用的描述，无法生成文案，请手动填写。");
  }
  const chat: ChatFn = deps.chat ?? ((options) => chatJsonByTier(options));
  let result: { data: unknown; modelUsed: string };
  try {
    result = await chat({
      tier: "fast",
      stage: "douyin_publish_copy",
      system: SYSTEM_PROMPT,
      user: userPrompt(input),
      temperature: 0.7,
      maxTokens: 700,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[douyin-copy] LLM call failed", detail);
    throw new DouyinCopyError(
      "LLM_UNAVAILABLE",
      "文案生成失败：AI 文案服务暂时不可用。可以稍后重试，或直接手动填写标题、正文和话题。",
      detail.slice(0, 300),
    );
  }
  const parsed = douyinCopySchema.safeParse(result.data);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    console.error("[douyin-copy] LLM output rejected", detail);
    throw new DouyinCopyError(
      "LLM_INVALID_OUTPUT",
      "文案生成失败：AI 返回的内容不符合格式要求。请重试，或直接手动填写。",
      detail.slice(0, 300),
    );
  }
  return { copy: parsed.data, modelUsed: result.modelUsed };
}
