import { db } from "@/lib/db";
import { generateContent, type ProductContext } from "@/lib/providers/openai";
import { Prisma, ProjectStatus } from "@prisma/client";

export async function generateContentPlan(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { contentPlan: true, product: true },
  });

  if (!project) throw new Error("项目不存在");

  if (
    project.status !== ProjectStatus.DRAFT &&
    project.status !== ProjectStatus.CONTENT_GENERATED
  ) {
    throw new Error(`当前状态 ${project.status} 不允许生成内容`);
  }

  let productContext: ProductContext | undefined;
  if (project.product) {
    const sizes = project.product.sizes as Array<{ name: string; dimensions: string }>;
    productContext = {
      name: project.product.name,
      productLine: project.product.productLine,
      color: project.product.color,
      description: project.product.description,
      features: project.product.features,
      sizes: sizes.map((s) => `${s.name} ${s.dimensions}`),
    };
  }

  const result = await generateContent({
    keyword: project.keyword,
    productContext,
  });

  if (project.contentPlan) {
    const updated = await db.contentPlan.update({
      where: { projectId },
      data: {
        script: result.script,
        videoPrompt: result.videoPrompt,
        caption: result.caption,
        hashtags: result.hashtags,
        contentAngles: result.contentAngles,
        modelUsed: result.modelUsed,
        tokenUsage: result.tokenUsage ?? Prisma.JsonNull,
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.CONTENT_GENERATED,
        category: result.category || undefined,
        errorMessage: null,
      },
    });

    return updated;
  }

  const [contentPlan] = await db.$transaction([
    db.contentPlan.create({
      data: {
        projectId,
        script: result.script,
        videoPrompt: result.videoPrompt,
        caption: result.caption,
        hashtags: result.hashtags,
        contentAngles: result.contentAngles,
        modelUsed: result.modelUsed,
        tokenUsage: result.tokenUsage ?? Prisma.JsonNull,
      },
    }),
    db.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.CONTENT_GENERATED,
        category: result.category || undefined,
        errorMessage: null,
      },
    }),
  ]);

  return contentPlan;
}

export async function updateContentPlan(
  projectId: string,
  data: {
    script?: string;
    caption?: string;
    hashtags?: string[];
    videoPrompt?: string;
  }
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { contentPlan: true },
  });

  if (!project) throw new Error("项目不存在");
  if (!project.contentPlan) throw new Error("尚未生成内容方案");

  return db.contentPlan.update({
    where: { projectId },
    data,
  });
}
