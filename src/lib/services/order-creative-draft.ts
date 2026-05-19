import { db } from "@/lib/db";
import type { AspectRatio, BrandEndingMode } from "@/types/video-generation";

export interface OrderCreativeDraft {
  rawPrompt: string;
  selectedDuration: 15 | 30 | 60;
  selectedAspectRatio: AspectRatio;
  selectedBrandEndingMode: BrandEndingMode;
  cta: string;
  brandName: string;
  website: string;
  sourceTitle: string;
}

function buildDraftFromOrder(
  order: {
    title: string;
    productInput: unknown;
    rounds: Array<{
      angles: Array<{
        videoBrief: {
          durationSec: number | null;
          aspectRatio: string | null;
          videoGenerationPlan: unknown;
        } | null;
      }>;
    }>;
  },
  options?: { variant?: boolean; persona?: "PERSONAL" | "BUSINESS" },
): OrderCreativeDraft {
  const isPersonal = options?.persona === "PERSONAL";
  const input = order.productInput as Record<string, unknown> | null;
  const brandKit = (input?.brandKit ?? input?.brand_kit) as
    | Record<string, unknown>
    | undefined;
  const brief = order.rounds[0]?.angles[0]?.videoBrief;
  const plan = brief?.videoGenerationPlan as
    | { brandPackaging?: { mode?: BrandEndingMode } }
    | null
    | undefined;

  const basePrompt =
    (typeof input?.rawPrompt === "string" && input.rawPrompt) ||
    order.title ||
    "";

  const variantSuffix =
    " — variant: emphasize a fresher hook and stronger CTA while keeping the same product story.";

  const rawPrompt = options?.variant
    ? `${basePrompt.trim()}${variantSuffix}`
    : basePrompt.trim();

  const duration = brief?.durationSec;
  const selectedDuration: 15 | 30 | 60 =
    duration === 60 ? 60 : duration === 30 ? 30 : 15;

  const ar = brief?.aspectRatio;
  const selectedAspectRatio: AspectRatio =
    ar === "16:9" || ar === "1:1" ? ar : "9:16";

  return {
    rawPrompt,
    selectedDuration,
    selectedAspectRatio,
    selectedBrandEndingMode: isPersonal
      ? "none"
      : (plan?.brandPackaging?.mode ?? "auto_end_card"),
    cta: isPersonal
      ? ""
      : (typeof brandKit?.ctaText === "string" && brandKit.ctaText) ||
        (typeof input?.cta === "string" && input.cta) ||
        "Tap to shop",
    brandName: isPersonal
      ? ""
      : (typeof brandKit?.brandName === "string" && brandKit.brandName) || "",
    website: isPersonal
      ? ""
      : (typeof brandKit?.websiteUrl === "string" && brandKit.websiteUrl) ||
        (typeof brandKit?.website === "string" && brandKit.website) ||
        "",
    sourceTitle: order.title,
  };
}

/** 最近一次 unified-input 订单（Phase 6e：一键沿用上次创意） */
export async function loadLastCreativeDraft(
  userId: string,
  persona: "PERSONAL" | "BUSINESS",
): Promise<OrderCreativeDraft | null> {
  const order = await db.deliveryOrder.findFirst({
    where: {
      createdById: userId,
      productCategory: "unified_input",
      rounds: {
        some: {
          angles: {
            some: { videoBrief: { persona } },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      title: true,
      productInput: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            take: 1,
            select: {
              videoBrief: {
                select: {
                  durationSec: true,
                  aspectRatio: true,
                  videoGenerationPlan: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order?.rounds[0]?.angles[0]?.videoBrief) return null;
  return buildDraftFromOrder(order, { persona });
}

export async function loadOrderCreativeDraft(
  orderId: string,
  userId: string,
): Promise<OrderCreativeDraft | null> {
  const order = await db.deliveryOrder.findFirst({
    where: { id: orderId, createdById: userId },
    select: {
      title: true,
      productInput: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            take: 1,
            select: {
              videoBrief: {
                select: {
                  durationSec: true,
                  aspectRatio: true,
                  videoGenerationPlan: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!order?.rounds[0]?.angles[0]?.videoBrief) return null;
  return buildDraftFromOrder(order, { variant: true, persona: "BUSINESS" });
}
