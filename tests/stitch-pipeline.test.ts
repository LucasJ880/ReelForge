/**
 * C3：应用内合成管线（单遍合成：逐段归一化 + concat + 字幕 + 混音，只编码一次）。
 *
 * 纯函数部分锁住滤镜图 / 时长量化 / 字幕窗口 / 时间预算；集成部分在本机真跑 ffmpeg
 * （lavfi 合成素材，不连任何外部服务），本机没有 ffmpeg 时跳过。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { probeMedia, runFfmpeg } from "../src/lib/media/ffmpeg-bin";
import { __test__ as fontsTest, ensureMediaFonts } from "../src/lib/media/media-fonts";
import {
  buildTimelineFilterGraph,
  composeTimeline,
  createMediaBudget,
  frameRateValue,
  quantizeToFrames,
  resolveCaptionWindowSec,
  resolveClipKeepSec,
  resolvePostProductionEffects,
  runStitchStep,
  scaledStepTimeoutMs,
  StitchBudgetExceededError,
  StitchCompositionError,
  stepTimeout,
  thumbnailSeekSeconds,
} from "../src/lib/media/stitch-pipeline";
import {
  buildTimedCues,
  renderAssCaptions,
  splitScriptByDurations,
  type CaptionWord,
} from "../src/lib/video-generation/audio-post-production";
import { splitVoiceoverScript } from "../src/lib/video-generation/prompt-intelligence";
import type { PostProductionPlan } from "../src/types/video-generation";
import {
  ffmpegHasLibass,
  ffmpegUsable,
  makeClip,
  toneMeanVolumeDb,
  useBundledCjkFont,
} from "./helpers/synthetic-media";

function plan(overrides: {
  captions?: boolean;
  bgm?: boolean;
  voiceover?: boolean;
  style?: "word_by_word" | "karaoke" | "plain";
  script?: string;
}): PostProductionPlan {
  return {
    audio: {
      voiceover: {
        enabled: overrides.voiceover ?? true,
        voiceId: "warm-confident",
        language: "zh-CN",
        script: overrides.script ?? "一拧即开，随时补水。点击下方链接立即预约。",
      },
      bgm: overrides.bgm ? { trackId: "wholesome", volume: 0.2 } : { trackId: "none", volume: 0 },
    },
    captions: {
      enabled: overrides.captions ?? false,
      style: overrides.style ?? "word_by_word",
      language: "zh-CN",
      position: "bottom",
      exportSrt: true,
    },
  } as PostProductionPlan;
}

/// 夹具：「一拧即开，随时补水。点击下方链接立即预约。」的逐词时间戳（毫秒，相对成片起点）
const KARAOKE_WORDS: CaptionWord[] = [
  { text: "一拧", startMs: 150, endMs: 650 },
  { text: "即开，", startMs: 650, endMs: 1_200 },
  { text: "随时", startMs: 1_350, endMs: 1_850 },
  { text: "补水。", startMs: 1_850, endMs: 2_500 },
  { text: "点击", startMs: 2_800, endMs: 3_200 },
  { text: "下方链接", startMs: 3_200, endMs: 3_800 },
  { text: "立即预约。", startMs: 3_800, endMs: 4_600 },
];

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test("buildTimelineFilterGraph：逐段缩放/帧率/按帧截断，无音轨段补静音，concat 后接字幕与混音", () => {
  const graph = buildTimelineFilterGraph({
    clips: [
      { videoInput: 0, audioInput: 0, frames: 344, samples: 632_100 },
      { videoInput: 1, audioInput: null, frames: 72, samples: 132_300 },
      { videoInput: 2, audioInput: 3, frames: 90, samples: 132_300 },
    ],
    width: 1080,
    height: 1920,
    fps: "24",
    ass: { path: "/tmp/w/captions.ass", fontsDir: "/var/task/fonts" },
    audioPlanFilter: "[acat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]",
    audioPlanOutput: "[aout]",
  });
  const parts = graph.filterComplex.split(";");
  assert.match(parts[0], /^\[0:v:0\]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2,setsar=1,fps=24,format=yuv420p,tpad=stop_mode=clone:stop_duration=2,trim=end_frame=344,setpts=PTS-STARTPTS\[v0\]$/);
  assert.match(parts[1], /^\[0:a:0\]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=632100,asetpts=PTS-STARTPTS\[a0\]$/);
  assert.match(parts[3], /^anullsrc=channel_layout=stereo:sample_rate=44100,atrim=end_sample=132300,asetpts=PTS-STARTPTS\[a1\]$/, "无音轨段补静音");
  assert.match(parts[5], /^\[3:a:0\]/, "b-roll：音轨取自配音输入（替换素材原声）");
  assert.equal(parts[6], "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vcat][acat]");
  assert.equal(parts[7], "[vcat]ass=filename='/tmp/w/captions.ass':fontsdir='/var/task/fonts'[vout]");
  assert.equal(parts[8], "[acat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]");
  assert.equal(graph.videoLabel, "[vout]");
  assert.equal(graph.audioLabel, "[aout]");
  assert.doesNotMatch(graph.filterComplex, /\[0:a\?\]/, "ffmpeg 6.x 不认滤镜里的可选流标记");

  const bare = buildTimelineFilterGraph({
    clips: [{ videoInput: 0, audioInput: 0, frames: 24, samples: 44_100 }],
    width: 1080,
    height: 1920,
    fps: "24",
    ass: null,
    audioPlanFilter: null,
    audioPlanOutput: null,
  });
  assert.equal(bare.videoLabel, "[vcat]");
  assert.equal(bare.audioLabel, "[acat]");
});

test("quantizeToFrames：音画按同一整帧时长截断（段内严格等长）", () => {
  assert.deepEqual(quantizeToFrames(14.35, "24"), { frames: 344, durationSec: 14.333333, samples: 632_100 });
  assert.equal(quantizeToFrames(3, "30").frames, 90);
  assert.equal(quantizeToFrames(0.001, "24").frames, 1);
  const ntsc = quantizeToFrames(10, "24000/1001");
  assert.equal(ntsc.frames, 240);
  assert.ok(Math.abs(frameRateValue("30000/1001") - 29.97) < 0.01);
  assert.equal(frameRateValue("garbage"), 30);
});

test("resolveClipKeepSec：trimToFit 截到期望时长，AI 段裁尾截到 keep，取更短者", () => {
  assert.equal(resolveClipKeepSec({ sourceDurationSec: 15.04, intendedDurationSec: 15, trimToFit: true, tailKeepSec: null }), 15);
  assert.equal(resolveClipKeepSec({ sourceDurationSec: 15, intendedDurationSec: 15, trimToFit: true, tailKeepSec: 14.2 }), 14.2);
  assert.equal(resolveClipKeepSec({ sourceDurationSec: 15, intendedDurationSec: 20, trimToFit: true, tailKeepSec: null }), null, "源比期望短：用原长");
  assert.equal(resolveClipKeepSec({ sourceDurationSec: 3, intendedDurationSec: 0.4, trimToFit: true, tailKeepSec: null }), 1, "下限 1s");
  assert.equal(resolveClipKeepSec({ sourceDurationSec: 15, intendedDurationSec: 15, trimToFit: false, tailKeepSec: null }), null);
});

test("resolveCaptionWindowSec：显式优先；否则 总长 - 尾卡（按实际时长），无尾卡铺满", () => {
  assert.equal(resolveCaptionWindowSec({ explicit: 12, clips: [{ durationSec: 20 }] }), 12);
  assert.equal(
    resolveCaptionWindowSec({
      explicit: null,
      clips: [{ durationSec: 14.2 }, { durationSec: 3 }, { durationSec: 3, excludeFromCaptions: true }],
    }),
    17.2,
  );
  assert.equal(resolveCaptionWindowSec({ explicit: null, clips: [{ durationSec: 15 }] }), null);
});

test("resolvePostProductionEffects：与改造前 applyLocalPostProduction 的判定一致", () => {
  assert.deepEqual(resolvePostProductionEffects(null), { active: false, captions: false, bgmPath: null, bgmVolume: 0, script: "" });
  const off = resolvePostProductionEffects(plan({ captions: false, bgm: false, voiceover: false }));
  assert.equal(off.active, false);
  const captionsOnly = resolvePostProductionEffects(plan({ captions: true, voiceover: false }));
  assert.equal(captionsOnly.active, true);
  assert.equal(captionsOnly.captions, true);
  const noScript = resolvePostProductionEffects(plan({ captions: true, script: "   " }));
  assert.equal(noScript.captions, false, "没有台词就不烧字幕");
  const bgm = resolvePostProductionEffects(plan({ bgm: true }));
  assert.equal(bgm.bgmPath, "scripts/assets/pet-kit-bgm.mp3");
  assert.equal(bgm.bgmVolume, 0.2);
  assert.throws(
    () => resolvePostProductionEffects({ ...plan({}), audio: { ...plan({}).audio, bgm: { trackId: "nope", volume: 0.2 } } } as unknown as PostProductionPlan),
    StitchCompositionError,
  );
});

test("时间预算：单步超时随片长放大，被 deadline 封顶；剩余不足直接抛预算异常", () => {
  assert.ok(scaledStepTimeoutMs("encode", 60) > scaledStepTimeoutMs("encode", 15));
  assert.deepEqual(stepTimeout(undefined, "encode", 15), { timeoutMs: scaledStepTimeoutMs("encode", 15), capped: false });
  const budget = createMediaBudget({ deadlineAt: 100_000, reserveMs: 20_000, now: () => 30_000 });
  assert.deepEqual(stepTimeout(budget, "encode", 60), { timeoutMs: 50_000, capped: true });
  assert.deepEqual(stepTimeout(budget, "probe", 1), { timeoutMs: 30_000, capped: false });
  const exhausted = createMediaBudget({ deadlineAt: 100_000, reserveMs: 20_000, now: () => 79_000 });
  assert.throws(() => stepTimeout(exhausted, "encode", 15), StitchBudgetExceededError);
});

test("缩略图取帧点：开场过渡之后、不深 seek", () => {
  assert.equal(thumbnailSeekSeconds(15), 1.5);
  assert.equal(thumbnailSeekSeconds(60), 2);
  assert.equal(thumbnailSeekSeconds(1), 0.25);
  assert.equal(thumbnailSeekSeconds(null), 0.25);
});

// ---------------------------------------------------------------------------
// 集成（真跑 ffmpeg）
// ---------------------------------------------------------------------------

test("integration：音轨比画面短的段（apad 无限流）也能正常收尾 —— ffmpeg 6.x 下 -shortest 收不住 apad", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-apad-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = await makeClip(path.join(dir, "short-audio.mp4"), {
    durationSec: 4,
    audio: { kind: "tone", hz: 330, speechSec: 2.5, padToEnd: false },
  });
  /// 音频流本身只有 2.5s（不是补出来的静音）：用 -t 截短音轨制造「音轨比画面短」
  const started = Date.now();
  const result = await composeTimeline({
    clips: [{ path: clip, intendedDurationSec: null, trimToFit: false }],
    aspectRatio: "9:16",
    postProduction: null,
    workDir: path.join(dir, "work"),
    budget: createMediaBudget({ deadlineAt: Date.now() + 60_000, reserveMs: 0 }),
  });
  assert.ok(Date.now() - started < 60_000);
  const probe = await probeMedia(result.videoPath);
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.equal(probe.hasAudio, true);
  assert.ok(probe.durationSec && Math.abs(probe.durationSec - 4) < 0.1, `duration ${probe.durationSec}`);
});

test("integration：单遍合成 —— 主片帧率保留、无音轨片段补静音、AI 段语音安全裁尾、口播与 BGM 都在", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-single-pass-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /// AI 段：口播 5s 后静音到 7s → 可以安全裁 0.8s
  const ai = await makeClip(path.join(dir, "ai.mp4"), {
    durationSec: 7,
    audio: { kind: "tone", hz: 440, speechSec: 5 },
  });
  /// 客户上传片段：30fps、没有音轨
  const uploaded = await makeClip(path.join(dir, "uploaded.mp4"), {
    durationSec: 3,
    fps: 30,
    audio: { kind: "none" },
    color: "navy",
  });
  const result = await composeTimeline({
    clips: [
      { path: ai, intendedDurationSec: 7, trimToFit: true, role: "ai_generated", tailTrimSec: 0.8 },
      { path: uploaded, intendedDurationSec: 3, trimToFit: true, role: "uploaded" },
    ],
    aspectRatio: "9:16",
    postProduction: plan({ captions: false, bgm: true }),
    workDir: path.join(dir, "work"),
    extractThumbnail: true,
  });
  assert.equal(result.clips[0]?.role, "ai_generated");
  assert.ok((result.clips[0]?.tailTrimmedSec ?? 0) > 0.7, `AI tail trimmed ${result.clips[0]?.tailTrimmedSec}`);
  assert.equal(result.clips[1]?.tailTrimmedSec, 0, "上传片段不裁尾");
  assert.equal(result.clips[1]?.hasAudio, false);
  assert.ok(result.thumbnailPath, "成片缩略图");
  assert.equal(result.applied.bgm, true);

  const probe = await probeMedia(result.videoPath);
  assert.equal(probe.fps, 24, "主片 24fps 保留，不强转 30");
  assert.equal(probe.hasAudio, true);
  const expected = 7 - (result.clips[0]?.tailTrimmedSec ?? 0) + 3;
  assert.ok(probe.durationSec && Math.abs(probe.durationSec - expected) < 0.15, `duration ${probe.durationSec} vs ${expected}`);
  /// 口播（440Hz）在成片里：改造前的归一化在 ffmpeg 6.x 上必然回退到「静音替换原声」
  const voice = await toneMeanVolumeDb(result.videoPath, 440, { durationSec: 4 });
  const source = await toneMeanVolumeDb(ai, 440, { durationSec: 4 });
  assert.ok(voice !== null && source !== null && voice >= source - 3, `voice ${voice} dB vs source ${source} dB`);
});

test("integration：要口播但 AI 段全都没有音轨 → VOICEOVER_TRACK_MISSING（不静默交付哑片）", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-mute-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mute = await makeClip(path.join(dir, "mute.mp4"), { durationSec: 2, audio: { kind: "none" } });
  await assert.rejects(
    composeTimeline({
      clips: [{ path: mute, intendedDurationSec: null, trimToFit: false, role: "ai_generated" }],
      aspectRatio: "9:16",
      postProduction: plan({ voiceover: true }),
      workDir: path.join(dir, "work"),
    }),
    (err: unknown) => err instanceof StitchCompositionError && err.code === "VOICEOVER_TRACK_MISSING",
  );
  await assert.rejects(
    composeTimeline({
      clips: [{ path: mute, intendedDurationSec: null, trimToFit: false, role: "broll", requireAudio: true }],
      aspectRatio: "9:16",
      postProduction: null,
      workDir: path.join(dir, "work2"),
    }),
    (err: unknown) => err instanceof StitchCompositionError && err.code === "BROLL_VOICE_TRACK_MISSING",
  );
});

test("integration：要烧字幕但运行时没有打包中文字体 → CAPTION_FONT_MISSING（fail closed，不出豆腐块）", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-nofont-"));
  const clip = await makeClip(path.join(dir, "clip.mp4"), { durationSec: 2, audio: { kind: "tone", hz: 330, speechSec: 2 } });
  const env = process.env as Record<string, string | undefined>;
  const previous = { cwd: process.cwd(), font: env.MEDIA_CJK_FONT_FILE, conf: env.FONTCONFIG_FILE };
  delete env.MEDIA_CJK_FONT_FILE;
  delete env.FONTCONFIG_FILE;
  process.chdir(dir);
  fontsTest.resetCache();
  t.after(() => {
    process.chdir(previous.cwd);
    if (previous.font === undefined) delete env.MEDIA_CJK_FONT_FILE;
    else env.MEDIA_CJK_FONT_FILE = previous.font;
    if (previous.conf === undefined) delete env.FONTCONFIG_FILE;
    else env.FONTCONFIG_FILE = previous.conf;
    fontsTest.resetCache();
    rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    composeTimeline({
      clips: [{ path: clip, intendedDurationSec: null, trimToFit: false }],
      aspectRatio: "9:16",
      postProduction: plan({ captions: true }),
      workDir: path.join(dir, "work"),
    }),
    (err: unknown) => err instanceof StitchCompositionError && err.code === "CAPTION_FONT_MISSING",
  );
});

test("integration：加粗字幕烧录用的是打包 Noto Sans SC、字幕窗口扣掉尾卡、导出 SRT", async (t) => {
  if (!(await ffmpegUsable()) || !(await ffmpegHasLibass())) return t.skip("ffmpeg with libass not installed");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font package not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-captions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const main = await makeClip(path.join(dir, "main.mp4"), { durationSec: 4, audio: { kind: "tone", hz: 330, speechSec: 4 } });
  const card = await makeClip(path.join(dir, "card.mp4"), { durationSec: 2, fps: 30, audio: { kind: "none" }, color: "black" });
  const result = await composeTimeline({
    clips: [
      { path: main, intendedDurationSec: null, trimToFit: false, role: "ai_generated" },
      { path: card, intendedDurationSec: 2, trimToFit: false, role: "end_card", excludeFromCaptions: true },
    ],
    aspectRatio: "9:16",
    postProduction: plan({ captions: true, bgm: true, style: "word_by_word" }),
    workDir: path.join(dir, "work"),
    logLevel: "info",
  });
  assert.equal(result.applied.captions, true);
  assert.equal(result.applied.audioMix, true);
  assert.ok(result.srtPath);
  assert.ok(result.captionWindowSec && Math.abs(result.captionWindowSec - 4) < 0.05, `caption window ${result.captionWindowSec}`);
  assert.match(result.stderr, /fontselect: \([^)]*\) -> [^\n]*NotoSansSC/);
  assert.doesNotMatch(result.stderr, /failed to find any fallback with glyph/);
});

/** "0:00:04.00" → 4000 */
function assMs(stamp: string): number {
  const [hours, minutes, seconds] = stamp.split(":");
  return Math.round((Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1_000);
}

test("integration：P04-C 持久化台词逐段对齐——两个 AI 段各背派发时分到的那句，窗口按量化后的实测段时长", async (t) => {
  if (!(await ffmpegUsable()) || !(await ffmpegHasLibass())) return t.skip("ffmpeg with libass not installed");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font package not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-chunks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = await makeClip(path.join(dir, "first.mp4"), { durationSec: 4, audio: { kind: "tone", hz: 330, speechSec: 4 } });
  const second = await makeClip(path.join(dir, "second.mp4"), { durationSec: 2, audio: { kind: "tone", hz: 440, speechSec: 2 } });
  const workDir = path.join(dir, "work");
  const chunks = ["一拧即开，随时补水。", "点击下方链接立即预约。"];
  const result = await composeTimeline({
    clips: [
      { path: first, intendedDurationSec: 4, trimToFit: true, role: "ai_generated" },
      { path: second, intendedDurationSec: 2, trimToFit: true, role: "ai_generated" },
    ],
    aspectRatio: "9:16",
    postProduction: plan({ captions: true, style: "plain" }),
    voiceoverChunks: chunks,
    workDir,
  });
  assert.equal(result.applied.captions, true);
  const ass = readFileSync(path.join(workDir, "captions.ass"), "utf8");
  const dialogues = ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const fields = line.split(",");
      return { startMs: assMs(fields[1]), endMs: assMs(fields[2]), text: fields.slice(9).join(",") };
    });
  assert.ok(dialogues.length >= 2);
  const inFirst = dialogues.filter((d) => d.endMs <= 4_000);
  const inSecond = dialogues.filter((d) => d.startMs >= 4_000);
  assert.equal(inFirst.length + inSecond.length, dialogues.length, "没有 cue 跨段");
  assert.equal(inFirst.map((d) => d.text).join(""), chunks[0]);
  assert.equal(inSecond.map((d) => d.text).join(""), chunks[1]);
  assert.equal(inFirst[0]?.startMs, 0);
  assert.equal(inSecond.at(-1)?.endMs, 6_000);
});

test("integration：legacy 段 + 语音安全裁尾 + 无持久化台词 → 字幕按计划时长（segmentDurationSec）切，不按裁尾后的实测", async (t) => {
  if (!(await ffmpegUsable()) || !(await ffmpegHasLibass())) return t.skip("ffmpeg with libass not installed");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font package not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-legacy-planned-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /// 段 0：口播 6s 后静音到 7s → 裁 0.8s（实测 6.2s；裁尾要求裁完 ≥ 5s）；段 1：说满 7s → 不裁。计划都是 7s。
  const first = await makeClip(path.join(dir, "first.mp4"), { durationSec: 7, audio: { kind: "tone", hz: 330, speechSec: 6 } });
  const second = await makeClip(path.join(dir, "second.mp4"), { durationSec: 7, audio: { kind: "tone", hz: 440, speechSec: 7 } });
  const script =
    "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window.";
  const planned = splitVoiceoverScript(script, [{ durationSec: 7 }, { durationSec: 7 }]);
  const workDir = path.join(dir, "work");
  const result = await composeTimeline({
    /// 与 stitch-composer.legacySegmentsToTimeline 同一形状：不填 intendedDurationSec、不 trimToFit、带裁尾、带计划时长
    clips: [
      { path: first, intendedDurationSec: null, trimToFit: false, role: "ai_generated", tailTrimSec: 0.8, plannedDurationSec: 7 },
      { path: second, intendedDurationSec: null, trimToFit: false, role: "ai_generated", tailTrimSec: 0.8, plannedDurationSec: 7 },
    ],
    aspectRatio: "9:16",
    postProduction: plan({ captions: true, style: "plain", script }),
    workDir,
  });
  assert.ok((result.clips[0]?.tailTrimmedSec ?? 0) > 0.7, `segment 0 trimmed ${result.clips[0]?.tailTrimmedSec}`);
  assert.equal(result.clips[1]?.tailTrimmedSec, 0, "说满的段不裁");
  const boundaryMs = Math.round((result.clips[0]?.durationSec ?? 0) * 1_000);
  assert.ok(boundaryMs < 6_300 && boundaryMs > 6_100, `measured boundary ${boundaryMs}`);
  /// 这个夹具下按实测时长切会得到不同的边界（"Custom blackout | curtains"）——用例因此有区分度
  assert.notDeepEqual(splitScriptByDurations(script, result.clips.map((clip) => clip.durationSec)), planned);
  const ass = readFileSync(path.join(workDir, "captions.ass"), "utf8");
  const dialogues = ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const fields = line.split(",");
      return { startMs: assMs(fields[1]), endMs: assMs(fields[2]), text: fields.slice(9).join(",") };
    });
  const squash = (value: string) => value.replace(/\s+/gu, " ").trim();
  const textIn = (predicate: (d: { startMs: number; endMs: number }) => boolean) =>
    squash(dialogues.filter(predicate).map((d) => d.text).join(" "));
  /// 按中点归窗（窗界 3208ms 在 ASS 里落成 0:00:03.20）
  assert.equal(textIn((d) => (d.startMs + d.endMs) / 2 < boundaryMs), squash(planned[0]), "段 0 字幕 = 按计划时长切出的第 1 句");
  assert.equal(textIn((d) => (d.startMs + d.endMs) / 2 >= boundaryMs), squash(planned[1]), "段 1 字幕 = 按计划时长切出的第 2 句");
  /// 窗口位置仍按实测：段 0 的字幕在 3.2s 前结束，段 1 从 3.2s 起
  assert.ok(dialogues.filter((d) => (d.startMs + d.endMs) / 2 < boundaryMs).every((d) => d.endMs <= boundaryMs + 10));
  assert.ok(dialogues.filter((d) => (d.startMs + d.endMs) / 2 >= boundaryMs).every((d) => d.startMs >= boundaryMs - 10));
});

test("integration：P04-B karaoke 字幕夹具实烧——Karaoke 样式 + 逐词 \\kf 标签，libass 用打包字体、无报错", async (t) => {
  if (!(await ffmpegUsable()) || !(await ffmpegHasLibass())) return t.skip("ffmpeg with libass not installed");
  if (!useBundledCjkFont(t)) return t.skip("bundled CJK font package not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-karaoke-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const main = await makeClip(path.join(dir, "main.mp4"), { durationSec: 5, audio: { kind: "tone", hz: 330, speechSec: 5 } });
  /// Phase 1 没有逐词时间戳来源，合成器不会走到这里；这条锁的是渲染器产物真的能被 libass 吃下
  const cues = buildTimedCues(KARAOKE_WORDS, { language: "zh-CN" });
  const ass = renderAssCaptions(cues, { aspectRatio: "9:16", position: "bottom", style: "karaoke", language: "zh-CN" });
  assert.match(ass, /^Style: Captions,Noto Sans SC,/mu, "Captions 样式原样");
  assert.match(ass, /^Style: Karaoke,Noto Sans SC,58,&H0000D7FF,&H00FFFFFF,/mu);
  assert.match(ass, /^; Language: zh-CN$/mu);
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 2, "两句 → 两条 karaoke Dialogue");
  assert.ok(dialogues.every((line) => line.includes(",Karaoke,,") && /\{\\kf\d+\}一拧|\{\\kf\d+\}点击/u.test(line)));
  const assPath = path.join(dir, "captions.ass");
  writeFileSync(assPath, ass, "utf8");
  const { fontDir } = ensureMediaFonts();
  assert.ok(fontDir, "bundled font dir");
  const escape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
  const burn = await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "info", "-nostats",
      "-i", main,
      "-vf", `scale=1080:1920,ass=filename='${escape(assPath)}':fontsdir='${escape(fontDir as string)}'`,
      "-t", "2", "-f", "null", "-",
    ],
    { timeoutMs: 60_000 },
  );
  /// libass：字体选中打包的 Noto Sans SC，没有缺字回退、没有解析报错
  assert.match(burn.stderr, /fontselect: \([^)]*\) -> [^\n]*NotoSansSC/);
  assert.doesNotMatch(burn.stderr, /failed to find any fallback with glyph/);
  assert.doesNotMatch(burn.stderr, /\[ass\][^\n]*(?:error|Error|failed|invalid)/u);
});

test("integration：卡在无限流上的 ffmpeg 到点被 SIGKILL 准时停；被预算封顶的超时转成预算异常", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-kill-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const started = Date.now();
  await assert.rejects(
    runStitchStep(
      ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-c:a", "aac", path.join(dir, "forever.m4a")],
      {
        step: "encode",
        label: "never-ending encode",
        mediaSec: 15,
        budget: createMediaBudget({ deadlineAt: Date.now() + 3_500, reserveMs: 0 }),
      },
    ),
    StitchBudgetExceededError,
  );
  assert.ok(Date.now() - started < 15_000, `killed after ${Date.now() - started}ms`);
});

test("integration：预算已用尽 → StitchBudgetExceededError（交给调用方放回 PENDING），不开始编码", async (t) => {
  if (!(await ffmpegUsable())) return t.skip("ffmpeg not installed");
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-budget-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = await makeClip(path.join(dir, "clip.mp4"), { durationSec: 2, audio: { kind: "none" } });
  await assert.rejects(
    composeTimeline({
      clips: [{ path: clip, intendedDurationSec: null, trimToFit: false }],
      aspectRatio: "9:16",
      postProduction: null,
      workDir: path.join(dir, "work"),
      budget: createMediaBudget({ deadlineAt: Date.now() - 1, reserveMs: 0 }),
    }),
    StitchBudgetExceededError,
  );
});
