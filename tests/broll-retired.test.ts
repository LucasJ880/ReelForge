import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  BROLL_ROUTE_RETIRED_MESSAGE,
  extractBrollClaimSegments,
  prepareRestitch,
  prepareSegmentRedoStitch,
  restitchReadyFinalVideo,
} from "../src/lib/services/stitch-service";
import { toUnifiedLibraryRow } from "../src/lib/services/unified-library-service";
import { brollSegmentDurationSec, buildBrollComposeArgs } from "../src/lib/video-generation/broll-segment-compose";
import { RestitchRejectedError } from "../src/lib/video-generation/restitch-patch";
import { SegmentRedoRejectedError } from "../src/lib/video-generation/segment-redo";
import type { PostProductionPlan } from "../src/types/video-generation";

/**
 * 实拍图库（b-roll）线路 2026-11-16 删除之后，旧的 b-roll 成片怎么办：
 *   - 照常能看能下载（成品库照样给出成片地址）；
 *   - 不能再「只重新合成」：预检就以带类型的 INVALID_STATE 拒绝，写清楚原因与下一步，不是 500；
 *     成品库也不再给它「换字幕 / 配乐」「重做一段」的入口；
 *   - 应用内合成器遇到它明确失败（断言在 stitch-composer-integration.test.ts）。
 * 另外留着两个纯函数的断言：认出 b-roll 段的判据，和外部 runner 重烧字幕还在用的段合成参数。
 * 全部 monkey-patch Prisma，不连库、不跑 ffmpeg。
 */

function patchModel(t: TestContext, model: object, patches: Record<string, unknown>) {
  const record = model as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = record[key];
    record[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) record[key] = originals[key];
  });
}

const OLD_URL = "https://abc.public.blob.vercel-storage.com/final-videos/fv-broll/old.mp4";

const PLAN: PostProductionPlan = {
  audio: {
    voiceover: { enabled: false, voiceId: "warm-confident", language: "zh", script: "这款百叶窗一拧即开。" },
    bgm: { trackId: "none", volume: 0 },
  },
  captions: { enabled: true, style: "plain", language: "zh", position: "bottom", exportSrt: true },
};

function brollSegment(index: number) {
  return {
    id: `job-${index}`,
    segmentIndex: index,
    segmentDurationSec: 4,
    status: VideoJobStatus.SUCCEEDED,
    outputVideoUrl: `https://videos.pexels.example/clip-${index}.mp4`,
    outputThumbUrl: null,
    frameQaDetail: null,
    assignedAssets: { broll: { ttsAudioUrl: `https://abc.public.blob.vercel-storage.com/tts-${index}.mp3`, narration: "你好" } },
  };
}

function readyBrollFinalVideo() {
  return {
    id: "fv-broll",
    status: FinalVideoStatus.READY,
    segmentCount: 2,
    targetDurationSec: 8,
    stitchAttempts: 1,
    stitchAttemptToken: null,
    stitchedVideoUrl: OLD_URL,
    previousStitchedVideoUrl: null,
    thumbnailUrl: "https://abc.public.blob.vercel-storage.com/thumb.jpg",
    subtitleFileUrl: null,
    ffmpegError: null,
    postProduction: PLAN,
    previousPostProduction: null,
    brief: { id: "brief-broll", status: VideoBriefStatus.QA_PENDING },
    segments: [brollSegment(0), brollSegment(1)],
  };
}

/// 任何写入都炸：被拒绝的重拼必须让旧成片原样不动
function forbidWrites(t: TestContext) {
  const boom = (what: string) => async () => {
    throw new Error(`被拒绝的重拼不得写库：${what}`);
  };
  patchModel(t, db.finalVideo, {
    findUnique: async () => readyBrollFinalVideo(),
    update: boom("finalVideo.update"),
    updateMany: boom("finalVideo.updateMany"),
  });
  patchModel(t, db.videoBrief, { update: boom("videoBrief.update"), updateMany: boom("videoBrief.updateMany") });
  patchModel(t, db.videoJob, { create: boom("videoJob.create"), update: boom("videoJob.update"), updateMany: boom("videoJob.updateMany") });
}

test("认出旧的 b-roll 成片：每一段都带 broll.ttsAudioUrl 才算；普通段、缺配音地址、缺段地址都不算", () => {
  assert.deepEqual(extractBrollClaimSegments([brollSegment(0), brollSegment(1)]), [
    { segmentIndex: 0, clipUrl: "https://videos.pexels.example/clip-0.mp4", ttsAudioUrl: "https://abc.public.blob.vercel-storage.com/tts-0.mp3" },
    { segmentIndex: 1, clipUrl: "https://videos.pexels.example/clip-1.mp4", ttsAudioUrl: "https://abc.public.blob.vercel-storage.com/tts-1.mp3" },
  ]);
  assert.equal(extractBrollClaimSegments([]), null);
  assert.equal(extractBrollClaimSegments([{ segmentIndex: 0, outputVideoUrl: "https://x/a.mp4", assignedAssets: null }]), null);
  assert.equal(extractBrollClaimSegments([{ segmentIndex: 0, outputVideoUrl: "https://x/a.mp4", assignedAssets: { broll: {} } }]), null);
  assert.equal(extractBrollClaimSegments([{ ...brollSegment(0), outputVideoUrl: null }]), null);
  /// 混着一段普通段：不算 b-roll（当初整链同源写入，混合形态不存在）
  assert.equal(
    extractBrollClaimSegments([brollSegment(0), { segmentIndex: 1, outputVideoUrl: "https://x/b.mp4", assignedAssets: null }]),
    null,
  );
  /// 最早那版同步交付的 b-roll：段已经是烤好配音的成品片段，只带 stock 标记——按普通成片处理，照旧能重拼
  assert.equal(
    extractBrollClaimSegments([{ segmentIndex: 0, outputVideoUrl: "https://x/a.mp4", assignedAssets: { stock: {}, searchTerm: "blinds" } }]),
    null,
  );
});

test("🔴 只重拼：旧 b-roll 成片在预检就被拒绝——带类型的 INVALID_STATE、一句客户看得懂的话、零写入", async (t) => {
  forbidWrites(t);
  const patch = { bgm: { trackId: "wholesome", volume: 0.2 } };
  for (const attempt of [() => prepareRestitch("fv-broll", patch), () => restitchReadyFinalVideo("fv-broll", patch)]) {
    await assert.rejects(attempt(), (err: unknown) => {
      assert.ok(err instanceof RestitchRejectedError, "必须是路由认得的拒绝类型（映射成 409），不是裸 Error（那会变成 500）");
      assert.equal(err.code, "INVALID_STATE");
      assert.equal(err.message, BROLL_ROUTE_RETIRED_MESSAGE);
      return true;
    });
  }
  assert.match(BROLL_ROUTE_RETIRED_MESSAGE, /实拍图库线路/);
  assert.match(BROLL_ROUTE_RETIRED_MESSAGE, /照常可以看和下载/, "说清楚成片本身没事");
  assert.match(BROLL_ROUTE_RETIRED_MESSAGE, /再做一条/, "失败不能只说不行：给下一步");
});

test("只重拼的拒绝先于限频与扣费：beforeCommit（路由在这里做账号限频）一次都不会被调到", async (t) => {
  forbidWrites(t);
  let reached = 0;
  await assert.rejects(
    restitchReadyFinalVideo(
      "fv-broll",
      { bgm: { trackId: "wholesome", volume: 0.2 } },
      {
        beforeCommit: async () => {
          reached += 1;
        },
      },
    ),
    RestitchRejectedError,
  );
  assert.equal(reached, 0);
});

test("重做某一段：旧 b-roll 成片照旧被拒绝（段不是 AI 生成的）", async (t) => {
  forbidWrites(t);
  await assert.rejects(
    prepareSegmentRedoStitch("fv-broll", 0),
    (err: unknown) => err instanceof SegmentRedoRejectedError && err.code === "INVALID_STATE" && /实拍图库/.test(err.message),
  );
});

test("成品库：旧 b-roll 成片照常给出成片地址（能看能下载），但不再给「换字幕 / 配乐」与「重做一段」的入口", () => {
  type Input = Parameters<typeof toUnifiedLibraryRow>[0];
  const order = (videoRouteSnapshot: string | null) =>
    ({
      id: "order-broll",
      title: "百叶窗（实拍图库）",
      status: "ROUND_ACTIVE",
      createdAt: new Date("2026-10-20T00:00:00Z"),
      updatedAt: new Date("2026-10-20T00:10:00Z"),
      rounds: [
        {
          angles: [
            {
              videoBrief: {
                id: "brief-broll",
                status: "QA_PENDING",
                videoRouteSnapshot,
                durationSec: 8,
                aspectRatio: "9:16",
                finalVideoUrl: null,
                finalThumbnailUrl: null,
                brandedVideoUrl: null,
                takedownAt: null,
                createdAt: new Date("2026-10-20T00:00:00Z"),
                storyboardRun: null,
                finalVideo: {
                  status: "READY",
                  stitchedVideoUrl: OLD_URL,
                  thumbnailUrl: "https://abc.public.blob.vercel-storage.com/thumb.jpg",
                  subtitleFileUrl: null,
                  segmentCount: 2,
                  startedAt: new Date("2026-10-20T00:05:00Z"),
                  finishedAt: new Date("2026-10-20T00:10:00Z"),
                  previousStitchedVideoUrl: null,
                  postProduction: PLAN,
                },
                videoJobs: [0, 1].map((index) => ({
                  id: `job-${index}`,
                  status: "SUCCEEDED",
                  lastProgress: 100,
                  submittedAt: new Date("2026-10-20T00:01:00Z"),
                  finishedAt: new Date("2026-10-20T00:04:00Z"),
                  createdAt: new Date("2026-10-20T00:00:00Z"),
                  outputVideoUrl: `https://abc.public.blob.vercel-storage.com/seg-${index}.mp4`,
                  segmentIndex: index,
                  segmentDurationSec: 4,
                  finalVideoId: "fv-broll",
                  replacesJobId: null,
                  supersededAt: null,
                  userSafeError: null,
                })),
              },
            },
          ],
        },
      ],
    }) as unknown as Input;

  const broll = toUnifiedLibraryRow(order("broll"));
  assert.ok(broll, "旧 b-roll 成片照样进成品库");
  assert.equal(broll.status, "ready");
  assert.equal(broll.videoUrl, OLD_URL, "照常能看能下载");
  assert.equal(broll.canRestitch, false, "不给换字幕 / 配乐的入口（与 prepareRestitch 同一判据）");
  assert.equal(broll.segments.length, 2);
  assert.ok(broll.segments.every((segment) => !segment.canRedo), "也不给重做一段的入口");

  /// 对照：同一条记录换成主线出片，就能改——说明上面两个 false 确实来自 b-roll 这一条判据
  const mainline = toUnifiedLibraryRow(order("buddy"));
  assert.equal(mainline?.canRestitch, true);
  assert.equal(mainline?.videoUrl, OLD_URL);
  assert.equal(mainline?.segments.length, 2);
  assert.ok(mainline?.segments.every((segment) => segment.canRedo));
});

test("段合成参数（外部 runner 给旧 b-roll 成片重烧字幕还在用）：口播驱动段长、素材循环补长、配音替换原声", () => {
  assert.equal(brollSegmentDurationSec(0.4), 2);
  assert.equal(brollSegmentDurationSec(1.65), 2);
  assert.equal(brollSegmentDurationSec(3), 3.35);
  assert.equal(brollSegmentDurationSec(8.2), 8.55);
  const joined = buildBrollComposeArgs({
    clipPath: "/tmp/clip.mp4",
    ttsPath: "/tmp/tts.mp3",
    outPath: "/tmp/out.mp4",
    width: 1080,
    height: 1920,
    targetDurationSec: 4.35,
  }).join(" ");
  assert.ok(joined.includes("-stream_loop -1"));
  assert.ok(joined.includes("-t 4.35"));
  /// 只映射 [1:a]（配音），素材原声被丢弃
  assert.ok(joined.includes("[1:a]apad"));
  assert.ok(!joined.includes("[0:a]"));
});
