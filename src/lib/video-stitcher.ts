"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  const ffmpeg = new FFmpeg();

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export async function stitchVideos(
  url1: string,
  url2: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  onProgress?.(5);
  const ffmpeg = await getFFmpeg();
  onProgress?.(20);

  const [data1, data2] = await Promise.all([
    fetchFile(url1),
    fetchFile(url2),
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
    onProgress?.(50 + Math.floor(progress * 45));
  });

  await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-c", "copy",
    "output.mp4",
  ]);

  onProgress?.(98);
  const outputData = await ffmpeg.readFile("output.mp4");
  const blob = new Blob([outputData as unknown as BlobPart], { type: "video/mp4" });

  await ffmpeg.deleteFile("part1.mp4");
  await ffmpeg.deleteFile("part2.mp4");
  await ffmpeg.deleteFile("list.txt");
  await ffmpeg.deleteFile("output.mp4");

  onProgress?.(100);
  return URL.createObjectURL(blob);
}
