import { db } from "@/lib/db";
import { ProjectStatus, PublishStatus } from "@prisma/client";
import { fetchVideoMetrics, isMockMode } from "@/lib/providers/tiktok";
import { getActiveTikTokAccount } from "@/lib/providers/tiktok-auth";

/**
 * 拉取所有已发布项目的 TikTok 数据（幂等）
 */
export async function fetchAllPendingAnalytics(batchSize = 10) {
  const publications = await db.publication.findMany({
    where: {
      publishStatus: PublishStatus.PUBLISHED,
      project: {
        status: {
          in: [ProjectStatus.PUBLISHED, ProjectStatus.ANALYTICS_PENDING],
        },
      },
    },
    include: { project: true },
    take: batchSize,
    orderBy: { publishedAt: "asc" },
  });

  const results = [];

  for (const pub of publications) {
    try {
      const result = await fetchAnalyticsForPublication(pub.id);
      results.push({ publicationId: pub.id, success: true, result });
    } catch (error) {
      results.push({
        publicationId: pub.id,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}

/**
 * 为单个项目拉取数据
 */
export async function fetchAnalyticsForProject(projectId: string) {
  const publication = await db.publication.findUnique({
    where: { projectId },
    include: { project: true },
  });

  if (!publication) throw new Error("项目未发布");
  if (publication.publishStatus !== PublishStatus.PUBLISHED) {
    throw new Error("项目未成功发布");
  }

  return fetchAnalyticsForPublication(publication.id);
}

async function fetchAnalyticsForPublication(publicationId: string) {
  const publication = await db.publication.findUnique({
    where: { id: publicationId },
    include: { project: true, snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });

  if (!publication) throw new Error("发布记录不存在");

  let accessToken = "mock_token";

  if (!isMockMode()) {
    const account = await getActiveTikTokAccount();
    if (!account) {
      throw new Error("未绑定 TikTok 账号，无法拉取数据");
    }
    accessToken = account.accessToken;
  }

  const metrics = await fetchVideoMetrics(
    publication.platformVideoId || "",
    accessToken
  );

  const snapshot = await db.analyticsSnapshot.create({
    data: {
      publicationId: publication.id,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
    },
  });

  await db.project.update({
    where: { id: publication.projectId },
    data: { status: ProjectStatus.ANALYTICS_FETCHED },
  });

  return snapshot;
}
