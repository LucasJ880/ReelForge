import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import type { ResearchStructured } from "./discovery-service";

const SYSTEM_PROMPT = `你是一名短视频广告卖点提炼专家。基于市场调研 + 产品/服务事实 + 客户上传的真实素材清单，为一个真实素材广告项目产出一组结构化卖点，面向剪辑和脚本团队使用。只输出 JSON。

输出 JSON:
{
  "selling_points": [
    {
      "kind": "core" | "scene" | "emotional" | "localization",
      "rank": 1,
      "title": "短标题（8 词以内，英文）",
      "body": "一句话解释（英文，20-40 词）",
      "evidence": ["来自调研或产品事实的证据关键词"],
      "localizations": {
        "en-US": "美式英语表达",
        "fr-CA": "魁北克法语表达（如目标语言为法语则必填）"
      }
    }
  ]
}

要求：
- core（核心卖点）至少 2 条、scene（场景卖点）至少 2 条、emotional（情绪卖点）至少 1 条、localization（本地化表达）至少 1 条。
- 共 6-10 条。
- rank 按在视频中应出现的重要程度从 1 开始递增。
- localizations 必须包含目标语言的变体；其它语言可为空。
- 不编造产品事实；每条 evidence 都必须在产品输入、素材说明或调研中能找到依据。
- 优先提炼“真实素材能够证明”的卖点，例如宠物反应、before/after、使用过程、人物口播、门店真实环境、产品特写。
- 如果关键卖点缺少可用素材，在 evidence 中标注 missing_footage:...，方便运营补拍。`;

export async function extractSellingPoints(deliveryOrderId: string) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: deliveryOrderId },
    include: { marketResearch: true },
  });
  if (!order) throw new Error("交付单不存在");
  if (!order.marketResearch || order.marketResearch.status !== "READY") {
    throw new Error("请先完成市场调研再提炼卖点");
  }

  await db.sellingPoint.deleteMany({ where: { deliveryOrderId } });

  const list = isLLMAvailable()
    ? await llmSellingPoints(order)
    : mockSellingPoints();

  await db.$transaction(
    list.map((sp, idx) =>
      db.sellingPoint.create({
        data: {
          deliveryOrderId,
          kind: sp.kind,
          rank: sp.rank ?? idx + 1,
          title: sp.title,
          body: sp.body,
          evidence: (sp.evidence ?? []) as unknown as Prisma.InputJsonValue,
          localizations: (sp.localizations ?? {}) as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  await db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: { status: "SELLING_POINTS_READY" },
  });

  return db.sellingPoint.findMany({
    where: { deliveryOrderId },
    orderBy: { rank: "asc" },
  });
}

type SellingPointLLM = {
  kind: "core" | "scene" | "emotional" | "localization";
  rank: number;
  title: string;
  body: string;
  evidence: string[];
  localizations: Record<string, string>;
};

async function llmSellingPoints(order: {
  productCategory: string;
  targetCountry: string;
  targetLanguage: string;
  targetRegionVariant: string | null;
  productInput: Prisma.JsonValue;
  marketResearch: { structured: Prisma.JsonValue | null } | null;
}): Promise<SellingPointLLM[]> {
  const research = order.marketResearch?.structured as unknown as ResearchStructured | null;

  const user = `产品类目: ${order.productCategory}
目标国家/语言: ${order.targetCountry} / ${order.targetLanguage}${order.targetRegionVariant ? ` (${order.targetRegionVariant})` : ""}

产品输入:
${JSON.stringify(order.productInput, null, 2)}

市场调研摘要:
${research ? JSON.stringify(research, null, 2) : "（无）"}

请输出 JSON 卖点清单。`;

  const { data } = await chatJson<{ selling_points: SellingPointLLM[] }>({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.5,
    maxTokens: 3000,
  });
  return data.selling_points ?? [];
}

function mockSellingPoints(): SellingPointLLM[] {
  return [
    {
      kind: "core",
      rank: 1,
      title: "Ultra-soft microfiber",
      body: "Feels like a cloud — premium microfiber keeps you warm without weight.",
      evidence: ["material=microfiber", "gsm>=300"],
      localizations: { "en-US": "cloud-soft microfiber" },
    },
    {
      kind: "scene",
      rank: 2,
      title: "Real usage proof",
      body: "Uses customer footage to show the product or service working in a believable everyday situation.",
      evidence: ["footage_assets", "footage_notes"],
      localizations: { "en-US": "real usage proof" },
    },
    {
      kind: "emotional",
      rank: 3,
      title: "Feels like a hug",
      body: "Wraps you in comfort the moment you slip under it.",
      evidence: ["emotion=comfort"],
      localizations: { "en-US": "feels like a hug" },
    },
    {
      kind: "localization",
      rank: 4,
      title: "Room aesthetic upgrade",
      body: "Instantly elevates any bedroom or sofa setup.",
      evidence: ["tag=aesthetic"],
      localizations: { "en-US": "aesthetic upgrade" },
    },
  ];
}
