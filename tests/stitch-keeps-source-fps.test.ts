/**
 * 4.5 拼接保留源帧率（服务端 stitch-service / 品牌封装同一路径）。
 *
 * 真跑本机 ffmpeg：24fps 主片 + 30fps 静帧尾卡 → 成片必须是 24fps，
 * 不能再被强转成 30fps（24→30 靠重复帧凑数，运动画面顿挫）。
 * 对象存储用内存替身，不连任何外部服务。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { probeMedia, runFfmpeg } from "../src/lib/media/ffmpeg-bin";
import { runFfmpegNormalizeAndConcatWithPostProduction } from "../src/lib/services/stitch-service";
import { getStorageProvider } from "../src/lib/storage";

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

test("integration: 24fps 主片 + 30fps 尾卡 → 拼接成片保持 24fps", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "stitch-fps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const main = path.join(dir, "main.mp4");
  await runFfmpeg([
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=s=360x640:d=2:r=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", main,
  ]);
  const card = path.join(dir, "card.mp4");
  await runFfmpeg([
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=navy:s=360x640:d=1:r=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", card,
  ]);

  /// 内存对象存储替身：把上传内容落到本地临时目录
  const storage = getStorageProvider() as unknown as Record<string, unknown>;
  const original = {
    isConfigured: storage.isConfigured,
    uploadBuffer: storage.uploadBuffer,
  };
  const uploaded: string[] = [];
  storage.isConfigured = () => true;
  storage.uploadBuffer = async (
    _bucket: string,
    buffer: Buffer,
    options: { key: string },
  ) => {
    const out = path.join(dir, `uploaded-${uploaded.length}.mp4`);
    writeFileSync(out, buffer);
    uploaded.push(out);
    return { url: pathToFileURL(out).href, key: options.key };
  };
  t.after(() => {
    storage.isConfigured = original.isConfigured;
    storage.uploadBuffer = original.uploadBuffer;
  });

  const result = await runFfmpegNormalizeAndConcatWithPostProduction({
    finalVideoId: "fps-test",
    aspectRatio: "9:16",
    clips: [
      { url: pathToFileURL(main).href, intendedDurationSec: null, trimToFit: false },
      { url: pathToFileURL(card).href, intendedDurationSec: 1, trimToFit: true },
    ],
    postProduction: null,
  });
  assert.equal(uploaded.length, 1);
  assert.equal(result.stitchedVideoUrl, pathToFileURL(uploaded[0]).href);

  const probe = await probeMedia(uploaded[0]);
  assert.equal(probe.fps, 24, `成片帧率应保持主片 24fps，实际 ${probe.fps}`);
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.ok(
    probe.durationSec && Math.abs(probe.durationSec - 3) < 0.25,
    `duration ${probe.durationSec}`,
  );
});
