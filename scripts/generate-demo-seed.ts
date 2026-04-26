/**
 * 生成 /demo/ai-video 首屏种子数据：Seedance 豪宅 B-roll + HeyGen 商务数字人合成。
 *
 *   1. 调真实 Apify+OpenAI 分析 DEMO_SEED_INPUT.tiktokUrl
 *   2. 调 Seedance (火山方舟) 生成豪宅内景 9:16 背景视频
 *   3. 把 Seedance 视频 mirror 到 Vercel Blob 拿永久 URL
 *   4. 选择一个职业风 avatar（默认 Brandon in Grey Suit），用 Blob BG URL 提交 HeyGen
 *   5. 轮询 HeyGen 直到 completed
 *   6. 把 HeyGen 成片下载并 mirror 到 Vercel Blob
 *   7. 把所有结果写回 src/lib/data/demo-seed.ts
 *
 * 跑法：
 *   npx tsx scripts/generate-demo-seed.ts
 *
 * 复用环境变量：
 *   REUSE_HEYGEN_VIDEO_ID  跳过 HeyGen 提交，复用已有 video_id
 *   REUSE_BG_BLOB_URL      跳过 Seedance，复用已有背景 mp4 URL
 *   SEED_AVATAR_ID         覆盖 avatar，默认 Brandon_expressive2_public
 *
 * 一次完整 run 大致消耗：HeyGen ≈ $0.5 + Seedance ≈ ¥1 + Apify+OpenAI < $0.05。
 */
import { loadEnvConfig } from "@next/env";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

const HEYGEN_POLL_INTERVAL_MS = 10_000;
const HEYGEN_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = 8_000;
const SEEDANCE_POLL_TIMEOUT_MS = 8 * 60 * 1000;

const DEFAULT_AVATAR_ID = "Brandon_expressive2_public";
const SEEDANCE_BG_PROMPT =
  "Slow cinematic dolly forward through a luxury modern living room. Floor-to-ceiling glass windows showing golden hour sunset over Los Angeles hillside. Polished marble floors, minimalist designer sofa, soft warm natural light. Premium real estate photography mood. 9:16 vertical, ultra HD, cinematic, no people, gentle smooth camera push-in.";

async function main() {
  const { put } = await import("@vercel/blob");
  const { analyzeDemoReferenceVideo } = await import(
    "../src/lib/services/demo-video-analysis-service"
  );
  const { getHeyGenProofStatus, submitHeyGenProof } = await import(
    "../src/lib/providers/digital-human"
  );
  const { submitSeedanceJob, getSeedanceStatus } = await import(
    "../src/lib/providers/seedance"
  );
  const { DEMO_SEED_INPUT } = await import("../src/lib/data/demo-seed");

  banner("Step 1: 调 Apify + OpenAI 分析参考视频");
  console.log("OPENAI_API_KEY loaded =", !!process.env.OPENAI_API_KEY);
  console.log("APIFY_TOKEN loaded =", !!process.env.APIFY_TOKEN);
  console.log("HEYGEN_API_KEY loaded =", !!process.env.HEYGEN_API_KEY);
  console.log("ARK_API_KEY loaded =", !!process.env.ARK_API_KEY);
  console.log("BLOB_READ_WRITE_TOKEN loaded =", !!process.env.BLOB_READ_WRITE_TOKEN);
  const analysis = await analyzeDemoReferenceVideo(DEMO_SEED_INPUT);
  console.log("source =", analysis.source);
  console.log("scene plan length =", analysis.clientVersion.scenePlan.length);

  banner("Step 2: 用 Seedance 生成豪宅内景背景视频");
  let bgBlobUrl = process.env.REUSE_BG_BLOB_URL?.trim() || "";
  if (bgBlobUrl) {
    console.log("reusing background:", bgBlobUrl);
  } else {
    console.log("seedance prompt:", SEEDANCE_BG_PROMPT.slice(0, 90) + "…");
    const submitted = await submitSeedanceJob({
      prompt: SEEDANCE_BG_PROMPT,
      duration: 10,
      ratio: "9:16",
    });
    console.log("seedance jobId =", submitted.jobId);
    const seedanceResult = await pollSeedanceUntilDone(getSeedanceStatus, submitted.jobId);
    if (!seedanceResult.videoUrl) {
      throw new Error("Seedance completed 但没有 video_url");
    }
    console.log("seedance video_url:", seedanceResult.videoUrl.slice(0, 80) + "…");

    banner("Step 3: 把 Seedance 视频 mirror 到 Vercel Blob");
    const bgResp = await fetch(seedanceResult.videoUrl);
    if (!bgResp.ok) throw new Error(`下载 Seedance mp4 失败 status=${bgResp.status}`);
    const bgBuffer = Buffer.from(await bgResp.arrayBuffer());
    const bgBlob = await put(`demo-seed/seedance-bg-${submitted.jobId}.mp4`, bgBuffer, {
      access: "public",
      contentType: "video/mp4",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    bgBlobUrl = bgBlob.url;
    console.log("BG Blob URL =", bgBlobUrl);
  }

  banner("Step 4: 提交 HeyGen 商务数字人 + Seedance 背景");
  const reuseId = process.env.REUSE_HEYGEN_VIDEO_ID?.trim();
  const proof = reuseId
    ? {
        provider: "heygen" as const,
        status: "submitted" as const,
        jobId: reuseId,
        avatarId: process.env.SEED_AVATAR_ID || DEFAULT_AVATAR_ID,
        voiceId: process.env.HEYGEN_VOICE_ID || "",
      }
    : await submitHeyGenProof({
        title: analysis.clientVersion.title,
        script: analysis.clientVersion.digitalHumanScript,
        avatarId: process.env.SEED_AVATAR_ID || DEFAULT_AVATAR_ID,
        backgroundVideoUrl: bgBlobUrl,
      });
  console.log(reuseId ? "reused video_id =" : "submitted video_id =", proof.jobId);
  console.log("avatar_id =", proof.avatarId);

  banner("Step 5: 轮询 HeyGen 状态");
  const completed = await pollHeyGenUntilCompleted(getHeyGenProofStatus, proof.jobId);
  if (!completed.videoUrl) {
    throw new Error("HeyGen completed 但没有 video_url");
  }
  console.log("HeyGen video_url =", completed.videoUrl.slice(0, 80) + "…");
  console.log("duration =", completed.duration, "s");

  banner("Step 6: 下载 HeyGen 成片并上传 Vercel Blob");
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
  console.log("HeyGen Blob URL =", blob.url);

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

  banner("Step 7: 写入 src/lib/data/demo-seed.ts");
  const seedFile = renderSeedFile({
    input: DEMO_SEED_INPUT,
    result: analysis,
    videoUrl: blob.url,
    thumbnailUrl,
    durationSec: Number((completed.duration ?? 0).toFixed(2)),
    backgroundVideoUrl: bgBlobUrl,
    avatarId: proof.avatarId,
  });
  const seedPath = resolve(__dirname, "..", "src/lib/data/demo-seed.ts");
  writeFileSync(seedPath, seedFile, "utf8");
  console.log("written:", seedPath);

  banner("Done. 现在的首屏视频是：经纪在豪宅前讲解");
}

async function pollSeedanceUntilDone(
  getStatus: (id: string) => Promise<{
    status: string;
    videoUrl?: string;
    errorMessage?: string;
    progress?: number;
  }>,
  jobId: string,
) {
  const start = Date.now();
  while (Date.now() - start < SEEDANCE_POLL_TIMEOUT_MS) {
    const r = await getStatus(jobId);
    console.log(
      `[seedance ${new Date().toLocaleTimeString()}] status=${r.status}` +
        (r.progress ? ` progress=${r.progress}%` : ""),
    );
    if (r.status === "completed") return r;
    if (r.status === "failed") {
      throw new Error("Seedance 失败: " + (r.errorMessage ?? "unknown"));
    }
    await sleep(SEEDANCE_POLL_INTERVAL_MS);
  }
  throw new Error("Seedance 轮询超时");
}

async function pollHeyGenUntilCompleted(
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
  while (Date.now() - start < HEYGEN_POLL_TIMEOUT_MS) {
    const status = await getStatus(videoId);
    console.log(
      `[heygen ${new Date().toLocaleTimeString()}] status=${status.status}` +
        (status.videoUrl ? " video_url=ready" : ""),
    );
    if (status.status === "completed") return status;
    if (status.status === "failed") {
      throw new Error("HeyGen 生成失败: " + (status.error ?? "unknown"));
    }
    await sleep(HEYGEN_POLL_INTERVAL_MS);
  }
  throw new Error("HeyGen 轮询超时（15 分钟仍未完成）");
}

function renderSeedFile(args: {
  input: unknown;
  result: unknown;
  videoUrl: string;
  thumbnailUrl: string;
  durationSec: number;
  backgroundVideoUrl: string;
  avatarId: string;
}): string {
  const sourceField = (args.result as { source?: string })?.source ?? "unknown";
  return `/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/generate-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：${new Date().toISOString()}
 * 数据源：${sourceField}
 * Avatar: ${args.avatarId}
 * Background: Seedance 豪宅内景 (mirrored to Blob)
 * HeyGen video_id 已下载并 mirrored 到 Vercel Blob，避免 7 天过期。
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = ${JSON.stringify(args.input, null, 2)};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = ${JSON.stringify(args.result, null, 2)};

export const DEMO_SEED_VIDEO_URL = ${JSON.stringify(args.videoUrl)};

export const DEMO_SEED_VIDEO_THUMBNAIL = ${JSON.stringify(args.thumbnailUrl)};

export const DEMO_SEED_VIDEO_DURATION_SEC = ${args.durationSec};

export const DEMO_SEED_BACKGROUND_VIDEO_URL = ${JSON.stringify(args.backgroundVideoUrl)};

export const DEMO_SEED_AVATAR_ID = ${JSON.stringify(args.avatarId)};
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
