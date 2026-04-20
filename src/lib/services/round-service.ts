import { db } from "@/lib/db";

export interface CreateRoundArgs {
  deliveryOrderId: string;
  primarySellingPointId?: string;
  optimizationSlots?: number;
  explorationSlots?: number;
  baseDistillationId?: string;
}

export async function createRound(args: CreateRoundArgs) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: args.deliveryOrderId },
    include: {
      rounds: { orderBy: { roundIndex: "desc" }, take: 1 },
      distillations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error("交付单不存在");

  const nextIndex = (order.rounds[0]?.roundIndex ?? 0) + 1;
  if (nextIndex > order.maxRounds) {
    throw new Error(`已达最大轮次 ${order.maxRounds}，无法再开新轮`);
  }

  // 非首轮必须引用蒸馏特征
  let baseDistillationId = args.baseDistillationId;
  if (nextIndex > 1 && !baseDistillationId) {
    baseDistillationId = order.distillations[0]?.id;
    if (!baseDistillationId) {
      throw new Error("非首轮必须先完成上一轮蒸馏");
    }
  }

  const round = await db.round.create({
    data: {
      deliveryOrderId: args.deliveryOrderId,
      roundIndex: nextIndex,
      primarySellingPointId: args.primarySellingPointId ?? null,
      optimizationSlots: args.optimizationSlots ?? 3,
      explorationSlots: args.explorationSlots ?? 2,
      baseDistillationId: baseDistillationId ?? null,
      status: "PLANNED",
    },
  });

  await db.deliveryOrder.update({
    where: { id: args.deliveryOrderId },
    data: {
      status:
        nextIndex === 1 ? "ROUND_ACTIVE" : "NEXT_ROUND_SCHEDULED",
    },
  });

  return round;
}

/**
 * 提前结算交付单。
 */
export async function finalizeDeliveryOrder(
  deliveryOrderId: string,
  reason: string,
) {
  return db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: {
      status: "COMPLETED",
      errorMessage: null,
      updatedAt: new Date(),
      ...(reason ? { errorMessage: `[COMPLETED] ${reason}` } : {}),
    },
  });
}

export async function cancelDeliveryOrder(
  deliveryOrderId: string,
  reason: string,
) {
  return db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: {
      status: "CANCELLED",
      errorMessage: reason,
    },
  });
}
