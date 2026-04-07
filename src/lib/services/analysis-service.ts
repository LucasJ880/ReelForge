import { db } from "@/lib/db";
import { ProjectStatus } from "@prisma/client";
import { generateAnalysis } from "@/lib/providers/openai";

export async function generateAnalysisReport(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      contentPlan: true,
      publication: {
        include: {
          snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
        },
      },
      analysisReport: true,
    },
  });

  if (!project) throw new Error("项目不存在");
  if (!project.contentPlan) throw new Error("缺少内容方案");
  if (!project.publication) throw new Error("项目未发布");

  const latestSnapshot = project.publication.snapshots[0];
  if (!latestSnapshot) throw new Error("暂无数据，请先拉取 TikTok 数据");

  if (
    project.status !== ProjectStatus.ANALYTICS_FETCHED &&
    project.status !== ProjectStatus.ANALYZED
  ) {
    throw new Error(`当前状态 ${project.status} 不允许生成分析`);
  }

  const result = await generateAnalysis({
    keyword: project.keyword,
    script: project.contentPlan.script,
    caption: project.contentPlan.caption,
    metrics: {
      views: latestSnapshot.views,
      likes: latestSnapshot.likes,
      comments: latestSnapshot.comments,
      shares: latestSnapshot.shares,
    },
  });

  const reportData = {
    performanceSummary: result.performanceSummary,
    directionAdvice: result.directionAdvice,
    optimizationTips: result.optimizationTips,
    overallScore: result.overallScore,
    modelUsed: result.modelUsed,
    tokenUsage: result.tokenUsage as Record<string, number>,
  };

  let report;
  if (project.analysisReport) {
    report = await db.analysisReport.update({
      where: { projectId },
      data: reportData,
    });
  } else {
    report = await db.analysisReport.create({
      data: { projectId, ...reportData },
    });
  }

  await db.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.ANALYZED },
  });

  return report;
}
