/**
 * 批量视频的参考图说明（2026-10-28，借鉴 LibTV 每条视频提示词开头的「参考使用说明」）。
 *
 * 批量提交时参考图 = 商家实拍在前 + 已批准的故事板帧在后（batch-service.orderBatchReferenceImages），
 * 但提示词里从没说过哪几张是产品、哪几张是帧：模型只能猜，1026 的 5 条漂移全在批量路径。
 * 这里按「真正发出去的」张数（截断之后）给每一段编号写明角色，插在提示词首行之后。
 * 纯函数：超出供应商 5000 字上限时原样返回（不能为了说明把整条提交打成不可重试的 422）。
 */
import { NEGATIVE_CONSTRAINTS_SEPARATOR } from "@/lib/video-generation/storyboard-beats";

const VIDEO_PROMPT_LIMIT = 5000;
const VIDEO_PROMPT_SAFETY = 100;
export const BATCH_REFERENCE_MANIFEST_PREFIX = "REFERENCE IMAGES:";

/// 与批量模板骨架同一记法（batch-style-templates / generic-commerce-template 的 {IMAGE_REFS} = input_images[n]）。
function span(from: number, to: number): string {
  return from === to ? `input_images[${from}] is` : `input_images[${from}]-input_images[${to}] are`;
}

export function batchReferenceManifestLine(input: { productPhotoCount: number; frameCount: number }): string | null {
  const photos = Math.max(0, input.productPhotoCount);
  const frames = Math.max(0, input.frameCount);
  if (photos === 0 && frames === 0) return null;
  const parts: string[] = [];
  if (photos > 0) {
    parts.push(
      `${span(1, photos)} ${photos === 1 ? "a real photo" : "real photos"} of the product — the only source of truth for its shape, proportions, colors, controls and printed marks; match it exactly.`,
    );
  }
  if (frames > 0) {
    parts.push(
      `${span(photos + 1, photos + frames)} ${frames === 1 ? "the approved storyboard keyframe" : "the approved storyboard keyframes in story order"} — follow their location, people, wardrobe, light and framing${photos > 0 ? "; where a keyframe and the product photos disagree about the product, the product photos win" : ""}.`,
    );
  }
  return `${BATCH_REFERENCE_MANIFEST_PREFIX} ${parts.join(" ")}`;
}

export function withBatchReferenceManifest(
  prompt: string,
  input: { productPhotoCount: number; frameCount: number; negativePrompt?: string | null },
): string {
  if (prompt.includes(BATCH_REFERENCE_MANIFEST_PREFIX)) return prompt;
  const line = batchReferenceManifestLine(input);
  if (!line) return prompt;
  const [first, ...rest] = prompt.split("\n");
  const next = rest.length > 0 ? [first, line, ...rest].join("\n") : `${first}\n${line}`;
  const negative = input.negativePrompt?.trim() ?? "";
  const tail = negative ? `${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : "";
  if (next.length + tail.length > VIDEO_PROMPT_LIMIT - VIDEO_PROMPT_SAFETY) return prompt;
  return next;
}
