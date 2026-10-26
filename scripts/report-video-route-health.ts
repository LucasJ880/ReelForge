/**
 * 线路健康画像速查（PRD C1）。
 *
 * 回答：每条线路最近还活着吗、出一条片要多久、要多少钱。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/report-video-route-health.ts [窗口小时数] [--run-key=<前缀>] [--md]
 *
 *   --run-key=exp-2611-bakeoff  只看幂等键以该前缀开头的 BatchJob 里的任务（X-SCAF-0 实验对照）。
 *                               没给窗口小时数时窗口放宽到 30 天、扫描上限放到 20000，实验跨几天也不漏。
 *   --md                        输出 markdown 表（直接贴进实验记录）。
 *
 * 只读；不写库、不调供应商。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { EXPERIMENT_BATCH_KEY_PREFIX } from "../src/lib/experiments/run-key";
import {
  DEFAULT_ROUTE_HEALTH_WINDOW_HOURS,
  getVideoRouteHealthReport,
  type VideoRouteHealthReport,
} from "../src/lib/services/video-route-health-service";
import { db } from "../src/lib/db";

/** --run-key 下的默认窗口：实验批次通常跨几天，24 小时会漏。 */
export const RUN_KEY_DEFAULT_WINDOW_HOURS = 24 * 30;
export const RUN_KEY_MAX_SCAN = 20_000;

export interface ReportArgs {
  /** 显式给的窗口小时数；没给为 null，由调用方按模式取默认。 */
  windowHours: number | null;
  runKey: string | null;
  md: boolean;
}

export function parseReportArgs(argv: string[]): ReportArgs {
  const args: ReportArgs = { windowHours: null, runKey: null, md: false };
  for (const arg of argv) {
    if (arg === "--md") {
      args.md = true;
    } else if (arg.startsWith("--run-key=")) {
      const value = arg.slice("--run-key=".length).trim();
      if (!value) throw new Error("--run-key= 后面要跟幂等键前缀，例如 --run-key=exp-2611-bakeoff");
      args.runKey = value;
    } else if (arg === "--run-key") {
      throw new Error("--run-key 要写成 --run-key=<前缀>");
    } else if (/^\d+(\.\d+)?$/.test(arg) && Number(arg) > 0) {
      args.windowHours = Number(arg);
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  return args;
}

function minutes(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 60_000).toFixed(1)} 分`;
}

function money(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toFixed(4)}`;
}

function points(value: number | null): string {
  return value === null ? "—" : value.toFixed(0);
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function verdict(route: VideoRouteHealthReport["routes"][number]): string {
  return route.insufficientData ? "样本不足" : route.healthy ? "健康" : "不健康";
}

/** 两种输出共用同一组列，列名即口径；单条积分是积分计价线路（Shuyu）的成本列。 */
export const REPORT_COLUMNS = ["线路", "模型", "样本", "成功", "失败", "取消", "成功率", "P50", "P95", "单条成本", "单条积分", "判定"] as const;

type ReportRow = Record<(typeof REPORT_COLUMNS)[number], string | number>;

/** 每条线路一行。 */
export function reportRows(report: VideoRouteHealthReport): ReportRow[] {
  return report.routes.map((route) => ({
    线路: route.routeId,
    模型: route.model ?? "—",
    样本: route.samples,
    成功: route.succeeded,
    失败: route.failed,
    取消: route.cancelled,
    成功率: percent(route.successRate),
    P50: minutes(route.p50DurationMs),
    P95: minutes(route.p95DurationMs),
    单条成本: money(route.avgCostUsd),
    单条积分: points(route.avgCostPoints),
    判定: verdict(route),
  }));
}

export function renderMarkdown(
  report: VideoRouteHealthReport,
  meta: { runKey?: string | null; batchCount?: number } = {},
): string {
  const rows = reportRows(report);
  const columns: readonly string[] = REPORT_COLUMNS;
  const escape = (value: unknown) => String(value).replaceAll("|", "\\|");
  const title = meta.runKey
    ? `线路健康画像 · 运行键 \`${meta.runKey}\`（${meta.batchCount ?? 0} 个批次） · 最近 ${report.windowHours} 小时`
    : `线路健康画像 · 最近 ${report.windowHours} 小时`;
  return [
    `### ${title}`,
    "",
    `生成于 ${report.generatedAt.toISOString()}`,
    "",
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${REPORT_COLUMNS.map((column) => escape(row[column])).join(" | ")} |`),
    "",
  ].join("\n");
}

async function main() {
  const args = parseReportArgs(process.argv.slice(2));
  let batchJobIds: string[] | undefined;
  let batchCount = 0;
  if (args.runKey) {
    const batches = await db.batchJob.findMany({
      where: { idempotencyKey: { startsWith: args.runKey } },
      select: { id: true, idempotencyKey: true, status: true, requestedCount: true },
      orderBy: { createdAt: "asc" },
    });
    batchJobIds = batches.map((batch) => batch.id);
    batchCount = batches.length;
    if (!args.md) {
      console.log(`\n运行键 ${args.runKey} · 匹配 ${batches.length} 个批次`);
      for (const batch of batches) console.log(`  ${batch.idempotencyKey} · ${batch.status} · ${batch.requestedCount} 条 · ${batch.id}`);
      if (batches.length === 0) console.log("  （没有批次：下表会是空的，不会退回全量）");
      if (!args.runKey.startsWith(EXPERIMENT_BATCH_KEY_PREFIX)) {
        console.log(`  注意：前缀不以 ${EXPERIMENT_BATCH_KEY_PREFIX} 开头，这些批次不会被平台读数排除`);
      }
    }
  }
  const windowHours = args.windowHours ?? (args.runKey ? RUN_KEY_DEFAULT_WINDOW_HOURS : DEFAULT_ROUTE_HEALTH_WINDOW_HOURS);
  const report = await getVideoRouteHealthReport({
    windowHours,
    batchJobIds,
    ...(args.runKey ? { maxScan: RUN_KEY_MAX_SCAN } : {}),
  });
  if (args.md) {
    process.stdout.write(renderMarkdown(report, { runKey: args.runKey, batchCount }));
    return;
  }
  console.log(`\n线路健康画像 · 最近 ${report.windowHours} 小时\n`);
  console.table(reportRows(report));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
