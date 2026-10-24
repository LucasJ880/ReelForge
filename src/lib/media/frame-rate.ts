/**
 * 拼接帧率决策（4.5）—— 纯函数、零依赖。
 *
 * 背景：此前拼接（服务端 stitch-service 与 GitHub Actions 的 stitch-runner）
 * 一律强转 30fps。Shuyu 原片全部是 24fps（quality 报告实测 27/27），
 * 24→30 只能靠重复帧凑数，运动画面出现周期性顿挫。
 *
 * 现在的规则：以第一段（主片）的源帧率为准，其余片段（尾卡静帧、追加镜头、
 * 客户上传片段）归一到同一帧率，保证 concat demuxer 拿到参数一致的分段。
 * 探测不到源帧率时才退回旧的 30fps。
 *
 * 本模块被 scripts/stitch-runner.ts 直接引用 —— 只能放纯函数，禁止引入
 * ffmpeg-static / Next / Prisma 或任何有运行时副作用的模块。
 */

/** 探测不到源帧率时的兜底（= 旧行为） */
export const FALLBACK_STITCH_FPS = "30";

/** 合理帧率区间：低于 5 / 高于 120 视为探测垃圾值（如把 tbn 误当帧率） */
const MIN_FPS = 5;
const MAX_FPS = 120;

/// NTSC 系帧率：ffmpeg 横幅只打印两位小数（23.98 / 29.97），这里还原成精确分数，
/// 避免长片累计漂移。
const NTSC_RATES: ReadonlyArray<readonly [number, string]> = [
  [24000 / 1001, "24000/1001"],
  [30000 / 1001, "30000/1001"],
  [48000 / 1001, "48000/1001"],
  [60000 / 1001, "60000/1001"],
];

function parseRate(raw: number | string): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = raw.trim();
  if (!text) return null;
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * 把各种写法的帧率（24、"24/1"、"30000/1001"、"23.98"）规范成 ffmpeg
 * `fps=` / `-r` 能直接吃的字符串；非法或越界返回 null。
 */
export function normalizeFrameRate(
  raw: number | string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const value = parseRate(raw);
  if (value === null || value < MIN_FPS || value > MAX_FPS) return null;
  for (const [exact, label] of NTSC_RATES) {
    if (Math.abs(value - exact) < 0.01) return label;
  }
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.01) return String(rounded);
  return String(Number(value.toFixed(3)));
}

/**
 * 拼接目标帧率：按片段顺序取第一个合法的源帧率（第一段 = 主片），
 * 全部探测失败才退回 30fps。
 */
export function pickStitchFrameRate(
  sourceRates: ReadonlyArray<number | string | null | undefined>,
): string {
  for (const rate of sourceRates) {
    const normalized = normalizeFrameRate(rate);
    if (normalized) return normalized;
  }
  return FALLBACK_STITCH_FPS;
}
