/**
 * 对已生成的干净原片补跑「品牌封装 + 后期」。
 *
 * 用途：视频生成是全链路里最贵的一步，若封装阶段因代码问题失败，
 * 不应为验证修复而重跑生成。本脚本直接取批次里已成功的 VideoJob 产出，
 * 用当前代码重跑封装，并校验成片轨道。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/e2e-package-existing.ts [batchId]
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyClientBrandPackaging } from "@/lib/video-generation/brand-packaging-service";
import { postProductionPlanSchema } from "@/lib/schemas/unified-input";
import { readBatchPostProductionFromSnapshot } from "@/lib/services/batch-service";

const run = promisify(execFile);
const db = new PrismaClient();

async function probe(url: string): Promise<{
  hasAudio: boolean;
  durationSec: number;
  width: number;
  height: number;
}> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    url,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  return {
    hasAudio: Boolean(parsed.streams?.some((s) => s.codec_type === "audio")),
    durationSec: Number(parsed.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

async function main(): Promise<void> {
  const batchId = process.argv[2];
  const job = await db.videoJob.findFirst({
    where: {
      ...(batchId ? { batchJobId: batchId } : {}),
      status: "SUCCEEDED",
      outputVideoUrl: { not: null },
      batchJob: { isNot: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      outputVideoUrl: true,
      templateSnapshot: true,
      batchJob: { select: { id: true, userId: true } },
    },
  });
  if (!job?.outputVideoUrl) throw new Error("找不到已成功的批量成片");

  const parsed = postProductionPlanSchema.safeParse(
    readBatchPostProductionFromSnapshot(job.templateSnapshot),
  );
  const postProduction = parsed.success ? parsed.data : null;

  const clean = await probe(job.outputVideoUrl);
  console.log(`\n▸ 干净原片\n  ${job.outputVideoUrl}`);
  console.log(
    `  ${clean.width}x${clean.height} · ${clean.durationSec.toFixed(1)}s · 音轨=${clean.hasAudio}`,
  );
  console.log(
    `▸ 批次后期\n  ${
      postProduction
        ? `字幕=${postProduction.captions.style}(${postProduction.captions.enabled}) · BGM=${postProduction.audio.bgm.trackId}@${postProduction.audio.bgm.volume} · 脚本=${postProduction.audio.voiceover.script.length}字`
        : "无"
    }`,
  );

  const brandPack = await db.workspaceBrandPackage.findFirst({
    where: { isGlobal: true, isActive: true, clientProfileId: "sunnyshutter" },
    select: { name: true },
  });
  console.log(`▸ 品牌包\n  ${brandPack?.name ?? "（未找到）"}`);

  const workDir = mkdtempSync(join(tmpdir(), "e2e-pack-"));
  const sourcePath = join(workDir, "source.mp4");
  const res = await fetch(job.outputVideoUrl);
  await writeFile(sourcePath, Buffer.from(await res.arrayBuffer()));

  const packaged = await applyClientBrandPackaging({
    sourceVideoPath: sourcePath,
    clientProfileId: "sunnyshutter",
    options: {
      includeLogo: true,
      includeEndCard: true,
      aspectRatio: "9:16",
      postProduction,
    },
    outputDir: workDir,
    outputId: `pack-${Date.now().toString(36)}`,
  });

  const final = await probe(packaged.blobUrl);
  console.log(`\n▸ 封装成片\n  ${packaged.blobUrl}`);
  console.log(
    `  ${final.width}x${final.height} · ${final.durationSec.toFixed(1)}s · 音轨=${final.hasAudio}`,
  );
  console.log(
    `  裁尾=${packaged.steps.tailTrimmedSeconds}s · logo=${packaged.steps.logoApplied} · 尾卡=${packaged.steps.endCardApplied}`,
  );
  console.log(
    `  尾卡加长=${(final.durationSec - clean.durationSec).toFixed(1)}s`,
  );
  if (packaged.warnings.length) console.log(`  警告：${packaged.warnings.join("; ")}`);

  await db.videoJob.update({
    where: { id: job.id },
    data: { brandedVideoUrl: packaged.blobUrl, brandedAt: new Date() },
  });
  console.log(`\n✅ 已写回成品库（videoJob=${job.id}）`);
  console.log(`最终成片：${packaged.blobUrl}\n`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("\n❌ 封装失败：", error);
  await db.$disconnect();
  process.exit(1);
});
