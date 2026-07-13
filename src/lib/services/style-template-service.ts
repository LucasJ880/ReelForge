import {
  Prisma,
  StyleTemplateStatus,
  type StyleTemplate,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  BATCH_STYLE_TEMPLATE_SEEDS,
  type BatchStyleImagesPerVideo,
  type BatchStyleLockedParams,
} from "@/lib/video-generation/batch-style-templates";

const lockedParamsSchema = z.object({
  duration: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  resolution: z.enum(["720p", "1080p"]),
  cameraStyle: z.string().min(3).max(200),
  stability: z.enum(["high", "balanced"]).default("balanced"),
  humanInteraction: z.enum(["none", "controlled"]).default("controlled"),
});

const imagesPerVideoSchema = z
  .object({
    min: z.number().int().min(1).max(9),
    max: z.number().int().min(1).max(9),
  })
  .refine((value) => value.min <= value.max, {
    message: "imagesPerVideo.min 不能大于 max",
  });

export interface StyleTemplateValues {
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  promptSkeleton: string;
  negativePrompt: string;
  lockedParams: BatchStyleLockedParams;
  imagesPerVideo: BatchStyleImagesPerVideo;
}

function validateValues(values: StyleTemplateValues): void {
  if (!values.promptSkeleton.includes("{IMAGE_REFS}")) {
    throw new Error("模板 promptSkeleton 必须包含 {IMAGE_REFS}");
  }
  if (!values.negativePrompt.trim()) {
    throw new Error("模板 negativePrompt 不能为空");
  }
  lockedParamsSchema.parse(values.lockedParams);
  imagesPerVideoSchema.parse(values.imagesPerVideo);
}

function json(value: object): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * 幂等 seed：只创建缺失的 v1 ACTIVE 模板，绝不 update 已存在 ACTIVE 行。
 * 因此重复 seed 也不会绕过「ACTIVE 不可变」约束。
 */
export async function seedBatchStyleTemplates(): Promise<number> {
  let created = 0;
  for (const template of BATCH_STYLE_TEMPLATE_SEEDS) {
    validateValues(template);
    created += await db.$transaction(async (tx) => {
      const existing = await tx.styleTemplate.findUnique({
        where: { slug_version: { slug: template.slug, version: template.version } },
        select: { id: true },
      });
      if (existing) return 0;
      await tx.styleTemplate.updateMany({
        where: { slug: template.slug, status: StyleTemplateStatus.ACTIVE },
        data: { status: StyleTemplateStatus.ARCHIVED },
      });
      await tx.styleTemplate.create({
        data: {
          ...template,
          lockedParams: json(template.lockedParams),
          imagesPerVideo: json(template.imagesPerVideo),
          status: StyleTemplateStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
      return 1;
    });
  }
  return created;
}

export async function listActiveStyleTemplates(): Promise<StyleTemplate[]> {
  return db.styleTemplate.findMany({
    where: { status: StyleTemplateStatus.ACTIVE },
    orderBy: [{ category: "asc" }, { nameZh: "asc" }],
  });
}

export async function getExactStyleTemplate(args: {
  id: string;
  version: number;
}): Promise<StyleTemplate> {
  const template = await db.styleTemplate.findFirst({
    where: { id: args.id, version: args.version },
  });
  if (!template) throw new Error("风格模板或指定版本不存在");
  return template;
}

export async function updateStyleTemplateDraft(
  id: string,
  values: StyleTemplateValues,
): Promise<StyleTemplate> {
  validateValues(values);
  const existing = await db.styleTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("风格模板不存在");
  if (existing.status === StyleTemplateStatus.ACTIVE) {
    throw new Error("ACTIVE_TEMPLATE_IMMUTABLE: 已发布模板不可原地修改，请创建新版本");
  }
  return db.styleTemplate.update({
    where: { id },
    data: {
      ...values,
      lockedParams: json(values.lockedParams),
      imagesPerVideo: json(values.imagesPerVideo),
    },
  });
}

export async function activateStyleTemplate(id: string): Promise<StyleTemplate> {
  const existing = await db.styleTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("风格模板不存在");
  if (existing.status === StyleTemplateStatus.ACTIVE) return existing;
  validateValues({
    name: existing.name,
    nameZh: existing.nameZh,
    category: existing.category,
    coverImage: existing.coverImage,
    promptSkeleton: existing.promptSkeleton,
    negativePrompt: existing.negativePrompt,
    lockedParams: lockedParamsSchema.parse(existing.lockedParams),
    imagesPerVideo: imagesPerVideoSchema.parse(existing.imagesPerVideo),
  });
  return db.$transaction(async (tx) => {
    await tx.styleTemplate.updateMany({
      where: {
        slug: existing.slug,
        status: StyleTemplateStatus.ACTIVE,
        id: { not: existing.id },
      },
      data: { status: StyleTemplateStatus.ARCHIVED },
    });
    return tx.styleTemplate.update({
      where: { id },
      data: {
        status: StyleTemplateStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });
  });
}

/**
 * 从任意旧版本创建下一版 DRAFT。旧行保持完全不变，批次 FK 因而可永久溯源。
 */
export async function createStyleTemplateVersion(
  sourceId: string,
  overrides: Partial<StyleTemplateValues> = {},
): Promise<StyleTemplate> {
  const source = await db.styleTemplate.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error("源风格模板不存在");

  const latest = await db.styleTemplate.findFirst({
    where: { slug: source.slug },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const values: StyleTemplateValues = {
    name: overrides.name ?? source.name,
    nameZh: overrides.nameZh ?? source.nameZh,
    category: overrides.category ?? source.category,
    coverImage: overrides.coverImage ?? source.coverImage,
    promptSkeleton: overrides.promptSkeleton ?? source.promptSkeleton,
    negativePrompt: overrides.negativePrompt ?? source.negativePrompt,
    lockedParams:
      overrides.lockedParams ??
      lockedParamsSchema.parse(source.lockedParams),
    imagesPerVideo:
      overrides.imagesPerVideo ??
      imagesPerVideoSchema.parse(source.imagesPerVideo),
  };
  validateValues(values);

  return db.styleTemplate.create({
    data: {
      slug: source.slug,
      version: (latest?.version ?? source.version) + 1,
      ...values,
      lockedParams: json(values.lockedParams),
      imagesPerVideo: json(values.imagesPerVideo),
      status: StyleTemplateStatus.DRAFT,
    },
  });
}

export const __test__ = {
  lockedParamsSchema,
  imagesPerVideoSchema,
  validateValues,
};
