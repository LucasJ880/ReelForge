import { del } from "@vercel/blob";
import { db } from "@/lib/db";

/**
 * 判断 URL 是否由我们自己存储在 Vercel Blob 上
 * （只有自己存的才删，外链的绝不删）
 */
function isOwnedBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.includes(".public.blob.vercel-storage.com") ||
    url.includes(".blob.vercel-storage.com")
  );
}

/**
 * 收集一个项目关联的所有 Blob URL
 */
export async function collectProjectBlobUrls(projectId: string): Promise<string[]> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      videoJob: {
        select: {
          videoUrl: true,
          videoUrl2: true,
          stitchedVideoUrl: true,
          thumbnailUrl: true,
        },
      },
    },
  });

  if (!project) return [];

  const urls: string[] = [];

  if (project.primaryImageUrl) urls.push(project.primaryImageUrl);
  for (const u of project.imageUrls ?? []) urls.push(u);

  const vj = project.videoJob;
  if (vj?.videoUrl) urls.push(vj.videoUrl);
  if (vj?.videoUrl2) urls.push(vj.videoUrl2);
  if (vj?.stitchedVideoUrl) urls.push(vj.stitchedVideoUrl);
  if (vj?.thumbnailUrl) urls.push(vj.thumbnailUrl);

  return urls.filter(isOwnedBlobUrl);
}

/**
 * 批量删除 Blob（带容错，不让一条失败挡住整体）
 */
export async function deleteBlobsSafe(urls: string[]): Promise<{
  deleted: number;
  failed: number;
  errors: string[];
}> {
  if (urls.length === 0) return { deleted: 0, failed: 0, errors: [] };

  const errors: string[] = [];
  let deleted = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    urls.map((u) => del(u)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      deleted++;
    } else {
      failed++;
      errors.push(`${urls[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  }

  return { deleted, failed, errors };
}

/**
 * 删除单个项目（包含 Blob 清理 + DB 级联）
 */
export async function deleteProjectWithAssets(projectId: string): Promise<{
  blobsDeleted: number;
  blobsFailed: number;
}> {
  const urls = await collectProjectBlobUrls(projectId);
  const { deleted, failed } = await deleteBlobsSafe(urls);

  await db.project.delete({ where: { id: projectId } }).catch((err) => {
    console.warn(`[project-service] DB delete failed for ${projectId}:`, err);
  });

  return { blobsDeleted: deleted, blobsFailed: failed };
}

/**
 * 批量删除项目
 * - ids: 显式指定要删的项目 ID 列表
 * - includeExpiredDays: 可选，同时删掉 DONE 状态且超过 N 天的项目
 */
export async function bulkDeleteProjects(input: {
  ids?: string[];
  includeExpiredDays?: number;
}): Promise<{
  projectCount: number;
  blobsDeleted: number;
  blobsFailed: number;
  ids: string[];
}> {
  const ids = new Set<string>();

  if (input.ids) {
    for (const id of input.ids) ids.add(id);
  }

  if (input.includeExpiredDays && input.includeExpiredDays > 0) {
    const cutoff = new Date(Date.now() - input.includeExpiredDays * 24 * 60 * 60 * 1000);
    const expired = await db.project.findMany({
      where: {
        status: "DONE",
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });
    for (const e of expired) ids.add(e.id);
  }

  if (ids.size === 0) {
    return { projectCount: 0, blobsDeleted: 0, blobsFailed: 0, ids: [] };
  }

  const idList = Array.from(ids);

  const allUrls: string[] = [];
  for (const id of idList) {
    allUrls.push(...(await collectProjectBlobUrls(id)));
  }
  const { deleted, failed } = await deleteBlobsSafe(allUrls);

  const deleteResult = await db.project.deleteMany({
    where: { id: { in: idList } },
  });

  return {
    projectCount: deleteResult.count,
    blobsDeleted: deleted,
    blobsFailed: failed,
    ids: idList,
  };
}

/**
 * 统计候选"过期"项目数量（给前端预览用）
 */
export async function countExpiredProjects(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.project.count({
    where: {
      status: "DONE",
      updatedAt: { lt: cutoff },
    },
  });
}
