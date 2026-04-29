import { Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";

export interface ContentMetricsInput {
  views?: number;
  completion_rate?: number;
  retention_3s?: number;
  shares?: number;
  saves?: number;
  likes?: number;
  comments?: number;
}

/**
 * 录入一个 publishRecord 在某个 windowHours 的 metrics（来自 CSV 上传）。
 */
export async function recordMetricsSnapshot(params: {
  publishRecordId: string;
  windowHours: 12 | 24 | 48;
  metrics: ContentMetricsInput;
  capturedAt?: Date;
  source?: string;
}) {
  const capturedAt = params.capturedAt ?? new Date();
  const snap = await db.metricsSnapshot.upsert({
    where: {
      publishRecordId_windowHours: {
        publishRecordId: params.publishRecordId,
        windowHours: params.windowHours,
      },
    },
    update: {
      metrics: params.metrics as unknown as Prisma.InputJsonValue,
      capturedAt,
      source: params.source ?? "csv_manual",
    },
    create: {
      publishRecordId: params.publishRecordId,
      windowHours: params.windowHours,
      metrics: params.metrics as unknown as Prisma.InputJsonValue,
      capturedAt,
      source: params.source ?? "csv_manual",
    },
  });

  // 更新 VideoBrief 状态到 METRICS_COLLECTING
  const record = await db.publishRecord.findUnique({
    where: { id: params.publishRecordId },
    select: { videoBriefId: true },
  });
  if (record) {
    const brief = await db.videoBrief.update({
      where: { id: record.videoBriefId },
      data: { status: VideoBriefStatus.METRICS_COLLECTING },
      include: { contentAngle: true },
    });
    await db.round.update({
      where: { id: brief.contentAngle.roundId },
      data: { status: "METRICS_WINDOWS_PENDING" },
    });
  }

  return snap;
}

export interface CsvRow {
  external_post_id: string;
  window_hours: 12 | 24 | 48;
  views?: number;
  completion_rate?: number;
  retention_3s?: number;
  shares?: number;
  saves?: number;
  likes?: number;
  comments?: number;
}

/**
 * 简易 CSV 解析：首行表头，逗号分隔。支持上面 CsvRow 的字段。
 */
export function parseMetricsCsv(csv: string): CsvRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error(
      "Metrics CSV 无有效数据：请保留表头，并至少提供 1 行指标。必需列为 external_post_id 和 window_hours。",
    );
  }
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const requiredHeaders = ["external_post_id", "window_hours"];
  const missingHeaders = requiredHeaders.filter(
    (headerName) => !header.includes(headerName),
  );
  if (missingHeaders.length > 0) {
    throw new Error(
      `Metrics CSV 缺少必需列：${missingHeaders.join(", ")}。请使用页面模板重新导入。`,
    );
  }
  const rows: CsvRow[] = [];
  const rejectedRows: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => (rec[h] = cells[idx] ?? ""));
    const externalPostId = rec["external_post_id"] || rec["post_id"];
    const windowHours = Number(rec["window_hours"]);
    if (!externalPostId || !(windowHours === 12 || windowHours === 24 || windowHours === 48)) {
      rejectedRows.push(
        `第 ${i + 1} 行缺少 external_post_id，或 window_hours 不是 12/24/48`,
      );
      continue;
    }
    rows.push({
      external_post_id: externalPostId,
      window_hours: windowHours as 12 | 24 | 48,
      views: toNum(rec["views"]),
      completion_rate: toRatio(rec["completion_rate"]),
      retention_3s: toRatio(rec["retention_3s"]),
      shares: toNum(rec["shares"]),
      saves: toNum(rec["saves"]),
      likes: toNum(rec["likes"]),
      comments: toNum(rec["comments"]),
    });
  }
  if (rows.length === 0) {
    throw new Error(
      `Metrics CSV 没有可导入行。${rejectedRows.slice(0, 3).join("；") || "请检查 external_post_id 和 window_hours。"}。`,
    );
  }
  return rows;
}

function toNum(s: string | undefined) {
  if (!s) return undefined;
  const n = Number(s.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function toRatio(s: string | undefined) {
  const n = toNum(s);
  if (n == null) return undefined;
  return n > 1 ? n / 100 : n;
}

/**
 * 从 CSV 批量导入：按 external_post_id 匹配 publishRecord。
 */
export async function importMetricsCsv(csv: string) {
  const rows = parseMetricsCsv(csv);
  const records = await db.publishRecord.findMany({
    where: {
      externalPostId: { in: rows.map((r) => r.external_post_id) },
    },
    select: { id: true, externalPostId: true },
  });
  const idByPost = new Map(records.map((r) => [r.externalPostId ?? "", r.id]));

  const results = [] as Array<{ post: string; ok: boolean; reason?: string }>;
  for (const row of rows) {
    const recordId = idByPost.get(row.external_post_id);
    if (!recordId) {
      results.push({ post: row.external_post_id, ok: false, reason: "未找到对应 PublishRecord" });
      continue;
    }
    await recordMetricsSnapshot({
      publishRecordId: recordId,
      windowHours: row.window_hours,
      metrics: {
        views: row.views,
        completion_rate: row.completion_rate,
        retention_3s: row.retention_3s,
        shares: row.shares,
        saves: row.saves,
        likes: row.likes,
        comments: row.comments,
      },
    });
    results.push({ post: row.external_post_id, ok: true });
  }
  return results;
}

export const METRICS_CSV_TEMPLATE = `external_post_id,window_hours,views,completion_rate,retention_3s,shares,saves,likes,comments
`;
