import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FRAME_QA_CHECKING, FRAME_QA_STATUS } from "@/lib/services/frame-qa-gate";

/**
 * P01-C · 帧质检运维报表（/internal/frame-qa）。
 *
 * VideoJob.frameQaStatus / frameQaDetail 落库以来没有任何界面读过：拦截率多少、
 * 为什么跳过、影子检查（黑边 / 近静止）命中多少、免费重抽用满后放行了哪些——
 * 没人知道，阈值也就没法校准。这里只读、只聚合，不触发任何生成或补检。
 *
 * 分两层：`summarizeFrameQa(rows)` 是纯函数（单测只测它），`getFrameQaReport` 负责查库。
 * frameQaDetail 是 Json 列，形状以 frame-qa-gate 的 FrameQaDetail 为准，
 * 但一律防御性读取：坏数据算「未知」，不抛错。
 */

/** 报表里的状态桶：四个结论 + 占位中 + 从没质检（null，如 MOCK / 老数据）。 */
export const FRAME_QA_BUCKETS = [
  FRAME_QA_STATUS.PASSED,
  FRAME_QA_STATUS.BLOCKED,
  FRAME_QA_STATUS.WOULD_BLOCK,
  FRAME_QA_STATUS.SKIPPED,
  FRAME_QA_CHECKING,
  "UNCHECKED",
] as const;
export type FrameQaBucket = (typeof FRAME_QA_BUCKETS)[number];

export interface FrameQaReportRow {
  id: string;
  batchJobId: string | null;
  frameQaStatus: string | null;
  frameQaCheckedAt: Date | null;
  frameQaDetail: unknown;
  outputVideoUrl: string | null;
}

export interface FrameQaBucketCount {
  status: FrameQaBucket;
  count: number;
  /** 占全部行的比例（0-1）；没有行时为 0。 */
  ratio: number;
}

export interface FrameQaReasonCount {
  /** 归一化后的原因（去掉动态报文），分桶键 */
  reason: string;
  count: number;
  /** 占 SKIPPED 行的比例（0-1）。 */
  ratio: number;
  /** 这一桶里第一条原文，给排障看明细；与 reason 相同就省略 */
  sample?: string;
}

/**
 * 拦截事件数：与「当前状态」分开算。BLOCKED 桶只是现在仍处于拦截态的行；
 * 一段被拦截过、重抽后 PASSED 的行，拦截事件只留在 detail.blockCount 里。
 */
export interface FrameQaBlockEvents {
  /** 所有行 blockCount 之和 */
  total: number;
  /** blockCount > 0 的行数（被拦截过的段数） */
  rows: number;
}

export interface FrameQaShadowStat {
  /** 这项影子检查真的跑了的行数（shadow.xxx 非 null）。 */
  checked: number;
  detected: number;
  /** detected / checked；没跑过为 null（界面写「—」，不写 0%）。 */
  rate: number | null;
  /** 最近一行用的阈值，给校准时对照；没有为 null。 */
  threshold: number | null;
}

export interface FrameQaShadowSummary {
  /** 带 shadow 字段的行数（门禁提前跳过 / 超时的行没有 shadow）。 */
  sampled: number;
  /** shadow.error 非空的行数：ffmpeg 自己失败了。 */
  errors: number;
  blackBars: FrameQaShadowStat;
  nearStatic: FrameQaShadowStat;
}

export interface FrameQaWouldBlockItem {
  videoJobId: string;
  batchJobId: string | null;
  blockCount: number;
  summary: string;
  /** 「第 N 帧：检出内容」，最多 6 条。 */
  issues: string[];
  outputVideoUrl: string | null;
  checkedAt: string | null;
}

/**
 * P01-B 之后 frameQaDetail.drift 才会有数据（商品 / 人物一致性漂移）。
 * 形状未定，这里只做最保守的读取：有对象就算接入，`detected / flagged === true`
 * 或 `ok === false` 算命中，`score` 是数字就取平均。
 */
export type FrameQaDriftSummary =
  | { available: false }
  | { available: true; rows: number; flagged: number; flaggedRate: number; meanScore: number | null };

export interface FrameQaReport {
  windowDays: number;
  total: number;
  byStatus: FrameQaBucketCount[];
  blockEvents: FrameQaBlockEvents;
  skipReasons: FrameQaReasonCount[];
  shadow: FrameQaShadowSummary;
  wouldBlock: FrameQaWouldBlockItem[];
  drift: FrameQaDriftSummary;
}

/** 库里 groupBy 出来的状态计数（null = 未质检）。 */
export interface FrameQaStatusCount {
  frameQaStatus: string | null;
  count: number;
}

const MAX_SKIP_REASONS = 12;
const MAX_WOULD_BLOCK = 50;
const MAX_ISSUES_PER_ITEM = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function bucketOf(frameQaStatus: string | null | undefined): FrameQaBucket {
  if (!frameQaStatus) return "UNCHECKED";
  return (FRAME_QA_BUCKETS as readonly string[]).includes(frameQaStatus)
    ? (frameQaStatus as FrameQaBucket)
    : "UNCHECKED";
}

function readShadowStat(
  rows: readonly FrameQaReportRow[],
  key: "blackBars" | "nearStatic",
): FrameQaShadowStat {
  let checked = 0;
  let detected = 0;
  let threshold: number | null = null;
  for (const row of rows) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const shadow = detail && isRecord(detail.shadow) ? detail.shadow : null;
    const stat = shadow && isRecord(shadow[key]) ? shadow[key] : null;
    if (!stat) continue;
    checked += 1;
    if (stat.detected === true) detected += 1;
    if (threshold === null) threshold = asFiniteNumber(stat.threshold);
  }
  return { checked, detected, rate: checked > 0 ? detected / checked : null, threshold };
}

function summarizeShadow(rows: readonly FrameQaReportRow[]): FrameQaShadowSummary {
  let sampled = 0;
  let errors = 0;
  for (const row of rows) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const shadow = detail && isRecord(detail.shadow) ? detail.shadow : null;
    if (!shadow) continue;
    sampled += 1;
    if (asString(shadow.error)) errors += 1;
  }
  return {
    sampled,
    errors,
    blackBars: readShadowStat(rows, "blackBars"),
    nearStatic: readShadowStat(rows, "nearStatic"),
  };
}

/**
 * 跳过原因按前缀归一化再分桶：frame-qa 把动态报文拼在原因后面
 * （「门禁执行异常：ECONNRESET」「门禁超时（>45s）」），不归一化每条都是一桶。
 * 已知前缀按表取；frame_qa_* 这类稳定代码原样；其余截到第一个冒号 / 括号之前。
 */
const SKIP_REASON_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^门禁执行异常/, "门禁执行异常"],
  [/^门禁超时/, "门禁超时"],
  [/^门禁未启用/, "门禁未启用"],
  [/^门禁未执行/, "门禁未执行"],
  [/^视频 ?URL ?不可下载/, "视频 URL 不可下载"],
  [/^供应商未返回视频地址/, "供应商未返回视频地址"],
];

export function normalizeSkipReason(raw: string): string {
  const text = raw.trim();
  for (const [pattern, label] of SKIP_REASON_PREFIXES) {
    if (pattern.test(text)) return label;
  }
  if (/^frame_qa_[a-z0-9_]+$/i.test(text)) return text;
  const head = text.split(/[：:（(]/)[0]?.trim() ?? text;
  return (head || text).slice(0, 40);
}

function summarizeSkipReasons(rows: readonly FrameQaReportRow[]): FrameQaReasonCount[] {
  const skipped = rows.filter((row) => bucketOf(row.frameQaStatus) === FRAME_QA_STATUS.SKIPPED);
  const buckets = new Map<string, { count: number; sample: string }>();
  for (const row of skipped) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const raw = (detail && asString(detail.skipReason)) ?? "(未记录原因)";
    const reason = raw === "(未记录原因)" ? raw : normalizeSkipReason(raw);
    const bucket = buckets.get(reason) ?? { count: 0, sample: raw };
    bucket.count += 1;
    buckets.set(reason, bucket);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, MAX_SKIP_REASONS);
  const tail = sorted.slice(MAX_SKIP_REASONS);
  const list: FrameQaReasonCount[] = head.map(([reason, bucket]) => ({
    reason,
    count: bucket.count,
    ratio: ratio(bucket.count, skipped.length),
    ...(bucket.sample !== reason ? { sample: bucket.sample } : {}),
  }));
  if (tail.length > 0) {
    const rest = tail.reduce((sum, [, bucket]) => sum + bucket.count, 0);
    list.push({ reason: `(其它 ${tail.length} 种)`, count: rest, ratio: ratio(rest, skipped.length) });
  }
  return list;
}

function summarizeBlockEvents(rows: readonly FrameQaReportRow[]): FrameQaBlockEvents {
  let total = 0;
  let withBlocks = 0;
  for (const row of rows) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const count = readBlockCount(detail);
    if (count > 0) {
      total += count;
      withBlocks += 1;
    }
  }
  return { total, rows: withBlocks };
}

function readBlockCount(detail: Record<string, unknown> | null): number {
  const raw = detail?.blockCount;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

function readIssues(detail: Record<string, unknown> | null): string[] {
  const issues = detail && Array.isArray(detail.issues) ? detail.issues : [];
  return issues
    .filter(isRecord)
    .slice(0, MAX_ISSUES_PER_ITEM)
    .map((issue) => {
      const index = asFiniteNumber(issue.frameIndex);
      const text = asString(issue.detail) ?? "(无描述)";
      return index === null ? text : `第 ${index + 1} 帧：${text}`;
    });
}

function summarizeWouldBlock(rows: readonly FrameQaReportRow[]): FrameQaWouldBlockItem[] {
  return rows
    .filter((row) => bucketOf(row.frameQaStatus) === FRAME_QA_STATUS.WOULD_BLOCK)
    .sort((a, b) => (b.frameQaCheckedAt?.getTime() ?? 0) - (a.frameQaCheckedAt?.getTime() ?? 0))
    .slice(0, MAX_WOULD_BLOCK)
    .map((row) => {
      const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
      return {
        videoJobId: row.id,
        batchJobId: row.batchJobId,
        blockCount: readBlockCount(detail),
        summary: (detail && asString(detail.summary)) ?? "(无结论摘要)",
        issues: readIssues(detail),
        outputVideoUrl: row.outputVideoUrl,
        checkedAt: row.frameQaCheckedAt ? row.frameQaCheckedAt.toISOString() : null,
      };
    });
}

function summarizeDrift(rows: readonly FrameQaReportRow[]): FrameQaDriftSummary {
  let count = 0;
  let flagged = 0;
  let scoreSum = 0;
  let scored = 0;
  for (const row of rows) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const drift = detail && isRecord(detail.drift) ? detail.drift : null;
    if (!drift) continue;
    count += 1;
    if (drift.detected === true || drift.flagged === true || drift.ok === false) flagged += 1;
    const score = asFiniteNumber(drift.score);
    if (score !== null) {
      scoreSum += score;
      scored += 1;
    }
  }
  if (count === 0) return { available: false };
  return {
    available: true,
    rows: count,
    flagged,
    flaggedRate: ratio(flagged, count),
    meanScore: scored > 0 ? scoreSum / scored : null,
  };
}

/**
 * 纯函数：rows → 报表。无 DB 依赖，便于单测。
 *
 * `statusCounts` 给了就用它算状态桶（来自库里 groupBy，不受明细行数上限影响）；
 * 没给就从 rows 数。明细类统计（跳过原因 / 影子 / 待复核 / 拦截事件 / 漂移）一律从 rows 来。
 */
export function summarizeFrameQa(
  rows: readonly FrameQaReportRow[],
  windowDays: number,
  options: { statusCounts?: readonly FrameQaStatusCount[] } = {},
): FrameQaReport {
  const counts = new Map<FrameQaBucket, number>(FRAME_QA_BUCKETS.map((bucket) => [bucket, 0]));
  if (options.statusCounts) {
    for (const item of options.statusCounts) {
      const bucket = bucketOf(item.frameQaStatus);
      counts.set(bucket, (counts.get(bucket) ?? 0) + Math.max(0, item.count));
    }
  } else {
    for (const row of rows) {
      const bucket = bucketOf(row.frameQaStatus);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return {
    windowDays,
    total,
    byStatus: FRAME_QA_BUCKETS.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      ratio: ratio(counts.get(status) ?? 0, total),
    })),
    blockEvents: summarizeBlockEvents(rows),
    skipReasons: summarizeSkipReasons(rows),
    shadow: summarizeShadow(rows),
    wouldBlock: summarizeWouldBlock(rows),
    drift: summarizeDrift(rows),
  };
}

export const FRAME_QA_REPORT_WINDOWS = [7, 30] as const;
export type FrameQaReportWindow = (typeof FRAME_QA_REPORT_WINDOWS)[number];

export function clampFrameQaWindow(raw: string | undefined): FrameQaReportWindow {
  const parsed = Number(raw);
  return (FRAME_QA_REPORT_WINDOWS as readonly number[]).includes(parsed)
    ? (parsed as FrameQaReportWindow)
    : 7;
}

/** 明细最多拉多少行：状态桶在库里 groupBy，不受这个上限影响；明细类统计超过就只看最近的（界面会标出来）。 */
export const FRAME_QA_REPORT_MAX_DETAIL_ROWS = 3000;

/**
 * 窗口口径：质检时刻落在窗口内的行，加上窗口内创建、供应商已成片、却从没质检过的行
 * （MOCK / 门禁未启用之前的老路径）——后者算「未质检」，不算跳过。
 */
export function frameQaReportWhere(since: Date): Prisma.VideoJobWhereInput {
  return {
    OR: [
      { frameQaCheckedAt: { gte: since } },
      { frameQaCheckedAt: null, status: "SUCCEEDED", createdAt: { gte: since } },
    ],
  };
}

/** 明细只拉进过门禁的行：未质检行没有 detail，拉进来只会占掉行数上限。 */
export function frameQaDetailWhere(since: Date): Prisma.VideoJobWhereInput {
  return { AND: [frameQaReportWhere(since), { frameQaStatus: { not: null } }] };
}

/**
 * 最近质检的排前面；frameQaCheckedAt 为 null 的放最后——Postgres DESC 默认 NULLS FIRST，
 * 不写 nulls:last 的话几千条未质检行会先把上限占满。
 */
export const FRAME_QA_REPORT_ORDER_BY: Prisma.VideoJobOrderByWithRelationInput[] = [
  { frameQaCheckedAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];

export async function getFrameQaReport(args: { days: FrameQaReportWindow }): Promise<FrameQaReport & { truncated: boolean }> {
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const [grouped, rows] = await Promise.all([
    db.videoJob.groupBy({
      by: ["frameQaStatus"],
      where: frameQaReportWhere(since),
      _count: { _all: true },
    }),
    db.videoJob.findMany({
      where: frameQaDetailWhere(since),
      orderBy: FRAME_QA_REPORT_ORDER_BY,
      take: FRAME_QA_REPORT_MAX_DETAIL_ROWS + 1,
      select: {
        id: true,
        batchJobId: true,
        frameQaStatus: true,
        frameQaCheckedAt: true,
        frameQaDetail: true,
        outputVideoUrl: true,
      },
    }),
  ]);
  const statusCounts: FrameQaStatusCount[] = grouped.map((item) => ({
    frameQaStatus: item.frameQaStatus,
    count: item._count._all,
  }));
  const truncated = rows.length > FRAME_QA_REPORT_MAX_DETAIL_ROWS;
  return {
    ...summarizeFrameQa(rows.slice(0, FRAME_QA_REPORT_MAX_DETAIL_ROWS), args.days, { statusCounts }),
    truncated,
  };
}
