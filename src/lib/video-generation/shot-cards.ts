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
  /** 光色：主光方向与质感、整体色调（10-29 补齐 Kelin 六项里缺的一项）。旧卡没有 */
  light?: string;
  /** 这一镜在哪：同一地点用同一个短名，换名 = 硬切到新地点。旧卡没有 */
  location?: string;
  /** 口播怎么出：主播出镜说 / 画外音 / 这一镜没人说。旧卡没有 */
  voice?: ShotCardVoice | null;
}

export const SHOT_CARD_LINE_PREFIX = "SHOT CARD: ";
const SHOT_CARD_TEXT_FIELDS = ["startState", "lens", "camera", "composition", "action", "endState", "sound", "light"] as const;
const FIELD_MAX_CHARS = 160;
/// 一张卡格式化后的上限：出帧提示词 5000 字里要给故事与锁行留位，视频侧还会按段预算再压。
export const SHOT_CARD_MAX_CHARS = 640;
/// 建故事板是用户在等的请求：2026-10-28 同题实测 gpt-5.6-sol 15–31s（偶发超 25s），gpt-5.6-terra 约 14s、质量接近，
/// 所以走 fast 档（terra 首选）；超时即退回模板节奏，不拖住出帧。

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
    card.light && `Light: ${card.light}`,
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
