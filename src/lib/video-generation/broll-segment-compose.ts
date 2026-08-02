/**
 * b-roll 段合成的纯参数模块。
 *
 * ⚠️ 与 audio-post-production 同一纪律：**零运行时依赖**（无 Next / Prisma / 网络），
 * 因为 scripts/stitch-runner.ts（GH Action 上的 standalone runner）要直接 import。
 * 服务端 broll-assembly-service 与 runner 共用这一份，保证两端 ffmpeg 参数不漂移。
 */

/// 口播与画面之间的呼吸间隙：紧贴着切下一段会显得赶。
export const BROLL_BREATH_GAP_SEC = 0.35;
export const BROLL_MIN_SEGMENT_SEC = 2;

/** 段时长由口播驱动：max(2s, TTS 实测时长 + 呼吸)，收敛到百分位。 */
export function brollSegmentDurationSec(ttsDurationSec: number): number {
  const target = Math.max(
    BROLL_MIN_SEGMENT_SEC,
    ttsDurationSec + BROLL_BREATH_GAP_SEC,
  );
  return Math.round(target * 100) / 100;
}

export function brollAspectResolution(aspectRatio: string): {
  width: number;
  height: number;
} {
  return aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

/**
 * 单段合成参数：图库素材（视频轨）+ TTS（音轨）→ 归一化段。
 *
 * - `-stream_loop -1`：素材短于口播时循环补长，再由 `-t` 截到目标时长
 * - `apad`：TTS 比目标时长短的尾巴补静音，避免 concat 时音轨长度不齐
 * - 丢弃素材原声（图库环境声嘈杂 + 背景音乐版权风险）
 * - 输出统一 1080 档 / 30fps / H.264+AAC，与主线段规格一致
 */
export function buildBrollComposeArgs(args: {
  clipPath: string;
  ttsPath: string;
  outPath: string;
  width: number;
  height: number;
  targetDurationSec: number;
}): string[] {
  return [
    "-y",
    "-loglevel",
    "error",
    "-stream_loop",
    "-1",
    "-i",
    args.clipPath,
    "-i",
    args.ttsPath,
    "-filter_complex",
    `[0:v]scale=${args.width}:${args.height}:force_original_aspect_ratio=decrease,pad=${args.width}:${args.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v];[1:a]apad,aresample=44100[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    String(args.targetDurationSec),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    args.outPath,
  ];
}

/** claim 载荷里 b-roll 段的机器可读形状（stitch claim/complete 契约的一部分）。 */
export type BrollClaimSegment = {
  segmentIndex: number;
  /// 图库素材原片 URL（未合成）
  clipUrl: string;
  /// 该段口播的 TTS 音频 URL
  ttsAudioUrl: string;
};
