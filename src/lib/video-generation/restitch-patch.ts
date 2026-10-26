import { z } from "zod";
import { bgmSettingsSchema, captionSettingsSchema } from "@/lib/schemas/unified-input";
import type { PostProductionPlan } from "@/types/video-generation";

/**
 * P05-B 只重拼的输入契约（轻模块：只有 zod，路由可静态引用；合成器在 stitch-service）。
 *
 * 只放行 captions / bgm 两项。口播（voiceover）不在此列：换口播稿等于重新生成画面与配音，
 * 不是「只重拼」——带了 voiceover 一律 INVALID_STATE，不是校验失败，而是走错了入口。
 */
export type RestitchPatch = {
  captions?: PostProductionPlan["captions"];
  bgm?: PostProductionPlan["audio"]["bgm"];
};

export type RestitchRejectCode = "INVALID_STATE" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND";

export class RestitchRejectedError extends Error {
  constructor(
    readonly code: RestitchRejectCode,
    message: string,
  ) {
    super(message);
    this.name = "RestitchRejectedError";
  }
}

export const restitchPatchSchema = z
  .object({
    captions: captionSettingsSchema.optional(),
    bgm: bgmSettingsSchema.optional(),
  })
  .strict();

const VOICEOVER_KEYS = ["voiceover", "audio", "script", "voiceId"] as const;

export function parseRestitchPatch(input: unknown): RestitchPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RestitchRejectedError("VALIDATION_FAILED", "请提供要更换的字幕样式或配乐设置。");
  }
  const record = input as Record<string, unknown>;
  if (VOICEOVER_KEYS.some((key) => key in record)) {
    throw new RestitchRejectedError(
      "INVALID_STATE",
      "只重拼只能更换字幕样式与配乐；要改口播稿，请回到创作页重新生成。",
    );
  }
  const parsed = restitchPatchSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RestitchRejectedError(
      "VALIDATION_FAILED",
      `字幕 / 配乐设置不合法${issue ? `：${issue.path.join(".") || "body"} ${issue.message}` : ""}。`,
    );
  }
  if (!parsed.data.captions && !parsed.data.bgm) {
    throw new RestitchRejectedError("VALIDATION_FAILED", "至少要更换字幕样式或配乐之一。");
  }
  return parsed.data;
}

/** 把补丁合进现有后期快照：口播原样保留，只替换字幕 / 配乐。 */
export function mergeRestitchPatch(
  base: PostProductionPlan,
  patch: RestitchPatch,
): PostProductionPlan {
  return {
    audio: {
      voiceover: base.audio.voiceover,
      bgm: patch.bgm ?? base.audio.bgm,
    },
    captions: patch.captions ?? base.captions,
  };
}

/** 两份快照的字幕 / 配乐是否完全一致（口播不比较）：一致就没有可重拼的改动。 */
export function restitchPatchIsNoop(base: PostProductionPlan, merged: PostProductionPlan): boolean {
  return (
    JSON.stringify(base.captions) === JSON.stringify(merged.captions) &&
    JSON.stringify(base.audio.bgm) === JSON.stringify(merged.audio.bgm)
  );
}
