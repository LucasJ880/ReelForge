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
    totalDurationSec: number;
    fromSec: number;
    toSec: number;
    /// 该段的负面提示词：provider 会以 NEGATIVE_CONSTRAINTS_SEPARATOR 拼在正向提示词后面一起发，预算据此扣除
    negativePrompt?: string | null;
  },
): string {
  if (original.includes(STORYBOARD_GROUNDING_MARKER) || input.beats.length === 0) return original;
  const count = input.beats.length;
  const span = input.totalDurationSec / count;
  const segmentSec = Math.max(1, input.toSec - input.fromSec);
  const photos = input.productPhotoCount;
  const shots = input.beats
    .map((beat, index) => ({ index, from: index * span, to: (index + 1) * span, beat: beatWithoutTime(beat) }))
    .filter((shot) => shot.to > input.fromSec && shot.from < input.toSec)
    .map((shot) => {
      const from = Math.max(0, Math.round(shot.from - input.fromSec));
      const to = Math.min(segmentSec, Math.round(shot.to - input.fromSec));
      return `${from}-${to}s: recreate storyboard keyframe ${shot.index + 1} (reference image ${photos + shot.index + 1}) — ${shot.beat}.`;
    });
  const normalizedStory = input.story.replace(/\s+/gu, " ").trim();
  const photoRange = photos === 1 ? "image 1 is a real photo" : `images 1-${photos} are real photos`;
  const references = photos > 0
    ? `REFERENCE IMAGES: ${photoRange} of the product — match it exactly. Images ${photos + 1}-${photos + count} are the approved storyboard keyframes in story order — match their people, location, wardrobe, light and framing.`
    : `REFERENCE IMAGES: images 1-${count} are the approved storyboard keyframes in story order — match their people, location, wardrobe, light, framing and the product they show.`;
  const kept = original
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => KEEP_TEMPLATE_LINE.test(line))
    /// 模板默认室内；场景由故事板决定，环境声跟着场景走
    .map((line) => line.replace("subtle real room ambience", "subtle ambient sound that fits the location"));
  const assemble = (story: string) => [
    `${input.aspectRatio} short video, ${segmentSec}s, one continuous photorealistic story.`,
    `STORY (the merchant's own description; it decides who is on screen, where, and what happens): ${story}`,
    references,
    "",
    STORYBOARD_GROUNDING_MARKER,
    ...shots,
    "",
    ...kept,
  ].join("\n");
  const negative = input.negativePrompt?.trim() ?? "";
  const negativeTail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  const storyBudget = Math.max(
    0,
    Math.min(
      STORY_CHAR_BUDGET,
      VIDEO_PROMPT_LIMIT - VIDEO_PROMPT_SAFETY - negativeTail.length - assemble("").length,
    ),
  );
  // 与 provider 的 string.length 校验同用 UTF-16 单位；按码点 slice 会让 emoji 稿超限。
  return assemble(truncateStoryText(normalizedStory, storyBudget));
}
