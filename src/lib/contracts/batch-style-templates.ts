import { z } from "zod";
import { customerApiErrorSchema } from "@/lib/contracts/customer-api";

export const batchStyleLockedParamsSchema = z
  .object({
    duration: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
    resolution: z.enum(["720p", "1080p"]),
    cameraStyle: z.string().min(3).max(200),
    stability: z.enum(["high", "balanced"]).default("balanced"),
    humanInteraction: z
      .enum(["none", "controlled"])
      .default("controlled"),
  })
  .strict();

export const batchStyleImagesPerVideoSchema = z
  .object({
    min: z.number().int().min(1).max(9),
    max: z.number().int().min(1).max(9),
  })
  .strict()
  .refine((value) => value.min <= value.max, {
    message: "imagesPerVideo.min cannot exceed max",
  });

export const batchStyleTemplateDtoSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    nameZh: z.string().min(1),
    category: z.string().min(1),
    coverImage: z.string().min(1),
    sampleImage: z.string().min(1).nullable(),
    promptSkeleton: z.string().min(1),
    negativePrompt: z.string().min(1),
    lockedParams: batchStyleLockedParamsSchema,
    imagesPerVideo: batchStyleImagesPerVideoSchema,
  })
  .strict();

export const batchStyleTemplatesSuccessSchema = z
  .object({
    ok: z.literal(true),
    templates: z.array(batchStyleTemplateDtoSchema),
  })
  .strict();

export const batchStyleTemplatesResponseSchema = z.union([
  batchStyleTemplatesSuccessSchema,
  customerApiErrorSchema,
]);

export type BatchStyleTemplateDto = z.infer<
  typeof batchStyleTemplateDtoSchema
>;

interface StyleTemplateRecord {
  id: string;
  slug: string;
  version: number;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  promptSkeleton: string;
  negativePrompt: string;
  lockedParams: unknown;
  imagesPerVideo: unknown;
}

export function batchStyleTemplateDto(
  template: StyleTemplateRecord,
  sampleImage: string | null,
): BatchStyleTemplateDto {
  return batchStyleTemplateDtoSchema.parse({
    id: template.id,
    slug: template.slug,
    version: template.version,
    name: template.name,
    nameZh: template.nameZh,
    category: template.category,
    coverImage: template.coverImage,
    sampleImage,
    promptSkeleton: template.promptSkeleton,
    negativePrompt: template.negativePrompt,
    lockedParams: template.lockedParams,
    imagesPerVideo: template.imagesPerVideo,
  });
}
