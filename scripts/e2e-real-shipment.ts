/**
 * 0728 真机全链路出片验收（会产生真实供应商费用）。
 *
 * 生成阶段走与 /api/batches 相同的生产路径：
 *   createBatchJob（含批次级后期快照）→ 配额授权 → processBatchTick 派发 Shuyu
 *   → 轮询到 SUCCEEDED。随后脚本显式调用品牌封装（全局 SunnyShutter 品牌包
 *   + 授权 BGM），该后半段是验收动作，不代表批量创建页会自动封装。
 *   → 校验成片轨道与成品库可见性
 *
 * 产品素材复用 SunnyShutter 真实上传图（bill@sunnyshutter.ca）。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/e2e-real-shipment.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient, StyleTemplateStatus } from "@prisma/client";
import { createBatchJob, processBatchTick } from "@/lib/services/batch-service";
import { authorizeBatchQuotaForSession } from "@/lib/services/quota-service";
import { applyClientBrandPackaging } from "@/lib/video-generation/brand-packaging-service";
import { findWorkspaceBrandPackageForUser } from "@/lib/services/workspace-brand-package-service";
import { postProductionPlanSchema } from "@/lib/schemas/unified-input";
import { readBatchPostProductionFromSnapshot } from "@/lib/services/batch-service";
import type { Session } from "next-auth";

const run = promisify(execFile);
const db = new PrismaClient();

const ACCOUNT = "bill@sunnyshutter.ca";
const TEMPLATE_SLUG = "commerce-single-feature-proof";
const POLL_INTERVAL_MS = 20_000;
/// 0728 实测：合作方渲染一条 15s 视频排队 + 出片可超过 15 分钟，
/// 超时放宽到 40 分钟，避免把正常的慢渲染误判成失败而重复计费重跑。
const POLL_TIMEOUT_MS = 40 * 60_000;

/**
 * 验收专用后期设置：脚本在生成完成后显式铺授权 BGM。
 * 口播由 Shuyu 根据 prompt 原生生成，本脚本不调用任何外部 TTS；
 * 字幕关闭，避免在无用户确认脚本时烧录文字。
 */
const POST_PRODUCTION = {
  audio: {
    voiceover: {
      enabled: false,
      voiceId: "warm-confident",
      language: "en-US",
      script: "",
    },
    bgm: { trackId: "wholesome" as const, volume: 0.18 },
  },
  captions: {
    enabled: false,
    style: "plain" as const,
    language: "en-US",
    position: "bottom" as const,
    exportSrt: false,
  },
};

function log(step: string, detail = ""): void {
  console.log(`\n▸ ${step}${detail ? `\n  ${detail}` : ""}`);
}

async function probeStreams(url: string): Promise<{
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
  const user = await db.adminUser.findUnique({
    where: { email: ACCOUNT },
    select: { id: true, email: true, role: true },
  });
  if (!user) throw new Error(`找不到账号 ${ACCOUNT}`);

  const template = await db.styleTemplate.findFirst({
    where: { slug: TEMPLATE_SLUG, status: StyleTemplateStatus.ACTIVE },
  });
  if (!template) throw new Error(`模板未激活：${TEMPLATE_SLUG}`);

  /// 只取真实上传原图，排除历史故事板帧（renders/storyboards/…）。
  const images = await db.mediaAsset.findMany({
    where: {
      userId: user.id,
      mimeType: { startsWith: "image/" },
      url: { contains: "/uploads/" },
    },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, url: true },
  });
  if (images.length < 1) throw new Error("该账号没有可用的真实产品图");

  log("素材与模板", [
    `账号：${user.email}`,
    `模板：${template.nameZh}（${template.slug} v${template.version}）`,
    `产品图：${images.length} 张真实上传图`,
    `验收后期：脚本显式铺授权 BGM(${POST_PRODUCTION.audio.bgm.trackId} @ ${POST_PRODUCTION.audio.bgm.volume})`,
  ].join("\n  "));

  // ---- 1. 创建批次（与 API 同路径，含批次级后期） ----
  const batch = await createBatchJob({
    userId: user.id,
    templateId: template.id,
    templateVersion: template.version,
    images: images.map((i) => ({ id: i.id, url: i.url })),
    requestedCount: 1,
    productName: "Custom zebra shades",
    idempotencyKey: `e2e-real-${Date.now()}`,
    isInternalStaff: false,
    postProduction: POST_PRODUCTION,
  });
  log("批次已创建", `batchId=${batch.id}`);

  // 后期确实写进了每条任务的快照
  const firstJob = await db.videoJob.findFirst({
    where: { batchJobId: batch.id },
    select: { id: true, templateSnapshot: true, promptText: true },
  });
  const snapPost = postProductionPlanSchema.safeParse(
    readBatchPostProductionFromSnapshot(firstJob?.templateSnapshot),
  );
  log(
    "后期设置随任务持久化",
    snapPost.success
      ? `✅ 读回成功：字幕=${snapPost.data.captions.style} / BGM=${snapPost.data.audio.bgm.trackId} / 口播=${snapPost.data.audio.voiceover.enabled}`
      : "❌ 快照读回失败",
  );
  log("确定性 prompt", `${firstJob?.promptText?.length ?? 0} 字符（模板骨架填空，无 LLM 介入）`);

  // ---- 2. 配额授权 + 派发 ----
  const session = {
    user: { id: user.id, email: user.email, role: user.role },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session;
  await authorizeBatchQuotaForSession(session, batch.id);
  log("配额已授权", "与前端提交同一条链路");

  await processBatchTick(batch.id);
  log("已派发到生成供应商", "开始轮询");

  // ---- 3. 轮询到成片 ----
  const startedAt = Date.now();
  let job = await db.videoJob.findFirstOrThrow({
    where: { batchJobId: batch.id },
    select: { id: true, status: true, outputVideoUrl: true, errorMessage: true },
  });
  while (
    !["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status) &&
    Date.now() - startedAt < POLL_TIMEOUT_MS
  ) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    await processBatchTick(batch.id).catch(() => undefined);
    job = await db.videoJob.findFirstOrThrow({
      where: { batchJobId: batch.id },
      select: { id: true, status: true, outputVideoUrl: true, errorMessage: true },
    });
    process.stdout.write(`  ${Math.round((Date.now() - startedAt) / 1000)}s → ${job.status}\n`);
  }
  if (job.status !== "SUCCEEDED" || !job.outputVideoUrl) {
    throw new Error(`生成未成功：${job.status} ${job.errorMessage ?? ""}`);
  }
  const clean = await probeStreams(job.outputVideoUrl);
  log("干净原片已产出", [
    job.outputVideoUrl,
    `${clean.width}x${clean.height} · ${clean.durationSec.toFixed(1)}s · 原生音轨=${clean.hasAudio ? "有" : "本次无（封装时仍会加入显式配置的 BGM）"}`,
  ].join("\n  "));

  // ---- 4. 验收脚本显式执行品牌封装 + 后期烧录 ----
  const brandPack = await db.workspaceBrandPackage.findFirst({
    where: { isGlobal: true, isActive: true, clientProfileId: "sunnyshutter" },
    select: { id: true, name: true },
  });
  if (!brandPack) throw new Error("找不到全局 SunnyShutter 品牌包");
  const resolved = await findWorkspaceBrandPackageForUser(brandPack.id, user.id);
  if (!resolved) throw new Error("全局品牌包对该用户不可见");
  log("品牌包已解析", `${brandPack.name}（全局只读，任何账号可选）`);

  const workDir = mkdtempSync(join(tmpdir(), "e2e-brand-"));
  const sourcePath = join(workDir, "source.mp4");
  const res = await fetch(job.outputVideoUrl);
  await Bun_writeFile(sourcePath, Buffer.from(await res.arrayBuffer()));

  const packaged = await applyClientBrandPackaging({
    sourceVideoPath: sourcePath,
    clientProfileId: "sunnyshutter",
    options: {
      includeLogo: true,
      includeEndCard: true,
      aspectRatio: "9:16",
      postProduction: POST_PRODUCTION,
    },
    outputDir: workDir,
    outputId: `e2e-${Date.now().toString(36)}`,
  });
  const final = await probeStreams(packaged.blobUrl);
  log("品牌封装 + 后期完成", [
    packaged.blobUrl,
    `${final.width}x${final.height} · ${final.durationSec.toFixed(1)}s · 音轨=${final.hasAudio}`,
    `裁尾=${packaged.steps.tailTrimmedSeconds}s · logo=${packaged.steps.logoApplied} · 尾卡=${packaged.steps.endCardApplied}`,
    packaged.warnings.length ? `警告：${packaged.warnings.join("; ")}` : "无警告",
  ].join("\n  "));

  await db.videoJob.update({
    where: { id: job.id },
    data: { brandedVideoUrl: packaged.blobUrl, brandedAt: new Date() },
  });

  // ---- 5. 成品库可见性 ----
  const visible = await db.videoJob.findUnique({
    where: { id: job.id },
    select: { status: true, outputVideoUrl: true, brandedVideoUrl: true },
  });
  log("成品库可见性", [
    `状态=${visible?.status}`,
    `可播原片=${Boolean(visible?.outputVideoUrl)}`,
    `已封装成片=${Boolean(visible?.brandedVideoUrl)}`,
    `尾卡加长=${(final.durationSec - clean.durationSec).toFixed(1)}s`,
  ].join(" · "));

  console.log(`\n✅ 全链路通过。最终成片：\n${packaged.blobUrl}\n`);
  await db.$disconnect();
}

/** 小工具：避免额外依赖 fs/promises 的具名导入冲突。 */
async function Bun_writeFile(path: string, data: Buffer): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, data);
}

main().catch(async (error) => {
  console.error("\n❌ 验收失败：", error);
  await db.$disconnect();
  process.exit(1);
});
