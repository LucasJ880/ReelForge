/**
 * Standalone stitch runner —— 在 GitHub Action runner / Cloud Run / Lambda 上跑。
 *
 * 这是一个「无 Next / 无 Prisma」的独立脚本：仅依赖 Node 内置 + `@vercel/blob`，
 * 通过 Aivora 后端的 internal API 拉任务、做拼接、写回结果。
 *
 * 流程（最多循环 LOOP_LIMIT 次，每次处理一条 FinalVideo）：
 *   1. GET  $APP_URL/api/internal/stitch/claim   → { task: {finalVideoId, attemptToken, segmentUrls[], aspectRatio, ...} | null }
 *   2. 下载所有段 mp4 到 tmp 目录
 *   3. 用本地 ffmpeg（GH Action runner 自带）转码 + concat 成最终 mp4
 *   4. 从成片抽取 JPEG 预览帧，并将 mp4 + jpg 上传到 Vercel Blob
 *   5. POST $APP_URL/api/internal/stitch/complete
 *      { finalVideoId, attemptToken, stitchedVideoUrl, thumbnailUrl }
 *   6. 任何步骤失败 → POST complete 写 error，不抛错（让循环继续处理下一个）
 *
 * Env 要求：
 *   APP_URL                 — e.g. https://aivora.vercel.app（不带尾斜杠）
 *   CRON_SECRET             — 与 Vercel 环境一致
 *   BLOB_READ_WRITE_TOKEN   — Vercel Blob R/W token
 *
 * 注意：不要在脚本里 import 任何 src/ 路径，否则需要把整个 Next/Prisma 拽到 runner，
 * 部署成本会爆炸。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const LOOP_LIMIT = Number(process.env.STITCH_RUNNER_LOOP_LIMIT ?? "5");
const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? "";

class StaleStitchAttemptError extends Error {
  constructor() {
    super("stitch attempt is no longer active");
    this.name = "StaleStitchAttemptError";
  }
}

class StitchRunnerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StitchRunnerError";
  }
}

interface StitchTask {
  finalVideoId: string;
  attemptToken: string;
  segmentUrls: string[];
  aspectRatio: string;
  targetDurationSec: number;
}

async function main() {
  if (!APP_URL || !CRON_SECRET || !BLOB_READ_WRITE_TOKEN) {
    console.error(
      "[stitch-runner] missing env: APP_URL / CRON_SECRET / BLOB_READ_WRITE_TOKEN are all required",
    );
    process.exit(1);
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < LOOP_LIMIT; i++) {
    const task = await claim();
    if (!task) {
      console.log(`[stitch-runner] no pending tasks; iter=${i}; exiting`);
      break;
    }
    console.log(
      `[stitch-runner] claimed task finalVideoId=${task.finalVideoId} segments=${task.segmentUrls.length}`,
    );

    let output: { stitchedVideoUrl: string; thumbnailUrl: string };
    try {
      output = await stitchOne(task);
    } catch (err) {
      const message = safeFailureMessage(err);
      console.error(
        `[stitch-runner] ✗ finalVideoId=${task.finalVideoId} error=${message}`,
      );
      try {
        await complete({
          finalVideoId: task.finalVideoId,
          attemptToken: task.attemptToken,
          error: message.slice(0, 500),
        });
      } catch (postErr) {
        if (postErr instanceof StaleStitchAttemptError) {
          console.warn(
            `[stitch-runner] stale failure ignored finalVideoId=${task.finalVideoId}`,
          );
        } else {
          console.error(
            "[stitch-runner] failed to POST /complete (giving up):",
            safeFailureMessage(postErr),
          );
        }
      }
      failed++;
      continue;
    }

    try {
      await complete({
        finalVideoId: task.finalVideoId,
        attemptToken: task.attemptToken,
        stitchedVideoUrl: output.stitchedVideoUrl,
        thumbnailUrl: output.thumbnailUrl,
      });
      console.log(
        `[stitch-runner] ✓ finalVideoId=${task.finalVideoId} mediaUploaded=true`,
      );
      processed++;
    } catch (err) {
      if (err instanceof StaleStitchAttemptError) {
        console.warn(
          `[stitch-runner] stale completion ignored finalVideoId=${task.finalVideoId}`,
        );
        continue;
      }
      console.error(
        `[stitch-runner] completion callback failed finalVideoId=${task.finalVideoId}:`,
        safeFailureMessage(err),
      );
      // The media has already been stitched and uploaded. A callback transport
      // failure is not a rendering failure: leave this attempt STITCHING so a
      // retry/sweeper can reconcile it without overwriting a newer claim.
      failed++;
    }
  }

  console.log(
    `[stitch-runner] done: processed=${processed} failed=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function claim(): Promise<StitchTask | null> {
  const res = await fetch(`${APP_URL}/api/internal/stitch/claim`, {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new StitchRunnerError(`claim_failed_http_${res.status}`);
  }
  const body = (await res.json()) as { task: StitchTask | null };
  return body.task ?? null;
}

async function complete(args: {
  finalVideoId: string;
  attemptToken: string;
  stitchedVideoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}) {
  const res = await fetch(`${APP_URL}/api/internal/stitch/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (res.status === 409) {
    throw new StaleStitchAttemptError();
  }
  if (!res.ok) {
    throw new StitchRunnerError(`complete_failed_http_${res.status}`);
  }
  if (!args.error) {
    const payload = (await res.json()) as { ok?: boolean };
    if (payload.ok !== true) {
      throw new Error("complete endpoint did not accept successful output");
    }
  }
}

async function stitchOne(task: StitchTask): Promise<{
  stitchedVideoUrl: string;
  thumbnailUrl: string;
}> {
  const tmpDir = path.join(
    os.tmpdir(),
    `stitch-${task.finalVideoId}-${Date.now()}`,
  );
  await mkdir(tmpDir, { recursive: true });
  try {
    const { width, height } = aspectToDimensions(task.aspectRatio);
    const padFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

    const normalized: string[] = [];
    for (const [i, url] of task.segmentUrls.entries()) {
      const localInput = path.join(tmpDir, `seg-${i}.input`);
      const out = path.join(tmpDir, `seg-${i}.mp4`);
      await downloadToFile(url, localInput);
      await runFfmpeg(
        "ffmpeg",
        [
          "-y",
          "-i",
          localInput,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-r",
          "30",
          "-vf",
          padFilter,
          out,
        ],
        "segment_normalization_failed",
      );
      normalized.push(out);
    }

    const concatList = path.join(tmpDir, "concat.txt");
    await writeFile(
      concatList,
      normalized
        .map((s) => `file '${s.replaceAll("'", "'\\''")}'`)
        .join("\n"),
      "utf8",
    );
    const finalOut = path.join(tmpDir, "final.mp4");
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        finalOut,
      ],
      "stitch_concat_failed",
    );

    const timestamp = Date.now();
    const thumbnailOut = path.join(tmpDir, "thumbnail.jpg");
    await extractThumbnail(finalOut, thumbnailOut, task.targetDurationSec);

    const videoBlobPath = `final-videos/${task.finalVideoId}/${timestamp}.mp4`;
    const thumbnailBlobPath = `final-videos/${task.finalVideoId}/${timestamp}.jpg`;
    const [stitchedVideoUrl, thumbnailUrl] = await Promise.all([
      uploadToBlob(finalOut, videoBlobPath, "video/mp4"),
      uploadToBlob(thumbnailOut, thumbnailBlobPath, "image/jpeg"),
    ]);
    return { stitchedVideoUrl, thumbnailUrl };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new StitchRunnerError(`download_segment_failed_http_${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function uploadToBlob(
  filePath: string,
  blobPath: string,
  contentType: "video/mp4" | "image/jpeg",
): Promise<string> {
  /// 动态 import 避免 stitch-runner.ts 在 type check 时强依赖 @vercel/blob
  /// （CI runner 通过 npx -y @vercel/blob 或 npm i 临时装即可）
  const { put } = (await import("@vercel/blob")) as typeof import("@vercel/blob");
  const buffer = await readFile(filePath);
  try {
    const blob = await put(blobPath, buffer, {
      access: "public",
      contentType,
      token: BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  } catch {
    throw new StitchRunnerError(
      contentType === "image/jpeg"
        ? "thumbnail_upload_failed"
        : "stitched_video_upload_failed",
    );
  }
}

async function extractThumbnail(
  videoPath: string,
  thumbnailPath: string,
  targetDurationSec: number,
) {
  /// Prefer a frame just after the opening transition. Clamp the seek point so
  /// short clips still have a valid candidate and long videos do not require a
  /// deep seek. If metadata/duration is inaccurate, fall back to ffmpeg's
  /// representative-frame selector instead of completing without a preview.
  const safeDuration = Number.isFinite(targetDurationSec)
    ? Math.max(0, targetDurationSec)
    : 0;
  const seekSeconds = Math.min(2, Math.max(0.25, safeDuration * 0.1));

  try {
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-ss",
        seekSeconds.toFixed(3),
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        "-q:v",
        "2",
        thumbnailPath,
      ],
      "thumbnail_seek_failed",
    );
  } catch {
    await runFfmpeg(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoPath,
        "-vf",
        "thumbnail=30,scale=480:-2",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnailPath,
      ],
      "thumbnail_extraction_failed",
    );
  }
}

async function runFfmpeg(
  executable: "ffmpeg",
  args: string[],
  errorCode: string,
) {
  try {
    await execFileAsync(executable, args, { maxBuffer: 1024 * 1024 * 50 });
  } catch {
    throw new StitchRunnerError(errorCode);
  }
}

function aspectToDimensions(aspectRatio: string): { width: number; height: number } {
  /// 默认 1080×1920；其它常见比例做兜底转换
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
      return { width: 1080, height: 1350 };
    default:
      return { width: 1080, height: 1920 };
  }
}

function safeFailureMessage(err: unknown): string {
  if (err instanceof StitchRunnerError) return err.code;
  if (err instanceof StaleStitchAttemptError) return "stale_stitch_attempt";
  return "stitch_runner_unexpected_failure";
}

main().catch((err) => {
  console.error("[stitch-runner] fatal:", safeFailureMessage(err));
  process.exit(1);
});
