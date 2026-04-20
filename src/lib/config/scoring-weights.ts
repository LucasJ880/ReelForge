/**
 * 赛马数据评分权重。
 *
 * MVP：只跑"内容分"（7 个互动指标加权）；
 * V2：加入"商业分"（CTR/加购/下单/ROAS）并与内容分二级加权。
 */

export const CONTENT_SCORE_WEIGHTS = {
  views: 0.1,
  completion_rate: 0.22,
  retention_3s: 0.18,
  shares: 0.12,
  saves: 0.1,
  likes: 0.08,
  comments: 0.2,
} as const;

export type ContentMetricKey = keyof typeof CONTENT_SCORE_WEIGHTS;

/**
 * 内容指标归一化：把原始指标映射到 0-1 分区间。
 * views 用 log 缩放；比率类指标直接 clamp；点赞评论用相对 views 的 rate。
 */
export function normalizeContentMetrics(m: {
  views?: number;
  completion_rate?: number;
  retention_3s?: number;
  shares?: number;
  saves?: number;
  likes?: number;
  comments?: number;
}): Record<ContentMetricKey, number> {
  const views = Math.max(m.views ?? 0, 0);
  const viewsNorm = Math.min(1, Math.log10(views + 1) / 6); // 1M views → 1.0
  const pct = (n: number | undefined) => Math.max(0, Math.min(1, n ?? 0));
  const rate = (n: number | undefined) =>
    views > 0 ? Math.min(1, (n ?? 0) / views) : 0;

  return {
    views: viewsNorm,
    completion_rate: pct(m.completion_rate),
    retention_3s: pct(m.retention_3s),
    shares: rate(m.shares) * 8, // 分享率 × 8 放大（<1 原值）
    saves: rate(m.saves) * 6,
    likes: Math.min(1, rate(m.likes) * 3),
    comments: Math.min(1, rate(m.comments) * 12),
  };
}

/**
 * 计算内容分（0-100）。
 */
export function calcContentScore(m: Parameters<typeof normalizeContentMetrics>[0]): number {
  const norm = normalizeContentMetrics(m);
  const total = (Object.keys(CONTENT_SCORE_WEIGHTS) as ContentMetricKey[]).reduce(
    (sum, k) => sum + Math.min(1, norm[k]) * CONTENT_SCORE_WEIGHTS[k] * 100,
    0,
  );
  return Math.round(total * 10) / 10;
}

/**
 * 赛马 48h 最终分数应综合三个窗口（12/24/48h）。
 * 策略：48h 作为权重 0.5，24h 0.3，12h 0.2。
 */
export function calcCompositeScore(windows: {
  h12?: number | null;
  h24?: number | null;
  h48?: number | null;
}): number | null {
  const parts: { w: number; s: number }[] = [];
  if (windows.h12 != null) parts.push({ w: 0.2, s: windows.h12 });
  if (windows.h24 != null) parts.push({ w: 0.3, s: windows.h24 });
  if (windows.h48 != null) parts.push({ w: 0.5, s: windows.h48 });
  if (parts.length === 0) return null;
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  const weighted = parts.reduce((a, p) => a + p.s * p.w, 0);
  return Math.round((weighted / totalW) * 10) / 10;
}
