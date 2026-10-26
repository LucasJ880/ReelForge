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
  reason: string;
  count: number;
  /** 占 SKIPPED 行的比例（0-1）。 */
  ratio: number;
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
  skipReasons: FrameQaReasonCount[];
  shadow: FrameQaShadowSummary;
  wouldBlock: FrameQaWouldBlockItem[];
  drift: FrameQaDriftSummary;
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

function summarizeSkipReasons(rows: readonly FrameQaReportRow[]): FrameQaReasonCount[] {
  const skipped = rows.filter((row) => bucketOf(row.frameQaStatus) === FRAME_QA_STATUS.SKIPPED);
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const detail = isRecord(row.frameQaDetail) ? row.frameQaDetail : null;
    const reason = (detail && asString(detail.skipReason)) ?? "(未记录原因)";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, MAX_SKIP_REASONS);
  const tail = sorted.slice(MAX_SKIP_REASONS);
  const list = head.map(([reason, count]) => ({ reason, count, ratio: ratio(count, skipped.length) }));
  if (tail.length > 0) {
    const rest = tail.reduce((sum, [, count]) => sum + count, 0);
    list.push({ reason: `(其它 ${tail.length} 种)`, count: rest, ratio: ratio(rest, skipped.length) });
  }
  return list;
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

/** 纯函数：rows → 报表。无 DB 依赖，便于单测。 */
export function summarizeFrameQa(rows: readonly FrameQaReportRow[], windowDays: number): FrameQaReport {
  const counts = new Map<FrameQaBucket, number>(FRAME_QA_BUCKETS.map((bucket) => [bucket, 0]));
  for (const row of rows) {
    const bucket = bucketOf(row.frameQaStatus);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return {
    windowDays,
    total: rows.length,
    byStatus: FRAME_QA_BUCKETS.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      ratio: ratio(counts.get(status) ?? 0, rows.length),
    })),
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

/** 单次最多扫多少行：报表体量小，内存聚合；超过就只看最近的（界面会标出来）。 */
const MAX_SCAN = 3000;

/**
 * 窗口口径：质检时刻落在窗口内的行，加上窗口内创建、供应商已成片、却从没质检过的行
 * （MOCK / 门禁未启用之前的老路径）——后者算「未质检」，不算跳过。
 */
export async function getFrameQaReport(args: { days: FrameQaReportWindow }): Promise<FrameQaReport & { truncated: boolean }> {
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const rows = await db.videoJob.findMany({
    where: {
      OR: [
        { frameQaCheckedAt: { gte: since } },
        { frameQaCheckedAt: null, status: "SUCCEEDED", createdAt: { gte: since } },
      ],
    },
    orderBy: [{ frameQaCheckedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_SCAN + 1,
    select: {
      id: true,
      batchJobId: true,
      frameQaStatus: true,
      frameQaCheckedAt: true,
      frameQaDetail: true,
      outputVideoUrl: true,
    },
  });
  const truncated = rows.length > MAX_SCAN;
  return { ...summarizeFrameQa(rows.slice(0, MAX_SCAN), args.days), truncated };
}
