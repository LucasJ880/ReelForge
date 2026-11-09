import { z } from "zod";

/**
 * 抖音发布包契约（2026-11-09）。服务端接口与客户端面板共用这一份；只依赖 zod，
 * 'use client' 组件可以安全 import。
 *
 * 发布包 = 发布版成片（烧入「AI生成」角标，矩阵账号另加 Aivora 尾卡）+ 封面 + 标题 / 正文 / 话题
 * + 发布登记。文案命中广告法极限词时不产出导出素材，改掉才放行。
 */

export const DOUYIN_PLATFORM = "douyin";

export const DOUYIN_TITLE_MIN = 4;
export const DOUYIN_TITLE_MAX = 30;
export const DOUYIN_BODY_MIN = 10;
export const DOUYIN_BODY_MAX = 300;
export const DOUYIN_HASHTAG_MIN = 3;
export const DOUYIN_HASHTAG_MAX = 5;
export const DOUYIN_HASHTAG_LENGTH_MAX = 20;

/** 话题写法归一：去掉开头的 # 与所有空白（抖音话题里不能有空格）。 */
export function cleanHashtag(raw: string): string {
  return raw.replace(/\s+/gu, "").replace(/^[#＃]+/u, "");
}

const hashtagSchema = z
  .string()
  .transform(cleanHashtag)
  .pipe(z.string().min(1, "话题不能为空").max(DOUYIN_HASHTAG_LENGTH_MAX, `话题不超过 ${DOUYIN_HASHTAG_LENGTH_MAX} 个字`));

export const douyinCopySchema = z.object({
  title: z
    .string()
    .trim()
    .min(DOUYIN_TITLE_MIN, `标题至少 ${DOUYIN_TITLE_MIN} 个字`)
    .max(DOUYIN_TITLE_MAX, `标题不超过 ${DOUYIN_TITLE_MAX} 个字`),
  body: z
    .string()
    .trim()
    .min(DOUYIN_BODY_MIN, `正文至少 ${DOUYIN_BODY_MIN} 个字`)
    .max(DOUYIN_BODY_MAX, `正文不超过 ${DOUYIN_BODY_MAX} 个字`),
  hashtags: z
    .array(hashtagSchema)
    .min(DOUYIN_HASHTAG_MIN, `至少 ${DOUYIN_HASHTAG_MIN} 个话题`)
    .max(DOUYIN_HASHTAG_MAX, `最多 ${DOUYIN_HASHTAG_MAX} 个话题`),
});

export type DouyinCopy = z.infer<typeof douyinCopySchema>;

/** 发布时粘贴进抖音「作品描述」的整段文字：标题、正文、话题各占一段。 */
export function douyinCaptionText(copy: DouyinCopy): string {
  return [copy.title, copy.body, copy.hashtags.map((tag) => `#${tag}`).join(" ")]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/** /api/library/[id]/douyin-kit：不跑 ffmpeg 的三个动作。 */
export const douyinKitRequestSchema = z.discriminatedUnion("action", [
  /// 用 AI 起一版标题 / 正文 / 话题（不落库，交给界面编辑）
  z.object({ action: z.literal("copy") }),
  /// 登记发到了哪个账号（同一条成片只能登记给一个账号）
  z.object({
    action: z.literal("register"),
    accountLabel: z.string().trim().min(1, "请填写发布到的账号").max(60),
    publishUrl: z.string().trim().url("作品链接不是有效网址").max(500).nullish().or(z.literal("")),
    note: z.string().trim().max(500).nullish(),
  }),
  /// 撤销登记（发错号 / 没发出去）
  z.object({ action: z.literal("unregister") }),
]);

/**
 * 产出导出素材（封面 + 发布版成片）。要跑 ffmpeg，所以挂在 /api/brand-packaging 上
 *（只有那个函数打包了 ffmpeg 二进制与中文字体，见 next.config.ts 的 mediaRuntimeTracingIncludes）：
 * 请求体 `{ douyinKit: {...} }`。封面恒做；includeVideo=false 只换封面（改了标题时用）。
 */
export const douyinKitRenderSchema = z.object({
  orderId: z.string().min(1).max(64),
  copy: douyinCopySchema,
  includeVideo: z.boolean().default(true),
});

export type DouyinKitRenderRequest = z.infer<typeof douyinKitRenderSchema>;

export type DouyinKitRequest = z.infer<typeof douyinKitRequestSchema>;

export interface DouyinKitAssets {
  /** 发布版成片（已烧入「AI生成」角标）；includeVideo=false 时为 null */
  videoUrl: string | null;
  coverUrl: string;
  /** 这次的发布版成片带不带 Aivora 尾卡 */
  endCard: boolean;
}

export interface DouyinKitRegistration {
  id: string;
  accountLabel: string | null;
  status: string;
  publishUrl: string | null;
  note: string | null;
  registeredAt: string;
}

export type DouyinKitErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "NOT_READY"
  | "COPY_GENERATION_FAILED"
  | "AD_LAW_TERMS"
  | "RENDER_FAILED"
  | "CANCELLED"
  | "PUBLISH_ACCOUNT_CONFLICT"
  | "PUBLISH_REGISTRATION_INVALID"
  | "PUBLISH_REGISTRATION_UNAVAILABLE"
  | "RATE_LIMITED";
