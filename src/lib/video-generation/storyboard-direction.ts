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
 * **缺省关（2026-11-10）。** 上线后第一次真实执行（压测冒烟 A 组）的线上日志：
 *   `[storyboard-direction] partial result … { cards: true, english: false, reference: false }`
 * ——只用上了镜头卡，英译与盘点两样没通过校验，随后补跑了一次英译；建故事板整体约 59 秒，比合并前慢。
 * 同一个用例在本机重跑三样都能出，说明是不稳定而不是必然失败。一次样本既证明不了它更好，也已经证明它更慢，
 * 所以先默认关掉，等用评测集量过「三样齐全率」和耗时再决定：STORYBOARD_DIRECTION=on 打开。
 * 这次同时把返回格式改成 reference → english → shots 的顺序并写明三样必填（原先示例里 english 与 reference
 * 是空值，模型可能照抄），并在日志里记下耗时与每一样没用上的原因，下次能直接从日志判断。
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

/** 合并调用是否生效：缺省关；STORYBOARD_DIRECTION=on 打开。镜头卡或英译任一开关关着也不走合并。 */
export function storyboardDirectionEnabled(env: EnvLike = process.env): boolean {
  if (env.STORYBOARD_DIRECTION?.trim().toLowerCase() !== "on") return false;
  return storyboardShotCardsEnabled(env) && storyEnglishEnabled(env);
}

const RETURN_MARKER = "Return JSON only:";
const SHOT_CARD_RULES = SHOT_CARD_SYSTEM_PROMPT.includes(RETURN_MARKER)
  ? SHOT_CARD_SYSTEM_PROMPT.slice(0, SHOT_CARD_SYSTEM_PROMPT.lastIndexOf(RETURN_MARKER)).trimEnd()
  : SHOT_CARD_SYSTEM_PROMPT;

export const STORYBOARD_DIRECTION_SYSTEM_PROMPT = `${SHOT_CARD_RULES}

This time you can SEE the merchant's real photos. Use them: in every card the product's shape, scale, colors, materials and printed marks, and the place if the photos show one, must agree with what the photos actually show. Never describe a product detail the photos do not show.

Your JSON has THREE required keys. Write them in this order and fill every one of them — never leave "english" empty and never leave "reference" empty:

1. "reference": a precise visual inventory of the photos so a video generator can faithfully reproduce what is in them. It is an object with exactly these fields:
${VISUAL_REFERENCE_JSON_SPEC}
Describe only what is actually visible. Ignore social-media watermarks or usernames overlaid on the photos. signageText must be verbatim. viewsCovered has exactly one entry per photo, in photo order.

2. "english": the merchant's description translated into English for a video-generation prompt. Keep every fact exactly as given: the product and its details, who appears, where it happens, every action and its order, the mood and the payoff. Do not add, drop, explain or embellish anything. Keep brand names and any text printed on the product exactly as written. Plain present-tense English sentences, no markdown, no lists. If the description is already in English, return it unchanged.

3. "shots": the shot cards described above, one per beat.

Return JSON only, shaped like: {"reference":{"isRealLocation":false,"locationDescription":null,"signageText":null,"signageKind":null,"keyFeatures":["..."],"productDescription":"...","viewsCovered":["..."]},"english":"...","shots":[{"startState":"...","action":"...","endState":"...","location":"...","voice":"...","lens":"...","camera":"...","composition":"...","light":"...","sound":"..."}]}`;

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

/** 没用上的那几样各是什么情况（只描述形状，不带内容）：缺键 / 空值 / 类型不对 / 有内容但没过校验。 */
export function describeDirectionGaps(data: unknown, direction: StoryboardDirection): Record<string, string> {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!record) return { response: "not a JSON object" };
  const shape = (value: unknown, key: string): string => {
    if (!(key in record)) return "key missing";
    if (value === null) return "null";
    if (typeof value === "string") return value.trim() ? `string(${value.length}) rejected by validation` : "empty string";
    if (Array.isArray(value)) return `array(${value.length}) rejected by validation`;
    if (typeof value === "object") {
      const keys = Object.keys(value as object);
      return keys.length === 0 ? "empty object" : `object(${keys.length} keys) rejected by validation`;
    }
    return typeof value;
  };
  const gaps: Record<string, string> = {};
  if (!direction.cards) gaps.shots = shape(record.shots, "shots");
  if (!direction.storyEnglish) gaps.english = shape(record.english, "english");
  if (!direction.visualReference) gaps.reference = shape(record.reference, "reference");
  return gaps;
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
  const startedAt = Date.now();
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
      console.warn(`[storyboard-direction] timed out after ${timeoutMs}ms; falling back to the separate shot-card and translation calls`);
      return null;
    }
    const direction = parseStoryboardDirection(result.data, {
      story: input.story,
      beatCount: input.beats.length,
      photoCount: images.length,
    });
    const elapsedMs = Date.now() - startedAt;
    if (!direction.cards || !direction.storyEnglish || !direction.visualReference) {
      /// 每一样没用上的原因写进日志（只写形状，不写内容）：下次从日志就能判断是模型没写、写了空的还是没译
      console.warn("[storyboard-direction] partial result; missing parts fall back individually", {
        elapsedMs,
        cards: Boolean(direction.cards),
        english: Boolean(direction.storyEnglish),
        reference: Boolean(direction.visualReference),
        why: describeDirectionGaps(result.data, direction),
      });
    } else {
      console.log(`[storyboard-direction] ok in ${elapsedMs}ms (cards, english, reference)`);
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
