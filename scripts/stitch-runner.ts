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
 *   4. 用 BLOB_READ_WRITE_TOKEN 调 @vercel/blob put 上传到 final-videos/{id}/{ts}.mp4
 *   5. POST $APP_URL/api/internal/stitch/complete  { finalVideoId, attemptToken, stitchedVideoUrl }
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

    let stitchedUrl: string;
    try {
      stitchedUrl = await stitchOne(task);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
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
            (postErr as Error).message,
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
        stitchedVideoUrl: stitchedUrl,
      });
      console.log(
        `[stitch-runner] ✓ finalVideoId=${task.finalVideoId} url=${stitchedUrl}`,
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
        (err as Error).message,
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
    throw new Error(
      `claim failed: HTTP ${res.status} ${await safeText(res)}`,
    );
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
    throw new Error(
      `complete failed: HTTP ${res.status} ${await safeText(res)}`,
    );
  }
  if (!args.error) {
    const payload = (await res.json()) as { ok?: boolean };
    if (payload.ok !== true) {
      throw new Error("complete endpoint did not accept successful output");
    }
  }
}

async function stitchOne(task: StitchTask): Promise<string> {
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
      await execFileAsync(
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
        { maxBuffer: 1024 * 1024 * 50 },
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
    await execFileAsync(
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
      { maxBuffer: 1024 * 1024 * 50 },
    );

    const blobPath = `final-videos/${task.finalVideoId}/${Date.now()}.mp4`;
    return await uploadToBlob(finalOut, blobPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `download segment failed: HTTP ${res.status} ${url.slice(0, 80)}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function uploadToBlob(filePath: string, blobPath: string): Promise<string> {
  /// 动态 import 避免 stitch-runner.ts 在 type check 时强依赖 @vercel/blob
  /// （CI runner 通过 npx -y @vercel/blob 或 npm i 临时装即可）
  const { put } = (await import("@vercel/blob")) as typeof import("@vercel/blob");
  const buffer = await readFile(filePath);
  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType: "video/mp4",
    token: BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

main().catch((err) => {
  console.error("[stitch-runner] fatal:", err);
  process.exit(1);
});
