/**
 * 运维（只读）：Shuyu 积分对账——窗口内「我们记的期望扣点」 vs 「供应商账户余额」（X-SCAF-9 / §7 P0-3）。
 *
 * 为什么只能用余额差对账：Shuyu 只开放账户余额（GET /account/balance → available_points），
 * 没有逐任务扣费明细，也没有按 externalJobId 查单条扣点的接口。所以单条
 * `providerUnitPoints` 与供应商扣费是否一致，只能在**独占时段**验证：
 *   1) 开窗前记一次余额（--balance-start），期间保证没有别的客户/脚本动这个账户；
 *   2) 跑实验批次；
 *   3) 关窗后跑本脚本：期望扣点 = 窗口内 Shuyu 任务的点数快照之和，与（起始余额 − 当前余额）比对。
 * 一旦 Shuyu 提供逐任务明细，应改成按 externalJobId / externalTaskId 逐条对，本文件注释同步改。
 *
 * 口径（以代码为准，不以直觉为准）：
 *   - VideoJob.providerUnitPoints 在提交时写的是 shuyuVideoPlanPointsForDuration(plan, duration)
 *     （src/lib/video-generation/providers/shuyu-video-provider.ts:216、video-route-cost.ts），
 *     即**该条任务的总点数**：按条套餐 = unitSalePoints，按秒套餐 = unitSalePoints × ceil(duration)。
 *     所以这里直接求和，**不再乘 ceil(segmentDurationSec)**，否则按秒套餐会被重复乘一次。
 *     segmentDurationSec 只用来打印分布，供人工核对套餐口径。
 *   - StoryboardFrame.pointsSnapshot 同理是该帧（一次图片生成）的点数快照。
 *   - 窗口按 submittedAt 过滤（扣点发生在提交那一刻），不按 createdAt。
 *   - 分组：SUCCEEDED 与在途（QUEUED/PAUSED/RUNNING/PROCESSING）计入「期望扣点」；
 *     FAILED/CANCELLED 另列为「可能已退回」（Shuyu 失败会退积分，见 0728 繁忙退款事故），不计入。
 *   - 点数快照为 null 的行单独计数，这些行**无法对账**（历史行或计价解析失败）。
 *
 * 用法（.env.local 直连生产库；只 SELECT，不写任何表；余额接口是免费 GET）：
 *   npx tsx --env-file=.env.local scripts/ops/reconcile-provider-spend.ts \
 *     --from 2026-10-27T02:00:00Z --to 2026-10-27T04:00:00Z [--route buddy] [--balance-start 123456] [--json]
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { db } from "../../src/lib/db";

interface CliArgs {
  from: Date;
  to: Date;
  route: string | null;
  balanceStart: number | null;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      map.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      map.set(arg.slice(2), argv[i + 1]);
      i += 1;
    } else {
      map.set(arg.slice(2), "true");
    }
  }
  const fromRaw = map.get("from");
  const toRaw = map.get("to");
  if (!fromRaw || !toRaw) {
    throw new Error(
      "用法：--from <iso> --to <iso> [--route buddy] [--balance-start <points>] [--json]",
    );
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error(`窗口不合法：from=${fromRaw} to=${toRaw}`);
  }
  const balanceStartRaw = map.get("balance-start");
  const balanceStart = balanceStartRaw === undefined ? null : Number(balanceStartRaw);
  if (balanceStart !== null && !Number.isFinite(balanceStart)) {
    throw new Error(`--balance-start 必须是数字：${balanceStartRaw}`);
  }
  return {
    from,
    to,
    route: map.get("route") ?? null,
    balanceStart,
    json: map.get("json") === "true",
  };
}

type Bucket = "settled" | "inflight" | "refundable";

export interface SpendRow {
  points: number | null;
  status: string;
}

export interface SpendSummary {
  rows: number;
  withSnapshot: number;
  withoutSnapshot: number;
  byStatus: Record<string, { rows: number; points: number; withoutSnapshot: number }>;
  settledPoints: number;
  inflightPoints: number;
  refundablePoints: number;
  /** settled + inflight */
  expectedPoints: number;
}

const BUCKET_BY_STATUS: Record<string, Bucket> = {
  SUCCEEDED: "settled",
  QUEUED: "inflight",
  PAUSED: "inflight",
  RUNNING: "inflight",
  PROCESSING: "inflight",
  FAILED: "refundable",
  CANCELLED: "refundable",
};

/** 纯函数：按状态归桶求和。 */
export function summarizeSpend(rows: SpendRow[]): SpendSummary {
  const summary: SpendSummary = {
    rows: rows.length,
    withSnapshot: 0,
    withoutSnapshot: 0,
    byStatus: {},
    settledPoints: 0,
    inflightPoints: 0,
    refundablePoints: 0,
    expectedPoints: 0,
  };
  for (const row of rows) {
    const entry = (summary.byStatus[row.status] ??= { rows: 0, points: 0, withoutSnapshot: 0 });
    entry.rows += 1;
    if (row.points === null) {
      summary.withoutSnapshot += 1;
      entry.withoutSnapshot += 1;
      continue;
    }
    summary.withSnapshot += 1;
    entry.points += row.points;
    const bucket = BUCKET_BY_STATUS[row.status] ?? "inflight";
    if (bucket === "settled") summary.settledPoints += row.points;
    else if (bucket === "inflight") summary.inflightPoints += row.points;
    else summary.refundablePoints += row.points;
  }
  summary.expectedPoints = summary.settledPoints + summary.inflightPoints;
  return summary;
}

function histogram(values: Array<string | number | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value === null ? "null" : String(value);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const window = { gte: args.from, lt: args.to };

  const videoJobs = await db.videoJob.findMany({
    where: {
      videoProviderAdapterSnapshot: "shuyu",
      submittedAt: window,
      ...(args.route ? { videoRouteSnapshot: args.route } : {}),
    },
    select: {
      id: true,
      status: true,
      submissionState: true,
      providerUnitPoints: true,
      segmentDurationSec: true,
      videoRouteSnapshot: true,
      videoModelSnapshot: true,
      externalJobId: true,
      batchJobId: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: "asc" },
  });

  const frames = await db.storyboardFrame.findMany({
    where: { provider: "shuyu", submittedAt: window },
    select: {
      id: true,
      status: true,
      pointsSnapshot: true,
      planId: true,
      resolutionSnapshot: true,
      externalTaskId: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: "asc" },
  });

  const video = summarizeSpend(
    videoJobs.map((job) => ({ points: job.providerUnitPoints, status: job.status })),
  );
  const image = summarizeSpend(
    frames.map((frame) => ({ points: frame.pointsSnapshot, status: frame.status })),
  );
  const expectedTotal = video.expectedPoints + image.expectedPoints;

  let balance: number | null = null;
  let balanceError: string | null = null;
  try {
    /// 免费 GET；动态 import 让 DB 查询失败时不至于连 provider 模块一起拉起
    const { getShuyuBalance } = await import("../../src/lib/providers/shuyu");
    balance = (await getShuyuBalance()).available_points;
  } catch (error) {
    balanceError = error instanceof Error ? error.message : String(error);
  }

  const balanceDelta =
    args.balanceStart !== null && balance !== null ? args.balanceStart - balance : null;

  const report = {
    window: { from: args.from.toISOString(), to: args.to.toISOString(), route: args.route },
    video: {
      ...video,
      durationSecHistogram: histogram(videoJobs.map((job) => job.segmentDurationSec)),
      unitPointsHistogram: histogram(videoJobs.map((job) => job.providerUnitPoints)),
      routes: histogram(videoJobs.map((job) => job.videoRouteSnapshot)),
      models: histogram(videoJobs.map((job) => job.videoModelSnapshot)),
      ackUnknown: videoJobs.filter((job) => job.submissionState === "ACK_UNKNOWN").length,
      withoutExternalId: videoJobs.filter((job) => !job.externalJobId).length,
    },
    image: {
      ...image,
      plans: histogram(frames.map((frame) => frame.planId)),
      resolutions: histogram(frames.map((frame) => frame.resolutionSnapshot)),
      withoutExternalId: frames.filter((frame) => !frame.externalTaskId).length,
    },
    expectedPoints: expectedTotal,
    refundablePoints: video.refundablePoints + image.refundablePoints,
    balance: { current: balance, start: args.balanceStart, delta: balanceDelta, error: balanceError },
    reconciliation:
      balanceDelta === null
        ? null
        : {
            expected: expectedTotal,
            observed: balanceDelta,
            diff: balanceDelta - expectedTotal,
            /// 容忍：允许差额落在「可能已退回」的范围内（退款到账时间不确定）
            withinRefundableBand:
              Math.abs(balanceDelta - expectedTotal) <= video.refundablePoints + image.refundablePoints,
          },
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const fmt = (n: number) => n.toLocaleString("en-US");
  console.log(`窗口 ${report.window.from} → ${report.window.to}${args.route ? `（线路 ${args.route}）` : ""}`);
  console.log(`视频 VideoJob（adapter=shuyu）：${video.rows} 行，有点数快照 ${video.withSnapshot}，无快照 ${video.withoutSnapshot}`);
  for (const [status, entry] of Object.entries(video.byStatus)) {
    console.log(`  ${status.padEnd(10)} ${String(entry.rows).padStart(4)} 行  ${fmt(entry.points).padStart(10)} 点${entry.withoutSnapshot ? `（其中 ${entry.withoutSnapshot} 行无快照）` : ""}`);
  }
  console.log(`  时长分布 ${JSON.stringify(report.video.durationSecHistogram)}  单条点数分布 ${JSON.stringify(report.video.unitPointsHistogram)}`);
  if (report.video.ackUnknown > 0 || report.video.withoutExternalId > 0) {
    console.log(`  ⚠ ACK_UNKNOWN ${report.video.ackUnknown} 行、无 externalJobId ${report.video.withoutExternalId} 行——这些是否真的被扣费只能靠余额差判断`);
  }
  console.log(`图片 StoryboardFrame（provider=shuyu）：${image.rows} 行，有点数快照 ${image.withSnapshot}，无快照 ${image.withoutSnapshot}`);
  for (const [status, entry] of Object.entries(image.byStatus)) {
    console.log(`  ${status.padEnd(10)} ${String(entry.rows).padStart(4)} 行  ${fmt(entry.points).padStart(10)} 点${entry.withoutSnapshot ? `（其中 ${entry.withoutSnapshot} 行无快照）` : ""}`);
  }
  console.log("");
  console.log(`期望扣点（SUCCEEDED + 在途）：${fmt(expectedTotal)} 点（视频 ${fmt(video.expectedPoints)} + 图片 ${fmt(image.expectedPoints)}）`);
  console.log(`可能已退回（FAILED/CANCELLED 的快照）：${fmt(report.refundablePoints)} 点`);
  console.log(
    balance === null
      ? `当前余额：读取失败（${balanceError}）`
      : `当前余额：${fmt(balance)} 点`,
  );
  if (report.reconciliation) {
    const r = report.reconciliation;
    console.log(
      `余额差（起始 ${fmt(args.balanceStart!)} − 当前 ${fmt(balance!)}）= ${fmt(r.observed)} 点；与期望差 ${r.diff >= 0 ? "+" : ""}${fmt(r.diff)} 点 ${r.diff === 0 ? "✓ 一致" : r.withinRefundableBand ? "~ 在可退回范围内" : "✗ 不一致"}`,
    );
  } else {
    console.log("未给 --balance-start：只打印期望扣点与当前余额；独占时段开窗前记下余额再跑一次即可对账。");
  }
  if (video.withoutSnapshot + image.withoutSnapshot > 0) {
    console.log(`⚠ ${video.withoutSnapshot + image.withoutSnapshot} 行没有点数快照，无法对账；期望扣点是下限。`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
