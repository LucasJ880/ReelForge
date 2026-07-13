/**
 * 数字人探店广告 · 外部出片 runner（GitHub Actions）
 * ==================================================================
 *
 * 与 stitch-runner 同构，但跑的是「完整数字人管线」（带 ffmpeg + TTS + Seedance），
 * 因此需要 import src 下的 pipeline（tsx 会按 tsconfig paths 解析 `@/`）。
 *
 * 流程（最多 LOOP_LIMIT 次，每次一条 DigitalHumanAdJob）：
 *   1. GET  $APP_URL/api/internal/digital-human/claim  → { task | null }
 *   2. runDigitalHumanAdPipeline(task) → 本地 final.mp4 + thumb.jpg
 *   3. @vercel/blob put 上传成片 + 缩略图
 *   4. POST $APP_URL/api/internal/digital-human/complete { jobId, outputVideoUrl, ... }
 *   5. 任一步失败 → POST complete 写 error（不抛错，继续下一条）
 *
 * Env：
 *   APP_URL                 https://aivora.vercel.app（不带尾斜杠）
 *   CRON_SECRET             与 Vercel 一致
 *   BLOB_READ_WRITE_TOKEN   Vercel Blob R/W token
 *   BYTEPLUS_ARK_API_KEY / OPENAI_API_KEY / VOLC_TTS_*  管线依赖
 *   STORE_AD_CAPTION_FONT   可选，指向中文字体（runner 上安装 fonts-noto-cjk）
 */
import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

loadEnvConfig(process.cwd());

const LOOP_LIMIT = Number(process.env.DH_RUNNER_LOOP_LIMIT ?? "3");
const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? "";

interface ClaimedTask {
  jobId: string;
  avatarAssetUri: string;
  voiceType: string;
  storeImageUrls: string[];
  industry: string;
  storeDescription: string | null;
  sellingPoints: string[];
  cta: string | null;
  brandName: string | null;
  durationSec: number;
  aspectRatio: string;
}

async function main() {
  if (!APP_URL || !CRON_SECRET || !BLOB_READ_WRITE_TOKEN) {
    console.error(
      "[dh-runner] missing env: APP_URL / CRON_SECRET / BLOB_READ_WRITE_TOKEN required",
    );
    process.exit(1);
  }

  const { runDigitalHumanAdPipeline } = await import(
    "../src/lib/video-generation/digital-human/store-ad-pipeline"
  );

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < LOOP_LIMIT; i++) {
    const task = await claim();
    if (!task) {
      console.log(`[dh-runner] no pending tasks; iter=${i}; exiting`);
      break;
    }
    console.log(`[dh-runner] claimed jobId=${task.jobId} industry=${task.industry}`);

    try {
      const result = await runDigitalHumanAdPipeline(
        {
          jobId: task.jobId,
          avatarAssetUri: task.avatarAssetUri,
          voiceType: task.voiceType,
          storeImageUrls: task.storeImageUrls,
          industry: task.industry,
          storeDescription: task.storeDescription,
          sellingPoints: task.sellingPoints,
          cta: task.cta,
          brandName: task.brandName,
          durationSec: task.durationSec,
          aspectRatio: task.aspectRatio,
        },
        { logger: (m) => console.log(`  [${task.jobId}] ${m}`) },
      );

      const outputVideoUrl = await uploadToBlob(
        result.finalVideoPath,
        `digital-human-ads/${task.jobId}/${Date.now()}.mp4`,
        "video/mp4",
      );
      let outputThumbnailUrl: string | null = null;
      if (result.thumbnailPath) {
        outputThumbnailUrl = await uploadToBlob(
          result.thumbnailPath,
          `digital-human-ads/${task.jobId}/${Date.now()}-thumb.jpg`,
          "image/jpeg",
        );
      }

      await complete({
        jobId: task.jobId,
        outputVideoUrl,
        outputThumbnailUrl,
        storyboard: result.storyboard,
      });
      console.log(`[dh-runner] ✓ jobId=${task.jobId} url=${outputVideoUrl}`);
      processed++;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      console.error(`[dh-runner] ✗ jobId=${task.jobId} error=${message}`);
      try {
        await complete({ jobId: task.jobId, error: message.slice(0, 500) });
      } catch (postErr) {
        console.error(
          "[dh-runner] failed to POST /complete (giving up):",
          (postErr as Error).message,
        );
      }
      failed++;
    }
  }

  console.log(`[dh-runner] done: processed=${processed} failed=${failed}`);
}

async function claim(): Promise<ClaimedTask | null> {
  const res = await fetch(`${APP_URL}/api/internal/digital-human/claim`, {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new Error(`claim failed: HTTP ${res.status} ${await safeText(res)}`);
  }
  const body = (await res.json()) as { task: ClaimedTask | null };
  return body.task ?? null;
}

async function complete(args: {
  jobId: string;
  outputVideoUrl?: string | null;
  outputThumbnailUrl?: string | null;
  storyboard?: unknown;
  error?: string;
}) {
  const res = await fetch(`${APP_URL}/api/internal/digital-human/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`complete failed: HTTP ${res.status} ${await safeText(res)}`);
  }
}

async function uploadToBlob(
  filePath: string,
  blobPath: string,
  contentType: string,
): Promise<string> {
  const { put } = (await import("@vercel/blob")) as typeof import("@vercel/blob");
  const buffer = await readFile(filePath);
  const blob = await put(blobPath, buffer, {
    access: "public",
    contentType,
    token: BLOB_READ_WRITE_TOKEN,
  });
  console.log(`[dh-runner] uploaded ${basename(filePath)} → ${blob.url}`);
  return blob.url;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

main().catch((err) => {
  console.error("[dh-runner] fatal:", err);
  process.exit(1);
});
