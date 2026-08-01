import { z } from "zod";
import { BRAND_PLACEMENTS, HOOK_TYPES } from "@/lib/video-generation/creative-recipe";

/**
 * `GET /api/videos` —— 青砚 `aivora-sync` 拉取我方成片的对外契约（PRD §9）。
 *
 * 方向：**青砚定时拉，我们不推。** 视频文件不经过青砚存储，只登记元数据 + URL。
 * 预期量级约 200 条/天。
 *
 * 命名：青砚已写好的 `mapAivoraItem` 占位里用的是 snake_case（`video_url` / `cover_url`），
 * 所以整个 payload 统一 snake_case。PRD §9.4 的字段名是 camelCase 写的，
 * 对应关系如下，青砚侧按此映射即可：
 *
 *   recipeId → recipe_id      hookType → hook_type       templateId → template_id
 *   durationSec → duration    aspectRatio → aspect_ratio  brandPlacement → brand_placement
 *
 * ⚠️ 契约冻结前是加字段最便宜的时候（PRD 风险 #3）。要加就现在加。
 */

export const VIDEOS_API_DEFAULT_LIMIT = 100;
export const VIDEOS_API_MAX_LIMIT = 200;

/** 目前只暴露完成态。青砚只关心可发布的成片，中间态对它没有意义。 */
export const videosApiStatusSchema = z.enum(["completed"]);

export const videosApiQuerySchema = z.object({
  status: videosApiStatusSchema.default("completed"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(VIDEOS_API_MAX_LIMIT)
    .default(VIDEOS_API_DEFAULT_LIMIT),
  /// 增量拉取：只返回该时刻之后完成的成片。省掉每次全量翻页。
  since: z.coerce.date().optional(),
});

export type VideosApiQuery = z.infer<typeof videosApiQuerySchema>;

export const videosApiItemSchema = z.object({
  /// 青砚用它做幂等键（其 VideoAsset 有 @@unique([source, externalId])）。
  /// 必须跨轮次稳定，绝不可复用给另一条成片。
  id: z.string().min(1),
  /// 已做品牌封装的成片。未封装的成片不进这个接口，见 videos-service 的说明。
  video_url: z.string().url(),
  title: z.string().min(1),
  cover_url: z.string().url().nullable(),
  /// 秒。拿不到为 null —— 不要拿目标时长冒充实际时长。
  duration: z.number().int().positive().nullable(),
  topic: z.string().min(1).nullable(),
  language: z.string().min(1).nullable(),
  completed_at: z.string().datetime(),

  /// —— PRD §9.4 创意配方字段 ——
  /// 全部可空。null 表示**未知**，不是「没有配方」：历史成片（2026-07-31 加列之前）
  /// 一律为 null，赛马必须把它们排除出配方维度统计，而不是归到某个默认桶里。
  recipe_id: z.string().min(1).nullable(),
  hook_type: z.enum(HOOK_TYPES).nullable(),
  template_id: z.string().min(1).nullable(),
  aspect_ratio: z.string().min(1).nullable(),
  brand_placement: z.enum(BRAND_PLACEMENTS).nullable(),
});

export type VideosApiItem = z.infer<typeof videosApiItemSchema>;

export const videosApiResponseSchema = z.object({
  videos: z.array(videosApiItemSchema),
  /// 可诊断性：只给一个数组的话，「拉到 0 条」分不清是没有成片还是全被过滤了。
  meta: z.object({
    count: z.number().int().nonnegative(),
    /// 已完成但尚未做品牌封装、因此不可对外交付的条数。
    /// 持续偏高说明封装管线掉队，而不是没有产出。
    skipped_unbranded: z.number().int().nonnegative(),
    /// 本页最后一条的完成时间，供下次作为 `since` 增量拉取。
    next_since: z.string().datetime().nullable(),
  }),
});

export type VideosApiResponse = z.infer<typeof videosApiResponseSchema>;
