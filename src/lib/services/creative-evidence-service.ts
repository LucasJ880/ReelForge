import {
  CreativeEvidenceStatus,
  Prisma,
  type CreativeEvidenceCard,
} from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  CREATIVE_INDUSTRIES,
  CREATIVE_OBJECTIVES,
  CREATIVE_PLATFORMS,
  parseCreativeEvidenceCardCore,
  parseCreativeEvidenceBreakdown,
  type CreativeEvidenceBreakdownLLM,
  type CreativeEvidenceCardCore,
  type CreativeIndustry,
  type CreativeObjective,
  type CreativePlatform,
} from "@/lib/schemas/creative-evidence";
import {
  PROMPT_VERSION,
  CREATIVE_EVIDENCE_BREAKDOWN_SYSTEM,
  buildCreativeEvidenceBreakdownUser,
  mockCreativeEvidenceBreakdown,
  type CreativeEvidenceBreakdownInput,
} from "@/lib/prompts/creative-evidence-breakdown";
import { withAIUsageTracking } from "./ai-usage-log-service";

const FEATURE = "creative_evidence_breakdown";

export interface UpsertCreativeEvidenceCardInput
  extends Partial<Omit<CreativeEvidenceCardCore, "slug" | "status">> {
  slug: string;
  /// 仅在 admin 编辑时透传 status；默认保持 DRAFT
  status?: CreativeEvidenceStatus;
}

export interface ListCreativeEvidenceCardsParams {
  industry?: CreativeIndustry;
  platform?: CreativePlatform;
  objective?: CreativeObjective;
  status?: CreativeEvidenceStatus;
  limit?: number;
  offset?: number;
}

export async function listCreativeEvidenceCards(
  params: ListCreativeEvidenceCardsParams = {},
) {
  const where: Prisma.CreativeEvidenceCardWhereInput = {};
  if (params.industry) where.industry = params.industry;
  if (params.platform) where.platform = params.platform;
  if (params.objective) where.objective = params.objective;
  if (params.status) where.status = params.status;

  const [items, total] = await Promise.all([
    db.creativeEvidenceCard.findMany({
      where,
      orderBy: [{ recommendationScore: "desc" }, { createdAt: "desc" }],
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    db.creativeEvidenceCard.count({ where }),
  ]);
  return { items, total };
}

export async function getCreativeEvidenceCard(idOrSlug: string) {
  return db.creativeEvidenceCard.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
}

/**
 * Admin / seed 用：upsert by slug，便于 seed 脚本可重复执行。
 * 不会自动跑 LLM；如果传入了缺失字段且 OPENAI_API_KEY 可用，调用方可以
 * 之后再 runBreakdown(slug, rawNotes) 补全。
 */
export async function upsertCreativeEvidenceCard(
  input: UpsertCreativeEvidenceCardInput,
) {
  const slug = input.slug;
  /// 用 zod 校验已知字段（status 默认 DRAFT 由 schema 处理；不传也允许）
  const validated = parseCreativeEvidenceCardCore({
    ...input,
    status: input.status ?? "DRAFT",
    /// 这些必填字段在调用方校验前必须已填
    industry: input.industry,
    platform: input.platform,
    objective: input.objective,
    title: input.title,
  });

  const data = mapCoreToPrismaData(validated);

  return db.creativeEvidenceCard.upsert({
    where: { slug },
    create: { slug, ...data, status: validated.status },
    update: { ...data, status: validated.status },
  });
}

export async function publishCreativeEvidenceCard(idOrSlug: string) {
  const card = await getCreativeEvidenceCard(idOrSlug);
  if (!card) throw new Error("CreativeEvidenceCard 不存在");
  return db.creativeEvidenceCard.update({
    where: { id: card.id },
    data: { status: CreativeEvidenceStatus.PUBLISHED },
  });
}

export async function archiveCreativeEvidenceCard(idOrSlug: string) {
  const card = await getCreativeEvidenceCard(idOrSlug);
  if (!card) throw new Error("CreativeEvidenceCard 不存在");
  return db.creativeEvidenceCard.update({
    where: { id: card.id },
    data: { status: CreativeEvidenceStatus.ARCHIVED },
  });
}

/**
 * 把数据库 row 映射回 schema 类型，便于 service / API 层使用。
 */
export function cardRowToCore(card: CreativeEvidenceCard): CreativeEvidenceCardCore {
  return parseCreativeEvidenceCardCore({
    slug: card.slug,
    title: card.title,
    industry: card.industry,
    platform: card.platform,
    objective: card.objective,
    sourcePlatform: card.sourcePlatform ?? undefined,
    referenceUrl: card.referenceUrl ?? undefined,
    thumbnailUrl: card.thumbnailUrl ?? undefined,
    publicMetrics: jsonOrUndefined(card.publicMetricsJson),
    hookPattern: jsonOrUndefined(card.hookPattern),
    structureBreakdown: jsonOrUndefined(card.structureBreakdownJson),
    whyItWorks: card.whyItWorks ?? undefined,
    visualStyle: card.visualStyle ?? undefined,
    suggestedUseCase: card.suggestedUseCase ?? undefined,
    riskNotes: card.riskNotes ?? undefined,
    recommendationScore: card.recommendationScore ?? undefined,
    clientPreviewSummary: card.clientPreviewSummary ?? undefined,
    status: card.status,
  });
}

/**
 * 推荐：根据 brief（industry / objective / platform）打出推荐分。
 * MVP 简单加权，不依赖 LLM。后续可替换为 vector 检索。
 */
export interface CreativeRecommendationScore {
  cardId: string;
  slug: string;
  score: number;
  reasons: string[];
}

export interface RecommendCreativeCardsInput {
  industry: CreativeIndustry;
  objective: CreativeObjective;
  platform?: CreativePlatform;
  limit?: number;
}

export async function recommendCreativeCards(
  input: RecommendCreativeCardsInput,
): Promise<CreativeRecommendationScore[]> {
  const { items } = await listCreativeEvidenceCards({
    status: CreativeEvidenceStatus.PUBLISHED,
    limit: 200,
  });

  const ranked = items
    .map((card) => {
      const reasons: string[] = [];
      let score = card.recommendationScore ?? 50;
      if (card.industry === input.industry) {
        score += 15;
        reasons.push("行业完全匹配");
      } else if (card.industry === "general") {
        score += 5;
        reasons.push("通用模板，可跨行业借鉴");
      }
      if (card.objective === input.objective) {
        score += 12;
        reasons.push("业务目标一致");
      }
      if (input.platform && card.platform === input.platform) {
        score += 8;
        reasons.push("平台一致");
      } else if (card.platform === "mixed") {
        score += 3;
        reasons.push("跨平台模板");
      }
      return {
        cardId: card.id,
        slug: card.slug,
        score: Math.min(100, Math.max(0, score)),
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, input.limit ?? 10);
}

/**
 * Run LLM breakdown for an existing card (by id or slug).
 * 把生成结果写回 card 字段，并落 AIUsageLog。
 */
export async function runCreativeEvidenceBreakdown(
  idOrSlug: string,
  input: {
    rawReferenceNotes: string;
    /// 是否强制走 mock（测试 / 无 LLM key 时）
    forceMock?: boolean;
  },
) {
  const card = await getCreativeEvidenceCard(idOrSlug);
  if (!card) throw new Error("CreativeEvidenceCard 不存在");

  const llmInput: CreativeEvidenceBreakdownInput = {
    rawReferenceNotes: input.rawReferenceNotes,
    industry: card.industry as CreativeIndustry,
    platform: card.platform as CreativePlatform,
    objective: card.objective as CreativeObjective,
    publicMetricsSummary: summarizeMetrics(card.publicMetricsJson),
    sourcePlatform: card.sourcePlatform ?? undefined,
    referenceUrl: card.referenceUrl ?? undefined,
  };

  let result: CreativeEvidenceBreakdownLLM;
  if (input.forceMock || !isLLMAvailable()) {
    result = parseCreativeEvidenceBreakdown(
      mockCreativeEvidenceBreakdown(llmInput),
    );
  } else {
    result = await withAIUsageTracking(
      {
        feature: FEATURE,
        creativeCardId: card.id,
        promptVersion: PROMPT_VERSION,
        inputForLog: input.rawReferenceNotes.slice(0, 600),
      },
      async () => {
        const r = await chatJson<CreativeEvidenceBreakdownLLM>({
          system: CREATIVE_EVIDENCE_BREAKDOWN_SYSTEM,
          user: buildCreativeEvidenceBreakdownUser(llmInput),
          temperature: 0.4,
          maxTokens: 1800,
        });
        return {
          data: parseCreativeEvidenceBreakdown(r.data),
          modelUsed: r.modelUsed,
          tokenUsage: r.tokenUsage,
          raw: r.raw,
        };
      },
    );
  }

  return db.creativeEvidenceCard.update({
    where: { id: card.id },
    data: {
      hookPattern: result.hookPattern as unknown as Prisma.InputJsonValue,
      structureBreakdownJson: result.structureBreakdown as unknown as Prisma.InputJsonValue,
      whyItWorks: result.whyItWorks,
      visualStyle: result.visualStyle,
      suggestedUseCase: result.suggestedUseCase,
      riskNotes: result.riskNotes ?? null,
      clientPreviewSummary: result.clientPreviewSummary,
      recommendationScore: result.recommendationScore,
      status: CreativeEvidenceStatus.REVIEWED,
    },
  });
}

function mapCoreToPrismaData(core: CreativeEvidenceCardCore) {
  /// 注意：Prisma JSON 字段写 null 必须用 Prisma.JsonNull / Prisma.DbNull，
  /// 不能直接传 null。这里把可空 JSON 字段统一规整成允许的写入形态。
  return {
    title: core.title,
    industry: core.industry,
    platform: core.platform,
    objective: core.objective,
    sourcePlatform: core.sourcePlatform ?? null,
    referenceUrl: core.referenceUrl ?? null,
    thumbnailUrl: core.thumbnailUrl ?? null,
    publicMetricsJson: (core.publicMetrics ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    hookPattern: (core.hookPattern ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    structureBreakdownJson: (core.structureBreakdown ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    whyItWorks: core.whyItWorks ?? null,
    visualStyle: core.visualStyle ?? null,
    suggestedUseCase: core.suggestedUseCase ?? null,
    riskNotes: core.riskNotes ?? null,
    recommendationScore: core.recommendationScore ?? null,
    clientPreviewSummary: core.clientPreviewSummary ?? null,
  } satisfies Prisma.CreativeEvidenceCardUpdateInput;
}

function jsonOrUndefined<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  if (value == null) return undefined;
  return value as unknown as T;
}

function summarizeMetrics(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const m = value as Record<string, unknown>;
  const parts: string[] = [];
  if (m.observedAt) parts.push(`observed=${m.observedAt}`);
  if (typeof m.views === "number") parts.push(`views=${m.views}`);
  if (typeof m.likes === "number") parts.push(`likes=${m.likes}`);
  if (typeof m.shares === "number") parts.push(`shares=${m.shares}`);
  if (typeof m.saves === "number") parts.push(`saves=${m.saves}`);
  if (typeof m.comments === "number") parts.push(`comments=${m.comments}`);
  if (m.isPaidAd) parts.push(`paid_ad=${m.paidAdNote ?? "yes"}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/// 暴露 enum 列表给 UI / API 使用
export const CREATIVE_ENUMS = {
  industries: CREATIVE_INDUSTRIES,
  platforms: CREATIVE_PLATFORMS,
  objectives: CREATIVE_OBJECTIVES,
};
