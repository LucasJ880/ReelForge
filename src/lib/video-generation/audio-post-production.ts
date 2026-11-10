import { captionMarginsFor } from "@/lib/video-generation/platform-safe-zone";

type AspectRatio = "9:16" | "16:9" | "1:1";
type CaptionPosition = "top" | "center" | "bottom";
type CaptionStyle = "word_by_word" | "karaoke" | "plain";

/** 一个词的时间戳（绝对毫秒）。Phase 1 还没有供应商来源；字段先定好，有了就能点亮逐词高亮。 */
export type CaptionWord = { text: string; startMs: number; endMs: number };

/** 字幕窗口（绝对毫秒）：一个 AI 段在成片里的起止 */
export type CaptionWindow = { startMs: number; endMs: number };

export type CaptionCue = {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  /** 逐词时间戳（绝对毫秒）；有它 karaoke / word_by_word 才是真高亮，没有就回退到整句 */
  words?: CaptionWord[];
};

export const BGM_TRACKS = [
  { id: "none", label: "无配乐", path: null },
  {
    id: "wholesome",
    label: "Wholesome",
    path: "scripts/assets/pet-kit-bgm.mp3",
    license: "CC BY 4.0",
    author: "Kevin MacLeod",
  },
] as const;

const MIN_READABLE_CUE_MS = 700;
const CJK_READABLE_GRAPHEMES = 18;
const LATIN_READABLE_GRAPHEMES = 42;

function isMostlyCjk(value: string): boolean {
  const graphemes = Array.from(value);
  if (graphemes.length === 0) return false;
  const cjk = graphemes.filter((character) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      character,
    ),
  ).length;
  return cjk / graphemes.length >= 0.3;
}

/** 强断点（短语边界）：切在这些标点之后，观感是完整语组而不是词组腰斩 */
const STRONG_BREAK = /[，,、:：；;]/u;

function splitLongSentence(sentence: string): string[] {
  const graphemes = Array.from(sentence);
  const limit = isMostlyCjk(sentence)
    ? CJK_READABLE_GRAPHEMES
    : LATIN_READABLE_GRAPHEMES;
  if (graphemes.length <= limit) return [sentence];

  /// 断点优先级：窗口内先找强标点（允许略超上限 15%，语义边界值得多几个字），
  /// 找不到再退到空格，最后才硬切 —— 0804 验收里 “Custom blackout / curtains
  /// from …” 这种腰斩就是旧逻辑空格/逗号同权导致的。
  const strongOvershoot = Math.floor(limit * 0.15);
  const chunks: string[] = [];
  let cursor = 0;
  while (graphemes.length - cursor > limit) {
    const ideal = cursor + limit;
    const minimum = cursor + Math.max(1, Math.floor(limit * 0.55));
    const strongMax = Math.min(graphemes.length, ideal + strongOvershoot);
    let boundary = 0;
    for (let index = strongMax; index >= minimum; index--) {
      if (STRONG_BREAK.test(graphemes[index - 1] ?? "")) {
        boundary = index;
        break;
      }
    }
    if (boundary === 0) {
      for (let index = ideal; index >= minimum; index--) {
        if (/\s/u.test(graphemes[index - 1] ?? "")) {
          boundary = index;
          break;
        }
      }
    }
    if (boundary === 0) boundary = ideal;
    chunks.push(graphemes.slice(cursor, boundary).join(""));
    cursor = boundary;
  }
  if (cursor < graphemes.length) {
    chunks.push(graphemes.slice(cursor).join(""));
  }
  return chunks;
}

function readableChunks(script: string): string[] {
  const normalized = script.trim().replace(/\s+/gu, " ");
  if (!normalized) return [];
  /// 句边界：CJK 句末标点后零宽切；拉丁句末标点(.!?)只有后跟空白才算句界
  /// —— 既修掉 v1「ASCII 句号不算句界导致英文台词整段黏连」的问题，
  /// 又不会把 "3.5"/"$19.99" 这类小数点误切。
  const sentences = normalized
    .split(/(?<=[。！？；;])|(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences
    .flatMap(splitLongSentence)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

/** 合并相邻 cue 时的连接符：拉丁文之间补空格，CJK 直接相接 */
function joinChunks(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return isMostlyCjk(left + right) ? `${left}${right}` : `${left} ${right}`;
}

function mergeToDuration(chunks: string[], durationMs: number): string[] {
  const maximumCues = Math.max(1, Math.floor(durationMs / MIN_READABLE_CUE_MS));
  const merged = [...chunks];
  while (merged.length > maximumCues) {
    let shortestIndex = 0;
    for (let index = 1; index < merged.length; index++) {
      if (
        Array.from(merged[index]).length <
        Array.from(merged[shortestIndex]).length
      ) {
        shortestIndex = index;
      }
    }
    if (shortestIndex === merged.length - 1) {
      merged[shortestIndex - 1] = joinChunks(
        merged[shortestIndex - 1],
        merged[shortestIndex],
      );
      merged.splice(shortestIndex, 1);
    } else {
      merged[shortestIndex] = joinChunks(
        merged[shortestIndex],
        merged[shortestIndex + 1],
      );
      merged.splice(shortestIndex + 1, 1);
    }
  }
  return merged;
}

function readableWeight(text: string): number {
  const cjkCount = Array.from(text).filter((character) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      character,
    ),
  ).length;
  const latinWords = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const punctuation = text.match(/[。！？!?；;，,、:：]/gu)?.length ?? 0;
  return Math.max(1, cjkCount + latinWords * 2 + punctuation * 0.35);
}

/**
 * 把已断好的可读短句铺进一个时间窗：每句至少 MIN_READABLE_CUE_MS（窗太短则等分），
 * 余量按字重分配；最后一句吸收取整误差，恰好铺到 endMs。
 */
function allocateCuesInWindow(
  chunks: string[],
  startMs: number,
  endMs: number,
  indexFrom: number,
): CaptionCue[] {
  const durationMs = Math.max(1, endMs - startMs);
  const merged = mergeToDuration(chunks, durationMs);
  const minimumMs = Math.max(
    1,
    Math.min(MIN_READABLE_CUE_MS, Math.floor(durationMs / merged.length)),
  );
  const distributableMs = durationMs - minimumMs * merged.length;
  const weights = merged.map(readableWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = startMs;
  return merged.map((text, index) => {
    const last = index === merged.length - 1;
    const allocated =
      minimumMs + Math.floor(distributableMs * (weights[index] / totalWeight));
    const cue: CaptionCue = {
      index: indexFrom + index,
      text,
      startMs: cursor,
      endMs: last ? endMs : cursor + allocated,
    };
    cursor = cue.endMs;
    return cue;
  });
}

/**
 * Build stable caption timings from the approved script and probed media
 * duration. No provider timestamps or guessed progress clocks are involved.
 * 整片一个窗口（没有 AI 段信息时的兜底：b-roll / 单段 / 旧数据）。
 */
export function buildDeterministicCues(
  script: string,
  durationSec: number,
): CaptionCue[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Caption duration must be a positive finite number");
  }
  const durationMs = Math.max(1, Math.round(durationSec * 1_000));
  const sourceChunks = readableChunks(script);
  if (sourceChunks.length === 0) return [];
  return allocateCuesInWindow(sourceChunks, 0, durationMs, 1);
}

/**
 * P04-B：按 AI 段窗口铺字幕，而不是在整片里均分——每段只背自己那句台词，
 * 段内再按字重均分。这是没有逐词时间戳时的默认路径。
 * chunks[i] 对应 windows[i]（多出来的 chunk 并进最后一个窗；缺的窗不出字幕）。
 * 任何 cue 都不跨窗。
 */
export function buildWindowedCues(
  chunks: string[],
  windows: CaptionWindow[],
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  windows.forEach((window, index) => {
    if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.endMs <= window.startMs) {
      throw new Error(`Caption window #${index} must end after it starts`);
    }
    const text =
      index === windows.length - 1
        ? chunks.slice(index).reduce((left, right) => joinChunks(left, right), "")
        : (chunks[index] ?? "");
    const readable = readableChunks(text);
    if (readable.length === 0) return;
    cues.push(
      ...allocateCuesInWindow(readable, window.startMs, window.endMs, cues.length + 1),
    );
  });
  return cues;
}

function nearestSpeechBoundary(
  graphemes: string[],
  ideal: number,
  min: number,
  max: number,
): number {
  const isBoundary = (index: number) =>
    /[。！？!?；;，,\s]/u.test(graphemes[index - 1] ?? "");
  for (let offset = 0; offset <= Math.max(ideal - min, max - ideal); offset++) {
    const after = ideal + offset;
    if (after >= min && after <= max && isBoundary(after)) return after;
    const before = ideal - offset;
    if (before >= min && before <= max && isBoundary(before)) return before;
  }
  return Math.min(max, Math.max(min, ideal));
}

/**
 * 把整篇口播稿按各段时长加权切成每段一句（在语句边界切，拼回去逐字相等）。
 * 与 prompt-intelligence.splitVoiceoverScript 是同一规则——派发时每段被要求念的就是这一句，
 * 字幕回退路径必须切出同样的结果才对得上口型；拼接器 / runner 不能 import 那边（LLM 依赖），
 * 所以这里保留一份，tests/unified-audio-contract.test.ts 锁住两边一致。
 * 传**计划**时长（不是裁尾后的实测）：实测不等长会让 nearestSpeechBoundary 吸到别的边界。
 */
export function splitScriptByDurations(
  script: string,
  durationsSec: ReadonlyArray<number>,
): string[] {
  const segmentCount = durationsSec.length;
  if (segmentCount <= 0) return [];
  const graphemes = Array.from(script.trim());
  if (graphemes.length === 0) return Array.from({ length: segmentCount }, () => "");
  const weights = durationsSec.map((durationSec) =>
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1,
  );
  const chunks: string[] = [];
  let cursor = 0;
  for (let index = 0; index < segmentCount; index++) {
    if (index === segmentCount - 1) {
      chunks.push(graphemes.slice(cursor).join(""));
      break;
    }
    const remainingSegments = segmentCount - index;
    const remainingWeight = weights
      .slice(index)
      .reduce((sum, weight) => sum + weight, 0);
    const ideal =
      cursor +
      Math.round((graphemes.length - cursor) * (weights[index] / remainingWeight));
    const minimum = Math.min(graphemes.length, cursor + 1);
    const maximum = Math.max(minimum, graphemes.length - (remainingSegments - 1));
    const boundary = nearestSpeechBoundary(graphemes, ideal, minimum, maximum);
    chunks.push(graphemes.slice(cursor, boundary).join(""));
    cursor = boundary;
  }
  while (chunks.length < segmentCount) chunks.push("");
  return chunks;
}

/** 同上，权重取窗口跨度。 */
export function splitScriptByWindows(
  script: string,
  windows: ReadonlyArray<{ startMs: number; endMs: number }>,
): string[] {
  return splitScriptByDurations(
    script,
    windows.map((window) => (window.endMs - window.startMs) / 1_000),
  );
}

/**
 * 段序列 → 字幕窗口（绝对毫秒）：按顺序累计偏移，只给 captioned 的段开窗，
 * 并裁到 maxEndMs（字幕窗口 = 主片时长，尾卡不背字幕）。
 */
export function captionWindowsFromSegments(
  segments: ReadonlyArray<{ durationSec: number; captioned: boolean }>,
  maxEndMs?: number,
): CaptionWindow[] {
  const windows: CaptionWindow[] = [];
  let cursorMs = 0;
  for (const segment of segments) {
    const durationMs = Math.max(0, Math.round(segment.durationSec * 1_000));
    const startMs = cursorMs;
    cursorMs += durationMs;
    if (!segment.captioned) continue;
    const endMs =
      maxEndMs !== undefined && Number.isFinite(maxEndMs) ? Math.min(cursorMs, maxEndMs) : cursorMs;
    if (endMs > startMs) windows.push({ startMs, endMs });
  }
  return windows;
}

export type CaptionPlanSegment = {
  /** 成片里的实测（已量化）时长：只用来放窗口位置 */
  durationSec: number;
  /** 背字幕的段（AI 口播段）；上传片段 / 尾卡 / b-roll 为 false */
  captioned: boolean;
  /** 计划时长（段计划里的 toSec-fromSec）；没有持久化台词时按它切，不按裁尾后的实测 */
  plannedDurationSec?: number | null;
};

/**
 * 纯函数（P04-B / P04-C）：字幕时间轴怎么定。进程内合成器与 runner 共用这一个。
 *   1. 有背字幕的段 → 每段一个窗口（位置按实测时长累计，裁到字幕窗口）。台词优先用派发时持久化的
 *      voiceoverChunks（与各段数量一致才用——它就是每段被要求念的那句）；旧数据没有 chunk 时按
 *      **计划**时长重切（同一规则），裁尾造成的实测不等长不会把边界吸偏。
 *   2. 没有背字幕的段（b-roll / 全是上传片段）→ 整片按字重均分（1025 之前的行为）。
 *   0.（2026-11-10）调用方给了语音识别的时间（speechWords）且对得上口播稿 → 字幕跟着人声走，上面两条都不用。
 */
export function planCaptionCues(args: {
  script: string;
  segments: ReadonlyArray<CaptionPlanSegment>;
  captionSpanSec: number;
  voiceoverChunks?: ReadonlyArray<string> | null;
  /**
   * 成片里实际语音的逐字 / 逐词时间（相对成片开头）。给了、且和口播稿对得上，字幕就跟着人声走（source = "speech"）；
   * 没给或对不上（alignCuesToSpeech 返回 null），照旧走下面按字数摊的三条路。
   */
  speechWords?: ReadonlyArray<SpokenWord> | null;
}): { cues: CaptionCue[]; source: "speech" | "chunks" | "planned" | "uniform" } {
  const captionSpanMs = Math.max(1, Math.round(args.captionSpanSec * 1_000));
  if (args.speechWords && args.speechWords.length > 0) {
    const aligned = alignCuesToSpeech(args.script, args.speechWords, { spanMs: captionSpanMs });
    if (aligned) return { cues: aligned.cues, source: "speech" };
  }
  const windows = captionWindowsFromSegments(args.segments, captionSpanMs);
  if (windows.length === 0) {
    return { cues: buildDeterministicCues(args.script, args.captionSpanSec), source: "uniform" };
  }
  const captioned = args.segments.filter((segment) => segment.captioned);
  const chunks = args.voiceoverChunks;
  if (chunks && chunks.length === captioned.length) {
    return { cues: buildWindowedCues(chunks.slice(0, windows.length), windows), source: "chunks" };
  }
  const plannedDurations = captioned.slice(0, windows.length).map((segment) =>
    segment.plannedDurationSec && segment.plannedDurationSec > 0
      ? segment.plannedDurationSec
      : segment.durationSec,
  );
  return {
    cues: buildWindowedCues(splitScriptByDurations(args.script, plannedDurations), windows),
    source: "planned",
  };
}

function hasCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    value,
  );
}

/** 两个相邻词之间的连接符：任一侧含 CJK 直接相接，否则空格；都没有字母时听 language 提示 */
function wordSeparator(left: string, right: string, cjkHint: boolean | null): string {
  if (hasCjk(left) || hasCjk(right)) return "";
  if (!/\p{L}/u.test(left + right) && cjkHint) return "";
  return " ";
}

function joinWords(words: ReadonlyArray<CaptionWord>, cjkHint: boolean | null): string {
  return words.reduce(
    (text, word, index) =>
      index === 0 ? word.text : `${text}${wordSeparator(words[index - 1].text, word.text, cjkHint)}${word.text}`,
    "",
  );
}

function countNonSpaceGraphemes(value: string): number {
  return Array.from(value).filter((character) => !/\s/u.test(character)).length;
}

function readableLimit(text: string): number {
  return isMostlyCjk(text) ? CJK_READABLE_GRAPHEMES : LATIN_READABLE_GRAPHEMES;
}

/**
 * P04-B：有逐词时间戳时，按 readableChunks 同一套断句规则把词分组成 cue，
 * cue 起止取组内首词 / 末词的真实时间。词永不被切开：断句边界落在词中间时整词归前一句。
 * 短于 MIN_READABLE_CUE_MS 的组并进前一句（只要并完仍在可读字数内），避免闪字。
 */
export function buildTimedCues(
  words: ReadonlyArray<CaptionWord>,
  options: { maxEndMs?: number; language?: string } = {},
): CaptionCue[] {
  const cjkHint = options.language ? /^(zh|ja|ko)/iu.test(options.language) : null;
  const maxEndMs =
    options.maxEndMs !== undefined && Number.isFinite(options.maxEndMs) && options.maxEndMs > 0
      ? options.maxEndMs
      : null;
  const sorted = words
    .map((word) => ({
      text: word.text.trim(),
      startMs: Math.round(word.startMs),
      endMs: Math.round(word.endMs),
    }))
    .filter(
      (word) =>
        word.text.length > 0 &&
        Number.isFinite(word.startMs) &&
        Number.isFinite(word.endMs) &&
        word.endMs >= word.startMs &&
        word.startMs >= 0 &&
        (maxEndMs === null || word.startMs < maxEndMs),
    )
    .map((word) => ({
      ...word,
      endMs: maxEndMs === null ? word.endMs : Math.min(word.endMs, maxEndMs),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  /// 只有标点的 token（供应商常把「，」「.」单独给）直接贴到前一个词上，不占独立的高亮段、不加空格
  const clean: CaptionWord[] = [];
  for (const word of sorted) {
    const previous = clean[clean.length - 1];
    if (previous && !/[\p{L}\p{N}]/u.test(word.text)) {
      previous.text = `${previous.text}${word.text}`;
      previous.endMs = Math.max(previous.endMs, word.endMs);
      continue;
    }
    clean.push({ ...word });
  }
  if (clean.length === 0) return [];

  const chunks = readableChunks(joinWords(clean, cjkHint));
  const groups: CaptionWord[][] = [];
  let wordCursor = 0;
  let consumedGraphemes = 0;
  let targetGraphemes = 0;
  for (const chunk of chunks) {
    targetGraphemes += countNonSpaceGraphemes(chunk);
    const group: CaptionWord[] = [];
    while (wordCursor < clean.length && consumedGraphemes < targetGraphemes) {
      const word = clean[wordCursor++];
      group.push(word);
      consumedGraphemes += countNonSpaceGraphemes(word.text);
    }
    if (group.length > 0) groups.push(group);
  }
  if (wordCursor < clean.length) groups.push(clean.slice(wordCursor));

  /// 太短的组并进前一句（并完仍可读才并）
  const merged: CaptionWord[][] = [];
  for (const group of groups) {
    const previous = merged[merged.length - 1];
    const spanMs = Math.max(...group.map((word) => word.endMs)) - group[0].startMs;
    if (previous && spanMs < MIN_READABLE_CUE_MS) {
      const combined = joinWords([...previous, ...group], cjkHint);
      if (countNonSpaceGraphemes(combined) <= readableLimit(combined)) {
        previous.push(...group);
        continue;
      }
    }
    merged.push([...group]);
  }

  const cues: CaptionCue[] = merged.map((group, index) => ({
    index: index + 1,
    text: joinWords(group, cjkHint),
    startMs: group[0].startMs,
    endMs: Math.max(...group.map((word) => word.endMs)),
    words: group,
  }));
  /// 相邻 cue 不重叠：上一句最晚只到下一句开口（供应商给的词尾常拖过下一词的起点）
  for (let index = 0; index + 1 < cues.length; index++) {
    const nextStart = cues[index + 1].startMs;
    cues[index].endMs = Math.min(cues[index].endMs, Math.max(cues[index].startMs + 1, nextStart));
  }
  return cues;
}

/* ── 按真实语音对齐（2026-11-10）──────────────────────────────────────────
 *
 * 没有时间戳时，字幕只能把口播稿按字数摊满整段（planCaptionCues 的 chunks / planned / uniform 三条路）。
 * 可出片模型不会匀速把话说满一整段：实测 6 条 15 秒成片，两句口播常在 7–10 秒内说完，
 * 第二句字幕却要等到 6–10 秒才换上去——人声说完了，字幕还停在上一句（6 条里 5 条偏晚，平均差约 2 秒）。
 *
 * 这里吃语音识别给的逐字 / 逐词时间，把口播稿的每一句对到它真正被说出来的那一段：
 *   - 字幕的字以口播稿为准。识别会写错字（抿→米、变→遍）、会出繁体，所以识别结果只拿来取时间；
 *     两边按「字 / 词」做最长公共子序列，对得上的才算数，对不上的字按同一句里的语速外推。
 *   - 一句都没对上的句子夹在前后两句之间；对上的字不到一半就整体放弃（返回 null，调用方照旧按字数摊）。
 *   - 字幕比人声早一点点出现、说完多留一会儿；两句离得近就直接接上，不闪。
 * 纯函数：识别从哪来（哪家接口、还是本机 whisper）由调用方决定。
 */

/** 语音识别出的一个字 / 词及其起止时间（毫秒，相对成片开头）。 */
export type SpokenWord = CaptionWord;

/** 字幕比人声早出现这么多：读的人需要一点预备 */
const SPEECH_LEAD_MS = 120;
/** 一句说完之后字幕多留这么久 */
const SPEECH_LINGER_MS = 500;
/** 上一句字幕收掉、下一句还没出，中间空得比这短就直接接上，不闪一下 */
const SPEECH_BRIDGE_MS = 700;
/** 对上的字不到这个比例：识别不可信（背景声太大 / 说的不是这份稿），放弃对齐 */
const SPEECH_MIN_COVERAGE = 0.5;
/** 估不出语速时每个字 / 词按这么长算 */
const SPEECH_FALLBACK_UNIT_MS = 250;

const CJK_UNIT = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const ALIGNMENT_UNIT = new RegExp(`[${CJK_UNIT}]|(?:(?![${CJK_UNIT}])[\\p{L}\\p{N}])+`, "gu");

/** 对齐单位：中日韩一字一个，其它文字一词一个；不分大小写、全半角。标点与空白不参与。 */
function alignmentUnits(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(ALIGNMENT_UNIT) ?? [];
}

function longestCommonSubsequence(left: string[], right: string[]): Array<[number, number]> {
  const rows = left.length;
  const cols = right.length;
  const table: Uint16Array[] = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      table[row][col] =
        left[row] === right[col]
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (left[row] === right[col]) {
      pairs.push([row, col]);
      row++;
      col++;
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      row++;
    } else {
      col++;
    }
  }
  return pairs;
}

export function alignCuesToSpeech(
  script: string,
  words: ReadonlyArray<SpokenWord>,
  options: { spanMs: number; minCoverage?: number },
): { cues: CaptionCue[]; coverage: number } | null {
  const spanMs = Math.round(options.spanMs);
  if (!Number.isFinite(spanMs) || spanMs <= 0) return null;
  const chunks = readableChunks(script);
  if (chunks.length === 0) return null;

  /// 口播稿侧：每个单位记下属于第几句
  const scriptUnits: Array<{ key: string; chunk: number }> = [];
  chunks.forEach((chunk, index) => {
    for (const key of alignmentUnits(chunk)) scriptUnits.push({ key, chunk: index });
  });
  if (scriptUnits.length === 0) return null;

  /// 识别侧：一个词里有多个单位（英文短语、几个汉字并成一个 token）时，时间在词内均分
  const spoken: Array<{ key: string; startMs: number; endMs: number }> = [];
  for (const word of [...words].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)) continue;
    if (word.startMs < 0 || word.endMs < word.startMs || word.startMs >= spanMs) continue;
    const keys = alignmentUnits(word.text);
    if (keys.length === 0) continue;
    const endMs = Math.min(word.endMs, spanMs);
    const step = (endMs - word.startMs) / keys.length;
    keys.forEach((key, index) => {
      spoken.push({
        key,
        startMs: Math.round(word.startMs + step * index),
        endMs: Math.round(word.startMs + step * (index + 1)),
      });
    });
  }
  if (spoken.length === 0) return null;

  const pairs = longestCommonSubsequence(
    scriptUnits.map((unit) => unit.key),
    spoken.map((unit) => unit.key),
  );
  const coverage = pairs.length / scriptUnits.length;
  if (coverage < (options.minCoverage ?? SPEECH_MIN_COVERAGE)) return null;

  /// 每一句被说出来的时段：首尾对上的字定位置，句首 / 句尾没对上的字按这一句的语速外推
  const firstUnitOfChunk: number[] = [];
  scriptUnits.forEach((unit, index) => {
    if (firstUnitOfChunk[unit.chunk] === undefined) firstUnitOfChunk[unit.chunk] = index;
  });
  const unitCountOfChunk = chunks.map(
    (_, index) => scriptUnits.filter((unit) => unit.chunk === index).length,
  );
  const spans: Array<{ startMs: number; endMs: number } | null> = chunks.map(() => null);
  chunks.forEach((_, chunk) => {
    const matched = pairs.filter(([unitIndex]) => scriptUnits[unitIndex].chunk === chunk);
    if (matched.length === 0) return;
    const [firstUnit, firstSpoken] = matched[0];
    const [lastUnit, lastSpoken] = matched[matched.length - 1];
    const heardMs = spoken[lastSpoken].endMs - spoken[firstSpoken].startMs;
    const unitMs =
      matched.length >= 2 && heardMs > 0
        ? heardMs / (lastUnit - firstUnit + 1)
        : SPEECH_FALLBACK_UNIT_MS;
    const leading = firstUnit - firstUnitOfChunk[chunk];
    const trailing = firstUnitOfChunk[chunk] + unitCountOfChunk[chunk] - 1 - lastUnit;
    spans[chunk] = {
      startMs: spoken[firstSpoken].startMs - leading * unitMs,
      endMs: spoken[lastSpoken].endMs + trailing * unitMs,
    };
  });

  /// 一个字都没对上的句子：夹在前后两句之间，连着几句就按字数分这段空档
  for (let chunk = 0; chunk < spans.length; chunk++) {
    if (spans[chunk]) continue;
    let next = chunk;
    while (next < spans.length && !spans[next]) next++;
    const gapStart = chunk > 0 ? (spans[chunk - 1] as { endMs: number }).endMs : 0;
    const gapEnd = next < spans.length ? (spans[next] as { startMs: number }).startMs : spanMs;
    const weights = chunks.slice(chunk, next).map(readableWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = gapStart;
    for (let index = chunk; index < next; index++) {
      const share = (Math.max(0, gapEnd - gapStart) * weights[index - chunk]) / totalWeight;
      spans[index] = { startMs: cursor, endMs: cursor + share };
      cursor += share;
    }
    chunk = next - 1;
  }

  /// 时段 → 字幕：早一点出现、说完多留一会儿；不重叠、不倒退、不出界
  const cues: CaptionCue[] = [];
  let previousStart = -1;
  spans.forEach((span, index) => {
    const { startMs, endMs } = span as { startMs: number; endMs: number };
    const cueStart = Math.min(
      Math.max(0, previousStart + 1, Math.round(startMs) - SPEECH_LEAD_MS),
      Math.max(0, spanMs - 1),
    );
    previousStart = cueStart;
    cues.push({
      index: index + 1,
      text: chunks[index],
      startMs: cueStart,
      endMs: Math.round(endMs) + SPEECH_LINGER_MS,
    });
  });
  cues.forEach((cue, index) => {
    const limit = index + 1 < cues.length ? cues[index + 1].startMs : spanMs;
    const readable = Math.max(cue.endMs, cue.startMs + MIN_READABLE_CUE_MS);
    cue.endMs = Math.max(cue.startMs + 1, Math.min(limit, readable));
    if (index + 1 < cues.length && limit - cue.endMs < SPEECH_BRIDGE_MS) cue.endMs = Math.max(cue.endMs, limit);
  });
  return { cues, coverage };
}

function srtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
    .concat(",", String(millis).padStart(3, "0"));
}

export function renderSrtCaptions(cues: CaptionCue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.index}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}`,
    )
    .join("\n\n")
    .concat(cues.length > 0 ? "\n" : "");
}

function assTimestampFromCs(centiseconds: number): string {
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const remainder = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(2, "0")}`;
}

function assTimestamp(ms: number): string {
  return assTimestampFromCs(Math.floor(ms / 10));
}

function escapeAssText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/\r?\n/gu, "\\N");
}

function assResolution(aspectRatio: AspectRatio) {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function assAlignment(position: CaptionPosition): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

/**
 * 字幕字体 = 打包的 Noto Sans SC 的真实 family 名（必须等于 media-fonts 的 CJK_FONT_FAMILY）。
 * 1025 真机验收：原来写「Noto Sans CJK SC」，Linux 靠 fontconfig 别名碰巧对上；macOS 的 libass
 * 走 CoreText 不读 fontconfig，fontsdir 里的字体按 family 名匹配不上，回退 Helvetica，中文全成豆腐块。
 * 本模块保持纯函数（客户端也会间接读到），所以这里写字面量，由测试锁住与常量一致。
 */
export const CAPTION_FONT_FAMILY = "Noto Sans SC";

/** 赢家金（样式表里是 AABBGGRR；行内 \1c 覆盖写 &HBBGGRR&）：当前词 / 已念过的词 */
const ASS_GOLD = "&H0000D7FF";
const ASS_GOLD_INLINE = "&H00D7FF&";
const ASS_WHITE = "&H00FFFFFF";

function assTimeCs(ms: number): number {
  return Math.floor(ms / 10);
}

/**
 * karaoke：一条 Dialogue，每个词前缀 {\kf<厘秒>}。\kf 的语义是「未念 = SecondaryColour、
 * 念过 = PrimaryColour、念到哪填到哪」，所以 Karaoke 样式 Primary=金、Secondary=白。
 * 各词厘秒合计恰好等于 cue 时长（按与 Dialogue 时间戳相同的向下取整算）。
 */
function karaokeDialogue(cue: CaptionCue, words: ReadonlyArray<CaptionWord>, cjkHint: boolean | null): string {
  const startCs = assTimeCs(cue.startMs);
  const totalCs = Math.max(1, assTimeCs(cue.endMs) - startCs);
  const boundaries: number[] = [];
  for (const [index, word] of words.entries()) {
    const raw = Math.min(totalCs, Math.max(0, assTimeCs(word.startMs) - startCs));
    boundaries.push(index === 0 ? raw : Math.max(raw, boundaries[index - 1]));
  }
  let text = boundaries[0] > 0 ? `{\\kf${boundaries[0]}}` : "";
  words.forEach((word, index) => {
    const next = index + 1 < words.length ? boundaries[index + 1] : totalCs;
    const durationCs = Math.max(0, next - boundaries[index]);
    const separator = index === 0 ? "" : wordSeparator(words[index - 1].text, word.text, cjkHint);
    text += `${separator}{\\kf${durationCs}}${escapeAssText(word.text)}`;
  });
  return `Dialogue: 0,${assTimestamp(cue.startMs)},${assTimestamp(cue.endMs)},Karaoke,,0,0,0,,${text}`;
}

/** word_by_word：每个词一条 Dialogue，整句都在、只有当前词是金色（{\r} 回到样式默认色） */
function wordByWordDialogues(cue: CaptionCue, words: ReadonlyArray<CaptionWord>, cjkHint: boolean | null): string[] {
  const line = (highlight: number | null) =>
    words
      .map((word, index) => {
        const separator = index === 0 ? "" : wordSeparator(words[index - 1].text, word.text, cjkHint);
        const escaped = escapeAssText(word.text);
        return `${separator}${index === highlight ? `{\\1c${ASS_GOLD_INLINE}}${escaped}{\\r}` : escaped}`;
      })
      .join("");
  const dialogue = (startCs: number, endCs: number, text: string) =>
    `Dialogue: 0,${assTimestampFromCs(startCs)},${assTimestampFromCs(endCs)},Captions,,0,0,0,,${text}`;
  const events: string[] = [];
  const cueStartCs = assTimeCs(cue.startMs);
  const cueEndCs = Math.max(cueStartCs + 1, assTimeCs(cue.endMs));
  const firstStartCs = Math.max(cueStartCs, assTimeCs(words[0].startMs));
  if (firstStartCs > cueStartCs) events.push(dialogue(cueStartCs, firstStartCs, line(null)));
  let cursorCs = firstStartCs;
  words.forEach((word, index) => {
    const startCs = Math.max(cursorCs, assTimeCs(word.startMs));
    const nextCs = index + 1 < words.length ? assTimeCs(words[index + 1].startMs) : cueEndCs;
    /// 同一厘秒起点的词也至少亮 1cs——零长的 Dialogue 等于这个词从没被高亮过
    const endCs = Math.max(startCs + 1, nextCs);
    events.push(dialogue(startCs, endCs, line(index)));
    cursorCs = endCs;
  });
  return events;
}

export function renderAssCaptions(
  cues: CaptionCue[],
  options: {
    aspectRatio: AspectRatio;
    position: CaptionPosition;
    style: CaptionStyle;
    /** 口播 / 字幕语言（如 zh-CN）：写进 Script Info，并在词与词之间都没有字母时决定是否留空格 */
    language?: string;
    /** 目标平台：有界面安全区的平台（抖音）字幕让开底部文案区与右侧按钮列；不传 = 原边距 */
    platform?: string | null;
  },
): string {
  const resolution = assResolution(options.aspectRatio);
  const fontSize = options.aspectRatio === "9:16" ? 58 : 48;
  const outline = options.style === "plain" ? 2 : 4;
  const bold = options.style === "plain" ? 0 : -1;
  /// 平台安全区只改边距；没有专门规则的平台输出与之前逐字节一致
  const safeMargins = captionMarginsFor({
    platform: options.platform,
    aspectRatio: options.aspectRatio,
    width: resolution.width,
    height: resolution.height,
    position: options.position,
  });
  const marginL = safeMargins?.marginL ?? 80;
  const marginR = safeMargins?.marginR ?? 80;
  const marginV = safeMargins?.marginV ?? (options.aspectRatio === "9:16" ? 150 : 90);
  const alignment = assAlignment(options.position);
  const language = options.language?.trim().replace(/[\r\n]+/gu, " ");
  const cjkHint = language ? /^(zh|ja|ko)/iu.test(language) : null;
  /// 逐词渲染的门槛：样式不是 plain，且至少一个 cue 真带逐词时间戳。
  /// 不满足就整句渲染，输出与 1025 之前**逐字节一致**（不多一个 Style、不多一行注释）。
  const timedWords = (cue: CaptionCue) =>
    cue.words?.filter((word) => word.text.trim().length > 0) ?? [];
  const karaoke =
    options.style === "karaoke" && cues.some((cue) => timedWords(cue).length > 0);
  const header = `[Script Info]
ScriptType: v4.00+${karaoke && language ? `\n; Language: ${language}` : ""}
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Captions,${CAPTION_FONT_FAMILY},${fontSize},${ASS_WHITE},${ASS_GOLD},&H90000000,&H50000000,${bold},0,0,0,100,100,0,0,1,${outline},1,${alignment},${marginL},${marginR},${marginV},1${
    karaoke
      ? `\nStyle: Karaoke,${CAPTION_FONT_FAMILY},${fontSize},${ASS_GOLD},${ASS_WHITE},&H90000000,&H50000000,-1,0,0,0,100,100,0,0,1,4,1,${alignment},${marginL},${marginR},${marginV},1`
      : ""
  }

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = cues.flatMap((cue) => {
    const words = timedWords(cue);
    /// 没有逐词时间戳（Phase 1 的常态）或 plain：整句一条
    if (words.length === 0 || options.style === "plain") {
      return [
        `Dialogue: 0,${assTimestamp(cue.startMs)},${assTimestamp(cue.endMs)},Captions,,0,0,0,,${escapeAssText(cue.text)}`,
      ];
    }
    return options.style === "karaoke"
      ? [karaokeDialogue(cue, words, cjkHint)]
      : wordByWordDialogues(cue, words, cjkHint);
  });
  return `${header}\n${events.join("\n")}\n`;
}

function ffmpegNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/u, "");
}

export type AudioFilterPlan = {
  filterComplex: string;
  outputLabel: "[aout]" | null;
  bgmInputArgs: string[];
};

export function buildAudioFilterPlan(options: {
  bgmVolume: number;
  hasNativeAudio: boolean;
  durationSec?: number;
  sourceAudioInputIndex?: number;
  /**
   * 原生音轨来自滤镜图里的某个标签（如单遍合成里 concat 出来的 "[acat]"），
   * 而不是某个输入文件的音频流。给了就优先于 sourceAudioInputIndex。
   */
  sourceAudioLabel?: string;
  bgmInputIndex?: number;
}): AudioFilterPlan {
  const volume = Math.min(0.35, Math.max(0, options.bgmVolume));
  const hasBgm = volume > 0;
  const sourceIndex = options.sourceAudioInputIndex ?? 0;
  const source = options.sourceAudioLabel ?? `[${sourceIndex}:a]`;
  const bgmIndex = options.bgmInputIndex ?? 1;
  const trim =
    options.durationSec && options.durationSec > 0
      ? `,atrim=end=${ffmpegNumber(options.durationSec)}`
      : "";
  const normalize = "loudnorm=I=-16:TP=-1.5:LRA=11";

  if (!hasBgm && !options.hasNativeAudio) {
    return { filterComplex: "", outputLabel: null, bgmInputArgs: [] };
  }
  if (!hasBgm) {
    return {
      filterComplex: `${source}${normalize}[aout]`,
      outputLabel: "[aout]",
      bgmInputArgs: [],
    };
  }

  const bgmChain = `[${bgmIndex}:a]volume=${ffmpegNumber(volume)}${trim},asetpts=PTS-STARTPTS[bgm]`;
  if (!options.hasNativeAudio) {
    return {
      filterComplex: `${bgmChain};[bgm]${normalize}[aout]`,
      outputLabel: "[aout]",
      bgmInputArgs: ["-stream_loop", "-1"],
    };
  }
  return {
    filterComplex: [
      `${source}asplit=2[voice_mix][voice_sidechain]`,
      bgmChain,
      "[bgm][voice_sidechain]sidechaincompress=threshold=0.035:ratio=8:attack=20:release=300[ducked_bgm]",
      `[voice_mix][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2,${normalize}[aout]`,
    ].join(";"),
    outputLabel: "[aout]",
    bgmInputArgs: ["-stream_loop", "-1"],
  };
}
