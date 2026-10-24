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

/// 游标模式的起点哨兵：从最早一条（或 since 之后）开始升序翻页。
export const VIDEOS_API_CURSOR_START = "start";
export const VIDEOS_API_CURSOR_MAX_LENGTH = 512;

/**
 * 游标 = (完成时间, 条目 id) 的复合键，升序。只按时间做游标会在同一毫秒的
 * 多条成片之间丢数据或重复；带上 id 做次序键，翻页边界就是全序的。
 * 编码为 base64url(JSON)，对青砚是不透明字符串，原样回传即可。
 */
export interface VideosApiCursor {
  /// 完成时间（ISO 8601，毫秒精度，与 completed_at 一致）
  completedAt: string;
  /// 与 videos[].id 同一个值（brief-… / batch-…）
  id: string;
}

export function encodeVideosApiCursor(cursor: VideosApiCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.completedAt, id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeVideosApiCursor(value: string): VideosApiCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string") {
      return null;
    }
    if (!/^(brief|batch)-.+$/.test(parsed.id)) return null;
    const time = new Date(parsed.t);
    if (Number.isNaN(time.getTime())) return null;
    return { completedAt: time.toISOString(), id: parsed.id };
  } catch {
    return null;
  }
}

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
  /// （旧语义保持不变：倒序取最新 limit 条；积压超过 limit 时旧的会漏，
  /// 青砚切到下面的 cursor 模式后即可不再依赖它。）
  since: z.coerce.date().optional(),
  /// 游标模式（2026-10-25 起可选，D7）：按 (完成时间, id) 升序翻页，不漏不重。
  /// 首次传 `start`（可同时带 since 作为起点），之后原样回传 meta.next_cursor，
  /// 直到 meta.has_more=false；平时也可以一直拿最后一个 next_cursor 轮询增量。
  /// 不传 cursor = 旧语义，响应形状与以前完全一致。
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(VIDEOS_API_CURSOR_MAX_LENGTH)
    .refine(
      (value) => value === VIDEOS_API_CURSOR_START || decodeVideosApiCursor(value) !== null,
      { message: "invalid cursor" },
    )
    .optional(),
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
    /// —— 仅游标模式（请求带 cursor）返回；旧语义的响应里没有这两个字段 ——
    /// 下一页的游标：本页扫到的最后一条（含因缺标题等被过滤掉的行），
    /// 本页为空时原样回传请求的游标，便于继续轮询。
    next_cursor: z.string().min(1).optional(),
    /// 游标之后是否还有更多成片；为 true 时应立刻用 next_cursor 继续拉。
    has_more: z.boolean().optional(),
  }),
});

export type VideosApiResponse = z.infer<typeof videosApiResponseSchema>;
