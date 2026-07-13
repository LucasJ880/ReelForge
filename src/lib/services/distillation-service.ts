import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";

const SYSTEM_PROMPT = `你是一名短视频创意蒸馏师。给你上一轮的 top 3 视频（含 hook/标题/脚本/打分结果），请提炼可复用的创意特征（不是复制成片），输出可指导下一轮 OPTIMIZATION angle 生成的结构化特征。只输出 JSON。

输出 JSON:
{
  "summary": "英文 80-150 词，概括 top3 的共同有效特征 + 差异化要点",
  "structured": {
    "hook_type": "简短英文标签（如 'POV_first_sec'、'before_after_reveal'）",
    "title_structure": "提炼的标题语法结构",
    "selling_point_order": ["卖点出现的典型顺序"],
    "cta_position": "opening | mid | closing | hidden",
    "format": "ASMR | demo | story | before_after | lifestyle",
    "duration_sweet_spot_sec": 数字,
    "scene_rhythm": "英文，描述节奏/剪辑特征"
  }
}
`;

interface DistillLLM {
  summary: string;
  structured: {
    hook_type: string;
    title_structure: string;
    selling_point_order: string[];
    cta_position: string;
    format: string;
    duration_sweet_spot_sec: number;
    scene_rhythm: string;
  };
}

/**
 * 给定一个 Round，对其 top3（已在 scoring-service 里标记为 ARCHIVED）做蒸馏。
 */
export async function distillRound(roundId: string) {
  const round = await db.round.findUnique({
    where: { id: roundId },
    include: {
      deliveryOrder: true,
      angles: {
        where: {
          videoBrief: { status: "ARCHIVED" },
        },
        include: {
          videoBrief: {
            include: {
              scripts: { where: { isCurrent: true }, take: 1 },
              publishRecords: { include: { metricsSnapshots: true } },
            },
          },
        },
      },
    },
  });
  if (!round) throw new Error("轮次不存在");
  if (round.angles.length === 0) {
    throw new Error("该轮次没有 top3（ARCHIVED）视频可蒸馏");
  }

  await db.round.update({
    where: { id: roundId },
    data: { status: "DISTILLATION_PENDING" },
  });

  const llmInput = round.angles.map((a) => ({
    angle_title: a.title,
    hook: a.hook,
    narrative: a.narrative,
    script_full_text: a.videoBrief?.scripts[0]?.fullText,
    metrics: a.videoBrief?.publishRecords
      .flatMap((r) => r.metricsSnapshots)
      .map((s) => ({ window: s.windowHours, metrics: s.metrics })),
  }));

  const result = !isLLMForcedMock() && isLLMAvailable()
    ? await llmDistill(llmInput)
    : mockDistill();

  const distillation = await db.distillationFeature.create({
    data: {
      deliveryOrderId: round.deliveryOrderId,
      sourceRoundId: round.id,
      summary: result.summary,
      structured: result.structured as unknown as Prisma.InputJsonValue,
    },
  });

  await db.round.update({
    where: { id: roundId },
    data: { status: "CLOSED" },
  });

  await db.deliveryOrder.update({
    where: { id: round.deliveryOrderId },
    data: { status: "AWAITING_DISTILLATION" },
  });

  return distillation;
}

async function llmDistill(items: unknown[]): Promise<DistillLLM> {
  const user = `Top3 视频：
${JSON.stringify(items, null, 2)}

请蒸馏其共同有效特征和差异化要点。`;
  const { data } = await chatJson<DistillLLM>({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.5,
    maxTokens: 2000,
  });
  return data;
}

function mockDistill(): DistillLLM {
  return {
    summary:
      "[Mock] Top 3 share POV-style opening hook within first 1.5 seconds, followed by an ASMR texture close-up, ending with a soft CTA in the final 2 seconds.",
    structured: {
      hook_type: "POV_first_sec",
      title_structure: "POV: you just got the softest X ever",
      selling_point_order: ["softness", "warmth", "giftable"],
      cta_position: "closing",
      format: "ASMR",
      duration_sweet_spot_sec: 18,
      scene_rhythm: "One close-up (3s) → mid cozy scene (10s) → hero CTA (5s)",
    },
  };
}
