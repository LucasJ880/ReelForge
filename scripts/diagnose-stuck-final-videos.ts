/**
 * 只读诊断脚本：找出卡在"合成中"（assembling / 85%）状态的任务。
 *
 * 不做任何写操作。输出：
 *   - 所有非终态的 FinalVideo（PENDING / STITCHING）及其 brief / segments 时间线
 *   - 每条的状态、stitchAttempts、ffmpegError、startedAt / finishedAt / updatedAt
 */
import { loadEnvConfig } from "@next/env";
import { FinalVideoStatus, PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
const db = new PrismaClient();

function fmt(d: Date | null | undefined) {
  return d ? d.toISOString() : "null";
}

async function main() {
  const stuck = await db.finalVideo.findMany({
    where: {
      status: { in: [FinalVideoStatus.PENDING, FinalVideoStatus.STITCHING] },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      brief: {
        select: {
          id: true,
          status: true,
          aspectRatio: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          finalVideoUrl: true,
          videoGenerationPlan: true,
        },
      },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });

  console.log(`共 ${stuck.length} 条非终态 FinalVideo (PENDING/STITCHING)\n`);

  for (const fv of stuck) {
    const plan = fv.brief?.videoGenerationPlan as
      | { assemblyPlan?: { clips?: Array<{ sourceType?: string }> } }
      | null;
    const clips = plan?.assemblyPlan?.clips ?? null;
    console.log("=".repeat(80));
    console.log(`FinalVideo ${fv.id}`);
    console.log(`  status=${fv.status} stitchAttempts=${fv.stitchAttempts}`);
    console.log(`  segmentCount=${fv.segmentCount} targetDurationSec=${fv.targetDurationSec}`);
    console.log(`  ffmpegError=${JSON.stringify(fv.ffmpegError)}`);
    console.log(`  stitchedVideoUrl=${fv.stitchedVideoUrl}`);
    console.log(`  createdAt=${fmt(fv.createdAt)} updatedAt=${fmt(fv.updatedAt)}`);
    console.log(`  startedAt=${fmt(fv.startedAt)} finishedAt=${fmt(fv.finishedAt)}`);
    console.log(`  brief=${fv.brief?.id} briefStatus=${fv.brief?.status} briefError=${JSON.stringify(fv.brief?.errorMessage)}`);
    console.log(`  brief.updatedAt=${fmt(fv.brief?.updatedAt)} finalVideoUrl=${fv.brief?.finalVideoUrl}`);
    console.log(
      `  unifiedAssemblyClips=${clips ? clips.map((c) => c.sourceType).join(",") : "none"}`,
    );
    for (const s of fv.segments) {
      console.log(
        `    seg#${s.segmentIndex} job=${s.id} status=${s.status} url=${s.outputVideoUrl ? s.outputVideoUrl.slice(0, 90) : "null"}`,
      );
      console.log(
        `      submittedAt=${fmt(s.submittedAt)} finishedAt=${fmt(s.finishedAt)} lastCheckedAt=${fmt(s.lastCheckedAt)} error=${JSON.stringify(s.errorMessage)?.slice(0, 120)}`,
      );
    }
  }

  // 顺带统计 STITCHING 状态存在多久
  const stitching = stuck.filter((f) => f.status === FinalVideoStatus.STITCHING);
  if (stitching.length) {
    console.log("\n--- STITCHING 停留时长 ---");
    for (const fv of stitching) {
      const ageMin = fv.startedAt
        ? (Date.now() - fv.startedAt.getTime()) / 60000
        : NaN;
      console.log(`${fv.id}: startedAt 距今 ${ageMin.toFixed(1)} 分钟`);
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
