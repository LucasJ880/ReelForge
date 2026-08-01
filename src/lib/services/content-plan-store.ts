import { Prisma, type ContentFormat as DbContentFormat } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildContentPlan,
  type ContentPlanInput,
} from "@/lib/services/content-plan-service";
import {
  fetchProductFacts,
  factsToPromptLines,
  ProductLinkError,
} from "@/lib/services/product-link-service";
import { resolveDerivationInput } from "@/lib/services/winner-derivation-service";
import type { ContentFormat, ContentPost } from "@/lib/schemas/content-plan";

/**
 * O1 的落库层：生成 → 持久化 → 读回（PRD §3 / M3）。
 *
 * 生成本身**不计费**。PRD 决策 4 定的是「失败零计费、迭代低价、取消永远免费」，
 * 而一周文案计划的成本只有一次 LLM 调用；对它收费会直接惩罚迭代，
 * 那是同行调研里点名的头号流失原因。真正花钱的是出图，计费放在渲染那一步。
 */

const FORMAT_TO_DB: Record<ContentFormat, DbContentFormat> = {
  text: "TEXT",
  single_image: "SINGLE_IMAGE",
  carousel: "CAROUSEL",
  video: "VIDEO",
};

/**
 * 内容帖的创意配方身份。
 *
 * 用「钩子类型 + 形态」而不是随机 id：赛马要回答的是「哪种结构在赢」，
 * 分组键必须在不同帖子之间可复用。同一结构的两条帖子必须落到同一个 recipeId，
 * 否则每条都是自己一组，永远判不出胜负。
 */
export function postRecipeId(post: {
  hookType: string;
  format: ContentFormat;
}): string {
  return `post:${post.hookType}:${post.format}`;
}

export type CreateContentPlanArgs = {
  userId: string;
  source: "sentence" | "product_image" | "product_url";
  /// 一句话原文 / 商品链接 / 产品图 URL
  sourceInput: string;
  industry?: string | null;
  platform?: string | null;
  brandName?: string | null;
  idempotencyKey?: string | null;
};

export class ContentPlanConflictError extends Error {
  constructor(readonly planId: string) {
    super("同一幂等键已存在计划");
    this.name = "ContentPlanConflictError";
  }
}

export async function createContentPlan(args: CreateContentPlanArgs) {
  if (args.idempotencyKey) {
    const existing = await db.contentPlan.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: args.userId,
          idempotencyKey: args.idempotencyKey,
        },
      },
      select: { id: true },
    });
    /// 重放返回已有计划，而不是再生成一份。重复生成对商家是「同一个操作扣了两次」。
    if (existing) return getContentPlan(args.userId, existing.id);
  }

  let productFacts: string[] | null = null;
  let factsRaw: Prisma.InputJsonValue | undefined;

  if (args.source === "product_url") {
    /// 抓不到就明确失败，不要静默降级成纯一句话 ——
    /// 商家给了链接却拿到一份和链接无关的计划，比报错更糟。
    const facts = await fetchProductFacts(args.sourceInput);
    productFacts = factsToPromptLines(facts);
    factsRaw = facts as unknown as Prisma.InputJsonValue;
  }

  /// 每周排期先看有没有依据可用：自己的战绩优先，其次同行长期在投的结构，
  /// 都没有就老实说这是第一周（R4 / O4）。
  const derivation = await resolveDerivationInput({
    userId: args.userId,
    industry: args.industry ?? null,
  });

  const input: ContentPlanInput = {
    sentence:
      args.source === "sentence"
        ? args.sourceInput
        : productFacts?.[0] ?? args.sourceInput,
    industry: args.industry ?? null,
    platform: args.platform ?? null,
    brandName: args.brandName ?? null,
    productFacts,
    referenceStructures: derivation.referenceStructures,
    winningRecipe: derivation.winningRecipe,
  };

  const { plan, source: generatedBy } = await buildContentPlan(input);

  const created = await db.contentPlan.create({
    data: {
      userId: args.userId,
      source:
        args.source === "sentence"
          ? "SENTENCE"
          : args.source === "product_url"
            ? "PRODUCT_URL"
            : "PRODUCT_IMAGE",
      sourceInput: args.sourceInput,
      theme: plan.theme,
      targetAudience: plan.targetAudience,
      corePainPoint: plan.corePainPoint,
      productFactsJson: factsRaw,
      generatedBy,
      planBasis: derivation.basis,
      idempotencyKey: args.idempotencyKey ?? null,
      posts: { create: plan.posts.map(toPostCreate) },
    },
    select: { id: true },
  });

  return getContentPlan(args.userId, created.id);
}

function toPostCreate(post: ContentPost) {
  return {
    key: post.key,
    dayOffset: post.dayOffset,
    format: FORMAT_TO_DB[post.format],
    copyHook: post.copy.hook,
    copyBody: post.copy.body,
    copyCta: post.copy.cta,
    hashtags: post.hashtags,
    imagePrompt: post.imagePrompt,
    slidesJson: post.slides.length
      ? (post.slides as unknown as Prisma.InputJsonValue)
      : undefined,
    rationale: post.rationale,
    hookType: post.hookType,
    recipeId: postRecipeId({ hookType: post.hookType, format: post.format }),
  };
}

const planSelect = {
  id: true,
  source: true,
  sourceInput: true,
  theme: true,
  targetAudience: true,
  corePainPoint: true,
  generatedBy: true,
  planBasis: true,
  createdAt: true,
  posts: {
    orderBy: [{ dayOffset: "asc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      dayOffset: true,
      format: true,
      status: true,
      copyHook: true,
      copyBody: true,
      copyCta: true,
      hashtags: true,
      imagePrompt: true,
      slidesJson: true,
      renderedImageUrls: true,
      renderedAt: true,
      renderError: true,
      rationale: true,
      recipeId: true,
      hookType: true,
    },
  },
} satisfies Prisma.ContentPlanSelect;

export async function getContentPlan(userId: string, planId: string) {
  /// where 里带 userId 而不是查完再判：越权读取要在查询层就不可能，
  /// 不能依赖调用方记得比对 owner。
  return db.contentPlan.findFirst({
    where: { id: planId, userId },
    select: planSelect,
  });
}

export async function listContentPlans(userId: string, limit = 20) {
  return db.contentPlan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: planSelect,
  });
}

export { ProductLinkError };
