import { z } from "zod";
import { bgmSettingsSchema, captionSettingsSchema } from "@/lib/schemas/unified-input";
import { signoffSettingsSchema } from "@/lib/video-generation/brand-signoff";
import type { PostProductionPlan } from "@/types/video-generation";

/**
 * P05-B 只重拼的输入契约（轻模块：只有 zod，路由可静态引用；合成器在 stitch-service）。
 *
 * 只放行 captions / bgm / signoff（片尾落款，2026-11-10）三项。口播（voiceover）不在此列：换口播稿等于重新生成画面与配音，
 * 不是「只重拼」——带了 voiceover 一律 INVALID_STATE，不是校验失败，而是走错了入口。
 */
export type RestitchPatch = {
  captions?: PostProductionPlan["captions"];
  bgm?: PostProductionPlan["audio"]["bgm"];
  signoff?: NonNullable<PostProductionPlan["signoff"]>;
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
    signoff: signoffSettingsSchema.optional(),
  })
  .strict();

const VOICEOVER_KEYS = ["voiceover", "audio", "script", "voiceId"] as const;

export function parseRestitchPatch(input: unknown): RestitchPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RestitchRejectedError("VALIDATION_FAILED", "请提供要更换的字幕样式、配乐或片尾落款设置。");
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
      `字幕 / 配乐 / 片尾落款设置不合法${issue ? `：${issue.path.join(".") || "body"} ${issue.message}` : ""}。`,
    );
  }
  if (!parsed.data.captions && !parsed.data.bgm && !parsed.data.signoff) {
    throw new RestitchRejectedError("VALIDATION_FAILED", "至少要更换字幕样式、配乐或片尾落款之一。");
  }
  return parsed.data;
}

/** 把补丁合进现有后期快照：口播原样保留，只替换字幕 / 配乐 / 片尾落款。 */
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
    /// 落款：补丁里给了就用补丁的（关掉 = enabled:false 也照存），没给沿用旧的；旧快照没有就不带这个键
    ...(patch.signoff ?? base.signoff ? { signoff: normalizeSignoff(patch.signoff ?? base.signoff!) } : {}),
  };
}

function normalizeSignoff(signoff: NonNullable<PostProductionPlan["signoff"]>): NonNullable<PostProductionPlan["signoff"]> {
  return {
    enabled: signoff.enabled,
    brandName: signoff.brandName.trim(),
    cta: signoff.cta?.trim() || null,
    /// 没勾就不带这个键：没用过 Logo 的快照形状和之前一样
    ...(signoff.logo ? { logo: true } : {}),
  };
}

/** 落款对成片有没有影响的那部分：关着的两份（不管里面存了什么字）视为相同。 */
function signoffEffect(signoff: PostProductionPlan["signoff"]): string {
  return signoff?.enabled && signoff.brandName.trim()
    ? JSON.stringify([signoff.brandName.trim(), signoff.cta?.trim() || null, Boolean(signoff.logo)])
    : "off";
}

/** 两份快照的字幕 / 配乐是否完全一致（口播不比较）：一致就没有可重拼的改动。 */
export function restitchPatchIsNoop(base: PostProductionPlan, merged: PostProductionPlan): boolean {
  return (
    JSON.stringify(base.captions) === JSON.stringify(merged.captions) &&
    JSON.stringify(base.audio.bgm) === JSON.stringify(merged.audio.bgm) &&
    signoffEffect(base.signoff) === signoffEffect(merged.signoff)
  );
}
