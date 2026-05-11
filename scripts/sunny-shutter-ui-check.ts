/**
 * UI 数据校验：直接调用 summarizeBriefRender（前端 <RenderProgress> 数据源），
 * 确认 Sunny Shutter 三个 brief 的最终展示文案没有泄露 provider 任何内部信息。
 *
 * 运行：
 *   npx dotenv -e .env.local -- npx tsx scripts/sunny-shutter-ui-check.ts
 */
import { PrismaClient } from "@prisma/client";
import { summarizeBriefRender } from "../src/lib/services/video-service";
import {
  VIDEO_JOB_USER_LABELS,
  VIDEO_JOB_USER_HELPER,
} from "../src/lib/labels-user";

const db = new PrismaClient();

const FORBIDDEN_IN_PRIMARY_UI = [
  /SEEDANCE_T2V/i,
  /SEEDANCE_I2V/i,
  /seedance/i,
  /volcengine/i,
  /\bcgt-/, // raw provider task id 前缀
];

function banner(t: string) {
  console.log("\n" + "=".repeat(78));
  console.log("  " + t);
  console.log("=".repeat(78));
}

function checkPrimary(text: string | null | undefined, where: string) {
  if (!text) return [];
  return FORBIDDEN_IN_PRIMARY_UI.filter((re) => re.test(text)).map(
    (re) => `${where} 暴露内部词：/${re}/ → "${text.slice(0, 80)}"`,
  );
}

async function main() {
  const order = await db.deliveryOrder.findFirst({
    where: { title: { contains: "Sunny Shutter", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    console.error("没找到 Sunny Shutter 订单");
    process.exit(2);
  }

  const briefs = await db.videoBrief.findMany({
    where: {
      contentAngle: { round: { deliveryOrderId: order.id } },
    },
    include: { contentAngle: { select: { sortOrder: true, title: true } } },
    orderBy: [{ contentAngle: { sortOrder: "asc" } }],
  });

  banner(`订单：${order.title}（${briefs.length} 个 brief）`);

  let totalLeaks = 0;

  for (const b of briefs) {
    const summary = await summarizeBriefRender(b.id);
    const angleLabel = b.contentAngle
      ? `#${b.contentAngle.sortOrder} ${b.contentAngle.title}`
      : "—";

    banner(
      `brief ${b.id} · ${angleLabel} · brief.status=${b.status}` +
        (b.finalVideoUrl ? "  ✓ 有最终视频" : ""),
    );
    console.log(
      `briefStatus=${summary.briefStatus}  · totalJobs=${summary.totalJobs}` +
        ` · succeeded=${summary.succeeded} running=${summary.running} queued=${summary.queued} failed=${summary.failed} cancelled=${summary.cancelled}` +
        ` · hasStuckJob=${summary.hasStuckJob}`,
    );
    if (summary.lastCheckedAt) {
      console.log(`lastCheckedAt=${summary.lastCheckedAt.toISOString()}`);
    }
    if (summary.finalVideoUrl) {
      console.log(`finalVideoUrl=${summary.finalVideoUrl}`);
    }

    /// 主 UI 文案核查 —— 模拟 RenderProgress 的渲染：
    /// 真实展示 = VIDEO_JOB_USER_LABELS[userStatusKey] + VIDEO_JOB_USER_HELPER[userStatusKey] + userSafeError
    for (const job of summary.jobs) {
      const userLabel = VIDEO_JOB_USER_LABELS[job.userStatusKey];
      const userHelper = VIDEO_JOB_USER_HELPER[job.userStatusKey];
      const leaks = [
        ...checkPrimary(userLabel, `job ${job.id.slice(0, 12)} label`),
        ...checkPrimary(userHelper, `job ${job.id.slice(0, 12)} helper`),
        ...checkPrimary(job.userSafeError, `job ${job.id.slice(0, 12)} userSafeError`),
      ];
      totalLeaks += leaks.length;
      console.log(
        `  - ${job.id.slice(0, 12)}…  user="${userLabel}"  helper="${(userHelper ?? "").slice(0, 40)}…"` +
          (job.outputVideoUrl
            ? `\n      preview=${job.outputVideoUrl.slice(0, 70)}…`
            : ""),
      );
      if (leaks.length > 0) {
        for (const l of leaks) console.log(`    ❌ ${l}`);
      }
      /// debug 字段允许暴露 provider/任务 ID（专门给开发者用的折叠区）
      if (job.debug?.externalJobId) {
        console.log(
          `    [debug-only] provider=${job.debug.provider} externalJobId=${job.debug.externalJobId.slice(0, 26)}… lastProviderStatus=${job.debug.lastProviderStatus}`,
        );
      }
    }
  }

  banner("结论");
  if (totalLeaks === 0) {
    console.log("✅ 没有任何 brief 的主 UI 文案/状态/错误信息泄露 provider 内部词。");
    console.log("✅ 主 UI 仅展示「视频已生成」并附预览 URL；provider 名/task id 仅出现在 debug 区。");
  } else {
    console.log(`❌ 发现 ${totalLeaks} 处 provider 内部词泄露到主 UI。`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
