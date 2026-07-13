/**
 * AC-4 —— 存量卡死任务一次性修复脚本。
 *
 * 扫描所有超过 deadline 仍为 QUEUED/RUNNING 的 VideoJob，置为 FAILED(timeout)
 * 并同步 brief → RENDER_FAILED（用户可见失败 + 重试入口，重试走既有
 * retryFailedVideoJob 幂等闭环：会先查 provider 真实状态，不重复扣费）。
 *
 * 判定条件（与 watchdog 信号 A 完全一致）：
 *   - status IN (QUEUED, RUNNING)
 *   - timeoutAt + 宽限 < now；timeoutAt 为 null 时 createdAt 超过兜底时长（60min）
 *
 * 用法：
 *   npx tsx scripts/fix-stuck-video-jobs.ts             # dry-run（默认，零写入）
 *   npx tsx scripts/fix-stuck-video-jobs.ts --execute   # 真正执行修复
 *
 * 输出：每条将被修复的任务清单（job id / brief id / 卡住时长 / provider 状态），
 * execute 模式额外输出结构化状态迁移日志（AC-5）并打印修复后的 job id 记录。
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient, VideoBriefStatus, VideoJobStatus } from "@prisma/client";

loadEnvConfig(process.cwd());
const db = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");

/// 与 watchdog / sweep 对齐的参数
const GRACE_MIN = Number(process.env.WATCHDOG_GRACE_MIN ?? "2");
const NO_TIMEOUT_MAX_MIN = Number(process.env.SWEEP_JOB_NO_TIMEOUT_MAX_MIN ?? "60");
const TIMEOUT_PREFIX = "[watchdog:timeout]";
const USER_ERROR =
  "视频生成超时，已自动停止。点击「重试」可继续（不会重复扣费）。";
const BRIEF_ERROR =
  "视频生成超时，已自动停止。点击「重试」可继续（不会重复扣费）。";

function ageMin(d: Date | null): string {
  return d ? ((Date.now() - d.getTime()) / 60000).toFixed(1) : "n/a";
}

async function main() {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - GRACE_MIN * 60_000);
  const noTimeoutCutoff = new Date(now.getTime() - NO_TIMEOUT_MAX_MIN * 60_000);

  const stuck = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      OR: [
        { timeoutAt: { not: null, lt: graceCutoff } },
        { timeoutAt: null, createdAt: { lt: noTimeoutCutoff } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      videoBrief: {
        select: { id: true, status: true, persona: true },
      },
    },
  });

  console.log(
    `${EXECUTE ? "[EXECUTE]" : "[DRY-RUN]"} 扫描到 ${stuck.length} 条超 deadline 仍非终态的 VideoJob\n`,
  );

  if (stuck.length === 0) {
    console.log("无存量卡死任务，无需修复。");
    await db.$disconnect();
    return;
  }

  for (const j of stuck) {
    console.log("-".repeat(78));
    console.log(`VideoJob   ${j.id}  (${j.status})`);
    console.log(`  brief          ${j.videoBrief.id}  (${j.videoBrief.status}, ${j.videoBrief.persona})`);
    console.log(`  externalJobId  ${j.externalJobId ?? "null（孤儿，从未提交成功）"}`);
    console.log(`  submittedAt    ${j.submittedAt?.toISOString() ?? "null"}  已卡 ${ageMin(j.submittedAt ?? j.createdAt)} 分钟`);
    console.log(`  timeoutAt      ${j.timeoutAt?.toISOString() ?? "null"}`);
    console.log(`  providerStatus ${j.lastProviderStatus ?? "n/a"}  lastCheckedAt ${j.lastCheckedAt?.toISOString() ?? "n/a"}`);
    console.log(`  将执行         status → FAILED(timeout)，brief → RENDER_FAILED，用户可重试`);
  }
  console.log("-".repeat(78));

  if (!EXECUTE) {
    console.log(
      `\nDRY-RUN 结束（未做任何写入）。确认清单后运行:\n  npx tsx scripts/fix-stuck-video-jobs.ts --execute`,
    );
    await db.$disconnect();
    return;
  }

  /// ---- execute：CAS 修复（仍在 QUEUED/RUNNING 才写，避免与在线 watchdog 竞态） ----
  const fixedJobIds: string[] = [];
  const briefIds = new Set<string>();
  for (const j of stuck) {
    const updated = await db.videoJob.updateMany({
      where: {
        id: j.id,
        status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      },
      data: {
        status: VideoJobStatus.FAILED,
        errorMessage: `${TIMEOUT_PREFIX} 存量修复脚本: 超过 deadline ${ageMin(j.submittedAt ?? j.createdAt)} 分钟仍非终态`,
        userSafeError: USER_ERROR,
        finishedAt: now,
        lastCheckedAt: now,
      },
    });
    if (updated.count > 0) {
      fixedJobIds.push(j.id);
      briefIds.add(j.videoBrief.id);
      /// AC-5 结构化迁移日志
      console.log(
        JSON.stringify({
          evt: "video_job_status_transition",
          task_id: j.id,
          from: j.status,
          to: VideoJobStatus.FAILED,
          reason: "backfill_timeout_fix",
          ts: now.toISOString(),
        }),
      );
    } else {
      console.log(`跳过 ${j.id}：已被在线 watchdog 抢先终态化`);
    }
  }

  /// brief 聚合：全部 job 非在飞后标 RENDER_FAILED（有失败段时）
  for (const briefId of briefIds) {
    const inflight = await db.videoJob.count({
      where: {
        videoBriefId: briefId,
        status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
      },
    });
    if (inflight > 0) continue;
    await db.videoBrief.update({
      where: { id: briefId },
      data: {
        status: VideoBriefStatus.RENDER_FAILED,
        errorMessage: BRIEF_ERROR,
      },
    });
    console.log(`brief ${briefId} → RENDER_FAILED（用户可见失败 + 重试入口）`);
  }

  console.log(`\n修复完成。被修复的 job id 记录（共 ${fixedJobIds.length} 条）:`);
  for (const id of fixedJobIds) console.log(`  ${id}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
