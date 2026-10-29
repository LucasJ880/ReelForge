/**
 * 故事板镜头节奏：英文原句写进出图提示词（模型读），界面按语言显示译名（客户读）。
 * 纯数据模块——服务端 storyboard-service 与客户端分镜面板共用，不得引入服务端依赖。
 */
import { truncateStoryText } from "@/lib/video-generation/storyboard-frame-inputs";

export const STORYBOARD_BEATS_SHORT = [
  "0–3s · immediate problem or desire hook",
  "3–7s · faithful product reveal",
  "7–11s · simple product demonstration and proof",
  "11–15s · resolved result with clean CTA-safe composition",
] as const;

export const STORYBOARD_BEATS_LONG = [
  "opening hook",
  "faithful product reveal",
  "first demonstration beat",
  "proof and resolved result",
  "clean CTA-safe closing composition",
] as const;

const BEAT_LABELS: Record<string, { zh: string; en: string }> = {
  "0–3s · immediate problem or desire hook": { zh: "0–3 秒 · 开场钩子：痛点或期待", en: "0–3s · Hook: the problem or the want" },
  "3–7s · faithful product reveal": { zh: "3–7 秒 · 产品亮相（忠于实物）", en: "3–7s · Product reveal" },
  "7–11s · simple product demonstration and proof": { zh: "7–11 秒 · 使用演示与效果证明", en: "7–11s · Demo and proof" },
  "11–15s · resolved result with clean CTA-safe composition": {
    zh: "11–15 秒 · 效果收尾（留出行动号召位置）",
    en: "11–15s · Payoff, with room for the call to action",
  },
  "opening hook": { zh: "开场钩子", en: "Opening hook" },
  "faithful product reveal": { zh: "产品亮相（忠于实物）", en: "Product reveal" },
  "first demonstration beat": { zh: "第一段使用演示", en: "First demo beat" },
  "proof and resolved result": { zh: "效果证明与收尾", en: "Proof and payoff" },
  "clean CTA-safe closing composition": { zh: "收尾画面（留出行动号召位置）", en: "Closing frame, with room for the call to action" },
};

/** 已知节奏给译名；未知的（旧数据或自定义）原样显示。 */
export function storyboardBeatLabel(beat: string, english: boolean): string {
  const label = BEAT_LABELS[beat];
  if (!label) return beat;
  return english ? label.en : label.zh;
}

/** 已按故事板改写过的段提示词带这个标记：重试 / 重复派发不再二次改写。 */
export const STORYBOARD_GROUNDING_MARKER = "APPROVED STORYBOARD (recreate these keyframes in order):";

/// 模板里与故事板无冲突、必须保留的约束行（身份 / 场景 / 产品 / 口型 / 光线锁，产品描述行，与口播台词）。
/// P02-C：bible 的 PRODUCT 行保留（产品描述不与故事板冲突）；CHARACTER 行**只保留带主播前缀的**
/// `CHARACTER (must match the presenter reference photo…`——通用配方自编的人物与 `NO on-camera person`
/// 都是 1025 修掉的「模板盖过商家原话」，谁在镜头前由商家原话与故事板帧决定。
/// `Audio:` 与 `Spoken dialogue` 是口播链路的依赖，必须原样保留。
const KEEP_TEMPLATE_LINE =
  /^(?:CHARACTER IDENTITY LOCK|CHARACTER \(must match the presenter reference photo|PRODUCT(?: \(|:)|SCENE GEOMETRY LOCK|PRODUCT SHAPE LOCK|LIP-SYNC LOCK|LIGHTING CONTINUITY LOCK|Audio:|Spoken dialogue|Do not render)/;

/// 供应商提示词上限 5000 字（shuyu）；商家描述最多 4000 字，这里给故事最多留 1500，余量给约束与台词。
const STORY_CHAR_BUDGET = 1500;
/// 视频 provider（providers/shuyu-video-provider.ts、byteplus-video-provider.ts）发出的是
/// `${prompt}\nNegative constraints: ${negativePrompt}`：预算必须把这条尾巴算进去，否则 grounding 4800 + 负面 250
/// 就撞 5000 不可重试拒绝。分隔符在这里定一份，测试读 provider 源码盯它不漂移。
export const NEGATIVE_CONSTRAINTS_SEPARATOR = "\nNegative constraints: ";
/// 整段上限与安全余量：bible 的人物 / 产品行与口播台词都可能很长，故事按
/// 「上限 − 负面尾巴 − 余量 − 其余所有行」动态收缩；余量给 provider 侧其余拼接。锁行与台词（exact wording）永不裁。
const VIDEO_PROMPT_LIMIT = 5000;
const VIDEO_PROMPT_SAFETY = 100;

function beatWithoutTime(beat: string): string {
  return beat.replace(/^\s*\d+\s*[–-]\s*\d+\s*s\s*·\s*/u, "").trim();
}

/**
 * 单条视频参考图的分组布局（P02-F(v)）：brief.referenceImageUrls 按 实拍 → 切片 → 主播 → 帧 排，
 * 各组张数 + 派发时用的张数上限随 directorPlan 写回（`referenceLayout`）。
 * 重试 / 重做按同一个上限截断，帧质检按它切出实拍与故事板首帧——不靠位置猜。
 */
export interface StoryboardReferenceLayout {
  productPhotoCount: number;
  anchorCount: number;
  personCount: number;
  frameCount: number;
  limit: number;
}

function layoutCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** 从持久化的 directorPlan（任意 JSON）读 referenceLayout；没有或坏数据 → null。 */
export function readStoryboardReferenceLayout(directorPlan: unknown): StoryboardReferenceLayout | null {
  if (!directorPlan || typeof directorPlan !== "object" || Array.isArray(directorPlan)) return null;
  const raw = (directorPlan as { referenceLayout?: unknown }).referenceLayout;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const productPhotoCount = layoutCount(record.productPhotoCount);
  const anchorCount = layoutCount(record.anchorCount);
  const personCount = layoutCount(record.personCount);
  const frameCount = layoutCount(record.frameCount);
  const limit = layoutCount(record.limit);
  if (
    productPhotoCount === null ||
    anchorCount === null ||
    personCount === null ||
    frameCount === null ||
    limit === null ||
    limit < 1
  ) {
    return null;
  }
  return { productPhotoCount, anchorCount, personCount, frameCount, limit };
}

function imageSpan(from: number, to: number): string {
  return from === to ? `image ${from} is` : `images ${from}-${to} are`;
}

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * 把一段视频提示词改写成「按已确认故事板拍」（纯函数）。
 *
 * 1025 真机验收：单条视频的提示词来自通用 UGC 配方——LOCATION 写死「居家、窗边晨光」，
 * 镜头表是模板句，商家写的「金毛在公园奔跑」一个字都没进提示词；已确认的四张故事板帧
 * 只作为参考图随行，模型照文字拍了客厅口播，和客户点头确认的画面对不上。
 * 这里用商家原话 + 故事板帧（按时间段、按参考图序号）替换通用的场景 / 镜头表 / 风格行，
 * 只保留不冲突的约束锁与口播台词。
 */
export function groundSegmentPromptInStoryboard(
  original: string,
  input: {
    aspectRatio: string;
    story: string;
    beats: readonly string[];
    /// 参考图里排在故事板帧前面的实拍张数（0 = 纯文字起稿，没有实拍）
    productPhotoCount: number;
    /// 排在实拍之后、帧之前的切片与主播张数（P02-F(v)；缺省 0 = 与分组前逐字节一致）
    anchorCount?: number;
    personCount?: number;
    totalDurationSec: number;
    fromSec: number;
    toSec: number;
    /// 该段的负面提示词：provider 会以 NEGATIVE_CONSTRAINTS_SEPARATOR 拼在正向提示词后面一起发，预算据此扣除
    negativePrompt?: string | null;
    /// 与 beats 对齐的镜头卡正文（shot-cards.ts，从帧提示词读回）。全空 / 省略 = 旧格式，逐字节不变。
    shotCards?: ReadonlyArray<string | null>;
  },
): string {
  if (original.includes(STORYBOARD_GROUNDING_MARKER) || input.beats.length === 0) return original;
  const count = input.beats.length;
  const span = input.totalDurationSec / count;
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  const photos = input.productPhotoCount;
  const anchors = input.anchorCount ?? 0;
  const persons = input.personCount ?? 0;
  /// 帧在参考图里的序号要跳过排在它前面的实拍、切片与主播
  const frameOffset = photos + anchors + persons;
  const segmentShots = input.beats
    .map((beat, index) => ({ index, from: index * span, to: (index + 1) * span, beat: beatWithoutTime(beat) }))
    .filter((shot) => shot.to > input.fromSec && shot.from < input.toSec)
    .map((shot) => ({
      ...shot,
      from: Math.max(0, Math.round(shot.from - input.fromSec)),
      to: Math.min(segmentSec, Math.round(shot.to - input.fromSec)),
      card: input.shotCards?.[shot.index]?.trim() || null,
    }));
  /// LibTV 式镜头卡模式：只要本段有一张卡就切换（旧 run 没有卡，输出与之前逐字节一致）。
  const cardMode = segmentShots.some((shot) => shot.card);
  const shotLines = (cardLimit: number) =>
    segmentShots.map((shot, order) => {
      const keyframe = `recreate storyboard keyframe ${shot.index + 1} (reference image ${frameOffset + shot.index + 1}) — ${shot.beat}.`;
      if (!cardMode) return `${shot.from}-${shot.to}s: ${keyframe}`;
      const card = shot.card && cardLimit >= SHOT_CARD_MIN_CHARS ? ` ${clipText(shot.card, cardLimit)}` : "";
      return `${shot.from}-${shot.to}s · shot ${order + 1}${order > 0 ? " (hard cut)" : ""}: ${keyframe}${card}`;
    });
  const normalizedStory = input.story.replace(/\s+/gu, " ").trim();
  const roles: string[] = [];
  if (photos > 0) {
    roles.push(`${photos === 1 ? "image 1 is a real photo" : `images 1-${photos} are real photos`} of the product — match it exactly.`);
  }
  if (anchors > 0) {
    roles.push(
      anchors === 1
        ? `image ${photos + 1} is a cut-out view of the same product — match it exactly.`
        : `images ${photos + 1}-${photos + anchors} are cut-out views of the same product — match it exactly.`,
    );
  }
  if (persons > 0) {
    roles.push(
      `${imageSpan(photos + anchors + 1, frameOffset)} the presenter reference ${persons === 1 ? "photo" : "photos"} — the on-camera person must be this exact person (same face, hair, skin tone and build).`,
    );
  }
  const productReferenced = photos + anchors > 0;
  roles.push(
    `images ${frameOffset + 1}-${frameOffset + count} are the approved storyboard keyframes in story order — match their people, location, wardrobe, light${productReferenced ? " and framing" : ", framing and the product they show"}.`,
  );
  const references = `REFERENCE IMAGES: ${roles.map((role, index) => (index === 0 ? role : capitalize(role))).join(" ")}`;
  const kept = original
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => KEEP_TEMPLATE_LINE.test(line))
    /// 模板默认室内；场景由故事板决定，环境声跟着场景走
    .map((line) => line.replace("subtle real room ambience", "subtle ambient sound that fits the location"));
  /// 镜头卡模式额外三行（LibTV 画布里每条视频提示词都有的「全局质感 / 产品不变量 / 旁白时间窗」）。
  const cardModeLines = cardMode
    ? [
        LOOK_LINE,
        ...(productReferenced ? [productInvariantsLine(photos + anchors)] : []),
        ...(kept.some((line) => line.startsWith("Spoken dialogue")) ? [speechTimingLine(segmentSec)] : []),
      ]
    : [];
  const assemble = (story: string, cardLimit: number) => [
    `${input.aspectRatio} short video, ${segmentSec}s, one continuous photorealistic story.`,
    `STORY (the merchant's own description; it decides who is on screen, where, and what happens): ${story}`,
    references,
    ...cardModeLines,
    "",
    STORYBOARD_GROUNDING_MARKER,
    ...shotLines(cardLimit),
    "",
    ...kept,
  ].join("\n");
  const negative = input.negativePrompt?.trim() ?? "";
  const negativeTail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  const available = (cardLimit: number) =>
    VIDEO_PROMPT_LIMIT - VIDEO_PROMPT_SAFETY - negativeTail.length - assemble("", cardLimit).length;
  /// 镜头卡与故事抢同一个 5000 字：故事先保底 STORY_RESERVE（商家原话决定谁出镜），余下平分给本段的卡，再把剩的还给故事。
  const cardsInSegment = segmentShots.filter((shot) => shot.card).length;
  const cardLimit = cardsInSegment === 0
    ? 0
    : Math.min(
        SHOT_CARD_SEGMENT_MAX_CHARS,
        Math.floor(
          Math.max(0, available(0) - Math.min(normalizedStory.length, STORY_RESERVE_WITH_CARDS)) / cardsInSegment,
        ) - 1,
      );
  /// 预算挤到放不下任何一张卡：整段退回旧格式（不留只加行、不加卡的半成品）
  if (cardsInSegment > 0 && cardLimit < SHOT_CARD_MIN_CHARS) {
    return groundSegmentPromptInStoryboard(original, { ...input, shotCards: undefined });
  }
  const storyBudget = Math.max(0, Math.min(STORY_CHAR_BUDGET, available(cardLimit)));
  // 与 provider 的 string.length 校验同用 UTF-16 单位；按码点 slice 会让 emoji 稿超限。
  return assemble(truncateStoryText(normalizedStory, storyBudget), cardLimit);
}

/// Runway Kling O3 的提示词上限（UTF-16，含发出时拼上的负面约束），与 providers/runway.ts 的 RUNWAY_MODEL_LIMITS 同值
///（本模块客户端也引用，不能 import 服务端 provider）。2026-10-28 用 Runway 的请求校验实测。
export const KLING_VIDEO_PROMPT_LIMIT = 2500;
const KLING_SHOT_CARD_MAX_CHARS = 240;
/// 预算再紧也给商家原话留这么多（谁出镜、在哪由它决定），不够就从产品行里让——产品长相实拍图里有
const KLING_STORY_MIN_CHARS = 200;
const KLING_PRODUCT_MIN_CHARS = 120;
const STORY_LINE_PREFIX = "STORY (the merchant's own description; it decides who is on screen, where, and what happens): ";

/** 本段从哪一张关键帧开场（0 起）：与 grounding 的节奏切法一致——每帧占「总时长 ÷ 帧数」秒。 */
export function storyboardOpeningFrameOrdinal(input: {
  frameCount: number;
  totalDurationSec: number;
  fromSec: number;
}): number {
  if (input.frameCount <= 0) return 0;
  const span = input.totalDurationSec / input.frameCount;
  if (!(span > 0)) return 0;
  return Math.min(input.frameCount - 1, Math.max(0, Math.floor(input.fromSec / span + 1e-9)));
}

/**
 * 参考图列表里本段开场帧的地址：列表按 实拍 → 切片 → 主播 → 帧 排（referenceLayout 记了各组张数），
 * 开场帧 = 帧组里本段第一张。布局缺失或越界返回 null（调用方不标首帧，Kling 会在提交前拒绝并写清原因）。
 */
export function storyboardOpeningFrameUrl(
  referenceUrls: readonly string[],
  layout: Pick<StoryboardReferenceLayout, "productPhotoCount" | "anchorCount" | "personCount" | "frameCount"> | null,
  segment: { totalDurationSec: number; fromSec: number },
): string | null {
  if (!layout || layout.frameCount <= 0) return null;
  const ordinal = storyboardOpeningFrameOrdinal({
    frameCount: layout.frameCount,
    totalDurationSec: segment.totalDurationSec,
    fromSec: segment.fromSec,
  });
  return referenceUrls[layout.productPhotoCount + layout.anchorCount + layout.personCount + ordinal] ?? null;
}

/**
 * Runway Kling O3 的故事板视频提示词（2026-10-28 灰度真机：Seedance 拦写实人脸参考图，故事板视频改走 Kling）。
 *
 * Kling 是图生视频：本段第一张关键帧单独作开场帧（video-service 标 first_frame），其余实拍 / 切片 / 主播 / 关键帧作参考，
 * 参考图没有序号语义——这里只按内容描述，不写「image N」。上限 2500 字装不下原模板逐字保留的各条锁行，
 * 而人物、场景、衣着、光线已经在关键帧里，所以按优先级取舍：
 * 必留 开场 / 参考说明 / 每帧节奏 / 产品行 / 音频与口播台词 / 不渲染文字 → 商家原话（截断）→ 镜头卡 → 质感行 → 各锁行（放不下整行不加）。
 * 口播台词一个字不动；商家原话至少留 200 字，不够时从产品行里让（产品行最少留 120 字）。
 */
export function groundSegmentPromptForOpeningFrame(
  original: string,
  input: Parameters<typeof groundSegmentPromptInStoryboard>[1] & { promptLimit?: number },
): string {
  if (original.includes(STORYBOARD_GROUNDING_MARKER) || input.beats.length === 0) return original;
  const count = input.beats.length;
  const span = input.totalDurationSec / count;
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  const opening = storyboardOpeningFrameOrdinal({
    frameCount: count,
    totalDurationSec: input.totalDurationSec,
    fromSec: input.fromSec,
  });
  const shots = input.beats
    .map((beat, index) => ({ index, from: index * span, to: (index + 1) * span, beat: beatWithoutTime(beat) }))
    .filter((shot) => shot.to > input.fromSec && shot.from < input.toSec)
    .map((shot) => ({
      ...shot,
      from: Math.max(0, Math.round(shot.from - input.fromSec)),
      to: Math.min(segmentSec, Math.round(shot.to - input.fromSec)),
      card: input.shotCards?.[shot.index]?.trim() || null,
    }));
  const photos = input.productPhotoCount;
  const anchors = input.anchorCount ?? 0;
  const persons = input.personCount ?? 0;
  const roles = [
    ...(photos > 0 ? [`${photos === 1 ? "a real photo" : `${photos} real photos`} of the product (match it exactly)`] : []),
    ...(anchors > 0 ? [`${anchors === 1 ? "a cut-out view" : `${anchors} cut-out views`} of the same product (match it exactly)`] : []),
    ...(persons > 0 ? [`the presenter ${persons === 1 ? "photo" : "photos"} (the on-camera person must be this exact person)`] : []),
    `the other approved storyboard keyframes in story order (match their people, location, wardrobe and light${photos + anchors > 0 ? "" : ", and the product they show"})`,
  ];
  const header = `${input.aspectRatio} short video, ${segmentSec}s, one continuous photorealistic story. It opens exactly on the opening frame, which is storyboard keyframe ${opening + 1}.`;
  const references = `REFERENCE IMAGES: ${roles.join("; ")}.`;
  const lines = original.split("\n").map((line) => line.trim());
  let mustKeep = lines
    .filter((line) => /^(?:PRODUCT(?: \(|:)|Audio:|Spoken dialogue|Do not render)/u.test(line))
    .map((line) => line.replace("subtle real room ambience", "subtle ambient sound that fits the location"));
  const locks = lines.filter((line) =>
    /^(?:CHARACTER IDENTITY LOCK|CHARACTER \(must match the presenter reference photo|SCENE GEOMETRY LOCK|PRODUCT SHAPE LOCK|LIP-SYNC LOCK|LIGHTING CONTINUITY LOCK)/u.test(line),
  );
  const negative = input.negativePrompt?.trim() ?? "";
  const negativeTail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  const budget = (input.promptLimit ?? KLING_VIDEO_PROMPT_LIMIT) - VIDEO_PROMPT_SAFETY - negativeTail.length;
  const assemble = (story: string, cardLimit: number, extras: readonly string[]) => [
    header,
    ...(story ? [`${STORY_LINE_PREFIX}${story}`] : []),
    references,
    STORYBOARD_GROUNDING_MARKER,
    ...shots.map((shot, order) => {
      const card = shot.card && cardLimit >= SHOT_CARD_MIN_CHARS ? ` ${clipText(shot.card, cardLimit)}` : "";
      return `${shot.from}-${shot.to}s · shot ${order + 1}${order > 0 ? " (hard cut)" : ""}: storyboard keyframe ${shot.index + 1} — ${shot.beat}.${card}`;
    }),
    ...mustKeep,
    ...extras,
  ].join("\n");

  /// 必留部分 + 故事保底放不下（产品行特别长、负面特别长）：只截产品行，口播台词一个字不动
  const story = input.story.replace(/\s+/gu, " ").trim();
  const storyReserve = story ? Math.min(story.length, KLING_STORY_MIN_CHARS) + STORY_LINE_PREFIX.length + 1 : 0;
  const overflow = assemble("", 0, []).length + storyReserve - budget;
  if (overflow > 0) {
    mustKeep = mustKeep.map((line) =>
      /^PRODUCT/u.test(line) ? clipText(line, Math.max(KLING_PRODUCT_MIN_CHARS, line.length - overflow)) : line,
    );
  }
  const storyRoom = budget - assemble("", 0, []).length - STORY_LINE_PREFIX.length - 1;
  const storyText = truncateStoryText(story, Math.max(0, Math.min(STORY_CHAR_BUDGET, storyRoom)));
  const cardsInSegment = shots.filter((shot) => shot.card).length;
  const perCard = cardsInSegment === 0
    ? 0
    : Math.min(KLING_SHOT_CARD_MAX_CHARS, Math.floor((budget - assemble(storyText, 0, []).length) / cardsInSegment) - 2);
  const cardLimit = perCard >= SHOT_CARD_MIN_CHARS ? perCard : 0;
  const extras: string[] = [];
  for (const line of [LOOK_LINE, ...locks]) {
    if (assemble(storyText, cardLimit, [...extras, line]).length <= budget) extras.push(line);
  }
  return assemble(storyText, cardLimit, extras);
}

/// 与 shot-cards.ts 的 SHOT_CARD_MAX_CHARS 同值（本模块客户端也引用，不能 import 那个服务端模块）。
const SHOT_CARD_SEGMENT_MAX_CHARS = 640;
/// 预算挤到这个长度以下的卡整张不写（半句镜头卡比没有更误导）。
const SHOT_CARD_MIN_CHARS = 60;
const STORY_RESERVE_WITH_CARDS = 600;

const LOOK_LINE =
  "LOOK: photoreal live-action commercial footage with one consistent grade; natural skin texture; physically correct materials, reflections, liquids and contact shadows; slow, steady, motivated camera moves. No cartoon, CGI or game look, no oversharpening, no HDR glow, no neon, no floating UI, no on-screen text or subtitles, no background music.";

function productInvariantsLine(productImages: number): string {
  const images = productImages === 1 ? "image 1" : `images 1-${productImages}`;
  return `PRODUCT INVARIANTS: in every shot the product keeps the exact silhouette, proportions, colors, controls and printed marks of ${images}; it never morphs, never shows a side or part the photos do not show, never gains extra parts, buttons or text, and keeps its real scale next to hands and furniture.`;
}

function speechTimingLine(segmentSec: number): string {
  const end = Math.max(1, segmentSec - 1);
  return `SPEECH TIMING: one narrator only; start the spoken line after the first half second and finish the complete line by ${end}s; never cut off mid-word, never repeat it, no second voice.`;
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
