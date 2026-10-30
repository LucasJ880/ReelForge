/**
 * 商家原话 → 英文（2026-10-29，按 Kelin 团队实测：提示词全程一种语言，全英文最准）。
 *
 * 出帧与出视频的提示词都是英文模板，此前商家的中文原话原样夹在中间（帧的 STORY CONTEXT、视频的 STORY 两行），
 * 同一件事中英各说一遍，模型两头听。这里在建故事板时把原话忠实译成英文一次：出帧用它，
 * 它随帧提示词的 STORY CONTEXT 行落库（免迁移），派发视频时从那里读回。
 * 镜头卡仍读原话（信息不丢）；口播台词不翻（模型要逐字念出来）。
 * 任何失败都返回 null，调用方退回原话，不阻塞出帧。
 */
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/gu;
/// 英文版上限：装得下一段需求的全部事实；更长的由出帧 / 出视频各自的预算再截
const STORY_ENGLISH_MAX_CHARS = 1200;
/// 译文里还能留的中日韩字符比例：商品上印的中文品牌名要逐字保留，整段没译的拒收
const STORY_ENGLISH_MAX_CJK_SHARE = 0.2;
const TRANSLATE_TIMEOUT_MS = 30_000;

const STORY_ENGLISH_SYSTEM_PROMPT = `You translate a small business owner's request for a short product video into English for a video-generation prompt.
Keep every fact exactly as given: the product and its details, who appears, where it happens, every action and its order, the mood and the payoff.
Do not add, drop, explain or embellish anything. Keep brand names and any text printed on the product exactly as written.
Write plain present-tense English sentences: no markdown, no lists, no quotation marks around the whole text.
Return JSON only: {"english": "..."}`;

function cjkShare(text: string): number {
  const visible = text.replace(/\s+/gu, "");
  if (!visible) return 0;
  return (visible.match(CJK)?.length ?? 0) / visible.length;
}

/** `STORYBOARD_STORY_ENGLISH=off` 一键退回：原话直接进提示词（10-29 前的行为）；缺省开。 */
export function storyEnglishEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORYBOARD_STORY_ENGLISH?.trim().toLowerCase() !== "off";
}

/** 原话里有中日韩文字才需要翻；纯英文原样用。 */
export function storyNeedsEnglish(story: string): boolean {
  return cjkShare(story) > 0;
}

function normalizeStoryEnglish(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as { english?: unknown }).english;
  if (typeof raw !== "string") return null;
  const english = raw.replace(/\s+/gu, " ").trim();
  if (!english || cjkShare(english) > STORY_ENGLISH_MAX_CJK_SHARE) return null;
  return english.length > STORY_ENGLISH_MAX_CHARS ? `${english.slice(0, STORY_ENGLISH_MAX_CHARS - 1).trimEnd()}…` : english;
}

export interface StoryEnglishDeps {
  enabled?: boolean;
  chat?: typeof chatJsonByTier;
  llmAvailable?: () => boolean;
  timeoutMs?: number;
}

/** 把商家原话译成提示词用的英文。已是英文 → 原样（去首尾空白）；译不了或开关关着 → null（调用方用原话）。 */
export async function renderStoryInEnglish(story: string, deps: StoryEnglishDeps = {}): Promise<string | null> {
  const text = story.trim();
  if (!text || !(deps.enabled ?? storyEnglishEnabled())) return null;
  if (!storyNeedsEnglish(text)) return text;
  const available = deps.llmAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) return null;
  const chat = deps.chat ?? chatJsonByTier;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chat<unknown>({
        tier: "fast",
        stage: "story_english",
        system: STORY_ENGLISH_SYSTEM_PROMPT,
        user: text,
        temperature: 0.2,
        /// 推理模型的上限含思考 token：给足余量，免得思考吃光额度回空响应（10-29 一致性设定踩过）
        maxTokens: 4000,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.timeoutMs ?? TRANSLATE_TIMEOUT_MS);
      }),
    ]);
    if (!result) {
      console.warn("[story-english] timed out; keeping the merchant's original wording");
      return null;
    }
    const english = normalizeStoryEnglish(result.data);
    if (!english) console.warn("[story-english] output rejected; keeping the merchant's original wording");
    return english;
  } catch (error) {
    console.warn("[story-english] translation failed; keeping the merchant's original wording:", (error as Error).message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
