/**
 * 帧质检影子检查（4.4 / D2）：黑边（cropdetect）与近静止（freezedetect）。
 *
 * **只记录、不拦截。** 结果写进 VideoJob.frameQaDetail.shadow，攒够真实数据
 * 校准阈值之后再决定要不要升级为拦截项（计划 §6：鬼影 / 换人拦截级质检不在本轮）。
 *
 * 一次 ffmpeg 解码同时跑两个分析滤镜，最多看前 30 秒；任何异常都只落 error 字段。
 */

import { runFfmpeg } from "./ffmpeg-bin";

/** 黑边判定：上下（或左右）合计被裁掉的比例 ≥ 3% 记为有黑边 */
export const BLACK_BAR_RATIO_THRESHOLD = 0.03;
/** 近静止判定：冻结时长占全片 ≥ 50% 记为近静止 */
export const NEAR_STATIC_RATIO_THRESHOLD = 0.5;
/// freezedetect 参数：-50dB 比默认 -60dB 宽松一档，压缩噪声下的「几乎不动」也能抓到
const FREEZE_NOISE_DB = -50;
const FREEZE_MIN_DURATION_SEC = 1;
/// cropdetect：亮度 ≤ 24/255 视为黑；reset=0 = 全片累计最大有效区域
const CROP_LIMIT = 24;
const MAX_ANALYZE_SEC = 30;
const SHADOW_TIMEOUT_MS = 25_000;

export interface BlackBarsShadow {
  detected: boolean;
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
  /** 上下黑边合计占高度的比例 */
  verticalBarRatio: number;
  /** 左右黑边合计占宽度的比例 */
  horizontalBarRatio: number;
  threshold: number;
}

export interface NearStaticShadow {
  detected: boolean;
  frozenSec: number;
  durationSec: number;
  ratio: number;
  threshold: number;
  noiseDb: number;
  minFreezeSec: number;
}

export interface FrameQaShadowResult {
  v: 1;
  blackBars: BlackBarsShadow | null;
  nearStatic: NearStaticShadow | null;
  error?: string;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** 纯函数：取 cropdetect 最后一条（累计最大有效区域）算黑边比例 */
export function parseCropdetect(
  stderr: string,
  source: { width: number; height: number },
): BlackBarsShadow | null {
  if (!(source.width > 0 && source.height > 0)) return null;
  const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(-?\d+):(-?\d+)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const cropWidth = Math.min(Number(last[1]), source.width);
  const cropHeight = Math.min(Number(last[2]), source.height);
  /// cropdetect 在整片都是黑场时会给出负数 / 0 尺寸：没有有效画面，不下结论
  if (!(cropWidth > 0 && cropHeight > 0)) return null;
  const verticalBarRatio = round4(1 - cropHeight / source.height);
  const horizontalBarRatio = round4(1 - cropWidth / source.width);
  return {
    detected:
      verticalBarRatio >= BLACK_BAR_RATIO_THRESHOLD ||
      horizontalBarRatio >= BLACK_BAR_RATIO_THRESHOLD,
    sourceWidth: source.width,
    sourceHeight: source.height,
    cropWidth,
    cropHeight,
    verticalBarRatio,
    horizontalBarRatio,
    threshold: BLACK_BAR_RATIO_THRESHOLD,
  };
}

/** 纯函数：累加 freezedetect 冻结区间；最后一段没有 freeze_end 视为冻结到片尾 */
export function parseFreezedetect(
  stderr: string,
  durationSec: number,
): NearStaticShadow | null {
  if (!(durationSec > 0)) return null;
  const events = [
    ...stderr.matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*([0-9.]+)/g),
  ].map((m) => ({ kind: m[1], at: Number(m[2]) }));
  let frozen = 0;
  let openStart: number | null = null;
  for (const event of events) {
    if (!Number.isFinite(event.at)) continue;
    if (event.kind === "start") {
      openStart = event.at;
    } else if (openStart !== null) {
      frozen += Math.max(0, event.at - openStart);
      openStart = null;
    }
  }
  if (openStart !== null) frozen += Math.max(0, durationSec - openStart);
  const frozenSec = Math.min(durationSec, frozen);
  const ratio = round4(frozenSec / durationSec);
  return {
    detected: ratio >= NEAR_STATIC_RATIO_THRESHOLD,
    frozenSec: round4(frozenSec),
    durationSec: round4(durationSec),
    ratio,
    threshold: NEAR_STATIC_RATIO_THRESHOLD,
    noiseDb: FREEZE_NOISE_DB,
    minFreezeSec: FREEZE_MIN_DURATION_SEC,
  };
}

/** ffmpeg 滤镜链（导出给测试核对参数） */
export function shadowFilterChain(): string {
  return [
    `cropdetect=limit=${CROP_LIMIT}:round=2:reset=0`,
    `freezedetect=n=${FREEZE_NOISE_DB}dB:d=${FREEZE_MIN_DURATION_SEC}`,
  ].join(",");
}

/**
 * 对本地视频跑影子检查。永不 throw：异常落 error 字段。
 * source 为 probeMedia 的结果（尺寸 + 时长）；缺失时对应检查记 null。
 */
export async function runFrameQaShadowChecks(
  videoPath: string,
  source: { width: number | null; height: number | null; durationSec: number | null },
): Promise<FrameQaShadowResult> {
  try {
    const { stderr } = await runFfmpeg(
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "info",
        "-t",
        String(MAX_ANALYZE_SEC),
        "-i",
        videoPath,
        "-an",
        "-vf",
        shadowFilterChain(),
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: SHADOW_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 32 },
    );
    const analyzedSec =
      source.durationSec && source.durationSec > 0
        ? Math.min(source.durationSec, MAX_ANALYZE_SEC)
        : 0;
    return {
      v: 1,
      blackBars:
        source.width && source.height
          ? parseCropdetect(stderr, { width: source.width, height: source.height })
          : null,
      nearStatic: parseFreezedetect(stderr, analyzedSec),
    };
  } catch (err) {
    return {
      v: 1,
      blackBars: null,
      nearStatic: null,
      error: (err as Error).message.slice(0, 300),
    };
  }
}
