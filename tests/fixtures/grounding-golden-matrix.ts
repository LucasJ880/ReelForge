import { createHash } from "node:crypto";
import {
  STORYBOARD_BEATS_LONG,
  STORYBOARD_BEATS_SHORT,
  groundSegmentPromptInStoryboard,
} from "../../src/lib/video-generation/storyboard-beats";

/**
 * P02-F(v) 逐字节基线：没有切片与主播时，grounding 的输出必须与 P02-F(v) 之前完全一致。
 * 矩阵覆盖 实拍 0–3 张 × 短/长节奏 × 单段/两段时间窗 × 有无负面提示词 × 两种模板。
 * GOLDEN 由改动前的 groundSegmentPromptInStoryboard 跑出（2026-10-26）。
 */
const TEMPLATES = [
  [
    "9:16 vertical UGC-style short video shot on a phone, 15s continuous story told in 5 quick cuts.",
    "LOCATION: real lived-in home environment, natural clutter, daylight from window",
    "CHARACTER IDENTITY LOCK: keep the cast.",
    "PRODUCT SHAPE LOCK: keep the product.",
    "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience.",
    'Spoken dialogue (voice only, exact wording, zh-CN, warm confident): "带它出门。"',
    "Do not render subtitles, captions, readable text, or a music bed.",
  ].join("\n"),
  [
    "CHARACTER (must match the presenter reference photo — same face; keep 100% identical in every cut): oat loungewear.",
    "PRODUCT (must exactly match the reference images): a navy linen roman shade.",
    "Style: authentic handheld iPhone footage",
  ].join("\n"),
];

export function groundingMatrixOutputs(): string[] {
  const outputs: string[] = [];
  for (const template of TEMPLATES) {
    for (const productPhotoCount of [0, 1, 2, 3]) {
      for (const negativePrompt of [null, "no text, no extra windows"]) {
        for (const [beats, totalDurationSec, windows] of [
          [STORYBOARD_BEATS_SHORT, 15, [[0, 15]]],
          [STORYBOARD_BEATS_LONG, 30, [[0, 15], [15, 30]]],
        ] as const) {
          for (const [fromSec, toSec] of windows) {
            outputs.push(
              groundSegmentPromptInStoryboard(template, {
                aspectRatio: "9:16",
                story: "一只金毛在公园奔跑，主人在手机上看项圈摄像头的第一视角画面。",
                beats,
                productPhotoCount,
                totalDurationSec,
                fromSec,
                toSec,
                negativePrompt,
              }),
            );
          }
        }
      }
    }
  }
  return outputs;
}

export function groundingMatrixDigest(outputs: readonly string[] = groundingMatrixOutputs()): string {
  return createHash("sha256").update(outputs.join("\n\u0000\n")).digest("hex");
}

if (process.argv[1]?.endsWith("grounding-golden-matrix.ts")) {
  console.log(groundingMatrixOutputs().length, groundingMatrixDigest());
}
