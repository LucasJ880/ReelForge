/**
 * 只读诊断（第二步）：针对卡住的 brief cmrcbuaji000rl404hzi2gzht 输出完整证据链。
 * 不做任何写操作、不调任何付费 API（只对已付费的段 URL 发 HEAD 验证可达性）。
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
const db = new PrismaClient();

const BRIEF_ID = process.argv[2] ?? "cmrcbuaji000rl404hzi2gzht";

async function main() {
  const brief = await db.videoBrief.findUnique({
    where: { id: BRIEF_ID },
    include: {
      finalVideo: { include: { segments: { orderBy: { segmentIndex: "asc" } } } },
      videoJobs: { orderBy: { createdAt: "asc" } },
      qaReviews: true,
    },
  });
  if (!brief) {
    console.log("brief 不存在");
    return;
  }

  console.log("=== VideoBrief ===");
  console.log(
    JSON.stringify(
      {
        id: brief.id,
        status: brief.status,
        targetDurationSec: brief.targetDurationSec,
        aspectRatio: brief.aspectRatio,
        errorMessage: brief.errorMessage,
        finalVideoUrl: brief.finalVideoUrl,
        finalVideoId: brief.finalVideoId,
        createdAt: brief.createdAt,
        updatedAt: brief.updatedAt,
      },
      null,
      2,
    ),
  );

  console.log("\n=== videoGenerationPlan.assemblyPlan ===");
  const plan = brief.videoGenerationPlan as Record<string, unknown> | null;
  console.log(JSON.stringify(plan?.assemblyPlan ?? null, null, 2));

  console.log("\n=== FinalVideo ===");
  console.log(JSON.stringify(brief.finalVideo, null, 2));

  console.log("\n=== VideoJobs ===");
  for (const j of brief.videoJobs) {
    console.log(
      JSON.stringify(
        {
          id: j.id,
          provider: j.provider,
          status: j.status,
          segmentIndex: j.segmentIndex,
          externalJobId: j.externalJobId,
          submittedAt: j.submittedAt,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          timeoutAt: j.timeoutAt,
          lastCheckedAt: j.lastCheckedAt,
          lastProviderStatus: j.lastProviderStatus,
          pollErrors: j.pollErrors,
          retryCount: j.retryCount,
          errorMessage: j.errorMessage,
          userSafeError: j.userSafeError,
          outputVideoUrl: j.outputVideoUrl,
          outputThumbUrl: j.outputThumbUrl,
        },
        null,
        2,
      ),
    );
  }

  // 已付费段 URL 可达性验证（HEAD，不产生生成费用）
  const seg = brief.finalVideo?.segments?.[0];
  if (seg?.outputVideoUrl) {
    try {
      const res = await fetch(seg.outputVideoUrl, { method: "HEAD" });
      console.log(
        `\n=== 段 URL HEAD 检查 ===\nstatus=${res.status} content-type=${res.headers.get("content-type")} content-length=${res.headers.get("content-length")}`,
      );
    } catch (e) {
      console.log(`段 URL HEAD 失败: ${(e as Error).message}`);
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
