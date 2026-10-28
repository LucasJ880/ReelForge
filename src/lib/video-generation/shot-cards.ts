/**
 * 故事板镜头卡（2026-10-28，借鉴 LibTV 公开画布的分镜写法）。
 *
 * 拆了 LibTV 一条高赞家电 TVC 的整张公开画布：它的每个视频提示词都是「参考使用说明 + 时间码镜头表」，
 * 每个镜头写死焦段景别、机位高度与一次有幅度的运镜、前中后景、一个有幅度的动作与镜头结束时的状态、同步声音。
 * 我们的故事板节奏是固定模板句（「3–7s · faithful product reveal」），派发视频时镜头表又被换成
 * 「recreate storyboard keyframe N — 模板句」，模型拿不到任何镜头级的拍法。
 *
 * 这里在建故事板时让 LLM 按商家原话给每一帧写一张镜头卡：出帧提示词里落一行 `SHOT CARD:`（持久化在帧提示词里，
 * 免迁移），派发视频时从帧提示词读回、接到对应镜头行上。LLM 不可用 / 超时 / 输出不合格 → 返回 null，
 * 出帧与派发与之前逐字节一致。`STORYBOARD_SHOT_CARDS=off` 整体关闭。
 */
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

export interface StoryboardShotCard {
  /** 焦段与景别，如 "35mm medium shot" */
  lens: string;
  /** 机位位置与高度 + 至多一次有幅度的运镜 */
  camera: string;
  /** 前景 / 中景 / 背景各是什么 */
  composition: string;
  /** 这一镜里发生的一个物理动作（带幅度） */
  action: string;
  /** 镜头结束时画面停在什么状态（下一镜从这里硬切） */
  endState: string;
  /** 同步声音（只要现场声，不要音乐与旁白） */
  sound: string;
}

export const SHOT_CARD_LINE_PREFIX = "SHOT CARD: ";
const SHOT_CARD_FIELDS = ["lens", "camera", "composition", "action", "endState", "sound"] as const;
const FIELD_MAX_CHARS = 160;
/// 一张卡格式化后的上限：出帧提示词 5000 字里要给故事与锁行留位，视频侧还会按段预算再压。
export const SHOT_CARD_MAX_CHARS = 640;
/// 建故事板是用户在等的请求：2026-10-28 同题实测 gpt-5.6-sol 15–31s（偶发超 25s），gpt-5.6-terra 约 14s、质量接近，
/// 所以走 fast 档（terra 首选）；超时即退回模板节奏，不拖住出帧。
const DESIGN_TIMEOUT_MS = 40_000;

export function storyboardShotCardsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORYBOARD_SHOT_CARDS?.trim().toLowerCase() !== "off";
}

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/gu, " ").trim().replace(/[.。;；]+$/u, "");
  return flat.length > FIELD_MAX_CHARS ? `${flat.slice(0, FIELD_MAX_CHARS - 1).trimEnd()}…` : flat;
}

/** LLM 原始输出 → 恰好 count 张卡；任何一张缺镜头 / 机位 / 动作就整体作废（半套卡比没有更容易误导）。 */
export function normalizeShotCards(raw: unknown, count: number): StoryboardShotCard[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { shots?: unknown }).shots)
      ? (raw as { shots: unknown[] }).shots
      : null;
  if (!list || list.length < count) return null;
  const cards = list.slice(0, count).map((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return Object.fromEntries(SHOT_CARD_FIELDS.map((field) => [field, clean(record[field])])) as unknown as StoryboardShotCard;
  });
  return cards.every((card) => card.lens && card.camera && card.action) ? cards : null;
}

/** 一张卡 → 一行英文（模型读）。空字段不写。 */
export function formatShotCard(card: StoryboardShotCard): string {
  const parts = [
    card.lens,
    card.camera && `Camera: ${card.camera}`,
    card.composition && `Composition: ${card.composition}`,
    card.action && `Action: ${card.action}`,
    card.endState && `Ends on: ${card.endState}`,
    card.sound && `Sound: ${card.sound}`,
  ].filter(Boolean);
  const text = `${parts.join(". ")}.`;
  return text.length > SHOT_CARD_MAX_CHARS ? `${text.slice(0, SHOT_CARD_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** 从帧提示词读回镜头卡正文（不含前缀）；没有 → null。 */
export function readShotCardFromFramePrompt(prompt: string | null | undefined): string | null {
  if (!prompt) return null;
  const line = prompt.split("\n").find((candidate) => candidate.startsWith(SHOT_CARD_LINE_PREFIX));
  const body = line?.slice(SHOT_CARD_LINE_PREFIX.length).trim();
  return body ? body : null;
}

export const SHOT_CARD_SYSTEM_PROMPT = `You are the director and director of photography of a live-action commercial for a small business.
You turn the merchant's own description into concrete storyboard shot cards that an image model and a video model can execute without guessing.

Write exactly one card per beat, in order. Every card describes ONE continuous camera shot:
- lens: focal length + shot size, e.g. "24mm wide establishing shot", "85mm close-up", "100mm macro".
- camera: where the camera is and how high (e.g. "12cm above the floor, slightly tilted up"), plus at most ONE slow move with a size ("20cm push-in", "slow 15° pan left", "locked off").
- composition: what sits in the foreground, midground and background, and where the product is in frame.
- action: one physical action with a magnitude (who/what moves, how far, how fast). The product only does what the merchant says it does.
- endState: what the frame shows when the shot ends; the next shot hard-cuts from here.
- sound: diegetic sync sound only (room tone, footsteps, the product's own sounds). Never music, never narration.

Rules:
- Stay faithful to the merchant's description: same place, same people, same product, same claims. Never add prices, offers, on-screen text, logos, UI or captions.
- Keep one coherent location, one light direction and one wardrobe across all cards unless the merchant clearly describes a change.
- The product must look exactly like the merchant's photos: never invent sides, buttons, labels or text that the photos do not show; keep its real scale next to hands and furniture.
- Use concrete physical words (materials, distances, light direction). No marketing adjectives such as "stunning", "amazing", "premium".
- Vary shot sizes across cards (wide → medium → close-up) so the cut reads like an edited commercial, and make the last card a clean, readable composition with empty space for an end card.
- English only. Each field at most 25 words.

Return JSON only: {"shots":[{"lens":"","camera":"","composition":"","action":"","endState":"","sound":""}]}`;

export interface DesignShotCardsInput {
  story: string;
  beats: readonly string[];
  durationSec: number;
  aspectRatio: string;
  productImageCount: number;
  personImageCount: number;
}

export interface DesignShotCardsDeps {
  enabled?: boolean;
  llmAvailable?: () => boolean;
  chat?: typeof chatJsonByTier;
  timeoutMs?: number;
}

export function buildShotCardUserPrompt(input: DesignShotCardsInput): string {
  const span = input.durationSec / Math.max(1, input.beats.length);
  const beats = input.beats
    .map((beat, index) => {
      const label = beat.replace(/^\s*\d+\s*[–-]\s*\d+\s*s\s*·\s*/u, "").trim();
      return `${index + 1}. ${Math.round(index * span)}-${Math.round((index + 1) * span)}s · ${label}`;
    })
    .join("\n");
  return [
    `Video: ${input.durationSec}s, aspect ratio ${input.aspectRatio}, ${input.beats.length} shots.`,
    `Merchant's description (may be in any language; keep its facts): ${input.story.replace(/\s+/gu, " ").trim().slice(0, 1800)}`,
    input.productImageCount > 0
      ? `The merchant uploaded ${input.productImageCount} real photo(s) of the product; the product must match them.`
      : "No product photos were uploaded; describe the product only as the merchant does.",
    input.personImageCount > 0
      ? "A presenter photo was uploaded: the on-camera person is that presenter in every shot that shows a person."
      : "No presenter photo: only show people if the description implies them; hands are fine.",
    "Beats:",
    beats,
  ].join("\n");
}

/**
 * 建故事板时设计镜头卡。任何失败都返回 null（调用方退回旧的模板节奏，不影响出帧）。
 */
export async function designStoryboardShotCards(
  input: DesignShotCardsInput,
  deps: DesignShotCardsDeps = {},
): Promise<StoryboardShotCard[] | null> {
  const enabled = deps.enabled ?? storyboardShotCardsEnabled();
  if (!enabled || input.beats.length === 0 || !input.story.trim()) return null;
  const available = deps.llmAvailable ?? (() => isLLMAvailable() && !isLLMForcedMock());
  if (!available()) return null;
  const chat = deps.chat ?? chatJsonByTier;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chat<unknown>({
        tier: "fast",
        stage: "storyboard_shot_cards",
        system: SHOT_CARD_SYSTEM_PROMPT,
        user: buildShotCardUserPrompt(input),
        temperature: 0.4,
        maxTokens: 2500,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.timeoutMs ?? DESIGN_TIMEOUT_MS);
      }),
    ]);
    if (!result) {
      console.warn("[shot-cards] design timed out; falling back to template beats");
      return null;
    }
    const cards = normalizeShotCards(result.data, input.beats.length);
    if (!cards) console.warn("[shot-cards] LLM output rejected; falling back to template beats");
    return cards;
  } catch (error) {
    console.warn("[shot-cards] design failed; falling back to template beats:", (error as Error).message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
