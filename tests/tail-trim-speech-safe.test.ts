import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  detectLastAudioActivityEndSeconds,
  resolveSpeechSafeTailTrim,
  trimVideoTailSpeechSafe,
} from "../src/lib/video-generation/tail-trim";

const execFileAsync = promisify(execFile);

test("no audio track → blind trim as before", () => {
  assert.deepEqual(
    resolveSpeechSafeTailTrim({
      durationSec: 15,
      requestedTailSec: 0.8,
      activityEndSec: null,
    }),
    { trimSec: 0.8, speechLimited: false },
  );
});

test("speech ends early → full requested trim", () => {
  assert.deepEqual(
    resolveSpeechSafeTailTrim({
      durationSec: 15,
      requestedTailSec: 0.8,
      activityEndSec: 13.5,
    }),
    { trimSec: 0.8, speechLimited: false },
  );
});

test("voiceover runs close to the end → trim shrinks (0804 'need it.' regression)", () => {
  /// v1 事故参数：15.04s 母片、口播讲到 14.8s、盲裁 0.8s 把收尾词切掉。
  const result = resolveSpeechSafeTailTrim({
    durationSec: 15.04,
    requestedTailSec: 0.8,
    activityEndSec: 14.8,
  });
  assert.ok(result.speechLimited);
  assert.ok(result.trimSec >= 0 && result.trimSec < 0.1);
});

test("audio active to the last frame → no trim at all", () => {
  assert.deepEqual(
    resolveSpeechSafeTailTrim({
      durationSec: 15,
      requestedTailSec: 0.8,
      activityEndSec: 15,
    }),
    { trimSec: 0, speechLimited: true },
  );
});

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

test("integration: silent tail trims fully, speech tail is protected", async (t) => {
  if (!(await ffmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "tailtrim-"));
  const src = join(dir, "src.mp4");
  /// 8s 视频；音频 = 前 6.5s 正弦「口播」，之后数字静音
  await execFileAsync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=320x240:d=8:r=24",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6.5",
    "-af", "apad=whole_dur=8",
    "-c:v", "libx264", "-c:a", "aac",
    "-shortest",
    src,
  ]);

  const activityEnd = await detectLastAudioActivityEndSeconds(src, 8);
  assert.ok(
    activityEnd !== null && activityEnd > 6.2 && activityEnd < 6.9,
    `activity end detected at ${activityEnd}`,
  );

  const gentle = await trimVideoTailSpeechSafe(src, { tailSeconds: 0.8 });
  assert.equal(gentle.speechLimited, false);
  assert.ok(gentle.trimmedSeconds > 0.7, "silent tail should trim fully");

  const aggressive = await trimVideoTailSpeechSafe(src, { tailSeconds: 2 });
  assert.ok(aggressive.speechLimited, "2s trim must be speech-limited");
  assert.ok(
    aggressive.trimmedSeconds < 1.5,
    `trim clamped to the silent tail, got ${aggressive.trimmedSeconds}`,
  );
});
