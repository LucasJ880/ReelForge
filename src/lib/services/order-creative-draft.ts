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

  if (!order) return null;

  const input = order.productInput as Record<string, unknown> | null;
  const brandKit = (input?.brandKit ?? input?.brand_kit) as
    | Record<string, unknown>
    | undefined;
  const brief = order.rounds[0]?.angles[0]?.videoBrief;
  const plan = brief?.videoGenerationPlan as
    | { brandPackaging?: { mode?: BrandEndingMode }; inputClassification?: unknown }
    | null
    | undefined;

  const rawPrompt =
    (typeof input?.rawPrompt === "string" && input.rawPrompt) ||
    order.title ||
    "";

  const duration = brief?.durationSec;
  const selectedDuration: 15 | 30 | 60 =
    duration === 60 ? 60 : duration === 30 ? 30 : 15;

  const ar = brief?.aspectRatio;
  const selectedAspectRatio: AspectRatio =
    ar === "16:9" || ar === "1:1" ? ar : "9:16";

  const variantSuffix =
    " — variant: emphasize a fresher hook and stronger CTA while keeping the same product story.";

  return {
    rawPrompt: `${rawPrompt.trim()}${variantSuffix}`,
    selectedDuration,
    selectedAspectRatio,
    selectedBrandEndingMode:
      plan?.brandPackaging?.mode ??
      (brandKit ? "auto_end_card" : "auto_end_card"),
    cta:
      (typeof brandKit?.ctaText === "string" && brandKit.ctaText) ||
      (typeof input?.cta === "string" && input.cta) ||
      "Tap to shop",
    brandName:
      (typeof brandKit?.brandName === "string" && brandKit.brandName) ||
      "",
    website:
      (typeof brandKit?.websiteUrl === "string" && brandKit.websiteUrl) ||
      (typeof brandKit?.website === "string" && brandKit.website) ||
      "",
    sourceTitle: order.title,
  };
}
