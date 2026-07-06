/**
 * 把 demo:curtain 出的 5 支窗帘成片发布进平台成片库（demo 账号可见）。
 *
 * 做三件事（幂等，可重复跑）：
 *   1. 本地 mp4 → Vercel Blob 永久地址（Seedance 临时链接 24h 过期，不能直接入库）
 *   2. ffmpeg 抽首帧 → 封面图上传 Blob
 *   3. 按平台数据结构补建 DeliveryOrder → Round → ContentAngle → VideoBrief
 *      → FinalVideo(READY) → VideoJob(SUCCEEDED)，成片库/详情页正常渲染
 *
 * 用法：
 *   npm run demo:curtain:publish                     # 发布到 demo@aivora.app
 *   CURTAIN_PUBLISH_EMAIL=xx@yy npm run demo:curtain:publish
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { put } from "@vercel/blob";
import {
  AngleType,
  DeliveryOrderStatus,
  FinalVideoStatus,
  PrismaClient,
  RoundStatus,
  VideoBriefStatus,
  VideoJobStatus,
  VideoProvider,
} from "@prisma/client";

loadEnvConfig(process.cwd());

const db = new PrismaClient();
const OUTPUT_DIR = resolve(process.cwd(), "tmp/curtain-viral-ads");
const SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission.json");
const TARGET_EMAIL = process.env.CURTAIN_PUBLISH_EMAIL || "demo@aivora.app";

/** 成片库里展示的客户友好标题（不暴露内部模版 id） */
const TITLES: Record<number, { title: string; hook: string }> = {
  1: {
    title: "窗帘爆款广告（15秒）· 成果前置 · 奶油奢华卧室",
    hook: "前2秒直接甩成品效果，倒叙揭秘细节，高级感拉满",
  },
  2: {
    title: "窗帘爆款广告（15秒）· 空间焕新对比 · 卧室遮光改造",
    hook: "同机位空窗 vs 装帘硬切对比，换装瞬间强冲击",
  },
  3: {
    title: "窗帘爆款广告（15秒）· 痛点狙击 · 清晨刺眼阳光",
    hook: "被晒醒的真实痛点开场，一拉遮光帘一步解决",
  },
  4: {
    title: "窗帘爆款广告（15秒）· 光影质感沉浸 · 白纱光影",
    hook: "逆光织纹微距+光影流动，无口播纯质感品牌片",
  },
  5: {
    title: "窗帘爆款广告（15秒）· 成果前置 · 通顶玻璃门",
    hook: "通顶蛇形帘顺滑开合，大玻璃门空间瞬间显高",
  },
};

type SubmissionRecord = {
  imageBlobUrls: Record<string, string>;
  videos: Array<{
    index: number;
    title: string;
    templateId: string;
    imageKeys: string[];
    externalJobId?: string;
    localPath?: string;
  }>;
};

function banner(t: string) {
  console.log(`\n${"=".repeat(72)}\n${t}\n${"=".repeat(72)}`);
}

async function uploadFile(localPath: string, blobKey: string, contentType: string) {
  const blob = await put(blobKey, readFileSync(localPath), {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

function extractThumb(videoPath: string, outPath: string) {
  execFileSync("ffmpeg", [
    "-v", "error",
    "-ss", "1",
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
    "-y",
  ]);
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("缺少 BLOB_READ_WRITE_TOKEN");
  if (!existsSync(SUBMISSION_PATH)) {
    throw new Error(`找不到 ${SUBMISSION_PATH}，先跑 npm run demo:curtain`);
  }
  const record = JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;

  const user = await db.adminUser.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error(`找不到账号 ${TARGET_EMAIL}`);
  banner(`发布 5 支窗帘成片到成片库 → ${user.email}（${user.userType}）`);

  for (const video of record.videos) {
    const meta = TITLES[video.index];
    const localPath = resolve(OUTPUT_DIR, `video-${video.index}.mp4`);
    if (!existsSync(localPath)) {
      throw new Error(`本地成片缺失：${localPath}（先跑 npm run demo:curtain -- --phase=wait）`);
    }

    /// 幂等：同标题订单已存在则跳过
    const existing = await db.deliveryOrder.findFirst({
      where: { title: meta.title, createdById: user.id },
    });
    if (existing) {
      console.log(`  ✓ 视频${video.index} 已在库中（${existing.id}），跳过`);
      continue;
    }

    console.log(`  ↑ 视频${video.index}「${meta.title}」`);
    const videoUrl = await uploadFile(
      localPath,
      `curtain-demo/final/curtain-viral-${video.index}.mp4`,
      "video/mp4",
    );
    const thumbLocal = resolve(OUTPUT_DIR, `video-${video.index}-thumb.jpg`);
    extractThumb(localPath, thumbLocal);
    const thumbUrl = await uploadFile(
      thumbLocal,
      `curtain-demo/final/curtain-viral-${video.index}-thumb.jpg`,
      "image/jpeg",
    );
    console.log(`    video → ${videoUrl}`);
    console.log(`    thumb → ${thumbUrl}`);

    const referenceImageUrls = video.imageKeys
      .map((k) => record.imageBlobUrls[k])
      .filter(Boolean);

    await db.$transaction(async (tx) => {
      const order = await tx.deliveryOrder.create({
        data: {
          title: meta.title,
          status: DeliveryOrderStatus.ROUND_ACTIVE,
          productCategory: "unified_input",
          targetPlatform: "tiktok",
          targetCountry: "CN",
          targetLanguage: "zh",
          productInput: {
            source: "unified_input",
            userType: "personal",
            rawPrompt: meta.title,
            publishedBy: "scripts/publish-curtain-videos-to-library.ts",
            styleTemplateId: video.templateId,
          },
          maxRounds: 1,
          createdById: user.id,
        },
      });
      const round = await tx.round.create({
        data: {
          deliveryOrderId: order.id,
          roundIndex: 1,
          status: RoundStatus.ANGLES_READY,
          optimizationSlots: 1,
          explorationSlots: 0,
          startedAt: new Date(),
        },
      });
      const angle = await tx.contentAngle.create({
        data: {
          roundId: round.id,
          sortOrder: 0,
          type: AngleType.OPTIMIZATION,
          title: meta.title,
          hook: meta.hook,
        },
      });
      const finalVideo = await tx.finalVideo.create({
        data: {
          targetDurationSec: 15,
          segmentCount: 1,
          status: FinalVideoStatus.READY,
          stitchedVideoUrl: videoUrl,
          thumbnailUrl: thumbUrl,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
      const brief = await tx.videoBrief.create({
        data: {
          contentAngleId: angle.id,
          status: VideoBriefStatus.QA_PENDING,
          durationSec: 15,
          targetDurationSec: 15,
          aspectRatio: "9:16",
          tone: "viral-ad",
          persona: "PERSONAL",
          referenceImageUrls,
          finalVideoUrl: videoUrl,
          finalThumbnailUrl: thumbUrl,
          finalVideoId: finalVideo.id,
        },
      });
      await tx.videoJob.create({
        data: {
          videoBriefId: brief.id,
          provider: VideoProvider.SEEDANCE_T2V,
          externalJobId: video.externalJobId ?? null,
          status: VideoJobStatus.SUCCEEDED,
          outputVideoUrl: videoUrl,
          outputThumbUrl: thumbUrl,
          segmentIndex: 0,
          segmentDurationSec: 15,
          finalVideoId: finalVideo.id,
          submittedAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
          lastProviderStatus: "succeeded",
        },
      });
      console.log(`    库记录 → order=${order.id} brief=${brief.id}`);
    });
  }

  banner("完成 — 刷新成片库即可看到 5 支窗帘视频");
}

main()
  .catch((err) => {
    console.error("\n[publish-curtain-videos] 失败:", (err as Error).message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
