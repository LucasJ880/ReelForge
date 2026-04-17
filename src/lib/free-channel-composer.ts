"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export interface FreeClipInput {
  sentence: string;
  durationMs: number;
  audioUrl: string;
  videoUrl: string;
}

export interface FreeCompositionResult {
  blob: Blob;
  objectUrl: string;
}

export type ProgressCallback = (
  pct: number,
  message?: string,
) => void;

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } finally {
    ffmpegLoadPromise = null;
  }
}

function proxy(url: string): string {
  // 通过站内 proxy 以避开 CORS（Pexels CDN 不开 CORS）
  return `/api/proxy-video?url=${encodeURIComponent(url)}`;
}

/**
 * 将每段 clip 转成统一规格的 1080x1920 mp4：
 *   - 视频循环至 durationMs，剪裁/居中缩放到 1080x1920
 *   - 音轨完全替换为 Edge TTS 的 mp3
 *   - 输出 H.264/AAC，方便后续 concat
 */
async function renderClip(
  ffmpeg: FFmpeg,
  index: number,
  clip: FreeClipInput,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const videoIn = `v${index}.mp4`;
  const audioIn = `a${index}.mp3`;
  const out = `clip${index}.mp4`;

  const [vData, aData] = await Promise.all([
    fetchFile(proxy(clip.videoUrl)),
    fetchFile(clip.audioUrl),
  ]);

  await ffmpeg.writeFile(videoIn, vData);
  await ffmpeg.writeFile(audioIn, aData);

  const seconds = Math.max(1, Math.ceil(clip.durationMs / 1000));

  const scaleFilter =
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

  ffmpeg.on("progress", ({ progress }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)) * 100);
  });

  await ffmpeg.exec([
    "-stream_loop", "-1",
    "-i", videoIn,
    "-i", audioIn,
    "-t", String(seconds),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", scaleFilter,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    out,
  ]);

  try {
    await ffmpeg.deleteFile(videoIn);
    await ffmpeg.deleteFile(audioIn);
  } catch {
    /* ignore */
  }

  return out;
}

async function concatClips(
  ffmpeg: FFmpeg,
  clipFiles: string[],
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  const listContent = clipFiles.map((f) => `file '${f}'`).join("\n") + "\n";
  await ffmpeg.writeFile("list.txt", new TextEncoder().encode(listContent));

  ffmpeg.on("progress", ({ progress }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)) * 100);
  });

  // 所有 clip 编码一致（同 libx264/aac/1080x1920/30fps），可以走 -c copy
  await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-c", "copy",
    "-movflags", "+faststart",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4");
  const result =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  for (const f of [...clipFiles, "list.txt", "output.mp4"]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* ignore */
    }
  }

  return result;
}

/**
 * 主函数：由 manifest 合成完整 Free 通道视频
 */
export async function composeFreeChannelVideo(
  clips: FreeClipInput[],
  onProgress?: ProgressCallback,
): Promise<FreeCompositionResult> {
  if (clips.length === 0) {
    throw new Error("Clip 列表为空");
  }

  onProgress?.(1, "加载 FFmpeg 核心...");
  const ffmpeg = await getFFmpeg();
  onProgress?.(8, "FFmpeg 就绪");

  const clipFiles: string[] = [];
  const total = clips.length;

  for (let i = 0; i < total; i++) {
    const base = 8 + Math.floor((i / total) * 75);
    const span = Math.floor((1 / total) * 75);

    onProgress?.(
      base,
      `[${i + 1}/${total}] 合成分镜：${clips[i].sentence.slice(0, 16)}...`,
    );

    const out = await renderClip(ffmpeg, i, clips[i], (pct) => {
      onProgress?.(base + Math.floor((pct / 100) * span));
    });
    clipFiles.push(out);
  }

  onProgress?.(85, "拼接所有分镜...");
  const outputBytes = await concatClips(ffmpeg, clipFiles, (pct) => {
    onProgress?.(85 + Math.floor(pct * 0.13));
  });

  const blob = new Blob([outputBytes as unknown as BlobPart], {
    type: "video/mp4",
  });
  onProgress?.(100, "合成完成");

  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
  };
}
