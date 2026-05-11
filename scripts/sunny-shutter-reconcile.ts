/**
 * Sunny Shutter Lifecycle Reconciliation —— 只读 + 调和，绝不重新提交。
 *
 * 设计安全护栏（与火山方舟计费安全相关）：
 * - 只调用 reconcileVideoJob() —— 内部仅向 Seedance GET /tasks/{id}，不会创建新 task。
 * - 永不调用 dispatchVideoGeneration / retryFailedVideoJob / submitSeedanceJob。
 * - 当遇到 externalJobId 为空的 job，跳过、只打印警告，绝不补提交。
 *
 * 运行：
 *   npx dotenv -e .env.local -- npx tsx scripts/sunny-shutter-reconcile.ts
 *
 * 可选 flag：
 *   --order-id <id>            指定 DeliveryOrder.id（覆盖标题模糊匹配）
 *   --since "2026-05-11 11:30" 时间窗起点（默认 2026-05-11 11:30）
 *   --until "2026-05-11 13:30" 时间窗终点（默认 2026-05-11 13:30）
 *   --inspect-only             只打印不调和（极度保守模式）
 *
 * 退出码：
 *   0 = 成功执行（无论是否有 job 状态变化）
 *   2 = 找不到 Sunny Shutter 订单
 *   3 = ARK_API_KEY 缺失（无法调和真实 Provider）
 */

import { PrismaClient, VideoJobStatus } from "@prisma/client";
import {
  reconcileVideoJob,
  syncBriefStatus,
} from "../src/lib/services/video-service";
import { getSeedanceStatus } from "../src/lib/providers/seedance";

const db = new PrismaClient();

const args = process.argv.slice(2);
function flagArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const orderIdOverride = flagArg("order-id");
const sinceArg = flagArg("since") ?? "2026-05-11 11:30";
const untilArg = flagArg("until") ?? "2026-05-11 13:30";
const inspectOnly = args.includes("--inspect-only");
const includeAll = args.includes("--include-all");

const since = new Date(sinceArg);
const until = new Date(untilArg);
if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
  console.error(`[sunny-shutter] --since/--until 必须是合法时间字符串`);
  process.exit(1);
}

function banner(title: string) {
  console.log("\n" + "=".repeat(78));
  console.log("  " + title);
  console.log("=".repeat(78));
}

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function shorten(value: string | null | undefined, n = 18) {
  if (!value) return "—";
  if (value.length <= n) return value;
  return value.slice(0, n) + "…";
}

async function findOrder() {
  if (orderIdOverride) {
    return db.deliveryOrder.findUnique({ where: { id: orderIdOverride } });
  }
  const candidates = await db.deliveryOrder.findMany({
    where: {
      OR: [
        { title: { contains: "Sunny Shutter", mode: "insensitive" } },
        { title: { contains: "sunny shutter", mode: "insensitive" } },
        { title: { contains: "Sunny", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    console.log(
      `[sunny-shutter] 标题匹配到 ${candidates.length} 个订单，使用最近一个：`,
    );
    for (const c of candidates) {
      console.log(`  - ${c.id} · ${c.title} · ${fmt(c.createdAt)}`);
    }
  }
  return candidates[0];
}

async function loadVideoJobs(orderId: string) {
  /// 通过 brief → angle → round → order 反查，再根据时间窗过滤
  const jobs = await db.videoJob.findMany({
    where: {
      videoBrief: {
        contentAngle: { round: { deliveryOrderId: orderId } },
      },
      ...(includeAll
        ? {}
        : {
            /// 时间窗用 createdAt OR submittedAt 都算，宽松匹配
            OR: [
              { createdAt: { gte: since, lte: until } },
              { submittedAt: { gte: since, lte: until } },
            ],
          }),
    },
    include: {
      videoBrief: {
        include: {
          contentAngle: { select: { id: true, sortOrder: true, title: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  return jobs;
}

function printJobsTable(
  rows: Awaited<ReturnType<typeof loadVideoJobs>>,
  label: string,
) {
  banner(label);
  if (rows.length === 0) {
    console.log("（没有匹配的 VideoJob）");
    return;
  }
  console.log(
    [
      "internal_id",
      "angle",
      "provider_task_id",
      "submittedAt",
      "internal_status",
      "lastProviderStatus",
      "lastCheckedAt",
      "outputVideoUrl",
      "userSafeError",
    ].join("  |  "),
  );
  console.log("-".repeat(160));
  for (const j of rows) {
    const angleLabel = j.videoBrief?.contentAngle
      ? `#${j.videoBrief.contentAngle.sortOrder} ${j.videoBrief.contentAngle.title.slice(0, 26)}`
      : "—";
    console.log(
      [
        shorten(j.id, 12),
        angleLabel,
        shorten(j.externalJobId, 26),
        fmt(j.submittedAt ?? j.createdAt),
        j.status,
        j.lastProviderStatus ?? "—",
        fmt(j.lastCheckedAt),
        j.outputVideoUrl ? "✓ 有" : "—",
        j.userSafeError ? j.userSafeError.slice(0, 30) + "…" : "—",
      ].join("  |  "),
    );
  }
}

async function main() {
  banner("阶段 0 · 启动检查");

  if (!process.env.ARK_API_KEY) {
    console.error(
      "[sunny-shutter] 缺少 ARK_API_KEY —— 调和将走 Mock 路径，无法核对真实 Volcengine 状态。",
    );
    console.error("请先在 .env.local 里配置 ARK_API_KEY 后再运行。");
    process.exit(3);
  }
  if (
    process.env.VIDEO_ENGINE_MOCK?.toLowerCase() === "true" ||
    process.env.VIDEO_ENGINE_MOCK === "1"
  ) {
    console.error(
      "[sunny-shutter] 检测到 VIDEO_ENGINE_MOCK=true —— 调和会走本地 Mock，不会查到真实任务。请清除该 env 后重试。",
    );
    process.exit(3);
  }

  console.log(
    `时间窗：${fmt(since)} ~ ${fmt(until)} (UTC)${includeAll ? "（已使用 --include-all 跳过时间过滤）" : ""}`,
  );
  console.log(`只读模式：${inspectOnly ? "是（不会改 DB / 不会调 Provider）" : "否（仅 GET Provider 状态 + 更新 DB）"}`);

  const order = await findOrder();
  if (!order) {
    console.error(
      "[sunny-shutter] 没找到 'Sunny Shutter' 订单。可用 --order-id <id> 指定。",
    );
    process.exit(2);
  }
  console.log(`订单：${order.id} · ${order.title} · ${fmt(order.createdAt)}`);

  const before = await loadVideoJobs(order.id);
  printJobsTable(before, "阶段 1 · 调和前 VideoJob 快照");

  /// 用户明确说："For every VideoJob ... Call Seedance/Volcengine task status API for that existing task ID."
  /// 因此所有带 externalJobId 的 job 都要查 Provider —— 包括 CANCELLED。
  /// CANCELLED 走"救回"路径（旧 dispatchVideoGeneration bug 把它们错误取消，但 Volcengine 那边可能已成功并扣费）。
  const reconcilable = before.filter(
    (j) =>
      !!j.externalJobId &&
      (j.status === "RUNNING" || j.status === "QUEUED"),
  );
  const rescuable = before.filter(
    (j) =>
      !!j.externalJobId &&
      (j.status === "CANCELLED" ||
        (j.status === "FAILED" && !j.outputVideoUrl)),
  );
  const noProvider = before.filter((j) => !j.externalJobId);
  const alreadyDone = before.filter(
    (j) => !!j.externalJobId && j.status === "SUCCEEDED",
  );

  banner(
    `阶段 2 · 调和（仅 GET Provider 状态，绝不重新提交） · 调和 ${reconcilable.length} · 救回 ${rescuable.length} · 已完成 ${alreadyDone.length} · 无 task ID ${noProvider.length}`,
  );
  if (noProvider.length > 0) {
    console.log("以下 job 没有 externalJobId，直接跳过（绝不补提交）：");
    for (const j of noProvider) {
      console.log(`  - ${shorten(j.id, 12)}  status=${j.status}`);
    }
  }

  if (inspectOnly) {
    console.log("\n[--inspect-only] 跳过实际调和。");
  } else {
    /// (a) 普通调和：RUNNING/QUEUED → 走 reconcileVideoJob
    if (reconcilable.length > 0) {
      console.log("\n>> (a) 调和 RUNNING/QUEUED job");
      for (const j of reconcilable) {
        try {
          const updated = await reconcileVideoJob(j.id);
          console.log(
            `  ${shorten(j.id, 12)}  ${j.status} → ${updated?.status ?? "?"}` +
              (updated?.lastProviderStatus
                ? `  (provider=${updated.lastProviderStatus})`
                : "") +
              (updated?.outputVideoUrl ? "  ✓ 拿到 outputVideoUrl" : ""),
          );
        } catch (err) {
          console.error(
            `  ${shorten(j.id, 12)}  调和异常：${(err as Error).message}`,
          );
        }
      }
    }

    /// (b) 救回路径：CANCELLED/FAILED 也查 Provider 状态，如果其实已成功则把视频救回
    /// 这一步只读 Provider，绝不会触发新提交（getSeedanceStatus 是 GET）。
    if (rescuable.length > 0) {
      console.log("\n>> (b) 救回 CANCELLED/FAILED job（仅 GET Provider，不重新提交）");
      for (const j of rescuable) {
        try {
          const result = await getSeedanceStatus(j.externalJobId!);
          const checkedAt = new Date();

          if (result.status === "completed" && result.videoUrl) {
            await db.videoJob.update({
              where: { id: j.id },
              data: {
                status: VideoJobStatus.SUCCEEDED,
                outputVideoUrl: result.videoUrl,
                outputThumbUrl: result.thumbnailUrl ?? null,
                finishedAt: new Date(),
                lastCheckedAt: checkedAt,
                lastProviderStatus: result.rawProviderStatus ?? "succeeded",
                userSafeError: null,
                errorMessage: null,
              },
            });
            console.log(
              `  ${shorten(j.id, 12)}  ${j.status} → SUCCEEDED  ✓ 救回成片 ${shorten(result.videoUrl, 60)}`,
            );
          } else if (result.status === "failed") {
            await db.videoJob.update({
              where: { id: j.id },
              data: {
                lastCheckedAt: checkedAt,
                lastProviderStatus: result.rawProviderStatus ?? "failed",
                userSafeError:
                  j.userSafeError ??
                  "视频生成失败，可点击重试。如多次失败请联系管理员。",
                errorMessage: j.errorMessage ?? result.errorMessage ?? null,
              },
            });
            console.log(
              `  ${shorten(j.id, 12)}  Provider 也确认失败（${result.rawProviderStatus}），保持 ${j.status}`,
            );
          } else {
            /// pending/processing/unknown
            await db.videoJob.update({
              where: { id: j.id },
              data: {
                lastCheckedAt: checkedAt,
                lastProviderStatus:
                  result.rawProviderStatus ?? result.status ?? "unknown",
              },
            });
            console.log(
              `  ${shorten(j.id, 12)}  Provider 仍在运行（${result.rawProviderStatus}），但本地已 ${j.status} —— 不改变本地状态，仅记录 lastProviderStatus`,
            );
          }
        } catch (err) {
          console.error(
            `  ${shorten(j.id, 12)}  救回查询异常：${(err as Error).message}`,
          );
        }
      }
    }
  }

  /// 调和后刷新所有相关 brief 的聚合状态（finalVideoUrl / status）
  if (!inspectOnly) {
    const briefIds = Array.from(
      new Set(before.map((j) => j.videoBriefId).filter(Boolean)),
    );
    console.log(`\n>> (c) 刷新 ${briefIds.length} 个 brief 的聚合状态`);
    for (const briefId of briefIds) {
      try {
        await syncBriefStatus(briefId);
        const brief = await db.videoBrief.findUnique({
          where: { id: briefId },
          select: { id: true, status: true, finalVideoUrl: true },
        });
        if (brief) {
          console.log(
            `  brief ${shorten(briefId, 12)} → ${brief.status}` +
              (brief.finalVideoUrl
                ? `  finalVideoUrl=${shorten(brief.finalVideoUrl, 60)}`
                : ""),
          );
        }
      } catch (err) {
        console.error(
          `  brief ${shorten(briefId, 12)}  syncBriefStatus 异常：${(err as Error).message}`,
        );
      }
    }
  }

  /// 重新拉取最新状态用于 UI 校验
  const after = await loadVideoJobs(order.id);
  printJobsTable(after, "阶段 3 · 调和后 VideoJob 快照");

  banner("阶段 4 · UI 视角校验（按当前 DB 状态推断 RenderProgress 会展示什么）");
  /// 复刻 video-service.ts 的 classifyUserStatus 逻辑（不再 import 内部 fn 以避免耦合）
  const now = Date.now();
  for (const j of after) {
    let userKey: string;
    if (j.status === "SUCCEEDED") userKey = "ready";
    else if (j.status === "FAILED") userKey = "failed";
    else if (j.status === "CANCELLED") userKey = "cancelled";
    else if (
      (j.status === "RUNNING" || j.status === "QUEUED") &&
      j.timeoutAt &&
      j.timeoutAt.getTime() < now
    )
      userKey = "stuck";
    else if (j.status === "RUNNING") userKey = j.externalJobId ? "generating" : "submitted";
    else if (j.status === "QUEUED") userKey = "waiting";
    else userKey = "waiting";

    const userLabel: Record<string, string> = {
      ready: "视频已生成",
      generating: "正在生成视频",
      submitted: "视频请求已发送",
      failed: "生成失败",
      stuck: "生成时间较长",
      cancelled: "已取消",
      waiting: "等待开始",
    };

    const exposesProvider =
      j.outputVideoUrl == null && j.userSafeError == null && false;
    /// (旧 UI 会暴露 provider 名 / external ID，新 UI 不会 —— 这里仅做静态自检)

    console.log(
      `  ${shorten(j.id, 12)}  user_status=${userLabel[userKey]} (${userKey})` +
        (j.outputVideoUrl ? `  preview=${shorten(j.outputVideoUrl, 60)}` : "") +
        (j.userSafeError ? `  error="${j.userSafeError.slice(0, 60)}"` : ""),
    );
    if (exposesProvider) {
      console.log(`    ⚠️  会暴露 provider 名 / 任务 ID（旧 UI 行为）`);
    }
  }

  /// 父级聚合
  const counts = {
    ready: after.filter((j) => j.status === "SUCCEEDED").length,
    generating: after.filter(
      (j) => j.status === "RUNNING" || j.status === "QUEUED",
    ).length,
    failed: after.filter((j) => j.status === "FAILED").length,
    cancelled: after.filter((j) => j.status === "CANCELLED").length,
  };
  console.log(
    `\n父级聚合徽章：${counts.ready}/${after.length} 视频已生成 · ${counts.generating} 正在生成 · ${counts.failed} 失败 · ${counts.cancelled} 已取消`,
  );

  banner("完成");
}

main()
  .catch((err) => {
    console.error("[sunny-shutter] 致命错误：", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
