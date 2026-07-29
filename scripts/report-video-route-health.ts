/**
 * 线路健康画像速查（PRD C1）。
 *
 * 回答：每条线路最近还活着吗、出一条片要多久、要多少钱。
 *
 * 用法：
 *   npx dotenv -e .env.local -- npx tsx scripts/report-video-route-health.ts [窗口小时数]
 */

import {
  DEFAULT_ROUTE_HEALTH_WINDOW_HOURS,
  getVideoRouteHealthReport,
} from "../src/lib/services/video-route-health-service";
import { db } from "../src/lib/db";

function minutes(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 60_000).toFixed(1)} 分`;
}

function money(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toFixed(4)}`;
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

async function main() {
  const windowHours = Number(process.argv[2]) || DEFAULT_ROUTE_HEALTH_WINDOW_HOURS;
  const report = await getVideoRouteHealthReport({ windowHours });
  console.log(`\n线路健康画像 · 最近 ${report.windowHours} 小时\n`);
  console.table(
    report.routes.map((route) => ({
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
      判定: route.insufficientData ? "样本不足" : route.healthy ? "健康" : "不健康",
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
