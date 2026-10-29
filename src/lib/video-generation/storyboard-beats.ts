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

/// 镜头卡（shot-cards.ts）里「谁说话」的固定写法：派发时按原句识别本段的口播方式，所以只在这里定一份
///（本模块客户端也引用，shot-cards.ts 从这里取，不能反过来）。
export type ShotCardVoice = "on_camera" | "voice_over" | "none";
export const SHOT_CARD_VOICE_PHRASES: Record<ShotCardVoice, string> = {
  on_camera: "the presenter says it on camera",
  voice_over: "off-screen narrator only",
  none: "no narration in this shot",
};
/// 地点和上一张不同的卡以这个前缀开头（第一张不写）：出帧换「换地点版」连续性锁，派发标硬切到新地点。
export const SHOT_CARD_NEW_LOCATION_PREFIX = "New location: ";

function shotCardVoice(card: string): ShotCardVoice | null {
  for (const voice of Object.keys(SHOT_CARD_VOICE_PHRASES) as ShotCardVoice[]) {
    if (card.includes(`Voice: ${SHOT_CARD_VOICE_PHRASES[voice]}`)) return voice;
  }
  return null;
}

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
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  const photos = input.productPhotoCount;
  const anchors = input.anchorCount ?? 0;
  const persons = input.personCount ?? 0;
  /// 帧在参考图里的序号要跳过排在它前面的实拍、切片与主播
  const frameOffset = photos + anchors + persons;
  const segmentShots = storyboardSegmentShots(input);
  /// LibTV 式镜头卡模式：只要本段有一张卡就切换（旧 run 没有卡，输出与之前逐字节一致）。
  const cardMode = segmentShots.some((shot) => shot.card);
  const shotLines = (cardLimit: number) =>
    segmentShots.map((shot, order) => {
      const keyframe = `storyboard keyframe ${shot.index + 1} (reference image ${frameOffset + shot.index + 1})`;
      if (!cardMode) return `${shot.from}-${shot.to}s: recreate ${keyframe} — ${shot.beat}.`;
      return `${shot.from}-${shot.to}s · shot ${order + 1}${hardCutLabel(shot, order)}: ${cardShotBody(shot, keyframe, cardLimit)}`;
    });
  const normalizedStory = input.story.replace(/\s+/gu, " ").trim();
  const productReferenced = photos + anchors > 0;
  const roles: string[] = [];
  if (photos > 0) {
    const subject = photos === 1 ? "image 1 is a real photo" : `images 1-${photos} are real photos`;
    /// 镜头卡模式写清实拍只管商品本身：商家实拍常带台面、手、价签与水印，不能跟着进画面
    roles.push(
      cardMode
        ? `${subject} of the product — copy only the product itself (shape, colors, printed marks), not ${photos === 1 ? "its" : "their"} background, surface, hands, props, price tags or watermarks.`
        : `${subject} of the product — match it exactly.`,
    );
  }
  if (anchors > 0) {
    roles.push(
      anchors === 1
        ? `image ${photos + 1} is a cut-out view of the same product — match it exactly.`
        : `images ${photos + 1}-${photos + anchors} are cut-out views of the same product — match it exactly.`,
    );
  }
  if (persons > 0) {
    /// 镜头卡模式：主播照只锁身份，衣着与场景跟已确认的关键帧（关键帧就是带着主播照画出来的）
    roles.push(
      `${imageSpan(photos + anchors + 1, frameOffset)} the presenter reference ${persons === 1 ? "photo" : "photos"} — the on-camera person must be this exact person (same face, hair, skin tone and build)${cardMode ? "; wardrobe and setting follow the keyframes" : ""}.`,
    );
  }
  roles.push(
    cardMode
      ? `images ${frameOffset + 1}-${frameOffset + count} are the approved storyboard keyframes in story order — each is the first moment of its shot: match its people, location, wardrobe, light${productReferenced ? " and framing" : ", framing and the product it shows"}, then play the action forward from it.`
      : `images ${frameOffset + 1}-${frameOffset + count} are the approved storyboard keyframes in story order — match their people, location, wardrobe, light${productReferenced ? " and framing" : ", framing and the product they show"}.`,
  );
  const references = `REFERENCE IMAGES: ${roles.map((role, index) => (index === 0 ? role : capitalize(role))).join(" ")}`;
  const templateLines = original
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => KEEP_TEMPLATE_LINE.test(line))
    /// 模板默认室内；场景由故事板决定，环境声跟着场景走
    .map((line) => line.replace("subtle real room ambience", "subtle ambient sound that fits the location"));
  const hasDialogue = templateLines.some((line) => line.startsWith("Spoken dialogue"));
  const voice = cardMode ? segmentVoice(segmentShots) : null;
  /// 镜头卡模式按卡拆掉互相打架的锁：全是画外音就不要口型锁；段内换地点，场景锁只管同一地点之内。
  const kept = cardMode
    ? reconcileLockLines(templateLines, { voice, hasDialogue, locationChange: segmentChangesLocation(segmentShots) })
    : templateLines;
  /// 镜头卡模式额外三行（LibTV 画布里每条视频提示词都有的「全局质感 / 产品不变量 / 旁白时间窗」）。
  const cardModeLines = cardMode
    ? [
        LOOK_LINE,
        ...(productReferenced ? [productInvariantsLine(photos + anchors)] : []),
        ...(hasDialogue ? [speechTimingLine(segmentSec, voice)] : []),
      ]
    : [];
  const assemble = (story: string, cardLimit: number) => [
    `${input.aspectRatio} short video, ${segmentSec}s, one continuous photorealistic story.`,
    `STORY (the merchant's own description; it decides who is on screen, where, and what happens): ${story}`,
    references,
    ...cardModeLines,
    "",
    STORYBOARD_GROUNDING_MARKER,
    ...(cardMode ? [KEYFRAME_MOTION_LINE] : []),
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
          Math.max(0, available(0) - Math.min(normalizedStory.length, STORY_RESERVE_WITH_CARDS) + cardSlotSlack(segmentShots)) /
            cardsInSegment,
        ),
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
/// 单张卡上限；实际多半先被 2500 字预算卡住。卡按重要性排，截掉的是尾巴上的声音与构图。
const KLING_SHOT_CARD_MAX_CHARS = 360;
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
 *
 * 镜头卡模式（2026-10-29）：原话保底 200 字之后先给镜头卡、再把剩的还给原话——卡里的首态 / 动作 / 尾态是
 * 视频最要紧的信息，原话的事实已经在卡和关键帧里；卡标了谁说话就紧跟台词加一句「谁说、何时说完」。
 */
export function groundSegmentPromptForOpeningFrame(
  original: string,
  input: Parameters<typeof groundSegmentPromptInStoryboard>[1] & { promptLimit?: number },
): string {
  if (original.includes(STORYBOARD_GROUNDING_MARKER) || input.beats.length === 0) return original;
  const count = input.beats.length;
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  const opening = storyboardOpeningFrameOrdinal({
    frameCount: count,
    totalDurationSec: input.totalDurationSec,
    fromSec: input.fromSec,
  });
  const shots = storyboardSegmentShots(input);
  const cardMode = shots.some((shot) => shot.card);
  const photos = input.productPhotoCount;
  const anchors = input.anchorCount ?? 0;
  const persons = input.personCount ?? 0;
  const roles = [
    ...(photos > 0
      ? [
          `${photos === 1 ? "a real photo" : `${photos} real photos`} of the product (${
            cardMode
              ? `copy only the product itself, not ${photos === 1 ? "its" : "their"} background, hands, props, price tags or watermarks`
              : "match it exactly"
          })`,
        ]
      : []),
    ...(anchors > 0 ? [`${anchors === 1 ? "a cut-out view" : `${anchors} cut-out views`} of the same product (match it exactly)`] : []),
    ...(persons > 0
      ? [`the presenter ${persons === 1 ? "photo" : "photos"} (the on-camera person must be this exact person${cardMode ? "; wardrobe follows the keyframes" : ""})`]
      : []),
    `the other approved storyboard keyframes in story order (${cardMode ? "each is the first moment of its shot: match people" : "match their people"}, location, wardrobe and light${photos + anchors > 0 ? "" : ", and the product they show"})`,
  ];
  const header = `${input.aspectRatio} short video, ${segmentSec}s, one continuous photorealistic story. It opens exactly on the opening frame, which is storyboard keyframe ${opening + 1}.`;
  const references = `REFERENCE IMAGES: ${roles.join("; ")}.`;
  const lines = original.split("\n").map((line) => line.trim());
  let mustKeep = lines
    .filter((line) => /^(?:PRODUCT(?: \(|:)|Audio:|Spoken dialogue|Do not render)/u.test(line))
    .map((line) => line.replace("subtle real room ambience", "subtle ambient sound that fits the location"));
  const hasDialogue = mustKeep.some((line) => line.startsWith("Spoken dialogue"));
  const voice = cardMode ? segmentVoice(shots) : null;
  /// 卡上标了谁说话：紧跟台词写一句「谁说、何时说完」（画外音段的口型锁会被去掉，这句不能没有）
  if (voice && hasDialogue) {
    const at = mustKeep.findIndex((line) => line.startsWith("Spoken dialogue"));
    mustKeep = [...mustKeep.slice(0, at + 1), klingSpeechLine(segmentSec, voice), ...mustKeep.slice(at + 1)];
  }
  const lockLines = lines.filter((line) =>
    /^(?:CHARACTER IDENTITY LOCK|CHARACTER \(must match the presenter reference photo|SCENE GEOMETRY LOCK|PRODUCT SHAPE LOCK|LIP-SYNC LOCK|LIGHTING CONTINUITY LOCK)/u.test(line),
  );
  const locks = cardMode
    ? reconcileLockLines(lockLines, { voice, hasDialogue, locationChange: segmentChangesLocation(shots) })
    : lockLines;
  const negative = input.negativePrompt?.trim() ?? "";
  const negativeTail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  const budget = (input.promptLimit ?? KLING_VIDEO_PROMPT_LIMIT) - VIDEO_PROMPT_SAFETY - negativeTail.length;
  const assemble = (story: string, cardLimit: number, extras: readonly string[]) => [
    header,
    ...(story ? [`${STORY_LINE_PREFIX}${story}`] : []),
    references,
    STORYBOARD_GROUNDING_MARKER,
    ...(cardMode ? [KEYFRAME_MOTION_LINE] : []),
    ...shots.map((shot, order) =>
      cardMode
        ? `${shot.from}-${shot.to}s · shot ${order + 1}${hardCutLabel(shot, order)}: ${cardShotBody(shot, `storyboard keyframe ${shot.index + 1}`, cardLimit)}`
        : `${shot.from}-${shot.to}s · shot ${order + 1}${order > 0 ? " (hard cut)" : ""}: storyboard keyframe ${shot.index + 1} — ${shot.beat}.`,
    ),
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
  const cardsInSegment = shots.filter((shot) => shot.card).length;
  let cardLimit = 0;
  if (cardsInSegment > 0) {
    const storyFloor = truncateStoryText(story, Math.min(story.length, KLING_STORY_MIN_CHARS));
    const perCard = Math.min(
      KLING_SHOT_CARD_MAX_CHARS,
      Math.floor((budget - assemble(storyFloor, 0, []).length + cardSlotSlack(shots)) / cardsInSegment),
    );
    cardLimit = perCard >= SHOT_CARD_MIN_CHARS ? perCard : 0;
    /// 卡按整段字段取舍，往往用不满平分的额度：把剩下的再平分几轮。放宽额度可能让某张卡整段多进一个字段，
    /// 所以每轮先按原话保底量一遍，超预算就停在上一轮。
    for (let round = 0; cardLimit > 0 && round < 3; round++) {
      const room = budget - assemble(storyFloor, cardLimit, []).length;
      const next = Math.min(KLING_SHOT_CARD_MAX_CHARS, cardLimit + Math.floor(room / cardsInSegment));
      if (next <= cardLimit || assemble(storyFloor, next, []).length > budget) break;
      cardLimit = next;
    }
    /// 一张卡都放不下：整段退回旧格式（与 Shuyu 版同一原则，不留只加了说明行、没有卡的半成品）
    if (cardLimit < SHOT_CARD_MIN_CHARS) {
      return groundSegmentPromptForOpeningFrame(original, { ...input, shotCards: undefined });
    }
  }
  const storyRoom = budget - assemble("", cardLimit, []).length - STORY_LINE_PREFIX.length - 1;
  const storyText = truncateStoryText(story, Math.max(0, Math.min(STORY_CHAR_BUDGET, storyRoom)));
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

interface StoryboardSegmentShot {
  index: number;
  from: number;
  to: number;
  beat: string;
  card: string | null;
  /// 卡以 `New location:` 开头：这一镜硬切到新地点
  newLocation: boolean;
  voice: ShotCardVoice | null;
}

/** 落在本段时间窗里的帧（时间相对段起点；每帧占「总时长 ÷ 帧数」秒）与各自的镜头卡。 */
function storyboardSegmentShots(input: {
  beats: readonly string[];
  totalDurationSec: number;
  fromSec: number;
  toSec: number;
  shotCards?: ReadonlyArray<string | null>;
}): StoryboardSegmentShot[] {
  const span = input.totalDurationSec / input.beats.length;
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  return input.beats
    .map((beat, index) => ({ index, from: index * span, to: (index + 1) * span, beat: beatWithoutTime(beat) }))
    .filter((shot) => shot.to > input.fromSec && shot.from < input.toSec)
    .map((shot) => {
      const card = input.shotCards?.[shot.index]?.trim() || null;
      return {
        ...shot,
        from: Math.max(0, Math.round(shot.from - input.fromSec)),
        to: Math.min(segmentSec, Math.round(shot.to - input.fromSec)),
        card,
        newLocation: card?.startsWith(SHOT_CARD_NEW_LOCATION_PREFIX) ?? false,
        voice: card ? shotCardVoice(card) : null,
      };
    });
}

function hardCutLabel(shot: StoryboardSegmentShot, order: number): string {
  if (order === 0) return "";
  return shot.newLocation ? " (hard cut to a new location)" : " (hard cut)";
}

/// 镜头卡模式在镜头表前写一次：关键帧是每一镜的起点，不是要复刻的静帧（Kling 只有 2500 字，不逐镜重复）。
const KEYFRAME_MOTION_LINE = "Each shot opens on its keyframe and then moves; never hold a keyframe still.";

/// 镜头卡正文按「. 字段名: 」切成字段（10-28 的旧卡开头是不带字段名的焦段，按 Shot 处理）。
const SHOT_CARD_FIELD_LABELS = ["New location", "Starts on", "Action", "Ends on", "Voice", "Shot", "Camera", "Composition", "Sound"];
const SHOT_CARD_FIELD_BOUNDARY = new RegExp(`\\. (?=(?:${SHOT_CARD_FIELD_LABELS.join("|")}): )`, "u");
/// 视频提示词里放不下整张卡时的取舍顺序：关键帧已经画出了首态，所以动作与尾态排在首态前面；
/// 「谁说话」不逐镜写（段里的 SPEECH TIMING / SPEECH 一句已经写清）。
const VIDEO_CARD_FIELD_PRIORITY = ["New location", "Action", "Ends on", "Starts on", "Camera", "Shot", "Composition", "Sound"];

function shotCardFieldLabel(field: string): string {
  const label = /^([A-Za-z ]+): /u.exec(field)?.[1];
  return label && SHOT_CARD_FIELD_LABELS.includes(label) ? label : "Shot";
}

/**
 * 把一张卡压到 limit 字以内：按字段整段取舍——先按重要性挑（放不下的整段跳过），再按卡里原来的顺序写出；
 * 不在字段中间截（半句镜头比没有更误导），连一段都放不下才按字截。
 */
function fitShotCard(card: string, limit: number): string {
  const fields = card
    .replace(/\.$/u, "")
    .split(SHOT_CARD_FIELD_BOUNDARY)
    .map((text, order) => ({ text, order, label: shotCardFieldLabel(text) }))
    .filter((field) => field.label !== "Voice");
  const render = (chosen: ReadonlySet<number>) => {
    const text = fields.filter((field) => chosen.has(field.order)).map((field) => field.text).join(". ");
    return text.endsWith("…") ? text : `${text}.`;
  };
  const all = new Set(fields.map((field) => field.order));
  if (render(all).length <= limit) return render(all);
  const chosen = new Set<number>();
  for (const label of VIDEO_CARD_FIELD_PRIORITY) {
    for (const field of fields.filter((candidate) => candidate.label === label)) {
      if (render(new Set([...chosen, field.order])).length <= limit) chosen.add(field.order);
    }
  }
  return chosen.size > 0 ? render(chosen) : clipText(card, limit);
}

/** 镜头卡模式的镜头正文：从这一张关键帧开演，后接镜头卡；卡放不下时退回节奏句。 */
function cardShotBody(shot: StoryboardSegmentShot, keyframe: string, cardLimit: number): string {
  return shot.card && cardLimit >= SHOT_CARD_MIN_CHARS
    ? `from ${keyframe}. ${fitShotCard(shot.card, cardLimit)}`
    : `from ${keyframe} — ${shot.beat}.`;
}

/**
 * 卡模式的预算先按「— 节奏句.」量镜头行（cardLimit = 0），真正写卡时这段换成「. 」：
 * 每张卡多出「节奏句 + 2」个字，还给卡，否则 Kling 上平白空着一两百字、卡却被截。
 */
function cardSlotSlack(shots: readonly StoryboardSegmentShot[]): number {
  return shots.reduce((sum, shot) => (shot.card ? sum + shot.beat.length + 2 : sum), 0);
}

interface SegmentVoice {
  mode: "on_camera" | "voice_over";
  /// 本段里出镜说的镜头序号（1 起）
  onCameraShots: number[];
  shotCount: number;
}

/** 本段口播怎么出：有一镜出镜说 → 出镜；否则有画外音 → 画外音；卡上都没写（旧卡 / 没有口播稿）→ null，与之前一致。 */
function segmentVoice(shots: readonly StoryboardSegmentShot[]): SegmentVoice | null {
  const onCameraShots = shots.flatMap((shot, order) => (shot.voice === "on_camera" ? [order + 1] : []));
  if (onCameraShots.length > 0) return { mode: "on_camera", onCameraShots, shotCount: shots.length };
  if (shots.some((shot) => shot.voice === "voice_over")) return { mode: "voice_over", onCameraShots: [], shotCount: shots.length };
  return null;
}

/** 段内换地点（本段第一镜之后有标 New location 的卡）。本段第一镜换地点不算：那是段与段之间的事。 */
function segmentChangesLocation(shots: readonly StoryboardSegmentShot[]): boolean {
  return shots.some((shot, order) => order > 0 && shot.newLocation);
}

const SCOPED_SCENE_GEOMETRY_LOCK =
  "SCENE GEOMETRY LOCK: within each location keep the windows, furniture, room proportions, prop positions and light direction unchanged; the place changes only at a hard cut marked as a new location, never by morphing or blending one place into another.";

/** 按镜头卡拆掉互相打架的锁行：画外音段去掉口型锁；段内换地点时场景锁只管同一地点之内。 */
function reconcileLockLines(
  lines: readonly string[],
  options: { voice: SegmentVoice | null; hasDialogue: boolean; locationChange: boolean },
): string[] {
  const dropLipSync = options.hasDialogue && options.voice?.mode === "voice_over";
  return lines
    .filter((line) => !(dropLipSync && line.startsWith("LIP-SYNC LOCK")))
    .map((line) => (options.locationChange && line.startsWith("SCENE GEOMETRY LOCK") ? SCOPED_SCENE_GEOMETRY_LOCK : line));
}

function speakerClause(voice: SegmentVoice | null): string {
  if (!voice) return "one narrator only";
  if (voice.mode === "voice_over") return "one off-screen narrator only, and nobody on screen speaks or moves their lips";
  if (voice.onCameraShots.length === voice.shotCount) return "one voice only: the presenter says the line on camera";
  const last = voice.onCameraShots[voice.onCameraShots.length - 1];
  const shots = voice.onCameraShots.length === 1 ? `shot ${last}` : `shots ${voice.onCameraShots.slice(0, -1).join(", ")} and ${last}`;
  return `one voice only: the presenter speaks on camera in ${shots} and the same voice continues off screen in the other shots`;
}

/** 旁白时间窗；卡上没写谁说话（voice = null）时与镜头卡初版逐字一致。 */
function speechTimingLine(segmentSec: number, voice: SegmentVoice | null = null): string {
  const end = Math.max(1, segmentSec - 1);
  return `SPEECH TIMING: ${speakerClause(voice)}; start the spoken line after the first half second and finish the complete line by ${end}s; never cut off mid-word, never repeat it, no second voice.`;
}

/** Kling 版（2500 字）只留一句：谁说、何时说完。 */
function klingSpeechLine(segmentSec: number, voice: SegmentVoice): string {
  return `SPEECH: ${speakerClause(voice)}; finish the whole line by ${Math.max(1, segmentSec - 1)}s and never repeat it.`;
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
