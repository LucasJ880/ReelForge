import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const runnerPath = path.join(process.cwd(), "scripts/stitch-runner.ts");

test("stitch runner extracts and uploads a JPEG preview before completing", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(
    runner,
    /await extractThumbnail\([\s\S]*postProduced\.videoPath,[\s\S]*thumbnailOut,[\s\S]*task\.targetDurationSec/,
  );
  assert.match(
    runner,
    /uploadToBlob\(thumbnailOut, thumbnailBlobPath, "image\/jpeg"\)/,
  );
  assert.match(runner, /thumbnailUrl: output\.thumbnailUrl/);
  assert.match(runner, /thumbnail=30,scale=480:-2/);
});

test("stitch runner probes actual duration and uploads optional deterministic SRT", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /ffprobe/);
  assert.match(runner, /buildDeterministicCues/);
  assert.match(runner, /renderAssCaptions/);
  assert.match(runner, /renderSrtCaptions/);
  assert.match(runner, /subtitleFileUrl: output\.subtitleFileUrl/);
  assert.match(runner, /text\/plain/);
});

test("stitch runner keeps temporary cleanup and emits only safe failure codes", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(
    runner,
    /finally \{[\s\S]*await rm\(tmpDir, \{ recursive: true, force: true \}\)/,
  );
  assert.match(runner, /return "stitch_runner_unexpected_failure"/);
  assert.doesNotMatch(runner, /url=\$\{stitched/);
  assert.doesNotMatch(runner, /url\.slice\(/);
  assert.doesNotMatch(runner, /safeText\(/);
});
