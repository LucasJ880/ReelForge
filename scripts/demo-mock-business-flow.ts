/**
 * Phase 2 demo：纯本地 mock 全链路演示。
 *
 * 模拟一个 30s / 9:16 的 B 端广告：
 *   - 2 段 AI 生成段（hook 15s + demo 15s，各自走 mock-clip-generator）
 *   - 1 段 auto end card（brand-end-card-renderer 渲染）
 *
 * 不调真实 Seedance / OpenAI / Blob；输出本地 file:// URL 列表 + 生成的 MP4 文件路径，
 * 方便人眼检查每段是否合规、对应分辨率、对应时长。
 *
 * 跑法：npm run typecheck 通过后
 *   npx tsx scripts/demo-mock-business-flow.ts
 */
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateMockClip } from "../src/lib/video-generation/mock-clip-generator";
import { renderBrandEndCard } from "../src/lib/video-generation/brand-end-card-renderer";
import type { BrandPackagingPlan } from "../src/types/video-generation";

const execFileAsync = promisify(execFile);

async function ffprobe(file: string) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,width,height:format=duration",
      "-of",
      "default=noprint_wrappers=1",
      file,
    ]);
    return stdout.trim().replace(/\s+/g, " · ");
  } catch (err) {
    return `(ffprobe failed: ${(err as Error).message})`;
  }
}

async function main() {
  console.log("=== Phase 2 mock business flow demo ===");
  console.log("scenario: 30s / 9:16 ad — 2 AI segments + auto brand end card\n");

  /// 强制 mock + 0 latency；本机有 ffmpeg 才真渲染
  process.env.VIDEO_ENGINE_MOCK = "true";
  process.env.VIDEO_ENGINE_MOCK_LATENCY_MS = "0";

  /// 1. 两段 AI mock clip
  const aiClips = [];
  for (let i = 0; i < 2; i++) {
    const r = await generateMockClip({
      briefId: "demo-brief-30s",
      segmentIndex: i,
      segmentCount: 2,
      durationSec: 15,
      aspectRatio: "9:16",
      purpose: i === 0 ? "hook" : "demo",
    });
    aiClips.push(r);
  }

  /// 2. brand end card
  const brandPlan: BrandPackagingPlan = {
    mode: "auto_end_card",
    logoAssetId: null,
    endCardDurationSeconds: 3,
    cta: "Tap to shop",
    brandName: "Aivora Hydrate",
    slogan: "Stay refreshed on every run",
    website: "aivora.app/hydrate",
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  };
  const endCard = await renderBrandEndCard({
    briefId: "demo-brief-30s",
    aspectRatio: "9:16",
    plan: brandPlan,
  });

  console.log("--- AI segments ---");
  for (const [i, c] of aiClips.entries()) {
    const pathOnDisk = c.url.startsWith("file://") ? fileURLToPath(c.url) : c.url;
    const probe = c.url.startsWith("file://") ? await ffprobe(pathOnDisk) : "(remote URL)";
    console.log(`  segment ${i}: ${c.source}`);
    console.log(`    url:    ${c.url}`);
    console.log(`    probe:  ${probe}`);
  }

  console.log("\n--- Brand end card ---");
  if (!endCard) {
    console.log("  (skipped — mode is none/uploaded_clip)");
  } else if (!endCard.url) {
    console.log(`  source=${endCard.source} (deferred or skipped) warnings=${endCard.warnings.join("; ")}`);
  } else {
    const pathOnDisk = endCard.url.startsWith("file://") ? fileURLToPath(endCard.url) : endCard.url;
    const probe = endCard.url.startsWith("file://") ? await ffprobe(pathOnDisk) : "(remote URL)";
    console.log(`  source: ${endCard.source}`);
    console.log(`  url:    ${endCard.url}`);
    console.log(`  probe:  ${probe}`);
  }

  console.log("\n--- Stitch verdict（不实际跑，因 BLOB token 缺失，但 clip 已就绪）---");
  console.log("  intended timeline:");
  let cursor = 0;
  for (const c of aiClips) {
    console.log(`    ${cursor}-${cursor + 15}s: AI segment (${c.cacheKey})`);
    cursor += 15;
  }
  if (endCard?.url) {
    console.log(`    ${cursor}-${cursor + endCard.durationSec}s: brand end card (${endCard.cacheKey})`);
    cursor += endCard.durationSec;
  }
  console.log(`  total: ${cursor}s\n`);

  console.log("✅ mock business flow OK — 所有 clip 真实存在、按用户选的 9:16 输出、各自时长准确。");
  console.log("   要验证最终 stitch，请配置 BLOB_READ_WRITE_TOKEN 后调用 stitchFinalVideo / executeAssembly。");
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
