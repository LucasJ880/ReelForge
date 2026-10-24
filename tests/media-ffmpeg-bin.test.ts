/**
 * 4.1 媒体运行时：ffmpeg 唯一解析入口 + 用 ffmpeg 本体替代 ffprobe 的探测。
 *
 * 纯逻辑（解析顺序、输入信息解析）不依赖本机 ffmpeg；集成用例在本机有
 * ffmpeg 时才跑（生成 lavfi 合成素材，不碰任何外部服务）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  __test__ as binTest,
  ffmpegBinary,
  parseFfmpegInputInfo,
  probeMedia,
  probeMediaDurationSeconds,
  resolveFfmpegBinary,
  runFfmpeg,
  staticFfmpegCandidates,
} from "../src/lib/media/ffmpeg-bin";

const MP4_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'seg.mp4':
  Metadata:
    major_brand     : isom
    encoder         : Lavf62.12.102
  Duration: 00:00:15.04, start: 0.000000, bitrate: 2141 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280 [SAR 1:1 DAR 9:16], 2008 kb/s, 24 fps, 24 tbr, 12288 tbn (default)
    Metadata:
      handler_name    : VideoHandler
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)
At least one output file must be specified`;

const MP3_WITH_COVER = `Input #0, mp3, from 'bgm.mp3':
  Metadata:
    artist          : Kevin MacLeod
  Duration: 00:02:31.20, start: 0.025057, bitrate: 78 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 64 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
At least one output file must be specified`;

test("[ffmpeg-bin] 解析顺序：FFMPEG_BIN 显式覆盖优先", () => {
  const resolved = resolveFfmpegBinary({
    env: { FFMPEG_BIN: "/opt/homebrew/bin/ffmpeg" },
    isExecutable: () => true,
  });
  assert.deepEqual(resolved, { path: "/opt/homebrew/bin/ffmpeg", source: "env" });
});

test("[ffmpeg-bin] 解析顺序：没设 FFMPEG_BIN 时用 ffmpeg-static 打包的二进制", () => {
  const cwd = "/var/task";
  const expected = path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg");
  const resolved = resolveFfmpegBinary({
    env: {},
    cwd,
    isExecutable: (candidate) => candidate === expected,
  });
  assert.deepEqual(resolved, { path: expected, source: "ffmpeg-static" });
  assert.equal(staticFfmpegCandidates(cwd)[0], expected);
});

test("[ffmpeg-bin] 解析顺序：静态二进制不可执行 → 回退 PATH 上的 ffmpeg", () => {
  const resolved = resolveFfmpegBinary({
    env: { FFMPEG_BIN: "   " },
    cwd: "/nonexistent-project",
    isExecutable: () => false,
  });
  assert.deepEqual(resolved, { path: "ffmpeg", source: "path" });
});

test("[ffmpeg-bin] ffmpegBinary 缓存随 FFMPEG_BIN 变化失效", () => {
  const previous = process.env.FFMPEG_BIN;
  try {
    binTest.resetCache();
    process.env.FFMPEG_BIN = "/custom/a/ffmpeg";
    assert.equal(ffmpegBinary().path, "/custom/a/ffmpeg");
    process.env.FFMPEG_BIN = "/custom/b/ffmpeg";
    assert.equal(ffmpegBinary().path, "/custom/b/ffmpeg");
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_BIN;
    else process.env.FFMPEG_BIN = previous;
    binTest.resetCache();
  }
});

test("[ffmpeg-bin] parseFfmpegInputInfo：时长 / 尺寸 / 帧率 / 音轨", () => {
  const probe = parseFfmpegInputInfo(MP4_BANNER);
  assert.equal(probe.durationSec, 15.04);
  assert.equal(probe.width, 720);
  assert.equal(probe.height, 1280);
  assert.equal(probe.fps, 24);
  assert.equal(probe.hasVideo, true);
  assert.equal(probe.hasAudio, true);
});

test("[ffmpeg-bin] parseFfmpegInputInfo：mp3 封面图不算视频流，90k tbr 不当帧率", () => {
  const probe = parseFfmpegInputInfo(MP3_WITH_COVER);
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.hasVideo, false);
  assert.equal(probe.width, null);
  assert.equal(probe.fps, null);
  assert.ok(Math.abs((probe.durationSec ?? 0) - 151.2) < 1e-9);
});

test("[ffmpeg-bin] parseFfmpegInputInfo：NTSC 帧率与无音轨", () => {
  const probe = parseFfmpegInputInfo(`Input #0, mov,mp4, from 'x.mp4':
  Duration: 00:00:05.01, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0(und): Video: h264 (Main), yuv420p, 1920x1080, 900 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)`);
  assert.equal(probe.fps, 29.97);
  assert.equal(probe.hasAudio, false);
  assert.equal(probe.width, 1920);
});

test("[ffmpeg-bin] parseFfmpegInputInfo：只看 Input #0，不被 Output 段干扰", () => {
  const probe = parseFfmpegInputInfo(`${MP4_BANNER}
Output #0, mp4, to 'out.mp4':
  Stream #0:0: Video: h264, yuv420p, 1080x1920, q=2-31, 30 fps, 15360 tbn`);
  assert.equal(probe.width, 720);
  assert.equal(probe.fps, 24);
});

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

test("integration: probeMedia 用 ffmpeg 本体探测（不需要 ffprobe）", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "ffmpeg-bin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "src.mp4");
  await runFfmpeg([
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=red:s=320x568:d=2:r=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-c:a", "aac", "-shortest", src,
  ]);
  const probe = await probeMedia(src);
  assert.equal(probe.width, 320);
  assert.equal(probe.height, 568);
  assert.equal(probe.fps, 24);
  assert.equal(probe.hasAudio, true);
  assert.ok(probe.durationSec && Math.abs(probe.durationSec - 2) < 0.1);
  assert.ok(Math.abs((await probeMediaDurationSeconds(src)) - 2) < 0.1);

  await assert.rejects(() => probeMedia(path.join(dir, "missing.mp4")), /ffmpeg probe failed/);
});

test("integration: runFfmpeg 非 0 退出默认 reject，allowNonZeroExit 时返回 stderr", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  await assert.rejects(() => runFfmpeg(["-hide_banner", "-i", "/no/such/input.mp4"]));
  const result = await runFfmpeg(["-hide_banner", "-i", "/no/such/input.mp4"], {
    allowNonZeroExit: true,
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /No such file|does not exist|Error/i);
});
