import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { FinalVideoStatus, VideoJobStatus } from "@prisma/client";
import {
  claimStitchTask,
  finishStitchTask,
} from "../src/lib/services/stitch-service";
import { db } from "../src/lib/db";

const fixturePostProduction = {
  audio: {
    voiceover: {
      enabled: true,
      voiceId: "warm-confident",
      language: "zh-CN",
      script: "一拧即开，随时补水。",
    },
    bgm: { trackId: "wholesome", volume: 0.2 },
  },
  captions: {
    enabled: true,
    style: "word_by_word",
    language: "zh-CN",
    position: "bottom",
    exportSrt: true,
  },
} as const;

function patchFinalVideo(
  t: TestContext,
  values: Record<string, unknown>,
) {
  const target = db.finalVideo as unknown as Record<string, unknown>;
  const originals = Object.fromEntries(
    Object.keys(values).map((key) => [key, target[key]]),
  );
  Object.assign(target, values);
  t.after(() => Object.assign(target, originals));
}

test("claimed stitch task contains the persisted post-production plan", async (t) => {
  patchFinalVideo(t, {
    findMany: async () => [
      {
        id: "final-post-production",
        status: FinalVideoStatus.PENDING,
        segmentCount: 1,
        stitchAttempts: 0,
        targetDurationSec: 15,
        postProduction: fixturePostProduction,
        brief: { aspectRatio: "9:16" },
        segments: [
          {
            segmentIndex: 0,
            status: VideoJobStatus.SUCCEEDED,
            outputVideoUrl: "https://assets.example.com/segment.mp4",
          },
        ],
      },
    ],
    updateMany: async () => ({ count: 1 }),
  });

  const task = await claimStitchTask();
  assert.ok(task);
  assert.deepEqual(task.postProduction?.captions, fixturePostProduction.captions);
  assert.equal(
    task.postProduction?.audio.bgm.trackId,
    "wholesome",
  );
});

test("successful callback persists an optional SRT URL", async (t) => {
  const writes: Array<Record<string, unknown>> = [];
  patchFinalVideo(t, {
    findUnique: async () => ({
      id: "final-post-production",
      status: FinalVideoStatus.STITCHING,
      stitchAttemptToken: "attempt-post",
      thumbnailUrl: null,
      brief: null,
    }),
    updateMany: async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return { count: 1 };
    },
  });

  const result = await finishStitchTask({
    finalVideoId: "final-post-production",
    attemptToken: "attempt-post",
    stitchedVideoUrl: "https://assets.example.com/final.mp4",
    thumbnailUrl: "https://assets.example.com/final.jpg",
    subtitleFileUrl: "https://assets.example.com/final.srt",
  });
  assert.equal(result.ok, true);
  assert.equal(
    writes[0]?.subtitleFileUrl,
    "https://assets.example.com/final.srt",
  );
});

test("post-production persistence and runner contracts are explicit", async () => {
  const [
    schema,
    migration,
    service,
    stitchService,
    pipeline,
    composer,
    runner,
    completeRoute,
  ] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile(
      "prisma/migrations/20260726123000_final_video_post_production/migration.sql",
      "utf8",
    ),
    readFile("src/lib/services/video-service.ts", "utf8"),
    readFile("src/lib/services/stitch-service.ts", "utf8"),
    readFile("src/lib/media/stitch-pipeline.ts", "utf8"),
    readFile("src/lib/services/stitch-composer.ts", "utf8"),
    readFile("scripts/stitch-runner.ts", "utf8"),
    readFile("src/app/api/internal/stitch/complete/route.ts", "utf8"),
  ]);
  assert.match(schema, /postProduction\s+Json\?/);
  assert.match(schema, /subtitleFileUrl\s+String\?/);
  assert.match(migration, /"postProduction"/);
  assert.match(migration, /"subtitleFileUrl"/);
  assert.match(service, /postProduction:/);
  /// C3：应用内合成器（生产 inprocess 与开发 local 同一实现）——单遍合成：字幕 + 混音 + 唯一一次编码
  assert.match(stitchService, /composeTimeline\(/);
  /// P04-B：字幕时间轴决策收口在 audio-post-production.planCaptionCues（进程内与 runner 共用）
  assert.match(pipeline, /planCaptionCues/);
  assert.match(pipeline, /renderAssCaptions/);
  assert.match(pipeline, /buildAudioFilterPlan/);
  assert.match(pipeline, /probeMedia/);
  /// 每一个分支（b-roll / assembly / legacy）都把持久化的后期快照交给合成器
  assert.equal(composer.match(/postProduction,/g)?.length, 3);
  assert.match(runner, /ffprobe/);
  assert.match(runner, /buildDeterministicCues/);
  assert.match(runner, /sidechaincompress/);
  assert.match(runner, /subtitleFileUrl/);
  assert.match(completeRoute, /subtitleFileUrl/);
});
