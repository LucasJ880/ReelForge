"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

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

function proxyUrl(url: string): string {
  return `/api/proxy-video?url=${encodeURIComponent(url)}`;
}

async function runFfmpegConcat(
  ffmpeg: FFmpeg,
  mode: "copy" | "reencode",
): Promise<void> {
  if (mode === "copy") {
    await ffmpeg.exec([
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-c", "copy",
      "-movflags", "+faststart",
      "output.mp4",
    ]);
  } else {
    await ffmpeg.exec([
      "-i", "part1.mp4",
      "-i", "part2.mp4",
      "-filter_complex",
      "[0:v:0][0:a:0?][1:v:0][1:a:0?]concat=n=2:v=1:a=1[outv][outa]",
      "-map", "[outv]",
      "-map", "[outa]",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "output.mp4",
    ]);
  }
}

export interface StitchResult {
  objectUrl: string;
  blob: Blob;
}

export async function stitchVideos(
  url1: string,
  url2: string,
  onProgress?: (pct: number) => void,
): Promise<StitchResult> {
  onProgress?.(5);
  const ffmpeg = await getFFmpeg();
  onProgress?.(20);

  const [data1, data2] = await Promise.all([
    fetchFile(proxyUrl(url1)),
    fetchFile(proxyUrl(url2)),
  ]);
  onProgress?.(40);

  await ffmpeg.writeFile("part1.mp4", data1);
  await ffmpeg.writeFile("part2.mp4", data2);

  await ffmpeg.writeFile(
    "list.txt",
    new TextEncoder().encode("file 'part1.mp4'\nfile 'part2.mp4'\n"),
  );
  onProgress?.(50);

  ffmpeg.on("progress", ({ progress }) => {
    const pct = Math.min(Math.max(progress, 0), 1);
    onProgress?.(50 + Math.floor(pct * 45));
  });

  let copySucceeded = true;
  try {
    await runFfmpegConcat(ffmpeg, "copy");
  } catch (e) {
    console.warn("[stitch] -c copy failed, retrying with re-encode:", e);
    copySucceeded = false;
  }

  if (copySucceeded) {
    try {
      const probeData = await ffmpeg.readFile("output.mp4");
      const sizeBytes =
        typeof probeData === "string" ? probeData.length : probeData.byteLength;
      if (sizeBytes < 1024) {
        copySucceeded = false;
      }
    } catch {
      copySucceeded = false;
    }
  }

  if (!copySucceeded) {
    try {
      await ffmpeg.deleteFile("output.mp4");
    } catch {}
    await runFfmpegConcat(ffmpeg, "reencode");
  }

  onProgress?.(98);
  const outputData = await ffmpeg.readFile("output.mp4");
  const blob = new Blob([outputData as unknown as BlobPart], {
    type: "video/mp4",
  });

  for (const f of ["part1.mp4", "part2.mp4", "list.txt", "output.mp4"]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {}
  }

  onProgress?.(100);
  return { objectUrl: URL.createObjectURL(blob), blob };
}
