import { db } from "@/lib/db";
import { ProjectStatus, PublishStatus } from "@prisma/client";
import { publishVideo } from "@/lib/providers/tiktok";

export async function publishToTikTok(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { videoJob: true, contentPlan: true, publication: true },
  });

  if (!project) throw new Error("项目不存在");
  if (!project.videoJob?.videoUrl) throw new Error("没有可用的视频");
  if (!project.contentPlan) throw new Error("缺少内容方案");

  if (
    project.status !== ProjectStatus.VIDEO_READY &&
    project.status !== ProjectStatus.PUBLISH_FAILED
  ) {
    throw new Error(`当前状态 ${project.status} 不允许发布`);
  }

  await db.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.PUBLISHING, errorMessage: null },
  });

  try {
    const caption = [
      project.contentPlan.caption,
      ...project.contentPlan.hashtags.map((t) =>
        t.startsWith("#") ? t : `#${t}`
      ),
    ].join(" ");

    const result = await publishVideo({
      videoUrl: project.videoJob.videoUrl,
      caption,
      accessToken: "mock_token",
      openId: "mock_open_id",
    });

    if (result.status === "failed") {
      await db.project.update({
        where: { id: projectId },
        data: {
          status: ProjectStatus.PUBLISH_FAILED,
          errorMessage: result.errorMessage || "发布失败",
        },
      });

      if (project.publication) {
        await db.publication.update({
          where: { projectId },
          data: {
            publishStatus: PublishStatus.FAILED,
            errorMessage: result.errorMessage,
          },
        });
      }

      throw new Error(result.errorMessage || "发布失败");
    }

    const pubData = {
      platform: "tiktok",
      platformVideoId: result.platformVideoId || null,
      publishStatus: result.status === "published"
        ? PublishStatus.PUBLISHED
        : PublishStatus.PENDING,
      publishedAt: result.status === "published" ? new Date() : null,
      errorMessage: null,
    };

    if (project.publication) {
      await db.publication.update({
        where: { projectId },
        data: pubData,
      });
    } else {
      await db.publication.create({
        data: { projectId, ...pubData },
      });
    }

    const newStatus =
      result.status === "published"
        ? ProjectStatus.PUBLISHED
        : ProjectStatus.PUBLISHING;

    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === ProjectStatus.PUBLISHED) {
      updateData.status = ProjectStatus.ANALYTICS_PENDING;
    }

    await db.project.update({
      where: { id: projectId },
      data: updateData,
    });

    return result;
  } catch (error) {
    if ((error as Error).message?.includes("发布失败")) throw error;

    await db.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.PUBLISH_FAILED,
        errorMessage: (error as Error).message,
      },
    });
    throw error;
  }
}
