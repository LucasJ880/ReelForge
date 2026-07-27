import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  generateVoiceoverScript,
} from "../src/components/video-generation/audio-caption-controls";

const source = readFileSync(
  "src/components/video-generation/audio-caption-controls.tsx",
  "utf8",
);
const studio = readFileSync(
  "src/components/video-generation/streamlined-video-studio.tsx",
  "utf8",
);

test("voiceover starts with a generated, editable script", () => {
  assert.match(source, /生成口播稿/);
  assert.match(source, /<textarea/);
  assert.match(source, /voiceover/);
  assert.match(studio, /audio:\s*\{\s*voiceover:/);
  assert.match(studio, /captions:/);
});

test("BGM disclosure includes license attribution", () => {
  assert.match(source, /CC BY 4\.0/);
  assert.match(source, /Kevin MacLeod/);
  assert.match(source, /Wholesome/);
  assert.match(source, /<details/);
});

test("automatic scripts are deterministic, localized, and duration-bounded", () => {
  const input = {
    prompt:
      "展示一款轻巧保温杯如何解决通勤途中漏水的问题，并清楚演示单手开盖。",
    cta: "立即了解",
    durationSec: 15 as const,
    language: "zh-CN",
    templateId: "commerce-demo-first-reveal",
  };
  const first = generateVoiceoverScript(input);
  const second = generateVoiceoverScript(input);
  assert.equal(first, second);
  assert.match(first, /保温杯/);
  assert.match(first, /立即了解/);
  assert.ok(Array.from(first).length <= 15 * 4);

  const english = generateVoiceoverScript({
    prompt: "Show how a compact travel bottle prevents leaks on a morning commute.",
    cta: "Learn more",
    durationSec: 15,
    language: "en-US",
    templateId: "commerce-ugc-testimonial",
  });
  assert.match(english, /travel bottle/i);
  assert.match(english, /Learn more/);
  assert.ok(english.split(/\s+/u).length <= 34);
});
