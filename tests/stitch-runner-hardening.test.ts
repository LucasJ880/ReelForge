/**
 * C3：GitHub runner 保留为回滚路径，补三处加固：
 *   - 要烧字幕但打包中文字体缺失 → 任务失败（caption_font_missing），不再只打 ::warning:: 交付豆腐块
 *   - 没有音轨的段补静音轨（concat 各段流结构一致）
 *   - 缩放与应用内合成器一致：lanczos + setsar=1
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRunnerNormalizeArgs,
  requireCaptionFontDir,
} from "../scripts/stitch-runner";

test("runner：字体缺失 → caption_font_missing 失败（fail closed）", () => {
  assert.throws(
    () => requireCaptionFontDir(null),
    (err: unknown) =>
      err instanceof Error &&
      err.name === "StitchRunnerError" &&
      (err as Error & { code?: string }).code === "caption_font_missing",
  );
  assert.equal(requireCaptionFontDir("/fonts"), "/fonts");
});

test("runner：字体缺失不再只是 warning", async () => {
  const runner = await readFile("scripts/stitch-runner.ts", "utf8");
  assert.doesNotMatch(runner, /::warning::bundled CJK font missing/);
  assert.match(runner, /requireCaptionFontDir\(fontDir\)/);
});

test("runner：没有音轨的段补一条等长静音轨；有音轨的段参数与改造前一致", () => {
  const padded = buildRunnerNormalizeArgs({
    input: "/tmp/in.mp4",
    output: "/tmp/out.mp4",
    targetFps: "24",
    padFilter: "scale=1080:1920",
    silentPadSec: 6.5,
  });
  const lavfi = padded.indexOf("lavfi");
  assert.ok(lavfi > 0, "补静音输入");
  assert.equal(padded[padded.indexOf("-t") + 1], "6.500");
  assert.ok(padded.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  assert.deepEqual(padded.slice(padded.indexOf("-map"), padded.indexOf("-map") + 4), [
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
  ]);
  assert.ok(padded.includes("-shortest"));
  assert.equal(padded.at(-1), "/tmp/out.mp4");

  const plain = buildRunnerNormalizeArgs({
    input: "/tmp/in.mp4",
    output: "/tmp/out.mp4",
    targetFps: "24",
    padFilter: "scale=1080:1920",
    silentPadSec: null,
  });
  assert.deepEqual(plain, [
    "-y",
    "-i",
    "/tmp/in.mp4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-r",
    "24",
    "-vf",
    "scale=1080:1920",
    "/tmp/out.mp4",
  ]);
});

test("runner：补静音不会把「要口播却一条音轨都没有」变成静默交付（voiceover_track_missing）", async () => {
  const runner = await readFile("scripts/stitch-runner.ts", "utf8");
  assert.match(runner, /silentSegments === task\.segmentUrls\.length/);
  assert.match(runner, /new StitchRunnerError\("voiceover_track_missing"\)/);
});

test("runner：缩放与应用内合成器一致（lanczos + setsar=1）", async () => {
  const runner = await readFile("scripts/stitch-runner.ts", "utf8");
  assert.match(runner, /force_original_aspect_ratio=decrease:flags=lanczos,pad=/);
  assert.match(runner, /\(oh-ih\)\/2,setsar=1`/);
});
