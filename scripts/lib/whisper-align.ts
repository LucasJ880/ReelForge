/**
 * whisper 词级对齐（X-SCAF-3）：把成片实际语音的逐词起点与字幕（ASS cue）逐词起点做比对，
 * 输出 |偏差| 的 P50 / P95 与 150ms 门（PRD 核心轮 §7 P0-4）。
 *
 * 设计要点
 *  - 以 whisper.cpp 的 `-ojf`（full JSON）为输入：`transcription[].tokens[]` 每个 token 带
 *    `offsets {from,to}`（ms）与 `t_dtw`（10ms 单位；本机 whisper-cli 1.9.1 + ggml-small 实测
 *    `-dtw small` 仍回 -1，所以 t_dtw ≥ 0 时优先用它，否则退回 offsets.from）。
 *  - 中/日/韩：whisper 的多语 tokenizer 会把一个汉字拆成多个 UTF-8 字节片 token，也会把两个
 *    汉字合成一个 token。这里先把所有 token 的字节串接、按 UTF-8 边界切成「字」，跨 token 的字
 *    取首尾 token 的时间；同一 token 内的多个字按时长线性均分（估值，注释在 mergeWhisperTokens）。
 *  - 英文：`-sow` 让 whisper 按词切；仍以「带前导空格的 token 开新词」兜底把子词片拼回整词。
 *  - 字幕侧读 ASS `Dialogue:` 行；有 `{\kf}` / `{\k}` 等 karaoke 标签时按厘秒累加出逐词时间，
 *    没有时只有 cue 起点可测（cue 的第一个字/词带时间，其余只参与文本对齐）。
 *  - 对齐用 LCS（最长公共子序列），不用 DTW：两边都是离散文本单元，LCS 给出单调的 1:1 精确匹配，
 *    对不上的单元如实计入 unmatchedRatio，而不是被强行拉到最近的时间点。偏差只在
 *    「匹配成功 + 参考侧有已知起点」的对上计算。
 *
 * 本机命令示例（macOS，whisper-cli 1.9.1，模型 ~/.cache/whisper-cpp/ggml-small.bin）
 *   # 1) 抽 16k 单声道 wav（与 scripts/real-video-acceptance-30s.ts 同一套 ffmpeg 参数）
 *   ffmpeg -y -loglevel error -i final.mp4 -vn -ar 16000 -ac 1 -c:a pcm_s16le final.wav
 *   # 2) 中文：按字；英文加 -sow 按词
 *   whisper-cli -m ~/.cache/whisper-cpp/ggml-small.bin -f final.wav -l zh -ojf -dtw small -np -of final-words
 *   whisper-cli -m ~/.cache/whisper-cpp/ggml-small.bin -f final.wav -l en -ojf -dtw small -sow -np -of final-words
 *   # 3) 一步到位（抽音 → whisper → 读 ASS → 对齐报告；--json 输出完整 JSON）
 *   npx tsx scripts/lib/whisper-align.ts --media final.mp4 --ass final.ass --lang zh
 *   npx tsx scripts/lib/whisper-align.ts --wav final.wav --ass final.ass --lang en --json
 *
 * CI / 测试不依赖 whisper-cli：tests/whisper-word-alignment.test.ts 只测这里的纯函数。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** 一个 whisper token 的原始字节与时间（字节而不是字符：CJK 会被拆成 UTF-8 片）。 */
export interface RawWhisperToken {
  bytes: Uint8Array;
  startMs: number;
  endMs: number;
  /** `t_dtw` 换算成 ms；whisper 未计算时为 null。 */
  dtwMs?: number | null;
}

export interface WhisperWordsResult {
  text: string;
  words: TimedWord[];
  /** 起点时间来源：任一 token 有 t_dtw ≥ 0 即为 dtw，否则 offsets。 */
  timingSource: "dtw" | "offsets";
  jsonPath?: string;
}

export type WordScript = "cjk" | "latin";

export interface AssCue {
  startMs: number;
  endMs: number;
  text: string;
  /** 只有 Dialogue 文本带 karaoke 标签（\k \K \kf \ko）时才有。 */
  words?: TimedWord[];
}

/** 对齐单元：参考侧（字幕）允许起点未知（null），只参与文本匹配。 */
export interface AlignUnit {
  text: string;
  startMs: number | null;
  endMs?: number | null;
}

export interface AlignedPair {
  text: string;
  refStartMs: number;
  hypStartMs: number;
  /** |ref.start - hyp.start| */
  deltaMs: number;
}

export interface AlignmentReport {
  /** 参与偏差统计的对数（匹配成功且参考侧起点已知）。 */
  n: number;
  p50: number | null;
  p95: number | null;
  meanMs: number | null;
  maxMs: number | null;
  /** 参考侧「有起点」的单元中没有匹配上的比例。 */
  unmatchedRatio: number;
  /** P95 < thresholdMs（默认 150）。n = 0 时为 false。 */
  passes150ms: boolean;
  thresholdMs: number;
  refUnits: number;
  refTimedUnits: number;
  hypUnits: number;
  matchedUnits: number;
  /** 文本层面的匹配率：matchedUnits / refUnits（不看时间）。 */
  textMatchRatio: number;
  pairs: AlignedPair[];
}

// ---------------------------------------------------------------------------
// 文本单元切分（参考侧与转写侧共用，保证两边粒度一致）
// ---------------------------------------------------------------------------

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}'’]/u;
const SPECIAL_TOKEN = /^\[_[A-Za-z0-9_]+\]$/u;

/** zh / ja / ko / yue → cjk（不加 -sow，按字），其余 → latin（加 -sow，按词）。 */
export function wordScriptForLanguage(lang: string): WordScript {
  const code = lang.trim().toLowerCase().split(/[-_]/u)[0];
  return code === "zh" || code === "ja" || code === "ko" || code === "yue" ? "cjk" : "latin";
}

/** 对齐前的文本归一：NFKC、小写、去掉所有非字母数字（含全角标点）。 */
export function normalizeUnitText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 把一段文本切成对齐单元：每个 CJK 字各自一个单元；连续的其他字母/数字（含词内撇号）
 * 合成一个单元；空白与标点只做分隔。中英混排（"iPhone 15 分钟"）两边同一规则。
 */
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  let current = "";
  const flush = () => {
    const trimmed = current.replace(/^['’]+|['’]+$/gu, "");
    if (trimmed.length > 0) units.push(trimmed);
    current = "";
  };
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) {
      flush();
      units.push(ch);
    } else if (WORD_CHAR.test(ch)) {
      current += ch;
    } else {
      flush();
    }
  }
  flush();
  return units;
}

// ---------------------------------------------------------------------------
// whisper full JSON → token → 字/词
// ---------------------------------------------------------------------------

interface TimedChar {
  ch: string;
  startMs: number;
  endMs: number;
}

function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0; // 非法起始字节
}

function tokenStart(token: RawWhisperToken): number {
  return token.dtwMs !== null && token.dtwMs !== undefined && token.dtwMs >= 0
    ? token.dtwMs
    : token.startMs;
}

/**
 * 把 token 字节流解码成带时间的字符序列。
 * 跨 token 的字符：起点 = 首个字节所在 token 的起点，终点 = 末字节所在 token 的终点。
 * 完全落在同一 token 内的连续多个字符：按该 token 时长线性均分（估值——whisper 对
 * 「完全」这类双字 token 只给一个时间区间，没有更细的真值）。
 */
function decodeTimedChars(tokens: RawWhisperToken[]): TimedChar[] {
  const bytes: number[] = [];
  const owner: number[] = [];
  tokens.forEach((token, index) => {
    for (const byte of token.bytes) {
      bytes.push(byte);
      owner.push(index);
    }
  });

  interface PendingChar {
    ch: string;
    first: number;
    last: number;
  }
  const pending: PendingChar[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = utf8SequenceLength(bytes[i]);
    if (len === 0 || i + len > bytes.length) {
      i += 1; // 丢弃无法组成字符的孤立字节
      continue;
    }
    const slice = Buffer.from(bytes.slice(i, i + len));
    const ch = slice.toString("utf8");
    if (ch.includes("�")) {
      i += 1;
      continue;
    }
    pending.push({ ch, first: owner[i], last: owner[i + len - 1] });
    i += len;
  }

  const result: TimedChar[] = [];
  let cursor = 0;
  while (cursor < pending.length) {
    const head = pending[cursor];
    if (head.first !== head.last) {
      result.push({
        ch: head.ch,
        startMs: tokenStart(tokens[head.first]),
        endMs: Math.max(tokenStart(tokens[head.first]), tokens[head.last].endMs),
      });
      cursor += 1;
      continue;
    }
    // 同一 token 内的连续字符：收集一段，线性均分
    let end = cursor;
    while (
      end + 1 < pending.length &&
      pending[end + 1].first === head.first &&
      pending[end + 1].last === head.first
    ) {
      end += 1;
    }
    // 只在「会被读出来」的字符（CJK 字 / 字母数字）之间均分时长；前导空格、标点零时长，
    // 否则英文 token " Every" 的词首会被空格顶后约 1/6 个 token。
    const token = tokens[head.first];
    const start = tokenStart(token);
    const stop = Math.max(start, token.endMs);
    const run = pending.slice(cursor, end + 1);
    const spoken = run.filter((c) => CJK_CHAR.test(c.ch) || WORD_CHAR.test(c.ch)).length;
    let spokenIndex = 0;
    for (const c of run) {
      const isSpoken = CJK_CHAR.test(c.ch) || WORD_CHAR.test(c.ch);
      const from = Math.round(start + ((stop - start) * spokenIndex) / Math.max(1, spoken));
      const to = isSpoken
        ? Math.round(start + ((stop - start) * (spokenIndex + 1)) / Math.max(1, spoken))
        : from;
      result.push({ ch: c.ch, startMs: from, endMs: to });
      if (isSpoken) spokenIndex += 1;
    }
    cursor = end + 1;
  }
  return result;
}

/**
 * token → 对齐单元（字 / 词）。规则与 splitUnits 一致：CJK 字单字成词，其他字母数字连续成词，
 * 空白标点分隔。特殊 token（[_BEG_]、[_TT_xx]）跳过。中英同一规则，语言只决定是否传 -sow。
 */
export function mergeWhisperTokens(tokens: RawWhisperToken[]): TimedWord[] {
  const usable = tokens.filter((token) => {
    const text = Buffer.from(token.bytes).toString("utf8");
    return !SPECIAL_TOKEN.test(text.trim());
  });
  const chars = decodeTimedChars(usable);
  const words: TimedWord[] = [];
  let current: TimedChar[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((c) => c.ch).join("").replace(/^['’]+|['’]+$/gu, "");
    if (text.length > 0) {
      words.push({
        text,
        startMs: current[0].startMs,
        endMs: Math.max(current[0].startMs, current[current.length - 1].endMs),
      });
    }
    current = [];
  };
  for (const c of chars) {
    if (CJK_CHAR.test(c.ch)) {
      flush();
      words.push({ text: c.ch, startMs: c.startMs, endMs: Math.max(c.startMs, c.endMs) });
    } else if (WORD_CHAR.test(c.ch)) {
      current.push(c);
    } else {
      flush();
    }
  }
  flush();
  return words;
}

interface WhisperFullJson {
  transcription?: Array<{
    text?: string;
    offsets?: { from: number; to: number };
    tokens?: Array<{
      text?: string;
      offsets?: { from: number; to: number };
      t_dtw?: number;
    }>;
  }>;
}

/**
 * 读 whisper `-ojf` 输出。whisper.cpp 把 token 文本原样写进 JSON，CJK 字节片 token 会让文件
 * 不是合法 UTF-8；所以按 latin1 读（每个字节一个字符，JSON 结构字符全是 ASCII 不受影响），
 * 解析后再把每个 token 文本转回字节，由 mergeWhisperTokens 跨 token 拼回完整字符。
 */
export function parseWhisperFullJson(raw: Buffer | string): {
  text: string;
  tokens: RawWhisperToken[];
  timingSource: "dtw" | "offsets";
} {
  const latin1 = typeof raw === "string" ? raw : raw.toString("latin1");
  const payload = JSON.parse(latin1) as WhisperFullJson;
  const tokens: RawWhisperToken[] = [];
  const textParts: string[] = [];
  let sawDtw = false;
  for (const segment of payload.transcription ?? []) {
    if (segment.text) {
      textParts.push(Buffer.from(segment.text, "latin1").toString("utf8").trim());
    }
    for (const token of segment.tokens ?? []) {
      const from = token.offsets?.from ?? segment.offsets?.from ?? 0;
      const to = token.offsets?.to ?? from;
      const dtwMs =
        typeof token.t_dtw === "number" && token.t_dtw >= 0 ? token.t_dtw * 10 : null;
      if (dtwMs !== null) sawDtw = true;
      tokens.push({
        bytes: Buffer.from(token.text ?? "", "latin1"),
        startMs: from,
        endMs: Math.max(from, to),
        dtwMs,
      });
    }
  }
  return {
    text: textParts.filter((part) => part.length > 0).join(" "),
    tokens,
    timingSource: sawDtw ? "dtw" : "offsets",
  };
}

// ---------------------------------------------------------------------------
// 外部进程：ffmpeg 抽音、whisper-cli 转写
// ---------------------------------------------------------------------------

export const DEFAULT_WHISPER_MODEL =
  process.env.WHISPER_MODEL?.trim() ||
  resolve(process.env.HOME ?? "~", ".cache/whisper-cpp/ggml-small.bin");

export const DEFAULT_WHISPER_BIN = process.env.WHISPER_CLI?.trim() || "whisper-cli";

/** 与 scripts/real-video-acceptance-30s.ts 同一套参数：whisper.cpp 需要 16k 单声道 PCM。 */
export function extractWhisperWav(
  mediaPath: string,
  wavPath: string,
  opts: { ffmpeg?: string } = {},
): string {
  execFileSync(opts.ffmpeg ?? "ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", mediaPath,
    "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
    wavPath,
  ]);
  return wavPath;
}

/** 由模型文件名推 `-dtw` 预设（ggml-small.bin → small，ggml-large-v3.bin → large.v3）。 */
export function dtwPresetForModel(modelPath: string): string {
  const match = /ggml-([a-z]+(?:\.en)?(?:-v\d(?:-turbo)?)?)/u.exec(basename(modelPath));
  if (!match) return "small";
  return match[1].replace(/-v(\d)/u, ".v$1").replace(/-turbo$/u, ".turbo");
}

export interface RunWhisperOptions {
  lang: string;
  model?: string;
  bin?: string;
  /** 覆盖 -dtw 预设；默认由模型名推。 */
  dtw?: string;
  /** JSON 输出路径（不带扩展名）；默认 wav 同目录同名 + `-words`。 */
  outBase?: string;
}

/**
 * 调 whisper-cli 产出逐词时间。要求 wav 已是 16k 单声道（见 extractWhisperWav）。
 * 中文等 CJK 不加 -sow（按字），其余语言加 -sow（按词）。
 */
export function runWhisperWords(wavPath: string, opts: RunWhisperOptions): WhisperWordsResult {
  const model = opts.model ?? DEFAULT_WHISPER_MODEL;
  if (!existsSync(model)) throw new Error(`whisper model missing: ${model}`);
  if (!existsSync(wavPath)) throw new Error(`wav missing: ${wavPath}`);
  const bin = opts.bin ?? DEFAULT_WHISPER_BIN;
  const outBase = opts.outBase ?? `${wavPath.replace(/\.wav$/u, "")}-words`;
  const script = wordScriptForLanguage(opts.lang);
  const args = [
    "-m", model,
    "-f", wavPath,
    "-l", opts.lang,
    "-ojf",
    "-dtw", opts.dtw ?? dtwPresetForModel(model),
    "-np",
    "-of", outBase,
  ];
  if (script === "latin") args.push("-sow");
  try {
    execFileSync(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString("utf8").trim();
    throw new Error(
      `whisper-cli failed (${bin} ${args.join(" ")})${stderr ? `: ${stderr.split("\n").slice(-5).join(" | ")}` : ""}`,
    );
  }
  const jsonPath = `${outBase}.json`;
  const parsed = parseWhisperFullJson(readFileSync(jsonPath));
  return {
    text: parsed.text,
    words: mergeWhisperTokens(parsed.tokens),
    timingSource: parsed.timingSource,
    jsonPath,
  };
}

// ---------------------------------------------------------------------------
// ASS 解析
// ---------------------------------------------------------------------------

const DEFAULT_EVENT_FORMAT = [
  "Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text",
];

/** `H:MM:SS.cc`（ASS 厘秒）或 `HH:MM:SS,mmm`（SRT 风格）→ ms。 */
export function parseAssTimestamp(value: string): number {
  const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/u.exec(value);
  if (!match) throw new Error(`invalid ASS timestamp: ${JSON.stringify(value)}`);
  const [, h, m, s, frac = "0"] = match;
  const fracMs = Math.round(Number(frac) * 10 ** (3 - frac.length));
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + fracMs;
}

function unescapeAssPlainText(value: string): string {
  return value
    .replace(/\\[Nn]/gu, " ")
    .replace(/\\h/gu, " ")
    .replace(/\\([{}])/gu, "$1")
    .replace(/\\\\/gu, "\\");
}

/**
 * 解析 Dialogue 的 Text 字段：剥掉 `{...}` 覆盖块得到纯文本；若块里有 karaoke 标签
 * （\k \K \kf \ko，参数为厘秒），把标签后的文本当作一个带时间的音节：
 * 起点 = cue 起点 + 之前所有 karaoke 时长之和，终点 = 起点 + 本段时长。
 * 第一个 karaoke 标签之前的文本（罕见）视为零时长、落在 cue 起点。
 */
export function parseAssDialogueText(
  text: string,
  cueStartMs: number,
): { text: string; words?: TimedWord[]; highlight?: string } {
  const plainParts: string[] = [];
  const words: TimedWord[] = [];
  let sawKaraoke = false;
  let cursorMs = cueStartMs;
  let pendingDurationMs: number | null = null;
  /// word_by_word 字幕：每条 Dialogue 是整句，只有当前词被 `{\1c&H…&}词{\r}` 包住。
  /// 记下被包住的那个词，parseAssCues 才能把 N 条同句 Dialogue 合回一个 cue 并还原逐词起点。
  let capturingHighlight = false;
  let highlightBuffer = "";
  let highlight: string | undefined;

  const pushSyllable = (raw: string) => {
    const syllable = unescapeAssPlainText(raw).trim();
    if (pendingDurationMs === null) {
      if (syllable.length > 0) words.push({ text: syllable, startMs: cueStartMs, endMs: cueStartMs });
      return;
    }
    if (syllable.length > 0) {
      words.push({ text: syllable, startMs: cursorMs, endMs: cursorMs + pendingDurationMs });
    }
    cursorMs += pendingDurationMs;
    pendingDurationMs = null;
  };

  // 逐字符扫描：`\{` 是转义的字面大括号，不开覆盖块。
  let i = 0;
  let buffer = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length && (text[i + 1] === "{" || text[i + 1] === "}")) {
      buffer += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "{") {
      const close = text.indexOf("}", i + 1);
      if (close === -1) {
        buffer += text.slice(i);
        break;
      }
      const block = text.slice(i + 1, close);
      const karaoke = /\\(?:kf|ko|K|k)\s*(\d+(?:\.\d+)?)/u.exec(block);
      if (karaoke) {
        if (buffer.length > 0 || sawKaraoke) pushSyllable(buffer);
        plainParts.push(buffer);
        buffer = "";
        sawKaraoke = true;
        pendingDurationMs = Math.round(Number(karaoke[1]) * 10);
      } else if (/\\(?:1c|c)&H/u.test(block)) {
        capturingHighlight = true;
        highlightBuffer = "";
      } else if (capturingHighlight && /\\r(?![a-z])/u.test(block)) {
        capturingHighlight = false;
        const captured = unescapeAssPlainText(highlightBuffer).trim();
        if (captured.length > 0 && highlight === undefined) highlight = captured;
      }
      i = close + 1;
      continue;
    }
    buffer += ch;
    if (capturingHighlight) highlightBuffer += ch;
    i += 1;
  }
  if (sawKaraoke) pushSyllable(buffer);
  plainParts.push(buffer);

  const plain = unescapeAssPlainText(plainParts.join(""))
    .replace(/\s+/gu, " ")
    .trim();
  const base = sawKaraoke ? { text: plain, words } : { text: plain };
  return highlight !== undefined ? { ...base, highlight } : base;
}

/** 相邻 Dialogue 的起止间隙在这个范围内就视为同一段 word_by_word 序列（渲染按厘秒首尾相接）。 */
const WORD_BY_WORD_GAP_TOLERANCE_MS = 20;

/**
 * word_by_word 字幕把一句话渲染成 N 条首尾相接、纯文本相同的 Dialogue（每条高亮一个词）。
 * 直接当 N 个 cue 会让参考文本重复 N 次，LCS 对齐与 P95 全部失真。这里把这样的连续段合回一个 cue：
 * 起点取首条、终点取末条；每条高亮的词按该条的 Start 还原成逐词起点（没有高亮的条，比如首词前的
 * 空当，只贡献时间范围）。普通字幕（文本不同或不相接）原样保留。
 */
export function mergeWordByWordRuns(
  cues: ReadonlyArray<AssCue & { highlight?: string }>,
): AssCue[] {
  const merged: AssCue[] = [];
  let run: Array<AssCue & { highlight?: string }> = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1 && run[0].highlight === undefined) {
      /// 没有 highlight 键的普通 cue 原样保留（只在解析到高亮时才会带这个键）
      merged.push(run[0]);
    } else {
      const words = run
        .filter((cue) => cue.highlight !== undefined)
        .map((cue) => ({ text: cue.highlight as string, startMs: cue.startMs, endMs: cue.endMs }));
      merged.push({
        startMs: run[0].startMs,
        endMs: Math.max(...run.map((cue) => cue.endMs)),
        text: run[0].text,
        ...(words.length > 0 ? { words } : {}),
      });
    }
    run = [];
  };

  for (const cue of cues) {
    const prev = run[run.length - 1];
    const continuesRun =
      prev !== undefined &&
      cue.words === undefined &&
      prev.words === undefined &&
      cue.text === prev.text &&
      cue.startMs >= prev.startMs &&
      cue.startMs <= prev.endMs + WORD_BY_WORD_GAP_TOLERANCE_MS;
    if (!continuesRun) flush();
    run.push(cue);
  }
  flush();
  return merged;
}

/** 读 ASS 文本里的 `Dialogue:` 行（跳过 Comment），按 [Events] 的 Format 行定位 Start/End/Text。 */
export function parseAssCues(assText: string): AssCue[] {
  const cues: Array<AssCue & { highlight?: string }> = [];
  let format = DEFAULT_EVENT_FORMAT;
  let inEvents = false;
  for (const rawLine of assText.split(/\r?\n/u)) {
    const line = rawLine.replace(/^﻿/u, "");
    if (/^\s*\[/u.test(line)) {
      inEvents = /^\s*\[events\]\s*$/iu.test(line);
      continue;
    }
    const formatMatch = /^\s*Format:\s*(.*)$/iu.exec(line);
    if (formatMatch && inEvents) {
      format = formatMatch[1].split(",").map((field) => field.trim());
      continue;
    }
    const dialogue = /^\s*Dialogue:\s*(.*)$/iu.exec(line);
    if (!dialogue) continue;
    const fields = splitAssFields(dialogue[1], format.length);
    const startIdx = format.indexOf("Start");
    const endIdx = format.indexOf("End");
    const textIdx = format.indexOf("Text");
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;
    const startMs = parseAssTimestamp(fields[startIdx] ?? "");
    const endMs = parseAssTimestamp(fields[endIdx] ?? "");
    const parsed = parseAssDialogueText(fields[textIdx] ?? "", startMs);
    cues.push({
      startMs,
      endMs,
      text: parsed.text,
      ...(parsed.words ? { words: parsed.words } : {}),
      ...(parsed.highlight !== undefined ? { highlight: parsed.highlight } : {}),
    });
  }
  return mergeWordByWordRuns(cues);
}

/** 前 n-1 个逗号切分，最后一个字段（Text）保留其中的逗号。 */
function splitAssFields(value: string, count: number): string[] {
  const fields: string[] = [];
  let rest = value;
  for (let k = 0; k < count - 1; k += 1) {
    const comma = rest.indexOf(",");
    if (comma === -1) {
      fields.push(rest.trim());
      rest = "";
      break;
    }
    fields.push(rest.slice(0, comma).trim());
    rest = rest.slice(comma + 1);
  }
  fields.push(rest);
  return fields;
}

/**
 * ASS cue → 参考对齐单元。有 karaoke 逐词时间：每个音节的第一个单元带其起点；
 * 没有：整个 cue 只有第一个单元带 cue 起点。其余单元 startMs = null，只参与文本匹配——
 * 不做插值，避免把估出来的时间当成真值喂进 P95。
 */
export function cuesToReferenceUnits(cues: AssCue[]): AlignUnit[] {
  const units: AlignUnit[] = [];
  for (const cue of cues) {
    const spans = cue.words && cue.words.length > 0
      ? cue.words
      : [{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }];
    for (const span of spans) {
      splitUnits(span.text).forEach((text, index) => {
        units.push(
          index === 0
            ? { text, startMs: span.startMs, endMs: span.endMs }
            : { text, startMs: null, endMs: null },
        );
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// 对齐与统计
// ---------------------------------------------------------------------------

/** nearest-rank 百分位：sorted 升序，p ∈ (0,1]。 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1];
}

/**
 * LCS 单调对齐（见文件头的取舍说明）。返回匹配上的 (refIndex, hypIndex) 对，按序。
 * 比较键是 normalizeUnitText 之后的文本；键为空的单元不参与匹配。
 */
export function lcsAlign(refKeys: string[], hypKeys: string[]): Array<[number, number]> {
  const n = refKeys.length;
  const m = hypKeys.length;
  // dp[i][j] = LCS 长度 of ref[i..], hyp[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (refKeys[i].length > 0 && refKeys[i] === hypKeys[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (refKeys[i].length > 0 && refKeys[i] === hypKeys[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

export function alignWordStarts(
  reference: AlignUnit[],
  hypothesis: TimedWord[],
  opts: { thresholdMs?: number } = {},
): AlignmentReport {
  const thresholdMs = opts.thresholdMs ?? 150;
  const refKeys = reference.map((unit) => normalizeUnitText(unit.text));
  const hypKeys = hypothesis.map((unit) => normalizeUnitText(unit.text));
  const matches = lcsAlign(refKeys, hypKeys);

  const pairs: AlignedPair[] = [];
  for (const [ri, hi] of matches) {
    const ref = reference[ri];
    if (ref.startMs === null || ref.startMs === undefined) continue;
    const hyp = hypothesis[hi];
    pairs.push({
      text: ref.text,
      refStartMs: ref.startMs,
      hypStartMs: hyp.startMs,
      deltaMs: Math.abs(ref.startMs - hyp.startMs),
    });
  }
  const deltas = pairs.map((pair) => pair.deltaMs).sort((a, b) => a - b);
  const refTimedUnits = reference.filter((unit) => unit.startMs !== null && unit.startMs !== undefined).length;
  const p95 = percentile(deltas, 0.95);
  const mean = deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : null;
  return {
    n: deltas.length,
    p50: percentile(deltas, 0.5),
    p95,
    meanMs: mean === null ? null : Math.round(mean * 10) / 10,
    maxMs: deltas.length > 0 ? deltas[deltas.length - 1] : null,
    unmatchedRatio: refTimedUnits === 0 ? 1 : (refTimedUnits - deltas.length) / refTimedUnits,
    passes150ms: p95 !== null && p95 < thresholdMs,
    thresholdMs,
    refUnits: reference.length,
    refTimedUnits,
    hypUnits: hypothesis.length,
    matchedUnits: matches.length,
    textMatchRatio: reference.length === 0 ? 0 : matches.length / reference.length,
    pairs,
  };
}

// ---------------------------------------------------------------------------
// CLI：--media <mp4> | --wav <wav>  --ass <ass>  --lang zh|en  [--json] [--threshold 150]
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      args.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      args.set(arg.slice(2), argv[i + 1]);
      i += 1;
    } else {
      args.set(arg.slice(2), "true");
    }
  }
  return args;
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const lang = args.get("lang");
  const media = args.get("media");
  let wav = args.get("wav");
  if (!lang || (!media && !wav)) {
    console.error(
      "用法：npx tsx scripts/lib/whisper-align.ts (--media <mp4> | --wav <wav>) --lang zh|en [--ass <ass>] [--json] [--threshold 150] [--model <ggml.bin>] [--bin whisper-cli]",
    );
    process.exit(2);
  }
  if (!wav && media) {
    wav = `${media.replace(/\.[a-z0-9]+$/iu, "")}-16k.wav`;
    extractWhisperWav(media, wav);
  }
  const transcript = runWhisperWords(wav!, {
    lang,
    model: args.get("model"),
    bin: args.get("bin"),
    dtw: args.get("dtw"),
  });
  const assPath = args.get("ass");
  const report = assPath
    ? alignWordStarts(cuesToReferenceUnits(parseAssCues(readFileSync(assPath, "utf8"))), transcript.words, {
        thresholdMs: Number(args.get("threshold") ?? 150),
      })
    : null;

  if (args.get("json") === "true") {
    process.stdout.write(`${JSON.stringify({ wav, lang, transcript, report }, null, 2)}\n`);
    return;
  }
  console.log(`转写（${transcript.timingSource}，${transcript.words.length} 个单元）：${transcript.text}`);
  if (!report) {
    for (const word of transcript.words) console.log(`  ${String(word.startMs).padStart(7)}ms  ${word.text}`);
    return;
  }
  console.log(
    `对齐：n=${report.n}  P50=${report.p50 ?? "-"}ms  P95=${report.p95 ?? "-"}ms  max=${report.maxMs ?? "-"}ms  ` +
      `未匹配(有起点)=${(report.unmatchedRatio * 100).toFixed(1)}%  文本匹配=${(report.textMatchRatio * 100).toFixed(1)}%  ` +
      `${report.passes150ms ? "✓" : "✗"} P95 < ${report.thresholdMs}ms`,
  );
  for (const pair of report.pairs) {
    console.log(
      `  ${pair.text.padEnd(12)} 字幕 ${String(pair.refStartMs).padStart(7)}ms  语音 ${String(pair.hypStartMs).padStart(7)}ms  Δ ${String(pair.deltaMs).padStart(5)}ms`,
    );
  }
  if (!report.passes150ms) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
