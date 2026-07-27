import type {
  AspectRatio,
  CaptionPosition,
  CaptionStyle,
} from "@/types/video-generation";

export type CaptionCue = {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
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

function splitLongSentence(sentence: string): string[] {
  const graphemes = Array.from(sentence);
  const limit = isMostlyCjk(sentence)
    ? CJK_READABLE_GRAPHEMES
    : LATIN_READABLE_GRAPHEMES;
  if (graphemes.length <= limit) return [sentence];

  const chunks: string[] = [];
  let cursor = 0;
  while (graphemes.length - cursor > limit) {
    const ideal = cursor + limit;
    const minimum = cursor + Math.max(1, Math.floor(limit * 0.55));
    let boundary = ideal;
    for (let index = ideal; index >= minimum; index--) {
      if (/[，,、:：\s]/u.test(graphemes[index - 1] ?? "")) {
        boundary = index;
        break;
      }
    }
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
  const sentences =
    normalized.match(/[^。！？!?；;]+(?:[。！？!?；;]+|$)/gu) ?? [normalized];
  return sentences.flatMap(splitLongSentence).filter(Boolean);
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
      merged[shortestIndex - 1] += merged[shortestIndex];
      merged.splice(shortestIndex, 1);
    } else {
      merged[shortestIndex] += merged[shortestIndex + 1];
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
 * Build stable caption timings from the approved script and probed media
 * duration. No provider timestamps or guessed progress clocks are involved.
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
  const chunks = mergeToDuration(sourceChunks, durationMs);
  const minimumMs = Math.max(
    1,
    Math.min(MIN_READABLE_CUE_MS, Math.floor(durationMs / chunks.length)),
  );
  const distributableMs = durationMs - minimumMs * chunks.length;
  const weights = chunks.map(readableWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return chunks.map((text, index) => {
    const allocated =
      index === chunks.length - 1
        ? durationMs - cursor
        : minimumMs +
          Math.floor(distributableMs * (weights[index] / totalWeight));
    const cue = {
      index: index + 1,
      text,
      startMs: cursor,
      endMs: index === chunks.length - 1 ? durationMs : cursor + allocated,
    };
    cursor = cue.endMs;
    return cue;
  });
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

function assTimestamp(ms: number): string {
  const centiseconds = Math.floor(ms / 10);
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const remainder = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(2, "0")}`;
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

export function renderAssCaptions(
  cues: CaptionCue[],
  options: {
    aspectRatio: AspectRatio;
    position: CaptionPosition;
    style: CaptionStyle;
  },
): string {
  const resolution = assResolution(options.aspectRatio);
  const fontSize = options.aspectRatio === "9:16" ? 58 : 48;
  const outline = options.style === "plain" ? 2 : 4;
  const bold = options.style === "plain" ? 0 : -1;
  const marginV = options.aspectRatio === "9:16" ? 150 : 90;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Captions,Noto Sans CJK SC,${fontSize},&H00FFFFFF,&H0000D7FF,&H90000000,&H50000000,${bold},0,0,0,100,100,0,0,1,${outline},1,${assAlignment(options.position)},80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTimestamp(cue.startMs)},${assTimestamp(cue.endMs)},Captions,,0,0,0,,${escapeAssText(cue.text)}`,
  );
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
  bgmInputIndex?: number;
}): AudioFilterPlan {
  const volume = Math.min(0.35, Math.max(0, options.bgmVolume));
  const hasBgm = volume > 0;
  const sourceIndex = options.sourceAudioInputIndex ?? 0;
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
      filterComplex: `[${sourceIndex}:a]${normalize}[aout]`,
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
      `[${sourceIndex}:a]asplit=2[voice_mix][voice_sidechain]`,
      bgmChain,
      "[bgm][voice_sidechain]sidechaincompress=threshold=0.035:ratio=8:attack=20:release=300[ducked_bgm]",
      `[voice_mix][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2,${normalize}[aout]`,
    ].join(";"),
    outputLabel: "[aout]",
    bgmInputArgs: ["-stream_loop", "-1"],
  };
}
