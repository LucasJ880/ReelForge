/**
 * 成片评价读数（只读）：最近 N 天商家给成片的满意 / 不满意与原因分布。
 * 成片画面质检缺省关掉之后，这是唯一来自真人的质量读数；想知道「质量有没有跑偏」先看这里。
 *
 *   npm run report:feedback            # 最近 30 天
 *   npm run report:feedback -- --days 7
 *
 * 只读一张表，不写任何数据。评价表还没建（迁移没跑）时会直接报错说明。
 */
import { VIDEO_FEEDBACK_REASONS } from "@/lib/contracts/video-feedback";

const REASON_LABEL: Record<(typeof VIDEO_FEEDBACK_REASONS)[number], string> = {
  product_mismatch: "商品不像",
  unnatural_motion: "画面或动作不自然",
  off_brief: "没按描述拍",
  voice_caption: "口播或字幕有问题",
  other: "其他",
};

async function main(): Promise<void> {
  const flagIndex = process.argv.indexOf("--days");
  const days = flagIndex >= 0 ? Number(process.argv[flagIndex + 1]) : 30;
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error("--days 要是 1–365 的数字");
  const { loadVideoFeedbackSummary } = await import("@/lib/services/video-feedback-service");
  const { db } = await import("@/lib/db");
  try {
    const summary = await loadVideoFeedbackSummary(new Date(Date.now() - days * 24 * 60 * 60_000));
    console.log(`# 成片评价 · 最近 ${days} 天\n`);
    if (summary.total === 0) {
      console.log("还没有评价。");
      return;
    }
    console.log(`共 ${summary.total} 条评价：满意 ${summary.up}，不满意 ${summary.down}，满意率 ${summary.satisfactionRate}%\n`);
    if (summary.down > 0) {
      console.log("不满意的原因（一条可以带多个）：");
      for (const reason of VIDEO_FEEDBACK_REASONS) {
        if (summary.reasons[reason] > 0) console.log(`- ${REASON_LABEL[reason]}：${summary.reasons[reason]} 条`);
      }
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
