/**
 * 「帮我写 / 帮我润色」：看商品图写一段视频描述（2026-10-28 晚，上线审核 §3，回应 CEO「没有自动生成提示词，商家嫌麻烦」）。
 *
 * 学 Runway Product Shot Video Builder 的「上传商品图，自动提炼一份简报」：商家不用写提示词，只要点一下，
 * AI 用商家的语言写两三句「拍什么」，商家可以直接改。写的是给人看的描述，不是给模型的英文提示词——
 * 后者仍由出方案那一步在后台生成，可在故事板「查看提示词」里看到。
 * 任何失败都返回 null，界面保留商家原来的字，不卡住。
 */
import { analyzeImages, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

export interface PromptDraftInput {
  imageUrls: readonly string[];
  /// 商家已经写的字：有就在它的基础上润色，不推翻商家的意思
  hint?: string | null;
  language: string;
  durationSec: number;
}

export interface PromptDraftDeps {
  llmAvailable?: () => boolean;
  vision?: typeof analyzeImages;
  timeoutMs?: number;
}

const DRAFT_TIMEOUT_MS = 30_000;
/// 中文按字、英文按词的上限：够写清「什么商品、在哪、谁、做什么、记住哪一点」，又不至于变成一篇作文
const MAX_ZH_CHARS = 220;
const MAX_EN_WORDS = 90;

export const PROMPT_DRAFT_SYSTEM_PROMPT = `You help a small business owner describe a short vertical ad video for their product.
Look at the product photos and write the video idea the owner would tell a camera operator, in the requested language.
Rules:
- 2-3 plain sentences: what the product is, one concrete scene and moment where it shows its main benefit, who uses it, and how the video ends.
- Use only what the photos show or the owner already wrote. Never invent prices, discounts, awards, guarantees, statistics or features you cannot see.
- If a brand name or logo is printed on the product, mention it exactly as printed.
- If the owner already wrote something, keep their intent, facts and wording style; only make it concrete and complete.
- No camera jargon, no hashtags, no emoji, no bullet points.
Return JSON only: {"description":"..."}`;

function measure(text: string, english: boolean): number {
  return english ? text.split(/\s+/u).filter(Boolean).length : Array.from(text.replace(/\s+/gu, "")).length;
}

export async function writePromptDraft(
  input: PromptDraftInput,
  deps: PromptDraftDeps = {},
): Promise<string | null> {
  const imageUrls = [...new Set(input.imageUrls.filter((url) => url.startsWith("https://")))].slice(0, 4);
  const hint = input.hint?.replace(/\s+/gu, " ").trim().slice(0, 1200) ?? "";
  if (imageUrls.length === 0 && !hint) return null;
  const available = deps.llmAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) return null;
  const english = input.language.toLowerCase().startsWith("en");
  const vision = deps.vision ?? analyzeImages;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      vision(
        imageUrls,
        PROMPT_DRAFT_SYSTEM_PROMPT,
        [
          `Language: ${english ? "English" : "Simplified Chinese"}`,
          `Video length: ${input.durationSec} seconds, vertical.`,
          hint ? `What the owner already wrote: ${hint}` : "The owner has not written anything yet.",
          `Keep it under ${english ? `${MAX_EN_WORDS} words` : `${MAX_ZH_CHARS} Chinese characters`}.`,
        ].join("\n"),
        { detail: "low", maxTokens: 600 },
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.timeoutMs ?? DRAFT_TIMEOUT_MS);
      }),
    ]);
    if (!result) return null;
    const raw = result.data && typeof result.data === "object" ? (result.data as { description?: unknown }).description : null;
    const description = typeof raw === "string" ? raw.replace(/\s+/gu, " ").trim() : "";
    if (!description) return null;
    if (measure(description, english) > (english ? MAX_EN_WORDS : MAX_ZH_CHARS) * 1.2) return null;
    return description;
  } catch (error) {
    console.warn("[prompt-draft] draft failed; keeping the owner's text:", (error as Error).message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
