import { z } from "zod";

/**
 * 创作台给客户看的线路目录（2026-10-29 Evan：Shuyu 作默认线路，Shuyu 开放给我们的类别全部展示在前端；
 * Runway 作更高质量的备选）。
 *
 * 纯 zod 模块：'use client' 的线路选择卡也引用它，不得引入服务端依赖。
 * 只给展示必需的字段：不给积分单价、余额与原始价目结构（那是我们的进货价，不是客户的价格）。
 */
export const videoRouteFamilySchema = z
  .object({
    /// 模型家族，如 "Seedance 2.5 VIP"、"Kling 4.0"、"Wan 3.0（标准版）"
    label: z.string().min(1).max(120),
    /// 我们已经接入、审计过（提示词写法、参考图与口播都按它调过）；未接入的只展示
    integrated: z.boolean(),
    /// 标准线路此刻默认用的就是这个家族
    isDefault: z.boolean(),
    /// 单条最长秒数（价目表自报，取家族内最大）；没报为 null
    maxDurationSec: z.number().int().positive().max(120).nullable(),
    /// 开放的清晰度，从低到高
    resolutions: z.array(z.string().min(1).max(20)).max(12),
    /// 其中已接入（过得了审计）的清晰度；家族已接入但不是每档都接入时（如 Seedance 2.0 的 4K）靠它标清
    integratedResolutions: z.array(z.string().min(1).max(20)).max(12),
  })
  .strict();

export const videoRouteCatalogSchema = z
  .object({
    ok: z.literal(true),
    standard: z
      .object({
        /// 标准线路（Shuyu）此刻接不接得了单
        available: z.boolean(),
        /// 默认出片的模型家族与清晰度；拿不到价目表时为 null
        defaultFamily: z.string().min(1).max(120).nullable(),
        defaultResolution: z.string().min(1).max(20).nullable(),
        /// 标准线路明确失败时会不会自动改交高质量线路重拍（SHUYU_FALLBACK_TO_RUNWAY）
        fallsBackToPremium: z.boolean(),
      })
      .strict(),
    premium: z
      .object({
        /// 这个账号能不能选「高质量（Runway）」
        offered: z.boolean(),
        model: z.string().min(1).max(120),
        resolution: z.enum(["720p", "1080p"]),
      })
      .strict(),
    /// Shuyu 开放给我们的全部视频类别：默认的在最前，已接入的其次
    families: z.array(videoRouteFamilySchema).max(40),
  })
  .strict();

export type VideoRouteFamily = z.infer<typeof videoRouteFamilySchema>;
export type VideoRouteCatalog = z.infer<typeof videoRouteCatalogSchema>;
