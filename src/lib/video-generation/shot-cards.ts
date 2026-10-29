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
 * 调了 LLM 却没用上（失败 / 超时 / 输出不合格）时交给 onDegraded，故事板 run 上记一条（2026-10-29）。
 *
 * 2026-10-29（借鉴朋友的 ai-video-workflow 方法包，计划 docs/superpowers/plans/2026-10-29-shot-direction-p0.md）：
 * 每张卡加「首态 / 地点 / 谁说话」，字段按重要性排——出帧画的是首态那一刻，视频从这一帧开始演；
 * Kling 2500 字截断时先丢声音与构图，动作和尾态最后才丢。建故事板时把口播稿一起给 LLM，按台词顺序排镜头（台词原文不进卡）。
 */
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import {
  planningDegradation,
  type RecordPlanningDegradation,
} from "@/lib/video-generation/planning-degradation";
import {
  SHOT_CARD_NEW_LOCATION_PREFIX,
  SHOT_CARD_VOICE_PHRASES,
  type ShotCardVoice,
} from "@/lib/video-generation/storyboard-beats";

export type { ShotCardVoice };

export interface StoryboardShotCard {
  /** 开拍那一刻的画面状态（人在哪、朝向、哪只手拿什么、商品在哪）；出帧画的就是这一刻。旧卡没有 */
  startState?: string;
  /** 焦段与景别，如 "35mm medium shot" */
  lens: string;
  /** 机位位置与高度 + 至多一次有幅度的运镜 */
  camera: string;
  /** 前景 / 中景 / 背景各是什么 */
  composition: string;
  /** 这一镜里发生的一个物理动作（带方向与幅度） */
  action: string;
  /** 镜头结束时画面停在什么状态（下一镜从这里接） */
  endState: string;
  /** 同步声音（只要现场声，不要音乐与旁白） */
  sound: string;
  /** 这一镜在哪：同一地点用同一个短名，换名 = 硬切到新地点。旧卡没有 */
  location?: string;
  /** 口播怎么出：主播出镜说 / 画外音 / 这一镜没人说。旧卡没有 */
  voice?: ShotCardVoice | null;
}

export const SHOT_CARD_LINE_PREFIX = "SHOT CARD: ";
const SHOT_CARD_TEXT_FIELDS = ["startState", "lens", "camera", "composition", "action", "endState", "sound"] as const;
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

/// 地点名写进卡时是 `New location: X.`：句点会搅乱按句读卡，一律去掉。
function cleanLocation(value: unknown): string {
  return clean(value).replace(/[.。]/gu, "").trim();
}

function normalizeVoice(value: unknown): ShotCardVoice | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (key === "on_camera") return "on_camera";
  if (key === "voice_over" || key === "voiceover" || key === "off_screen") return "voice_over";
  if (key === "none" || key === "no_speech") return "none";
  return null;
}

/** 两张卡是不是同一个地点：任一方没写地点就当同一个（不凭空判换地点）。 */
export function sameShotLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (value: string | null | undefined) =>
    (value ?? "").toLowerCase().replace(/^the\s+/u, "").replace(/\s+/gu, " ").trim();
  const left = key(a);
  const right = key(b);
  return !left || !right || left === right;
}

/** LLM 原始输出里的卡数组：直接是数组，或包在 `{ shots: [...] }` 里。 */
function shotCardList(raw: unknown): unknown[] | null {
  return Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { shots?: unknown }).shots)
      ? (raw as { shots: unknown[] }).shots
      : null;
}

/** LLM 原始输出 → 恰好 count 张卡；任何一张缺镜头 / 机位 / 动作就整体作废（半套卡比没有更容易误导）。 */
export function normalizeShotCards(raw: unknown, count: number): StoryboardShotCard[] | null {
  const list = shotCardList(raw);
  if (!list || list.length < count) return null;
  const cards = list.slice(0, count).map((item): StoryboardShotCard => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = Object.fromEntries(SHOT_CARD_TEXT_FIELDS.map((field) => [field, clean(record[field])])) as Record<
      (typeof SHOT_CARD_TEXT_FIELDS)[number],
      string
    >;
    return { ...text, location: cleanLocation(record.location), voice: normalizeVoice(record.voice) };
  });
  if (!cards.every((card) => card.lens && card.camera && card.action)) return null;
  /// 连续性约定：没写首态、又没换地点的卡，从上一张的尾态接上；换地点不补（新地点的开场由那一张自己写）。
  for (let index = 1; index < cards.length; index++) {
    const card = cards[index];
    const previous = cards[index - 1];
    if (!card.startState && previous.endState && sameShotLocation(card.location, previous.location)) {
      card.startState = previous.endState;
    }
  }
  return cards;
}

/** normalizeShotCards 整体作废时的原因（记进降级记录）。 */
function rejectedShotCardsReason(raw: unknown, count: number): string {
  const list = shotCardList(raw);
  if (!list) return `LLM 输出里没有镜头卡数组（要 ${count} 张）`;
  if (list.length < count) return `LLM 只给了 ${list.length} 张镜头卡（要 ${count} 张）`;
  return `LLM 给的镜头卡有缺镜头 / 机位 / 动作的（要 ${count} 张都齐），整套作废`;
}

/**
 * 一张卡 → 一行英文（模型读）。按重要性排：首态 → 动作 → 尾态 → 谁说话 → 景别 / 机位 / 构图 / 声音，
 * 预算不够时从尾巴截，动作和尾态最后才丢。空字段不写；`newLocation` 时以 `New location:` 开头。
 */
export function formatShotCard(card: StoryboardShotCard, options: { newLocation?: boolean } = {}): string {
  const parts = [
    options.newLocation && card.location && `${SHOT_CARD_NEW_LOCATION_PREFIX}${card.location}`,
    card.startState && `Starts on: ${card.startState}`,
    card.action && `Action: ${card.action}`,
    card.endState && `Ends on: ${card.endState}`,
    card.voice && `Voice: ${SHOT_CARD_VOICE_PHRASES[card.voice]}`,
    card.lens && `Shot: ${card.lens}`,
    card.camera && `Camera: ${card.camera}`,
    card.composition && `Composition: ${card.composition}`,
    card.sound && `Sound: ${card.sound}`,
  ].filter(Boolean);
  const text = `${parts.join(". ")}.`;
  return text.length > SHOT_CARD_MAX_CHARS ? `${text.slice(0, SHOT_CARD_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** 一组卡按故事顺序格式化：地点和上一张不同的卡（第一张除外）标 `New location`。 */
export function formatShotCardSequence(
  cards: ReadonlyArray<StoryboardShotCard | null | undefined>,
): Array<string | null> {
  return cards.map((card, index) => {
    if (!card) return null;
    const previous = index > 0 ? cards[index - 1] : null;
    return formatShotCard(card, { newLocation: Boolean(previous) && !sameShotLocation(card.location, previous?.location) });
  });
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
The image model draws each card's startState as that shot's keyframe; the video model starts from the keyframe and plays the action.

Write exactly one card per beat, in order. Every card describes ONE continuous camera shot with ONE main change:
- startState: the instant the shot begins — where each person stands and faces, which hand holds what, where the product sits. The moment before the action, never its result.
- action: one physical action with a direction and a magnitude (who moves what, with which hand, how far, how fast).
- endState: what the frame shows when the shot ends.
- location: a short name for the place (2-4 words). Reuse the identical name for every shot in the same place; a new name means a hard cut to a new place.
- voice: "on_camera" when the presenter's face is visible and they say the voice-over to camera, "voice_over" when the narration plays from off screen, "none" when nobody speaks.
- lens: focal length + shot size, e.g. "24mm wide establishing shot", "85mm close-up", "100mm macro".
- camera: where the camera is and how high (e.g. "12cm above the floor, slightly tilted up"), plus at most ONE slow move with a size ("20cm push-in", "slow 15° pan left", "locked off").
- composition: what sits in the foreground, midground and background, and where the product is in frame.
- sound: diegetic sync sound only (room tone, footsteps, the product's own sounds). Never music, never narration.

Rules:
- Stay faithful to the merchant's description: same place, same people, same product, same claims. Never add prices, offers, on-screen text, logos, UI or captions.
- Continuity: each startState agrees with the previous shot's endState (same people, same props in the same hands and places) unless the cut moves to a new location or a later moment; then startState says what changed.
- Change location only when the merchant's description does. Keep one light direction and one wardrobe across all cards unless the merchant clearly describes a change.
- The product must look exactly like the merchant's photos: never invent sides, buttons, labels or text that the photos do not show; keep its real scale next to hands and furniture. It can be picked up, turned, worn or used, but it only does what the merchant says it does: no opening, folding, lighting up or transforming that the merchant does not describe.
- Choose the shot size that keeps the evidence of the action in frame (both hands and the product for a handover, the opening of the product when something comes out of it); never push in so far that the action leaves the frame.
- Write what the camera can see: gaze, pauses, hand positions, reactions. Never name feelings, and no marketing adjectives such as "stunning", "amazing", "premium".
- Vary shot sizes across cards (wide → medium → close-up) so the cut reads like an edited commercial, and make the last card a clean closing hero shot: the whole product clearly visible, its own printed logo or label facing the camera if it has one.
- When a voice-over script is given, order the shots so each one shows what the narration says while it plays. Never put its words on screen or into the cards.
- English only. startState, action and endState at most 15 words each; every other field at most 20 words.

Return JSON only: {"shots":[{"startState":"","action":"","endState":"","location":"","voice":"","lens":"","camera":"","composition":"","sound":""}]}`;

export interface DesignShotCardsInput {
  story: string;
  beats: readonly string[];
  durationSec: number;
  aspectRatio: string;
  productImageCount: number;
  personImageCount: number;
  /// 已定的口播稿（创作台出故事板时带上）：只用来按台词顺序排镜头、标谁说话，原文不进卡。
  voiceoverScript?: string | null;
}

export interface DesignShotCardsDeps {
  enabled?: boolean;
  llmAvailable?: () => boolean;
  chat?: typeof chatJsonByTier;
  timeoutMs?: number;
  /// 调了 LLM 却没用上（失败 / 超时 / 输出不合格）时记一条；不传 = 只打日志
  onDegraded?: RecordPlanningDegradation;
}

export function buildShotCardUserPrompt(input: DesignShotCardsInput): string {
  const span = input.durationSec / Math.max(1, input.beats.length);
  const beats = input.beats
    .map((beat, index) => {
      const label = beat.replace(/^\s*\d+\s*[–-]\s*\d+\s*s\s*·\s*/u, "").trim();
      return `${index + 1}. ${Math.round(index * span)}-${Math.round((index + 1) * span)}s · ${label}`;
    })
    .join("\n");
  const script = input.voiceoverScript?.replace(/\s+/gu, " ").trim() ?? "";
  return [
    `Video: ${input.durationSec}s, aspect ratio ${input.aspectRatio}, ${input.beats.length} shots.`,
    `Merchant's description (may be in any language; keep its facts): ${input.story.replace(/\s+/gu, " ").trim().slice(0, 1800)}`,
    input.productImageCount > 0
      ? `The merchant uploaded ${input.productImageCount} real photo(s) of the product; the product must match them.`
      : "No product photos were uploaded; describe the product only as the merchant does.",
    input.personImageCount > 0
      ? "A presenter photo was uploaded: the on-camera person is that presenter in every shot that shows a person."
      : "No presenter photo: only show people if the description implies them; hands are fine.",
    script
      ? `Voice-over script (one voice, spoken across the whole video in this order; never rewrite it): ${script.slice(0, 2000)}`
      : 'No voice-over script: set every "voice" to "none".',
    "Beats:",
    beats,
  ].join("\n");
}

/**
 * 建故事板时设计镜头卡。任何失败都返回 null（调用方退回旧的模板节奏，不影响出帧）；调了 LLM 的失败同时交给 deps.onDegraded。
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
  const timeoutMs = deps.timeoutMs ?? DESIGN_TIMEOUT_MS;
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
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!result) {
      console.warn("[shot-cards] design timed out; falling back to template beats");
      deps.onDegraded?.(planningDegradation("shot_cards", `镜头卡设计超时（${timeoutMs / 1000} 秒没返回）`));
      return null;
    }
    const cards = normalizeShotCards(result.data, input.beats.length);
    if (!cards) {
      console.warn("[shot-cards] LLM output rejected; falling back to template beats");
      deps.onDegraded?.(planningDegradation("shot_cards", rejectedShotCardsReason(result.data, input.beats.length)));
    }
    return cards;
  } catch (error) {
    console.warn("[shot-cards] design failed; falling back to template beats:", (error as Error).message);
    deps.onDegraded?.(planningDegradation("shot_cards", error));
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
