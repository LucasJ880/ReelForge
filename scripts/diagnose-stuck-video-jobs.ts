/**
 * 只读诊断（本轮卡死 bug 取证）：找出所有非终态 VideoJob（QUEUED/RUNNING）
 * 及其 brief 时间线，重点区分：
 *   - externalJobId 为 null 的孤儿（永远不会被 pollRunningJobs / reconcile 扫到）
 *   - externalJobId 非空但 lastCheckedAt 长期未更新（轮询断供）
 *   - timeoutAt 已过期但仍在 RUNNING（sweep 未生效）
 * 不做任何写操作、不调任何付费 API。
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient, VideoJobStatus } from "@prisma/client";

loadEnvConfig(process.cwd());
const db = new PrismaClient();

function fmt(d: Date | null | undefined) {
  return d ? d.toISOString() : "null";
}
function ageMin(d: Date | null | undefined) {
  return d ? ((Date.now() - d.getTime()) / 60000).toFixed(1) : "n/a";
}

async function main() {
  const jobs = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.QUEUED, VideoJobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      videoBrief: {
        select: {
          id: true,
          status: true,
          persona: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          finalVideoId: true,
        },
      },
    },
    take: 100,
  });

  console.log(`共 ${jobs.length} 条非终态 VideoJob (QUEUED/RUNNING)\n`);
  for (const j of jobs) {
    console.log("=".repeat(80));
    console.log(`VideoJob ${j.id}  status=${j.status}  provider=${j.provider}`);
    console.log(`  externalJobId=${j.externalJobId ?? "NULL(孤儿:不会被轮询)"}`);
    console.log(`  segmentIndex=${j.segmentIndex} retryCount=${j.retryCount} pollErrors=${j.pollErrors}`);
    console.log(`  createdAt=${fmt(j.createdAt)} (距今 ${ageMin(j.createdAt)} 分钟)`);
    console.log(`  submittedAt=${fmt(j.submittedAt)} startedAt=${fmt(j.startedAt)}`);
    console.log(`  timeoutAt=${fmt(j.timeoutAt)} ${j.timeoutAt && j.timeoutAt.getTime() < Date.now() ? "<< 已超时仍非终态" : ""}`);
    console.log(`  lastCheckedAt=${fmt(j.lastCheckedAt)} (距今 ${ageMin(j.lastCheckedAt)} 分钟)`);
    console.log(`  lastProviderStatus=${j.lastProviderStatus}`);
    console.log(`  errorMessage=${JSON.stringify(j.errorMessage)?.slice(0, 200)}`);
    console.log(
      j.videoBrief
        ? `  brief=${j.videoBrief.id} persona=${j.videoBrief.persona} briefStatus=${j.videoBrief.status} briefError=${JSON.stringify(j.videoBrief.errorMessage)?.slice(0, 120)}`
        : `  batch=${j.batchJobId ?? "unknown"}（批量任务，无 VideoBrief）`,
    );
    if (j.videoBrief) {
      console.log(`  brief.createdAt=${fmt(j.videoBrief.createdAt)} brief.updatedAt=${fmt(j.videoBrief.updatedAt)}`);
    }
  }

  // 最近 24h 内到达终态的 job 统计（了解正常任务耗时基线）
  const recentDone = await db.videoJob.findMany({
    where: {
      status: { in: [VideoJobStatus.SUCCEEDED, VideoJobStatus.FAILED] },
      finishedAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      finishedAt: true,
      errorMessage: true,
      lastProviderStatus: true,
    },
    orderBy: { finishedAt: "desc" },
    take: 30,
  });
  console.log(`\n--- 最近 24h 终态 job (${recentDone.length}) ---`);
  for (const j of recentDone) {
    const durMin =
      j.submittedAt && j.finishedAt
        ? ((j.finishedAt.getTime() - j.submittedAt.getTime()) / 60000).toFixed(1)
        : "n/a";
    console.log(
      `${j.id} ${j.status} 用时=${durMin}min providerStatus=${j.lastProviderStatus} err=${JSON.stringify(j.errorMessage)?.slice(0, 100)}`,
    );
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
