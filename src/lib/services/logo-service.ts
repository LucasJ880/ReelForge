import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import { buildLogoPrompt } from "@/lib/ai/logo-prompt";
import { recordAIUsage } from "./ai-usage-log-service";

/**
 * Logo Service —— PART 6。
 *
 * 设计要点：
 * - 单次调用生成 N 个候选（默认 3），全部存到 LogoGeneration.generatedUrls。
 * - 用户选定后写回 DeliveryOrder.clientBrief.brandAssets.logoUrl，并标 selectedUrl。
 * - 不阻塞视频生成：logo 是可选的；导演 prompt 看到时会拼到 end card / 角落。
 * - mock：缺 OPENAI_API_KEY 或 IMAGE_ENGINE_MOCK=true → 返回占位 URL，不计费。
 */

export const LOGO_STYLE_KEYS = [
  "modern",
  "minimal",
  "luxury",
  "playful",
  "tech",
  "natural",
  "local",
] as const;
export type LogoStyleKey = (typeof LOGO_STYLE_KEYS)[number];

export interface GenerateLogoArgs {
  deliveryOrderId: string;
  businessName: string;
  industry?: string | null;
  style?: LogoStyleKey | null;
  colors?: string | null;
  slogan?: string | null;
  iconIdea?: string | null;
  language?: string | null;
  /// 候选数；默认 3，最多 4（更多会推高成本而对决策无大帮助）
  count?: number;
  /// 强制 mock，便于测试
  forceMock?: boolean;
}

export interface GenerateLogoResult {
  generationId: string;
  urls: string[];
  fromMock: boolean;
  modelUsed: string;
}

export async function generateLogoCandidates(
  args: GenerateLogoArgs,
): Promise<GenerateLogoResult> {
  const order = await db.deliveryOrder.findUnique({
    where: { id: args.deliveryOrderId },
    select: { id: true, title: true },
  });
  if (!order) throw new Error("项目不存在");

  const prompt = buildLogoPrompt({
    businessName: args.businessName,
    industry: args.industry,
    styleHint: args.style,
    colors: args.colors,
    slogan: args.slogan,
    iconIdea: args.iconIdea,
    language: args.language,
  });

  const useMock =
    args.forceMock || !getAiProvider().isConfigured() || process.env.IMAGE_ENGINE_MOCK === "true";

  const start = Date.now();
  let urls: string[] = [];
  let modelUsed = "mock";
  let errorMessage: string | null = null;
  try {
    const result = await getAiProvider().generateImages({
      prompt,
      n: clampInt(args.count ?? 3, 1, 4),
      storagePrefix: `logos/${args.deliveryOrderId}/`,
      forceMock: useMock,
    });
    urls = result.urls;
    modelUsed = result.modelUsed;
  } catch (err) {
    errorMessage = (err as Error).message;
  }

  const generation = await db.logoGeneration.create({
    data: {
      deliveryOrderId: args.deliveryOrderId,
      prompt,
      styleHint: args.style ?? null,
      model: modelUsed,
      generatedUrls: urls,
      errorMessage,
    },
  });

  await recordAIUsage({
    feature: "logo_generation",
    deliveryOrderId: args.deliveryOrderId,
    model: modelUsed,
    status: errorMessage ? "FAILED" : useMock ? "MOCK" : "SUCCESS",
    inputSummary: `business=${args.businessName} style=${args.style ?? "(any)"}`,
    outputSummary: `${urls.length} candidates`,
    durationMs: Date.now() - start,
    errorMessage,
  });

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return {
    generationId: generation.id,
    urls,
    fromMock: useMock,
    modelUsed,
  };
}

/**
 * 用户选定一个 logo URL：
 * 1. 标记 LogoGeneration.selectedUrl
 * 2. 写回 DeliveryOrder.clientBrief.brandAssets.logoUrl
 *
 * brandAssets / clientBrief 的形状参考 prisma schema 注释。
 */
export async function selectLogo(args: {
  deliveryOrderId: string;
  generationId: string;
  url: string;
}) {
  const generation = await db.logoGeneration.findUnique({
    where: { id: args.generationId },
  });
  if (!generation) throw new Error("Logo 生成记录不存在");
  if (generation.deliveryOrderId !== args.deliveryOrderId) {
    throw new Error("Logo 记录不属于该项目");
  }
  if (!generation.generatedUrls.includes(args.url)) {
    throw new Error("所选 URL 不在该生成的候选列表中");
  }

  const order = await db.deliveryOrder.findUnique({
    where: { id: args.deliveryOrderId },
    select: { clientBrief: true },
  });
  if (!order) throw new Error("项目不存在");

  const updatedBrief = mergeLogoUrlIntoClientBrief(order.clientBrief, args.url);

  await db.$transaction([
    db.logoGeneration.update({
      where: { id: args.generationId },
      data: { selectedUrl: args.url },
    }),
    db.deliveryOrder.update({
      where: { id: args.deliveryOrderId },
      data: { clientBrief: updatedBrief },
    }),
  ]);

  return { ok: true as const, logoUrl: args.url };
}

/**
 * 列出某项目历史 logo 生成（最近的优先）。
 */
export async function listLogoGenerationsForOrder(deliveryOrderId: string) {
  return db.logoGeneration.findMany({
    where: { deliveryOrderId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 把 logo URL 合并进 clientBrief.brandAssets.logoUrl。
 * 如果 clientBrief 是 null 或不是对象，建立最小可用结构。
 */
export function mergeLogoUrlIntoClientBrief(
  current: Prisma.JsonValue,
  logoUrl: string,
): Prisma.InputJsonValue {
  const base: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  const brand = base.brandAssets;
  const brandObj: Record<string, unknown> =
    brand && typeof brand === "object" && !Array.isArray(brand)
      ? { ...(brand as Record<string, unknown>) }
      : {};
  brandObj.logoUrl = logoUrl;
  base.brandAssets = brandObj;
  return base as Prisma.InputJsonValue;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

/// 仅供测试导入
export const __test__ = {
  mergeLogoUrlIntoClientBrief,
};
