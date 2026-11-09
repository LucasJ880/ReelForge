/**
 * 建故事板时的「一次看图导演调用」（2026-11-09，出方案并成一次的第二步）。
 *
 * 此前建故事板调两次模型、派发视频时再调一次，三次各管一段，互相看不到：
 *   - 镜头卡（shot-cards）：只读文字，**没看商品图**——它被要求「商品必须和照片一致」，却不知道照片里是什么；
 *   - 原话英译（story-english）：单独一次；
 *   - 看商品图（visual-reference-analysis）：要等到出方案 / 派发视频时才跑，而且 /plan 与 /dispatch 各跑一遍。
 *
 * 这里并成一次看图调用，同一个模型看着商家的实拍同时写出三样东西，彼此自洽：
 *   shots（镜头卡）+ english（原话英译）+ reference（商品 / 场所的视觉盘点）。
 * 盘点存在 StoryboardRun.visualReference，派发视频时直接读回，不再重新看图。
 *
 * 兜底——任何情况下都不比合并前差：
 *   - 三样各自校验、各自取用：哪一样不合格，就只对那一样补跑它原来的单独调用（镜头卡 / 英译），
 *     或留空（盘点留空 = 派发时照旧现看一遍图）；
 *   - 整次调用失败 / 超时：三样全部走原来的路径；
 *   - 没有商品图、批量故事板、镜头卡或英译的开关关着：不走这里，原路径原样。
 *   补跑的调用自己会记降级（shot_cards / story_english），所以这里不另记。
 *
 * 退路：STORYBOARD_DIRECTION=off 一键退回合并前的两次调用（没有经过真机出片对照，留个不用回滚代码的开关）。
 */
import { analyzeImages, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import {
  SHOT_CARD_SYSTEM_PROMPT,
  buildShotCardUserPrompt,
  normalizeShotCards,
  storyboardShotCardsEnabled,
  type DesignShotCardsInput,
  type StoryboardShotCard,
} from "@/lib/video-generation/shot-cards";
import { normalizeStoryEnglish, storyEnglishEnabled, storyNeedsEnglish } from "@/lib/video-generation/story-english";
import {
  VISUAL_REFERENCE_JSON_SPEC,
  normalizeVisualReference,
  type VisualReferenceAnalysis,
} from "@/lib/video-generation/visual-reference-analysis";

/// 看图 + 写四张卡 + 英译 + 盘点：比单独的镜头卡（40 秒）多留一些；故事板路由 maxDuration 120，
/// 超时后补跑的两次调用是并行的（各自 30–40 秒），加起来仍在路由时限内
const DIRECTION_TIMEOUT_MS = 55_000;
/// 推理模型的输出上限含思考 token：四张卡 + 英译 + 盘点，给足余量免得回空响应
const DIRECTION_MAX_TOKENS = 6000;
/// 与 visual-reference-analysis 同一个上限
const DIRECTION_MAX_IMAGES = 8;

type EnvLike = Record<string, string | undefined>;

/** 合并调用是否生效：缺省开；STORYBOARD_DIRECTION=off 退回两次调用。镜头卡或英译任一开关关着也不走合并。 */
export function storyboardDirectionEnabled(env: EnvLike = process.env): boolean {
  if (env.STORYBOARD_DIRECTION?.trim().toLowerCase() === "off") return false;
  return storyboardShotCardsEnabled(env) && storyEnglishEnabled(env);
}

const RETURN_MARKER = "Return JSON only:";
const SHOT_CARD_RULES = SHOT_CARD_SYSTEM_PROMPT.includes(RETURN_MARKER)
  ? SHOT_CARD_SYSTEM_PROMPT.slice(0, SHOT_CARD_SYSTEM_PROMPT.lastIndexOf(RETURN_MARKER)).trimEnd()
  : SHOT_CARD_SYSTEM_PROMPT;

export const STORYBOARD_DIRECTION_SYSTEM_PROMPT = `${SHOT_CARD_RULES}

This time you can SEE the merchant's real photos. Use them: in every card the product's shape, scale, colors, materials and printed marks, and the place if the photos show one, must agree with what the photos actually show. Never describe a product detail the photos do not show.

In the same JSON also return two more keys.

"english": the merchant's description translated into English for a video-generation prompt. Keep every fact exactly as given: the product and its details, who appears, where it happens, every action and its order, the mood and the payoff. Do not add, drop, explain or embellish anything. Keep brand names and any text printed on the product exactly as written. Plain present-tense English sentences, no markdown, no lists. If the description is already in English, return it unchanged.

"reference": a precise visual inventory of the photos so a video generator can faithfully reproduce what is in them:
${VISUAL_REFERENCE_JSON_SPEC}
Describe only what is actually visible. Ignore social-media watermarks or usernames overlaid on the photos. signageText must be verbatim. viewsCovered has exactly one entry per photo, in photo order.

Return JSON only: {"shots":[{"startState":"","action":"","endState":"","location":"","voice":"","lens":"","camera":"","composition":"","light":"","sound":""}],"english":"","reference":{}}`;

export interface StoryboardDirectionInput extends DesignShotCardsInput {
  /// 商家实拍（不含主播照）；按上传顺序，最多看前 8 张
  productImageUrls: readonly string[];
}

export interface StoryboardDirection {
  /// 镜头卡；null = 这一样没用上，调用方补跑单独的镜头卡调用
  cards: StoryboardShotCard[] | null;
  /// 原话英译；null = 没用上，调用方补跑单独的英译（原话本来就是英文时这里是原话）
  storyEnglish: string | null;
  /// 视觉盘点；null = 没用上，派发视频时照旧现看一遍图
  visualReference: VisualReferenceAnalysis | null;
}

export interface StoryboardDirectionDeps {
  enabled?: boolean;
  llmAvailable?: () => boolean;
  analyze?: typeof analyzeImages;
  timeoutMs?: number;
}

/** 纯函数：模型返回的 JSON → 三样各自校验后的结果（不合格的那一样为 null）。 */
export function parseStoryboardDirection(
  data: unknown,
  input: { story: string; beatCount: number; photoCount: number },
): StoryboardDirection {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const cards = normalizeShotCards(record, input.beatCount);
  /// 原话已经是英文：不用模型的版本，原样用（与 renderStoryInEnglish 同一口径）
  const storyEnglish = storyNeedsEnglish(input.story) ? normalizeStoryEnglish(record) : input.story.trim();
  const reference =
    record.reference && typeof record.reference === "object" && !Array.isArray(record.reference)
      ? normalizeVisualReference(record.reference as Record<string, unknown>, input.photoCount)
      : null;
  return {
    cards,
    storyEnglish,
    /// 既没商品描述也没场所描述 = 没看出东西，当作没有盘点（派发时现看）
    visualReference: reference && (reference.productDescription || reference.locationDescription) ? reference : null,
  };
}

/**
 * 一次看图调用同时出镜头卡、原话英译与视觉盘点。
 * 返回 null = 根本没走合并（开关关着 / 没有商品图 / 没有节拍或描述 / LLM 不可用）或整次调用失败——调用方三样全走原路径。
 * 永不抛出。
 */
export async function designStoryboardDirection(
  input: StoryboardDirectionInput,
  deps: StoryboardDirectionDeps = {},
): Promise<StoryboardDirection | null> {
  const enabled = deps.enabled ?? storyboardDirectionEnabled();
  const images = input.productImageUrls.slice(0, DIRECTION_MAX_IMAGES);
  if (!enabled || images.length === 0 || input.beats.length === 0 || !input.story.trim()) return null;
  const available = deps.llmAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) return null;
  const analyze = deps.analyze ?? analyzeImages;
  const timeoutMs = deps.timeoutMs ?? DIRECTION_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const user = [
      buildShotCardUserPrompt({ ...input, productImageCount: images.length }),
      `You are shown the ${images.length} product photo(s) below, in upload order. Return the JSON now.`,
    ].join("\n");
    const result = await Promise.race([
      analyze([...images], STORYBOARD_DIRECTION_SYSTEM_PROMPT, user, { maxTokens: DIRECTION_MAX_TOKENS }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!result) {
      console.warn("[storyboard-direction] timed out; falling back to the separate shot-card and translation calls");
      return null;
    }
    const direction = parseStoryboardDirection(result.data, {
      story: input.story,
      beatCount: input.beats.length,
      photoCount: images.length,
    });
    if (!direction.cards || !direction.storyEnglish || !direction.visualReference) {
      console.warn("[storyboard-direction] partial result; missing parts fall back individually", {
        cards: Boolean(direction.cards),
        english: Boolean(direction.storyEnglish),
        reference: Boolean(direction.visualReference),
      });
    }
    return direction;
  } catch (error) {
    console.warn(
      "[storyboard-direction] failed; falling back to the separate shot-card and translation calls:",
      (error as Error).message,
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
