/**
 * 恢复卡在「正在合成最终视频 85%」的 FinalVideo。
 *
 * 原则（成本硬约束）：
 *   - 绝不重新生成：只复用 DB 里已 SUCCEEDED 的分镜段（已付费资产）。
 *   - 只跑本地免费步骤：ffmpeg 归一化 + 拼接、缩略图抽帧、持久存储上传、DB 状态更新。
 *   - 必须在 AIVORA_DRY_RUN=1 + STITCH_RUNTIME=local 下运行（脚本自检，防误用）。
 *
 * 流程：
 *   1. 校验 FinalVideo 处于 PENDING 且所有段 SUCCEEDED（幂等：已 READY 直接跳过）。
 *   2. 走修复后的真实代码路径 stitchFinalVideo()（unified brief → assembly-executor →
 *      runFfmpegNormalizeAndConcat → persistStitchedFile 上传持久存储 → READY）。
 *      若段 URL 已过期（403），回退用 --local-seg 指定的本地保全文件（file:// URL 注入）。
 *   3. ffmpeg 抽首帧生成缩略图，上传持久存储，写回 thumbnailUrl / finalThumbnailUrl。
 *   4. ffprobe 验证最终 mp4 可播放，打印验收信息。
 *
 * 用法：
 *   AIVORA_DRY_RUN=1 STITCH_RUNTIME=local npx tsx scripts/recover-stuck-final-video.ts <finalVideoId> [--local-seg <segmentIndex>=<path> ...]
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

async function main() {
  if (process.env.AIVORA_DRY_RUN !== "1") {
    throw new Error("必须在 AIVORA_DRY_RUN=1 下运行（计费保险丝）");
  }
  if ((process.env.STITCH_RUNTIME ?? "").toLowerCase() !== "local") {
    throw new Error("必须设置 STITCH_RUNTIME=local（本地 ffmpeg 恢复）");
  }

  const args = process.argv.slice(2);
  const finalVideoId = args.find((a) => !a.startsWith("--"));
  if (!finalVideoId) throw new Error("用法: recover-stuck-final-video.ts <finalVideoId> [--local-seg 0=/path/seg-0.mp4]");

  /// --local-seg 0=/abs/path.mp4 —— 段 URL 过期时的本地保全文件回退
  const localSegs = new Map<number, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local-seg" && args[i + 1]) {
      const [idx, p] = args[i + 1].split("=");
      localSegs.set(Number(idx), path.resolve(p));
    }
  }

  /// 延迟 import：确保 loadEnvConfig 先生效
  const { db } = await import("../src/lib/db");
  const { stitchFinalVideo } = await import("../src/lib/services/stitch-service");

  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: { select: { id: true, status: true } },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });
  if (!fv) throw new Error(`FinalVideo ${finalVideoId} 不存在`);

  console.log(`[recover] FinalVideo ${fv.id} status=${fv.status} segments=${fv.segments.length}/${fv.segmentCount}`);

  if (fv.status === FinalVideoStatus.READY && fv.stitchedVideoUrl) {
    console.log(`[recover] 已是 READY，跳过（幂等）。stitchedVideoUrl=${fv.stitchedVideoUrl}`);
    await finalizeThumbnailAndVerify(fv.id);
    return;
  }

  const allSucceeded =
    fv.segments.length === fv.segmentCount &&
    fv.segments.every((s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl);
  if (!allSucceeded) {
    throw new Error("段未全部 SUCCEEDED，拒绝恢复（不允许触发任何重新生成）");
  }

  /// 段 URL 可达性检查；不可达且有本地保全文件 → 把 file:// URL 临时写进 DB 段记录
  /// （runFfmpegNormalizeAndConcat 原生支持 file://；这不会触发任何重新生成）
  for (const seg of fv.segments) {
    const url = seg.outputVideoUrl as string;
    let reachable = false;
    try {
      const res = await fetch(url, { method: "HEAD" });
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    if (!reachable) {
      const local = localSegs.get(seg.segmentIndex ?? 0);
      if (!local) {
        throw new Error(
          `段 #${seg.segmentIndex} URL 不可达且未提供 --local-seg 回退文件；请传入已保全的本地段文件`,
        );
      }
      const fileUrl = pathToFileURL(local).href;
      console.log(`[recover] 段 #${seg.segmentIndex} URL 已过期，使用本地保全文件: ${fileUrl}`);
      await db.videoJob.update({
        where: { id: seg.id },
        data: { outputVideoUrl: fileUrl },
      });
    } else {
      console.log(`[recover] 段 #${seg.segmentIndex} URL 可达 ✓`);
    }
  }

  /// 若之前被打过「awaiting external stitcher」占位 / FAILED，重置回 PENDING 再走状态机
  if (fv.status !== FinalVideoStatus.PENDING) {
    const reset = await db.finalVideo.updateMany({
      where: {
        id: fv.id,
        status: fv.status,
        stitchAttemptToken: fv.stitchAttemptToken,
      },
      data: {
        status: FinalVideoStatus.PENDING,
        ffmpegError: null,
        stitchAttemptToken: null,
      },
    });
    if (reset.count !== 1) {
      throw new Error("FinalVideo 状态已被其他 runner 更新，拒绝覆盖当前合成尝试");
    }
    console.log(`[recover] 状态 ${fv.status} → PENDING（重置以便领取）`);
  }

  console.log("[recover] 走真实代码路径 stitchFinalVideo()（本地 ffmpeg + 持久存储上传）...");
  const result = await stitchFinalVideo(fv.id);
  console.log(`[recover] stitch 结果: ok=${result.ok} status=${result.status} url=${result.stitchedVideoUrl ?? "null"} error=${result.error ?? "null"}`);

  if (!result.ok || !result.stitchedVideoUrl) {
    throw new Error(`恢复失败: ${result.error ?? "unknown"}`);
  }

  await finalizeThumbnailAndVerify(fv.id);
}

/**
 * 补缩略图（若缺）+ 终态验收打印。全部本地/免费步骤。
 */
async function finalizeThumbnailAndVerify(finalVideoId: string) {
  const { db } = await import("../src/lib/db");
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: { brief: { select: { id: true, status: true, finalVideoUrl: true, finalThumbnailUrl: true } } },
  });
  if (!fv?.stitchedVideoUrl) throw new Error("stitchedVideoUrl 缺失");

  const tmpDir = path.join(os.tmpdir(), `recover-verify-${finalVideoId}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    /// 下载成片验证可播放
    const res = await fetch(fv.stitchedVideoUrl);
    if (!res.ok) throw new Error(`成片 URL 不可达: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const localFinal = path.join(tmpDir, "final.mp4");
    await writeFile(localFinal, buf);
    const probe = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration,size",
        "-show_entries", "stream=codec_type,codec_name,width,height",
        "-of", "default=noprint_wrappers=1",
        localFinal,
      ],
      { encoding: "utf8" },
    );
    console.log(`[verify] 成片 ffprobe:\n${probe.trim()}`);

    /// 缺缩略图 → 本地抽首帧上传
    if (!fv.thumbnailUrl) {
      const thumbPath = path.join(tmpDir, "thumb.jpg");
      execFileSync(FFMPEG_BIN, [
        "-y", "-loglevel", "error",
        "-i", localFinal,
        "-vf", "select=eq(n\\,0),scale=540:-1",
        "-frames:v", "1",
        thumbPath,
      ]);
      const { getStorageProvider } = await import("../src/lib/storage");
      const storage = getStorageProvider();
      if (!storage.isConfigured()) throw new Error("storage provider 未配置，无法上传缩略图");
      const thumbBuf = await readFile(thumbPath);
      const obj = await storage.uploadBuffer("renders", thumbBuf, {
        key: `final-videos/${finalVideoId}/thumb-${Date.now()}.jpg`,
        access: "public",
        contentType: "image/jpeg",
        overwrite: true,
      });
      await db.finalVideo.update({
        where: { id: finalVideoId },
        data: { thumbnailUrl: obj.url },
      });
      if (fv.brief?.id) {
        await db.videoBrief.update({
          where: { id: fv.brief.id },
          data: { finalThumbnailUrl: obj.url },
        });
      }
      console.log(`[verify] 缩略图已生成并上传: ${obj.url}`);
    }

    const after = await db.finalVideo.findUnique({
      where: { id: finalVideoId },
      include: { brief: { select: { id: true, status: true, finalVideoUrl: true, finalThumbnailUrl: true } } },
    });
    console.log("[verify] 终态:");
    console.log(`  FinalVideo.status         = ${after?.status}`);
    console.log(`  FinalVideo.stitchedVideoUrl = ${after?.stitchedVideoUrl}`);
    console.log(`  FinalVideo.thumbnailUrl   = ${after?.thumbnailUrl}`);
    console.log(`  Brief.status              = ${after?.brief?.status}`);
    console.log(`  Brief.finalVideoUrl       = ${after?.brief?.finalVideoUrl}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[recover] 失败:", e);
    process.exit(1);
  });
