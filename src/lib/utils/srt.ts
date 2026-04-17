/**
 * SRT 字幕生成工具
 *
 * MoneyPrinterTurbo 的字幕流程：按句切分 -> 每句估算时长 -> 输出 SRT
 */

export interface SrtSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * 粗略按标点/换行切分脚本为句子
 * 支持中英混合
 */
export function splitIntoSentences(script: string): string[] {
  const normalized = script.replace(/\s+/g, " ").trim();
  // 切分：中文句末标点 / 英文句末标点
  const parts = normalized.split(/(?<=[。！？.!?])\s+/).filter(Boolean);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 将 ms 转为 SRT 时间戳 `HH:MM:SS,mmm`
 */
function msToSrtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const mm = total % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mm, 3)}`;
}

/**
 * 用已知句子时长数组生成 SRT 文本
 */
export function buildSrt(
  sentences: string[],
  durationsMs: number[],
): { srt: string; segments: SrtSegment[] } {
  const segments: SrtSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const duration = durationsMs[i] ?? 2000;
    const startMs = cursor;
    const endMs = cursor + duration;
    segments.push({
      index: i + 1,
      startMs,
      endMs,
      text: sentences[i],
    });
    cursor = endMs;
  }

  const srt = segments
    .map(
      (seg) =>
        `${seg.index}\n${msToSrtTime(seg.startMs)} --> ${msToSrtTime(seg.endMs)}\n${seg.text}\n`,
    )
    .join("\n");

  return { srt, segments };
}
