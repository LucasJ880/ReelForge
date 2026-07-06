/**
 * 用 v2 重生成的成片替换成片库里的旧记录（针对 CEO 验收打回的 4 支）。
 *
 * 与 publish 脚本的区别：不新建订单，而是找到已发布的同标题订单，
 * 上传 v2 mp4 到带版本号的新 Blob key（避免 CDN 缓存旧片），
 * 然后原地更新 FinalVideo / VideoBrief / VideoJob 的 URL 与参考图。
 *
 * 用法：
 *   npm run demo:curtain:replace              # 替换 submission-v2.json 里所有已下载的
 *   npm run demo:curtain:replace -- --only=3  # 只替换视频3
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

const db = new PrismaClient();
const OUTPUT_DIR = resolve(process.cwd(), "tmp/curtain-viral-ads");
const V1_PATH = resolve(OUTPUT_DIR, "submission.json");
const V2_PATH = resolve(OUTPUT_DIR, "submission-v2.json");
const TARGET_EMAIL = process.env.CURTAIN_PUBLISH_EMAIL || "demo@aivora.app";

/** 与 publish 脚本一致的成片库标题（用于定位既有订单） */
const LIBRARY_TITLES: Record<number, string> = {
  1: "窗帘爆款广告（15秒）· 成果前置 · 奶油奢华卧室",
  2: "窗帘爆款广告（15秒）· 空间焕新对比 · 卧室遮光改造",
  3: "窗帘爆款广告（15秒）· 痛点狙击 · 清晨刺眼阳光",
  4: "窗帘爆款广告（15秒）· 光影质感沉浸 · 白纱光影",
  5: "窗帘爆款广告（15秒）· 成果前置 · 通顶玻璃门",
};

type V2Record = {
  videos: Array<{
    index: number;
    title: string;
    imageKey: string;
    attempt: number;
    localPath?: string;
  }>;
};

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
    "-v", "error", "-ss", "1", "-i", videoPath,
    "-frames:v", "1", "-q:v", "3", outPath, "-y",
  ]);
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("缺少 BLOB_READ_WRITE_TOKEN");
  if (!existsSync(V2_PATH)) throw new Error(`找不到 ${V2_PATH}，先跑 npm run demo:curtain:v2`);

  const v2 = JSON.parse(readFileSync(V2_PATH, "utf8")) as V2Record;
  const v1 = JSON.parse(readFileSync(V1_PATH, "utf8")) as {
    imageBlobUrls: Record<string, string>;
  };

  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? Number(onlyArg.slice("--only=".length)) : null;

  const user = await db.adminUser.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error(`找不到账号 ${TARGET_EMAIL}`);

  for (const video of v2.videos) {
    if (only != null && video.index !== only) continue;
    if (!video.localPath || !existsSync(video.localPath)) {
      console.log(`  ⚠ 视频${video.index} 尚未下载，跳过`);
      continue;
    }
    const title = LIBRARY_TITLES[video.index];
    const order = await db.deliveryOrder.findFirst({
      where: { title, createdById: user.id },
      select: {
        id: true,
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1,
          select: {
            angles: {
              orderBy: { sortOrder: "asc" },
              take: 1,
              select: {
                videoBrief: {
                  select: { id: true, finalVideoId: true },
                },
              },
            },
          },
        },
      },
    });
    const brief = order?.rounds[0]?.angles[0]?.videoBrief;
    if (!order || !brief) {
      throw new Error(`成片库里找不到「${title}」，先跑 npm run demo:curtain:publish`);
    }

    console.log(`  ↻ 替换视频${video.index}「${title}」（attempt ${video.attempt}）`);
    const version = `v2a${video.attempt}`;
    const videoUrl = await uploadFile(
      video.localPath,
      `curtain-demo/final/curtain-viral-${video.index}-${version}.mp4`,
      "video/mp4",
    );
    const thumbLocal = resolve(OUTPUT_DIR, `video-${video.index}-${version}-thumb.jpg`);
    extractThumb(video.localPath, thumbLocal);
    const thumbUrl = await uploadFile(
      thumbLocal,
      `curtain-demo/final/curtain-viral-${video.index}-${version}-thumb.jpg`,
      "image/jpeg",
    );
    console.log(`    video → ${videoUrl}`);

    const refUrl = v1.imageBlobUrls[video.imageKey];
    await db.$transaction(async (tx) => {
      if (brief.finalVideoId) {
        await tx.finalVideo.update({
          where: { id: brief.finalVideoId },
          data: { stitchedVideoUrl: videoUrl, thumbnailUrl: thumbUrl, finishedAt: new Date() },
        });
      }
      await tx.videoBrief.update({
        where: { id: brief.id },
        data: {
          finalVideoUrl: videoUrl,
          finalThumbnailUrl: thumbUrl,
          referenceImageUrls: refUrl ? [refUrl] : undefined,
        },
      });
      await tx.videoJob.updateMany({
        where: { videoBriefId: brief.id },
        data: { outputVideoUrl: videoUrl, outputThumbUrl: thumbUrl, finishedAt: new Date() },
      });
      /// touch updatedAt 让成片库排序把替换过的片子顶上来
      await tx.deliveryOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
    });
    console.log(`    ✓ 库记录已更新 order=${order.id}`);
  }

  console.log("\n完成 — 成片库中的视频已替换为 v2 版本");
}

main()
  .catch((err) => {
    console.error("\n[replace-curtain-videos] 失败:", (err as Error).message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
