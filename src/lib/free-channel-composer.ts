"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

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

// 最近一次 exec 的 stderr 日志，用于在失败时做更好的诊断。
let lastLogLines: string[] = [];

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    ffmpeg.on("log", ({ message }) => {
      // 保留末尾 30 行；不 console.log 避免刷屏
      lastLogLines.push(message);
      if (lastLogLines.length > 30) lastLogLines.shift();
    });
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

/**
 * 某些 FS error 场景下（例如文件残留、index 冲突、wasm heap 错乱），
 * 最稳的恢复是整体 reset —— 下一次 getFFmpeg 会重新 load。
 */
export function resetFFmpeg() {
  try {
    ffmpegInstance?.terminate();
  } catch {
    /* ignore */
  }
  ffmpegInstance = null;
  ffmpegLoadPromise = null;
  lastLogLines = [];
}

/** 通过站内 proxy 以绕开 CORS（Pexels/用户素材 CDN 多半不开 CORS） */
function proxy(url: string): string {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy-video?url=${encodeURIComponent(url)}`;
}

/**
 * 安全的资源抓取：
 *  - 真实 fetch，校验 HTTP 状态
 *  - 如果 content-type 是 json/html（说明是错误页），抛明确错误
 *  - 如果响应 body 是空的，抛错
 *  - 返回 Uint8Array 给 ffmpeg.writeFile 用
 */
async function safeFetchBytes(
  url: string,
  kind: "video" | "audio",
  label: string,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `[${label}] 下载${kind === "video" ? "视频素材" : "音频"}失败（网络错误）：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `[${label}] ${kind === "video" ? "视频素材" : "音频"} HTTP ${res.status} - ${res.statusText}`,
    );
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json") || ct.includes("text/html")) {
    // 上游返回了错误页 —— 读出来拼到错误里方便诊断
    const text = await res.text().catch(() => "");
    throw new Error(
      `[${label}] ${kind === "video" ? "视频源" : "音频源"}返回了 ${ct || "text"} 而不是二进制（大概率上游 404 / 限流）：${text.slice(0, 200)}`,
    );
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(
      `[${label}] ${kind === "video" ? "视频素材" : "音频"}响应体为空`,
    );
  }
  return buf;
}

/**
 * 执行一次 ffmpeg 命令，统一清理进度监听器 + 捕获 stderr 做错误诊断。
 */
async function execWithGuard(
  ffmpeg: FFmpeg,
  args: string[],
  stepLabel: string,
  onProgress?: (pct: number) => void,
) {
  lastLogLines = [];

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.max(0, Math.min(1, progress)) * 100);
  };
  ffmpeg.on("progress", progressHandler);

  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      const tail = lastLogLines.slice(-8).join("\n");
      throw new Error(`[${stepLabel}] ffmpeg 退出码 ${code}\n${tail}`);
    }
  } catch (err) {
    const tail = lastLogLines.slice(-8).join("\n");
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`[${stepLabel}] ${detail}${tail ? `\n${tail}` : ""}`);
  } finally {
    ffmpeg.off("progress", progressHandler);
  }
}

/**
 * 将每段 clip 转成统一规格的 1080x1920 mp4
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
  const label = `分镜 ${index + 1}`;

  // 先清残留（防止跨次重试的同名文件）
  for (const f of [videoIn, audioIn, out]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* not exist, fine */
    }
  }

  const [vData, aData] = await Promise.all([
    safeFetchBytes(proxy(clip.videoUrl), "video", label),
    safeFetchBytes(clip.audioUrl, "audio", label),
  ]);

  await ffmpeg.writeFile(videoIn, vData);
  await ffmpeg.writeFile(audioIn, aData);

  const seconds = Math.max(1, Math.ceil(clip.durationMs / 1000));
  const scaleFilter =
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

  await execWithGuard(
    ffmpeg,
    [
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
    ],
    `${label} 渲染`,
    onProgress,
  );

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

  // 所有 clip 编码一致（同 libx264/aac/1080x1920/30fps），可以走 -c copy
  await execWithGuard(
    ffmpeg,
    [
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-c", "copy",
      "-movflags", "+faststart",
      "output.mp4",
    ],
    "拼接所有分镜",
    onProgress,
  );

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
 * 主函数：由 manifest 合成完整 Free 通道视频。
 * 失败时会重置 FFmpeg 实例，以便下次重试是干净状态。
 */
export async function composeFreeChannelVideo(
  clips: FreeClipInput[],
  onProgress?: ProgressCallback,
): Promise<FreeCompositionResult> {
  if (clips.length === 0) {
    throw new Error("Clip 列表为空（脚本未切分出任何句子）");
  }

  // 前置校验：素材 URL 是否合法
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c.videoUrl || !c.videoUrl.startsWith("http")) {
      throw new Error(`分镜 ${i + 1} 视频 URL 无效：${c.videoUrl}`);
    }
    if (!c.audioUrl || !c.audioUrl.startsWith("http")) {
      throw new Error(`分镜 ${i + 1} 音频 URL 无效：${c.audioUrl}`);
    }
  }

  onProgress?.(1, "加载 FFmpeg 核心...");
  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch (err) {
    throw new Error(
      `FFmpeg 核心加载失败（可能是网络问题，unpkg.com 被屏蔽？）：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  onProgress?.(8, "FFmpeg 就绪");

  try {
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
  } catch (err) {
    // 出错之后 ffmpeg 实例可能处于脏状态（半写入的文件、wasm heap 错乱）
    // 下次重试前 reset，保证一个干净起点
    resetFFmpeg();
    throw err;
  }
}
