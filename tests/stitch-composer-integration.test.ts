/**
 * C3：应用内合成器（生产 inprocess / 开发 local 唯一的合成实现）端到端：
 *   FinalVideo（假库）→ composeFinalVideoForStitch（真跑 ffmpeg，lavfi 合成素材）
 *   → runClaimedStitchAttempt → finishStitchTask（唯一成功写入点）。
 *
 * 覆盖改造前生产 runner 丢掉的东西：客户选的品牌尾卡、客户上传片段、trimToFit、
 * 字幕窗口；以及每个分支都从成片抽缩略图写进 FinalVideo.thumbnailUrl + brief.finalThumbnailUrl。
 * 对象存储用内存替身，不连数据库 / 供应商 / Blob；本机没有 ffmpeg 时跳过。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { probeMedia } from "../src/lib/media/ffmpeg-bin";
import {
  assemblyClipsToTimeline,
  composeFinalVideoForStitch,
  legacySegmentsToTimeline,
  resolveAiTailTrimSeconds,
} from "../src/lib/services/stitch-composer";
import { runClaimedStitchAttempt } from "../src/lib/services/stitch-service";
import type { PostProductionPlan } from "../src/types/video-generation";
import {
  fileUrl,
  ffmpegUsable,
  installMemoryStorage,
  makeClip,
  makeTone,
  toneMeanVolumeDb,
} from "./helpers/synthetic-media";

function patchModel(
  t: TestContext,
  model: Record<string, unknown>,
  patches: Record<string, unknown>,
) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

function withEnv(t: TestContext, next: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = env[key];
    if (next[key] === undefined) delete env[key];
    else env[key] = next[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete env[key];
      else env[key] = originals[key];
    }
  });
}

const BGM_ONLY: PostProductionPlan = {
  audio: {
    voiceover: { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: "一拧即开，随时补水。" },
    bgm: { trackId: "wholesome", volume: 0.2 },
  },
  captions: { enabled: false, style: "plain", language: "zh-CN", position: "bottom", exportSrt: false },
} as PostProductionPlan;

// ---------------------------------------------------------------------------
// 纯函数：裁尾规则只给 AI 段
// ---------------------------------------------------------------------------

test("裁尾规则：只给 AI 生成段（不裁 b-roll / 客户上传片段 / 尾卡），尾卡不背字幕", () => {
  const timeline = assemblyClipsToTimeline(
    [
      { type: "ai_generated_clip", url: "https://cdn/ai.mp4", intendedDurationSec: 15, trimToFit: true },
      { type: "uploaded_clip", url: "https://cdn/up.mp4", intendedDurationSec: 5, trimToFit: true },
      { type: "brand_end_card", url: "https://cdn/card.mp4", intendedDurationSec: 3, trimToFit: false },
      { type: "cta_card", url: "https://cdn/cta.mp4", intendedDurationSec: 3, trimToFit: false },
    ],
    0.8,
  );
  assert.deepEqual(timeline.map((clip) => [clip.role, clip.tailTrimSec ?? 0, clip.excludeFromCaptions ?? false]), [
    ["ai_generated", 0.8, false],
    ["uploaded", 0, false],
    ["end_card", 0, true],
    ["end_card", 0, true],
  ]);
  assert.deepEqual(
    legacySegmentsToTimeline([{ outputVideoUrl: "https://cdn/a.mp4" }, { outputVideoUrl: "https://cdn/b.mp4" }], 0.8).map(
      (clip) => [clip.role, clip.tailTrimSec],
    ),
    [
      ["ai_generated", 0.8],
      ["ai_generated", 0.8],
    ],
  );
  assert.equal(legacySegmentsToTimeline([{ outputVideoUrl: "https://cdn/a.mp4" }], 0)[0]?.tailTrimSec, undefined);
});

test("STITCH_AI_TAIL_TRIM_SEC：默认 0.8（与品牌封装同值），0/off 关闭，上限 3s", () => {
  assert.equal(resolveAiTailTrimSeconds({}), 0.8);
  assert.equal(resolveAiTailTrimSeconds({ STITCH_AI_TAIL_TRIM_SEC: "0" }), 0);
  assert.equal(resolveAiTailTrimSeconds({ STITCH_AI_TAIL_TRIM_SEC: "off" }), 0);
  assert.equal(resolveAiTailTrimSeconds({ STITCH_AI_TAIL_TRIM_SEC: "1.2" }), 1.2);
  assert.equal(resolveAiTailTrimSeconds({ STITCH_AI_TAIL_TRIM_SEC: "9" }), 3);
  assert.equal(resolveAiTailTrimSeconds({ STITCH_AI_TAIL_TRIM_SEC: "nonsense" }), 0.8);
});

// ---------------------------------------------------------------------------
// 端到端
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown> & {
  id: string;
  status: FinalVideoStatus;
  stitchAttemptToken: string | null;
  thumbnailUrl: string | null;
};

/** 假库：FinalVideo 一行（带 include 的形状）+ brief 写入记录 */
function installFakeDb(t: TestContext, row: FakeRow) {
  const briefWrites: Array<Record<string, unknown>> = [];
  patchModel(t, db.finalVideo as unknown as Record<string, unknown>, {
    findUnique: async () => row,
    count: async (args: { where: { stitchAttemptToken?: string; status?: FinalVideoStatus } }) =>
      row.status === args.where.status && row.stitchAttemptToken === args.where.stitchAttemptToken ? 1 : 0,
    updateMany: async (args: { where: { status?: FinalVideoStatus; stitchAttemptToken?: string | null }; data: Record<string, unknown> }) => {
      if (args.where.status && row.status !== args.where.status) return { count: 0 };
      if ("stitchAttemptToken" in args.where && row.stitchAttemptToken !== args.where.stitchAttemptToken) {
        return { count: 0 };
      }
      Object.assign(row, args.data);
      return { count: 1 };
    },
  });
  patchModel(t, db.videoBrief as unknown as Record<string, unknown>, {
    /// P05-B 白名单：成片就位只有交付前渲染态才置 QA_PENDING；真库里 brief 一定带 status，假库也给一个
    findUnique: async () => ({ finalVideoId: row.id, status: "RENDERING", brandedVideoUrl: null, finalVideo: row }),
    update: async (args: { data: Record<string, unknown> }) => {
      briefWrites.push(args.data);
      return {};
    },
  });
  patchModel(t, db.qAReview as unknown as Record<string, unknown>, {
    findFirst: async () => ({ id: "qa" }),
    create: async () => ({}),
    /// P01-E：已有 PENDING 桩会被合并写回「待复检」标记
    update: async () => ({}),
  });
  return briefWrites;
}

function segment(index: number, url: string, extra: Record<string, unknown> = {}) {
  return {
    id: `job_${index}`,
    segmentIndex: index,
    status: VideoJobStatus.SUCCEEDED,
    outputVideoUrl: url,
    outputThumbUrl: `https://provider.example.com/thumb-${index}.jpg`,
    assignedAssets: null,
    ...extra,
  };
}

test("integration · legacy 分支：AI 段语音安全裁尾 + 成片缩略图写进 FinalVideo 与 brief", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  withEnv(t, { STITCH_AI_TAIL_TRIM_SEC: undefined });
  const dir = mkdtempSync(path.join(tmpdir(), "composer-legacy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const uploads = installMemoryStorage(t, dir);
  /// 段 0：口播 5s 后静音到 7s（尾部可裁）；段 1：口播一直讲到结尾（不裁一个字）
  const seg0 = await makeClip(path.join(dir, "seg0.mp4"), { durationSec: 7, audio: { kind: "tone", hz: 440, speechSec: 5 } });
  const seg1 = await makeClip(path.join(dir, "seg1.mp4"), { durationSec: 6, audio: { kind: "tone", hz: 550, speechSec: 6 } });
  const row: FakeRow = {
    id: "fv_legacy_e2e",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_legacy",
    stitchAttempts: 0,
    segmentCount: 2,
    targetDurationSec: 15,
    thumbnailUrl: null,
    postProduction: BGM_ONLY,
    brief: { id: "brief_legacy", aspectRatio: "9:16", videoGenerationPlan: null, contentAngle: null },
    segments: [segment(0, fileUrl(seg0)), segment(1, fileUrl(seg1))],
  };
  const briefWrites = installFakeDb(t, row);

  const composed = await composeFinalVideoForStitch({ finalVideoId: row.id });
  assert.equal(composed.branch, "legacy");
  assert.ok((composed.clips[0]?.tailTrimmedSec ?? 0) > 0.7, "段 0 尾部静音被裁掉");
  assert.equal(composed.clips[1]?.tailTrimmedSec, 0, "段 1 口播讲到结尾：不裁");
  assert.equal(composed.clips[1]?.speechLimited, true);
  assert.match(composed.thumbnailUrl ?? "", /\.jpg$/);

  const outcome = await runClaimedStitchAttempt({ finalVideoId: row.id, attemptToken: "tok_legacy" });
  assert.equal(outcome.kind, "succeeded", JSON.stringify(outcome.result));
  assert.equal(row.status, FinalVideoStatus.READY);
  assert.match(String(row.thumbnailUrl), /final-videos-fv_legacy_e2e|\.jpg$/);
  assert.notEqual(row.thumbnailUrl, "https://provider.example.com/thumb-0.jpg", "不再用第 0 段的供应商缩略图");
  assert.equal(briefWrites.at(-1)?.status, VideoBriefStatus.QA_PENDING);
  assert.equal(briefWrites.at(-1)?.finalThumbnailUrl, row.thumbnailUrl);

  const video = uploads.filter((upload) => upload.contentType === "video/mp4").at(-1)!;
  const probe = await probeMedia(video.file);
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.equal(probe.hasAudio, true);
  assert.ok(probe.durationSec && probe.durationSec < 13 - 0.6, `trimmed total ${probe.durationSec}`);
});

test("integration · assembly 分支：客户上传片段 + 客户选的品牌尾卡都进成片，尾卡不背字幕，缩略图写回", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  withEnv(t, { STITCH_RUNTIME: "inprocess", STITCH_AI_TAIL_TRIM_SEC: undefined });
  const dir = mkdtempSync(path.join(tmpdir(), "composer-assembly-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const uploads = installMemoryStorage(t, dir);
  const ai = await makeClip(path.join(dir, "ai.mp4"), { durationSec: 7, audio: { kind: "tone", hz: 440, speechSec: 5 } });
  const uploaded = await makeClip(path.join(dir, "customer.mp4"), {
    durationSec: 4,
    fps: 30,
    audio: { kind: "none" },
    color: "darkgreen",
  });
  const plan = {
    assemblyPlan: {
      targetResolution: "1080x1920",
      aspectRatio: "9:16",
      fps: 30,
      outputCodec: "h264_aac_mp4",
      transitions: ["cut", "cut"],
      finalDurationSeconds: 13,
      normalizationPlan: "",
      clips: [
        { segmentOrder: 0, sourceType: "ai_generated_clip", uploadedAssetId: null, sourceVideoJobId: null, fromSec: 0, toSec: 7, normalize: true },
        { segmentOrder: 1, sourceType: "uploaded_clip", uploadedAssetId: "asset_store", sourceVideoJobId: null, fromSec: 7, toSec: 10, normalize: true },
        { segmentOrder: 2, sourceType: "brand_end_card", uploadedAssetId: null, sourceVideoJobId: null, fromSec: 10, toSec: 13, normalize: true },
      ],
    },
    brandPackagingPlan: {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: 3,
      brandName: "晴窗遮阳",
      slogan: "量身定制",
      cta: "立即预约",
      contactLines: ["电话 400-000-0000"],
      website: "aivora.example",
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
    classifiedAssets: [
      {
        id: "asset_store",
        type: "VIDEO",
        inferredRole: "store_clip",
        roleConfidence: 0.9,
        url: fileUrl(uploaded),
        mimeType: "video/mp4",
        fileName: "customer.mp4",
      },
    ],
  };
  const row: FakeRow = {
    id: "fv_assembly_e2e",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_assembly",
    stitchAttempts: 0,
    segmentCount: 1,
    targetDurationSec: 13,
    thumbnailUrl: null,
    postProduction: BGM_ONLY,
    brief: { id: "brief_assembly", aspectRatio: "9:16", videoGenerationPlan: plan, contentAngle: null },
    segments: [segment(0, fileUrl(ai))],
  };
  const briefWrites = installFakeDb(t, row);

  const outcome = await runClaimedStitchAttempt({ finalVideoId: row.id, attemptToken: "tok_assembly" });
  assert.equal(outcome.kind, "succeeded", JSON.stringify(outcome.result));
  assert.equal(row.status, FinalVideoStatus.READY);
  assert.match(String(row.thumbnailUrl), /\.jpg$/, "assembly 分支改造前从不写缩略图");
  assert.equal(briefWrites.at(-1)?.finalThumbnailUrl, row.thumbnailUrl);

  const video = uploads.filter((upload) => upload.contentType === "video/mp4" && upload.key.startsWith("final-videos/")).at(-1)!;
  const probe = await probeMedia(video.file);
  assert.equal(probe.width, 1080);
  assert.equal(probe.fps, 24);
  /// AI 段 7s 裁尾 0.8 → 6.2 + 上传片段 trimToFit 3s + 尾卡 3s
  assert.ok(probe.durationSec && Math.abs(probe.durationSec - 12.2) < 0.3, `duration ${probe.durationSec}`);

  /// 尾卡确实渲染并拼进来了（改造前生产 runner 根本不读 assemblyPlan）
  assert.ok(uploads.some((upload) => upload.key.startsWith("brand-end-cards/")), "尾卡渲染并转存");
  const tail = await probeMedia(video.file);
  assert.equal(tail.hasAudio, true);

  /// 直接调合成器再看一次各段：角色、裁尾只给 AI 段、字幕窗口扣掉尾卡
  row.status = FinalVideoStatus.STITCHING;
  const composed = await composeFinalVideoForStitch({ finalVideoId: row.id });
  assert.deepEqual(composed.clips.map((clip) => clip.role), ["ai_generated", "uploaded", "end_card"]);
  assert.ok((composed.clips[0]?.tailTrimmedSec ?? 0) > 0.7);
  assert.equal(composed.clips[1]?.tailTrimmedSec, 0);
  assert.equal(composed.clips[1]?.hasAudio, false, "上传片段没有音轨 → 补静音");
  assert.equal(composed.clips[2]?.tailTrimmedSec, 0);
  /// 字幕窗口 = 总长 - 尾卡（按实际时长：6.2 + 3）
  assert.ok(
    composed.captionWindowSec !== null && Math.abs(composed.captionWindowSec - 9.2) < 0.1,
    `caption window ${composed.captionWindowSec}`,
  );
});

test("integration · b-roll 分支：配音替换素材原声、30fps、一次编码，缩略图来自成片", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "composer-broll-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  installMemoryStorage(t, dir);
  /// 图库素材 1.5s、自带 880Hz 原声（必须被丢弃）；配音 2.2s 440Hz → 段长 max(2, 2.2+0.35)=2.55s（素材循环补长）
  const stock = await makeClip(path.join(dir, "stock.mp4"), { durationSec: 1.5, fps: 25, audio: { kind: "tone", hz: 880, speechSec: 1.5 } });
  const tts = await makeTone(path.join(dir, "tts.m4a"), 440, 2.2);
  const row: FakeRow = {
    id: "broll_e2e",
    status: FinalVideoStatus.STITCHING,
    stitchAttemptToken: "tok_broll",
    stitchAttempts: 0,
    segmentCount: 1,
    targetDurationSec: 3,
    thumbnailUrl: null,
    postProduction: {
      ...BGM_ONLY,
      audio: { ...BGM_ONLY.audio, voiceover: { ...BGM_ONLY.audio.voiceover, enabled: false } },
    },
    brief: { id: "brief_broll", aspectRatio: "9:16", videoGenerationPlan: null, contentAngle: null },
    segments: [segment(0, fileUrl(stock), { assignedAssets: { broll: { ttsAudioUrl: fileUrl(tts) } } })],
  };
  installFakeDb(t, row);
  const composed = await composeFinalVideoForStitch({ finalVideoId: row.id });
  assert.equal(composed.branch, "broll");
  assert.equal(composed.clips[0]?.role, "broll");
  assert.equal(composed.clips[0]?.tailTrimmedSec, 0, "b-roll 不裁尾");
  assert.match(composed.thumbnailUrl ?? "", /\.jpg$/);
  const output = fileURLToPath(composed.stitchedVideoUrl);
  const probe = await probeMedia(output);
  assert.equal(probe.fps, 30);
  assert.ok(probe.durationSec && Math.abs(probe.durationSec - 2.55) < 0.1, `duration ${probe.durationSec}`);
  /// 开着 BGM：配音必须还在（1025 runner 事故：b-roll 开 BGM 后口播被整段换成音乐）
  const voice = await toneMeanVolumeDb(output, 440, { durationSec: 2 });
  const stockAudio = await toneMeanVolumeDb(output, 880, { durationSec: 1.4 });
  assert.ok(voice !== null && voice > -32, `voice band ${voice} dB`);
  assert.ok(stockAudio !== null && voice > stockAudio + 15, `voice ${voice} dB vs stock ${stockAudio} dB`);
});
