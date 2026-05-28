import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { AdEditPlanStatus, Prisma, VideoBriefStatus, VideoJobStatus, VideoProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import {
  parseAdEditTimeline,
  type AdEditTimeline,
  type TimelineClip,
} from "@/lib/schemas/ad-edit-plan";

const execFileAsync = promisify(execFile);

const SUPPORTED_VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const SUPPORTED_IMAGE_EXT = /\.(png|jpe?g|webp)(\?|$)/i;
const OUTPUT_SIZE = "1080:1920";

let drawtextSupportPromise: Promise<boolean> | null = null;

export async function renderAdEditPlan(planId: string) {
  const plan = await db.adEditPlan.findUnique({
    where: { id: planId },
    include: { videoBrief: true },
  });
  if (!plan) throw new Error("剪辑计划不存在");

  const job = await db.videoJob.create({
    data: {
      videoBriefId: plan.videoBriefId,
      provider: VideoProvider.FFMPEG_EDIT,
      status: VideoJobStatus.RUNNING,
      externalJobId: `local-${randomUUID()}`,
      startedAt: new Date(),
    },
  });

  await db.adEditPlan.update({
    where: { id: planId },
    data: { status: AdEditPlanStatus.RENDERING, errorMessage: null },
  });
  await db.videoBrief.update({
    where: { id: plan.videoBriefId },
    data: { status: VideoBriefStatus.RENDERING },
  });

  try {
    const timeline = parseAdEditTimeline(plan.timeline);
    const result =
      process.env.ENABLE_FFMPEG_RENDER === "true"
        ? await renderWithFfmpeg(plan, timeline)
        : await renderManifestFallback(
            plan,
            timeline,
            "FFmpeg 渲染未开启：当前环境缺少 ENABLE_FFMPEG_RENDER=true，因此没有导出真实 MP4，系统返回 manifest fallback 供审核",
          );

    await db.videoJob.update({
      where: { id: job.id },
      data: {
        status: VideoJobStatus.SUCCEEDED,
        outputVideoUrl: result.videoUrl,
        outputThumbUrl: result.thumbnailUrl,
        errorMessage: result.fallbackReason ?? null,
        finishedAt: new Date(),
      },
    });
    const updatedPlan = await db.adEditPlan.update({
      where: { id: plan.id },
      data: {
        status: AdEditPlanStatus.RENDERED,
        outputVideoUrl: result.videoUrl,
        outputThumbnailUrl: result.thumbnailUrl,
        errorMessage: result.fallbackReason ?? null,
      },
    });
    await db.videoBrief.update({
      where: { id: plan.videoBriefId },
      data: {
        status: VideoBriefStatus.QA_PENDING,
        finalVideoUrl: result.videoUrl,
        finalThumbnailUrl: result.thumbnailUrl,
      },
    });
    await ensureQAPending(plan.videoBriefId);
    return updatedPlan;
  } catch (err) {
    await db.videoJob.update({
      where: { id: job.id },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    await db.adEditPlan.update({
      where: { id: plan.id },
      data: {
        status: AdEditPlanStatus.FAILED,
        errorMessage: (err as Error).message,
      },
    });
    await db.videoBrief.update({
      where: { id: plan.videoBriefId },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage: (err as Error).message,
      },
    });
    throw err;
  }
}

export async function renderLatestPlanForBrief(briefId: string) {
  const plan = await db.adEditPlan.findFirst({
    where: { videoBriefId: briefId, status: { in: ["READY", "REVIEWED", "RENDERED"] } },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });
  if (!plan) throw new Error("该 Brief 尚未生成 AdEditPlan");
  return renderAdEditPlan(plan.id);
}

async function renderWithFfmpeg(plan: {
  id: string;
  title: string;
  aspectRatio: string;
  timeline: Prisma.JsonValue;
}, timeline: AdEditTimeline) {
  const clips = validateRenderableClips(timeline.clips);
  if (plan.aspectRatio !== "9:16" || timeline.render.aspectRatio !== "9:16") {
    throw new Error(`FFmpeg 渲染仅支持 9:16，当前 plan=${plan.aspectRatio}, timeline=${timeline.render.aspectRatio}`);
  }

  const tmpDir = path.join(os.tmpdir(), `aivora-render-${plan.id}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const segments = [];
    let cursorMs = 0;
    const canDrawText = await ffmpegSupportsDrawtext();
    for (const [index, clip] of clips.entries()) {
      const output = path.join(tmpDir, `segment-${index}.mp4`);
      const durationMs = Math.max(500, clip.durationMs || clip.endMs - clip.startMs);
      const durationSec = durationMs / 1000;
      const filter = buildVideoFilter(timeline, cursorMs, durationMs, canDrawText);
      try {
        await execFileAsync("ffmpeg", buildSegmentArgs(clip, durationSec, filter, output), {
          maxBuffer: 1024 * 1024 * 10,
        });
      } catch (err) {
        throw new Error(
          `FFmpeg 渲染失败：第 ${index + 1} 个 clip 处理失败。请确认素材 URL 可以被服务器访问、格式为 mp4/mov/m4v/webm/png/jpg/webp，且 startMs/endMs 落在素材时长内。sourceUrl=${clip.sourceUrl}；底层原因=${(err as Error).message}`,
        );
      }
      segments.push(output);
      cursorMs += durationMs;
    }

    const concatFile = path.join(tmpDir, "concat.txt");
    await writeFile(
      concatFile,
      segments.map((segment) => `file '${segment.replaceAll("'", "'\\''")}'`).join("\n"),
      "utf8",
    );
    const output = path.join(tmpDir, "final.mp4");
    try {
      await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output,
      ], { maxBuffer: 1024 * 1024 * 10 });
    } catch (err) {
      throw new Error(`FFmpeg 渲染失败：多 clip 拼接失败。请检查所有片段是否能转码为统一的 9:16 H.264 MP4，并确认服务器有足够临时磁盘空间。底层原因=${(err as Error).message}`);
    }

    const videoUrl = await persistRenderedFile(output, `renders/${plan.id}.mp4`);
    return { videoUrl, thumbnailUrl: null, fallbackReason: null };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function ffmpegSupportsDrawtext() {
  drawtextSupportPromise ??= execFileAsync("ffmpeg", ["-hide_banner", "-filters"], {
    maxBuffer: 1024 * 1024 * 5,
  })
    .then(({ stdout, stderr }) => `${stdout}\n${stderr}`.includes("drawtext"))
    .catch(() => false);
  return drawtextSupportPromise;
}

async function renderManifestFallback(plan: {
  id: string;
  title: string;
  timeline: Prisma.JsonValue;
}, timeline: AdEditTimeline, reason: string) {
  const firstClip = timeline.clips[0];
  const manifest = {
    ...buildRenderFallbackManifest({
      planId: plan.id,
      title: plan.title,
      reason,
      timeline: plan.timeline,
    }),
  };

  const storage = getStorageProvider();
  if (storage.isConfigured()) {
    const obj = await storage.uploadBuffer(
      "renders",
      Buffer.from(JSON.stringify(manifest, null, 2)),
      {
        key: `renders/${plan.id}.json`,
        access: "public",
        contentType: "application/json",
        overwrite: true,
      },
    );
    return {
      videoUrl: firstClip?.sourceUrl ?? obj.url,
      thumbnailUrl: obj.url,
      fallbackReason: manifest.fallbackReason,
    };
  }

  return {
    videoUrl:
      firstClip?.sourceUrl ??
      `data:application/json;base64,${Buffer.from(JSON.stringify(manifest)).toString("base64")}`,
    thumbnailUrl: null,
    fallbackReason: manifest.fallbackReason,
  };
}

export function buildRenderFallbackManifest(params: {
  planId: string;
  title: string;
  reason: string;
  timeline: unknown;
}) {
  return {
    kind: "aivora_ad_edit_plan_manifest" as const,
    planId: params.planId,
    title: params.title,
    fallbackReason: `${params.reason}，返回首个真实素材 URL 作为可审核占位成片，并持久化 manifest 供检查。`,
    timeline: params.timeline,
  };
}

async function persistRenderedFile(filePath: string, blobPath: string) {
  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    return `file://${filePath}`;
  }
  const buffer = await readFile(filePath);
  const obj = await storage.uploadBuffer("renders", buffer, {
    key: blobPath,
    access: "public",
    contentType: "video/mp4",
    overwrite: true,
  });
  return obj.url;
}

function validateRenderableClips(clips: TimelineClip[]) {
  if (clips.length === 0) {
    throw new Error("AdEditPlan timeline clips 为空，无法渲染。请先重新生成真实素材剪辑计划，确保至少包含 1 个可用 clip。");
  }
  return clips.map((clip, index) => {
    if (!clip.sourceUrl) {
      throw new Error(`第 ${index + 1} 个 clip 缺少 sourceUrl，无法找到原始素材。请重新预处理 RawAsset 后重新生成 AdEditPlan。`);
    }
    if (!SUPPORTED_VIDEO_EXT.test(clip.sourceUrl) && !SUPPORTED_IMAGE_EXT.test(clip.sourceUrl)) {
      throw new Error(`第 ${index + 1} 个 clip 格式不支持。渲染仅支持 mp4、mov、m4v、webm、png、jpg、webp；请重新上传支持格式或修正 URL 文件扩展名：${clip.sourceUrl}`);
    }
    if (clip.endMs <= clip.startMs) {
      throw new Error(`第 ${index + 1} 个 clip 时间段无效：endMs 必须大于 startMs。当前 startMs=${clip.startMs}, endMs=${clip.endMs}，请重新生成 AdEditPlan。`);
    }
    return clip;
  });
}

async function ensureQAPending(briefId: string) {
  const existing = await db.qAReview.findFirst({
    where: { videoBriefId: briefId, status: "PENDING" },
  });
  if (existing) return;
  await db.qAReview.create({ data: { videoBriefId: briefId, status: "PENDING" } });
}

function buildSegmentArgs(clip: TimelineClip, durationSec: number, filter: string, output: string) {
  const isImage = SUPPORTED_IMAGE_EXT.test(clip.sourceUrl);
  const base = isImage
    ? ["-y", "-loop", "1", "-t", `${durationSec}`, "-i", clip.sourceUrl]
    : ["-y", "-ss", `${clip.startMs / 1000}`, "-t", `${durationSec}`, "-i", clip.sourceUrl];

  return [
    ...base,
    "-vf",
    filter,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ];
}

function buildVideoFilter(
  timeline: AdEditTimeline,
  segmentStartMs: number,
  segmentDurationMs: number,
  canDrawText: boolean,
) {
  const segmentEndMs = segmentStartMs + segmentDurationMs;
  const base = `scale=${OUTPUT_SIZE}:force_original_aspect_ratio=increase,crop=${OUTPUT_SIZE},setsar=1,fps=30`;
  if (!canDrawText) return base;
  const texts = [
    ...timeline.overlays.map((item) => ({ ...item, kind: "overlay" as const })),
    ...timeline.captions.map((item) => ({ ...item, position: "bottom" as const, kind: "caption" as const })),
  ].filter((item) => item.endMs > segmentStartMs && item.startMs < segmentEndMs);

  return texts.reduce((filter, item) => {
    const localStart = Math.max(0, (item.startMs - segmentStartMs) / 1000);
    const localEnd = Math.min(segmentDurationMs / 1000, (item.endMs - segmentStartMs) / 1000);
    const y = item.position === "top" ? "h*0.12" : item.position === "center" ? "(h-text_h)/2" : "h*0.78";
    const boxColor = item.kind === "caption" ? "black@0.55" : "black@0.35";
    return `${filter},drawtext=text='${escapeDrawtext(item.text)}':fontcolor=white:fontsize=54:box=1:boxcolor=${boxColor}:boxborderw=24:x=(w-text_w)/2:y=${y}:enable='between(t,${localStart.toFixed(2)},${localEnd.toFixed(2)})'`;
  }, base);
}

function escapeDrawtext(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, " ");
}
