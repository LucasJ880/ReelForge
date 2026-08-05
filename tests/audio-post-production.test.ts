import assert from "node:assert/strict";
import test from "node:test";
import {
  BGM_TRACKS,
  buildAudioFilterPlan,
  buildDeterministicCues,
  renderAssCaptions,
  renderSrtCaptions,
} from "../src/lib/video-generation/audio-post-production";

test("allocates the full probed duration by readable token weight", () => {
  const cues = buildDeterministicCues("第一句。Second sentence!", 8);
  assert.equal(cues[0]?.startMs, 0);
  assert.equal(cues.at(-1)?.endMs, 8_000);
  assert.ok(cues.every((cue) => cue.endMs > cue.startMs));
  assert.deepEqual(
    cues.map((cue) => cue.text).join(""),
    "第一句。Second sentence!",
  );
});

test("caption serialization is deterministic and escapes ASS control text", () => {
  const cues = buildDeterministicCues("新品 {ready}。Try it now!", 6);
  const firstSrt = renderSrtCaptions(cues);
  const secondSrt = renderSrtCaptions(cues);
  assert.equal(firstSrt, secondSrt);
  assert.match(firstSrt, /00:00:00,000/);
  assert.match(firstSrt, /00:00:06,000/);

  const ass = renderAssCaptions(cues, {
    aspectRatio: "9:16",
    position: "bottom",
    style: "word_by_word",
  });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /\\\{ready\\\}/);
  assert.doesNotMatch(ass, /Math\.random/);
});

test("FFmpeg plan ducks licensed BGM under native speech", () => {
  const plan = buildAudioFilterPlan({
    bgmVolume: 0.25,
    hasNativeAudio: true,
    durationSec: 8,
  });
  assert.match(plan.filterComplex, /sidechaincompress/);
  assert.match(plan.filterComplex, /volume=0\.25/);
  assert.match(plan.filterComplex, /atrim=end=8/);
  assert.match(plan.filterComplex, /loudnorm=I=-16:TP=-1\.5/);
  assert.deepEqual(plan.bgmInputArgs, ["-stream_loop", "-1"]);
});

test("licensed BGM catalog has an explicit no-music option and attribution", () => {
  assert.deepEqual(BGM_TRACKS[0], {
    id: "none",
    label: "无配乐",
    path: null,
  });
  assert.deepEqual(BGM_TRACKS[1], {
    id: "wholesome",
    label: "Wholesome",
    path: "scripts/assets/pet-kit-bgm.mp3",
    license: "CC BY 4.0",
    author: "Kevin MacLeod",
  });
});

test("english scripts split at sentence and phrase boundaries, never mid-phrase", () => {
  /// 0804 brand-logo 验收回归：旧逻辑不认 ASCII 句号 + 空格/逗号同权，
  /// 烧出 “Not in this bedroom. Custom blackout / curtains from …” 这类腰斩字幕。
  const script =
    "Morning glare again? Not in this bedroom. Custom blackout curtains from SunnyShutter, measured and made for your exact window. Soft light when you want it, total blackout when you need it.";
  const cues = buildDeterministicCues(script, 14.3);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    [
      "Morning glare again?",
      "Not in this bedroom.",
      "Custom blackout curtains from SunnyShutter,",
      "measured and made for your exact window.",
      "Soft light when you want it,",
      "total blackout when you need it.",
    ],
  );
  assert.ok(cues.every((cue) => cue.text === cue.text.trim()));
  assert.equal(cues.at(-1)?.endMs, 14_300);
});

test("decimal points do not split sentences", () => {
  const cues = buildDeterministicCues("Only $19.99 today. Grab yours now!", 6);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["Only $19.99 today.", "Grab yours now!"],
  );
});
