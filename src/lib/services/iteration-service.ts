import { db } from "@/lib/db";
import { distillRound } from "@/lib/services/distillation-service";
import { scoreRound } from "@/lib/services/scoring-service";

export async function generateRoundIterationReport(roundId: string) {
  const scored = await scoreRound(roundId);
  if (scored.ranked.length === 0) {
    throw new Error("该轮次尚无可排名数据，请先导入 12/24/48 小时指标");
  }

  const distillation = await distillRound(roundId);
  const round = await db.round.findUnique({
    where: { id: roundId },
    include: {
      deliveryOrder: {
        include: {
          rounds: { orderBy: { roundIndex: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!round) throw new Error("轮次不存在");

  const canScheduleNext =
    round.roundIndex < round.deliveryOrder.maxRounds &&
    !["COMPLETED", "CANCELLED"].includes(round.deliveryOrder.status);

  if (canScheduleNext) {
    await db.deliveryOrder.update({
      where: { id: round.deliveryOrderId },
      data: { status: "NEXT_ROUND_SCHEDULED" },
    });
  }

  return {
    scored,
    distillation,
    nextRound: {
      canSchedule: canScheduleNext,
      suggestedBaseDistillationId: distillation.id,
      suggestedSlots: { optimization: 3, exploration: 2 },
    },
  };
}
