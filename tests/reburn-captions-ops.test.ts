import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stitchTaskPayload } from "../src/lib/services/stitch-service";

/**
 * 1025 · 旧成片重烧字幕：
 * - 生产 runner 的混音按 ffprobe 实测音轨决定（b-roll 开 BGM 时口播曾被音乐整段替换）；
 * - 运维脚本与生产认领共用同一份任务载荷；
 * - 换链只换 URL、带全量 CAS，不碰状态 / 完成时间 / 额度字段。
 */

const POST_PRODUCTION = {
  audio: {
    bgm: { volume: 0.22, trackId: "wholesome" },
    voiceover: { script: "这个是工厂的实体照片，需要专业，大气", enabled: false, voiceId: "warm-confident", language: "zh" },
  },
  captions: { style: "plain", enabled: true, language: "zh", position: "bottom", exportSrt: true },
};

test("任务载荷：b-roll 段带出素材 + 配音，普通段只给段 URL；画幅缺省 9:16", () => {
  const broll = stitchTaskPayload({
    targetDurationSec: 9,
    postProduction: POST_PRODUCTION,
    brief: { aspectRatio: "9:16" },
    segments: [
      { segmentIndex: 0, outputVideoUrl: "https://videos.pexels.com/a.mp4", assignedAssets: { broll: { ttsAudioUrl: "https://blob.test/tts-0.mp3" } } },
      { segmentIndex: 1, outputVideoUrl: "https://videos.pexels.com/b.mp4", assignedAssets: { broll: { ttsAudioUrl: "https://blob.test/tts-1.mp3" } } },
    ],
  });
  assert.deepEqual(broll.brollSegments, [
    { segmentIndex: 0, clipUrl: "https://videos.pexels.com/a.mp4", ttsAudioUrl: "https://blob.test/tts-0.mp3" },
    { segmentIndex: 1, clipUrl: "https://videos.pexels.com/b.mp4", ttsAudioUrl: "https://blob.test/tts-1.mp3" },
  ]);
  assert.equal(broll.postProduction?.captions.enabled, true);

  const normal = stitchTaskPayload({
    targetDurationSec: 30,
    postProduction: null,
    brief: null,
    segments: [
      { segmentIndex: 0, outputVideoUrl: "https://r2.test/0", assignedAssets: null },
      { segmentIndex: 1, outputVideoUrl: "https://r2.test/1", assignedAssets: null },
    ],
  });
  assert.deepEqual(normal, {
    segmentUrls: ["https://r2.test/0", "https://r2.test/1"],
    aspectRatio: "9:16",
    targetDurationSec: 30,
    postProduction: null,
    brollSegments: null,
  });
});

test("生产认领用同一份载荷（claimStitchTask 不再内联拼对象）", async () => {
  const service = await readFile("src/lib/services/stitch-service.ts", "utf8");
  /// C3：runner 认领与进程内合成器共用 claimNextReadyFinalVideo 的 CAS；runner 载荷仍只由
  /// stitchTaskPayload 生成，且在 CAS 之前算出（算不出就不认领）。
  assert.match(service, /prepare: \(fv\) => stitchTaskPayload\(fv\),/);
  assert.match(service, /attemptToken: claimed\.attemptToken,\s*\.\.\.claimed\.prepared,/);
  assert.ok(
    service.indexOf("const prepared = options.prepare(fv);") <
      service.indexOf("const claim = await db.finalVideo.updateMany({\n        where: { id: fv.id, status: FinalVideoStatus.PENDING },"),
    "载荷在 CAS 之前计算",
  );
});

test("runner：只有 b-roll 按实测音轨混音（缺音轨就失败），普通成片判据不变；被 import 时不进认领循环", async () => {
  const runner = await readFile("scripts/stitch-runner.ts", "utf8");
  assert.match(
    runner,
    /const hasNativeAudio = args\.task\.brollSegments\?\.length\s*\? await requireBrollVoiceTrack\(args\.inputPath\)\s*: snapshot\.audio\.voiceover\.enabled;/,
  );
  assert.match(runner, /throw new StitchRunnerError\("audio_probe_failed"\)/);
  assert.match(runner, /throw new StitchRunnerError\("broll_voice_track_missing"\)/);
  assert.match(runner, /if \(require\.main === module\) \{\s*main\(\)/);
  assert.match(runner, /export async function stitchOne\(task: StitchTask\)/);
});

test("换链：生产写库闸 + 全量 CAS，只换 URL，不碰状态 / 完成时间 / 额度", async () => {
  const script = await readFile("scripts/ops/reburn-final-video-captions.ts", "utf8");
  assert.match(script, /process\.env\.CONFIRM_PRODUCTION_DB !== "reburn-final-video-captions"/);
  assert.match(script, /status: "READY",\s*stitchedVideoUrl: fromVideo,\s*thumbnailUrl: fromThumb,\s*subtitleFileUrl: fromSrt,/);
  assert.match(
    script,
    /id: brief\.id,\s*status: brief\.status,\s*finalVideoId,\s*finalVideoUrl: fromVideo,\s*finalThumbnailUrl: brief\.finalThumbnailUrl,\s*brandedVideoUrl: null,/,
  );
  /// 新文件必须在同一个生产 store、真实存在；与生产认领同一道就绪判定；回滚记录先打印
  assert.match(script, /if \(parsed\.hostname !== storeHost\)/);
  assert.match(script, /await fetch\(url, \{ method: "HEAD" \}\)/);
  assert.match(script, /isStitchCandidateReady\(fv\)/);
  assert.match(script, /console\.log\(JSON\.stringify\(\{ rollbackRecord: record \}\)\);\s*await db\.\$transaction/);
  assert.match(script, /data: \{ finalVideoUrl: video, finalThumbnailUrl: thumb \}/);
  /// 只查代码（注释里解释了为什么不走 retryStitch / PENDING）
  const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/finishedAt:/, /startedAt:/, /stitchAttempts:/, /quotaRefundedAt:/, /errorMessage:/, /status: "PENDING"/, /retryStitch/]) {
    assert.doesNotMatch(code, forbidden);
  }
});
