/**
 * 生成 /demo/ai-video 首屏种子数据：
 *
 *   1. 调真实 Apify+OpenAI 分析 DEMO_SEED_INPUT.tiktokUrl
 *   2. 用分析得出的脚本提交 HeyGen 真实数字人生成
 *   3. 轮询 HeyGen 直到 completed
 *   4. 把成片 mp4 下载下来上传到 Vercel Blob 拿永久 URL
 *   5. 把 1+4 的结果写回 src/lib/data/demo-seed.ts
 *
 * 跑法：
 *   npx tsx scripts/generate-demo-seed.ts
 *
 * 这个脚本会消耗一次 HeyGen 额度（~$0.5）+ 一次 Apify+OpenAI（<$0.05）。
 *
 * 注意：用 dynamic import 来确保 `@next/env` 先把 .env.local 加载进 process.env
 * 之后，才让 openai client / providers 被实例化。
 */
import { loadEnvConfig } from "@next/env";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

const POLL_INTERVAL_MS = 10000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

async function main() {
  const { put } = await import("@vercel/blob");
  const { analyzeDemoReferenceVideo } = await import(
    "../src/lib/services/demo-video-analysis-service"
  );
  const { getHeyGenProofStatus, submitHeyGenProof } = await import(
    "../src/lib/providers/digital-human"
  );
  const { DEMO_SEED_INPUT } = await import("../src/lib/data/demo-seed");

  banner("Step 1: 调 Apify + OpenAI 分析参考视频");
  console.log("OPENAI_API_KEY loaded =", !!process.env.OPENAI_API_KEY);
  console.log("APIFY_TOKEN loaded =", !!process.env.APIFY_TOKEN);
  console.log("HEYGEN_API_KEY loaded =", !!process.env.HEYGEN_API_KEY);
  console.log("BLOB_READ_WRITE_TOKEN loaded =", !!process.env.BLOB_READ_WRITE_TOKEN);
  const analysis = await analyzeDemoReferenceVideo(DEMO_SEED_INPUT);
  console.log("source =", analysis.source);
  console.log("reference plays =", analysis.reference.metrics.plays);
  console.log("scene plan length =", analysis.clientVersion.scenePlan.length);

  banner("Step 2: 提交 HeyGen 真实数字人生成");
  const reuseId = process.env.REUSE_HEYGEN_VIDEO_ID?.trim();
  const proof = reuseId
    ? {
        provider: "heygen" as const,
        status: "submitted" as const,
        jobId: reuseId,
        avatarId: process.env.HEYGEN_AVATAR_ID || "",
        voiceId: process.env.HEYGEN_VOICE_ID || "",
      }
    : await submitHeyGenProof({
        title: analysis.clientVersion.title,
        script: analysis.clientVersion.digitalHumanScript,
      });
  console.log(
    reuseId ? "reused video_id =" : "submitted video_id =",
    proof.jobId,
  );

  banner("Step 3: 轮询 HeyGen 状态");
  const completed = await pollUntilCompleted(getHeyGenProofStatus, proof.jobId);
  if (!completed.videoUrl) {
    throw new Error("HeyGen completed 但没有 video_url");
  }
  console.log("HeyGen video_url =", completed.videoUrl);
  console.log("duration =", completed.duration, "s");

  banner("Step 4: 下载成片并上传 Vercel Blob");
  const mp4 = await fetch(completed.videoUrl);
  if (!mp4.ok) throw new Error("下载 HeyGen mp4 失败 status=" + mp4.status);
  const buffer = Buffer.from(await mp4.arrayBuffer());
  const blob = await put(`demo-seed/heygen-${proof.jobId}.mp4`, buffer, {
    access: "public",
    contentType: "video/mp4",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  console.log("Vercel Blob URL =", blob.url);

  let thumbnailUrl = completed.thumbnailUrl ?? "";
  if (thumbnailUrl) {
    try {
      const thumb = await fetch(thumbnailUrl);
      if (thumb.ok) {
        const thumbBuffer = Buffer.from(await thumb.arrayBuffer());
        const thumbBlob = await put(
          `demo-seed/heygen-${proof.jobId}.jpg`,
          thumbBuffer,
          {
            access: "public",
            contentType: "image/jpeg",
            token: process.env.BLOB_READ_WRITE_TOKEN,
            addRandomSuffix: false,
            allowOverwrite: true,
          },
        );
        thumbnailUrl = thumbBlob.url;
        console.log("Thumbnail Blob URL =", thumbnailUrl);
      }
    } catch (err) {
      console.warn("缩略图上传失败，继续：", (err as Error).message);
    }
  }

  banner("Step 5: 写入 src/lib/data/demo-seed.ts");
  const seedFile = renderSeedFile({
    input: DEMO_SEED_INPUT,
    result: analysis,
    videoUrl: blob.url,
    thumbnailUrl,
    durationSec: Number((completed.duration ?? 0).toFixed(2)),
  });
  const seedPath = resolve(__dirname, "..", "src/lib/data/demo-seed.ts");
  writeFileSync(seedPath, seedFile, "utf8");
  console.log("written:", seedPath);

  banner("Done. 客户首屏现在就是真实数据 + 真实数字人成片");
}

async function pollUntilCompleted(
  getStatus: (id: string) => Promise<{
    status: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    duration?: number;
    error?: string | null;
  }>,
  videoId: string,
) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await getStatus(videoId);
    console.log(
      `[${new Date().toLocaleTimeString()}] status=${status.status}` +
        (status.videoUrl ? " video_url=ready" : ""),
    );
    if (status.status === "completed") return status;
    if (status.status === "failed") {
      throw new Error("HeyGen 生成失败: " + (status.error ?? "unknown"));
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("HeyGen 轮询超时（6 分钟仍未完成）");
}

function renderSeedFile(args: {
  input: unknown;
  result: unknown;
  videoUrl: string;
  thumbnailUrl: string;
  durationSec: number;
}): string {
  const sourceField = (args.result as { source?: string })?.source ?? "unknown";
  return `/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/generate-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：${new Date().toISOString()}
 * 数据源：${sourceField}
 * HeyGen video_id 已下载并 mirrored 到 Vercel Blob，避免 7 天过期。
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = ${JSON.stringify(
    args.input,
    null,
    2,
  )};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = ${JSON.stringify(
    args.result,
    null,
    2,
  )};

export const DEMO_SEED_VIDEO_URL = ${JSON.stringify(args.videoUrl)};

export const DEMO_SEED_VIDEO_THUMBNAIL = ${JSON.stringify(args.thumbnailUrl)};

export const DEMO_SEED_VIDEO_DURATION_SEC = ${args.durationSec};
`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function banner(title: string) {
  console.log("\n" + "=".repeat(70));
  console.log("  " + title);
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("[generate-demo-seed] 失败：", err);
  process.exit(1);
});
