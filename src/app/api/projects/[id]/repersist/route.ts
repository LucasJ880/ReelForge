import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";
import { persistRemoteVideo, persistRemoteImage } from "@/lib/utils/persist-video";

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    include: { videoJob: true },
  });

  if (!project?.videoJob) {
    return NextResponse.json({ error: "没有视频任务" }, { status: 404 });
  }

  const vj = project.videoJob;
  const updates: Partial<typeof vj> = {};
  const errors: string[] = [];

  if (vj.videoUrl) {
    try {
      const persisted = await persistRemoteVideo(vj.videoUrl, `videos/${id}-part1-migrate`);
      if (persisted !== vj.videoUrl) updates.videoUrl = persisted;
    } catch (e) {
      errors.push(`part1: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (vj.videoUrl2) {
    try {
      const persisted = await persistRemoteVideo(vj.videoUrl2, `videos/${id}-part2-migrate`);
      if (persisted !== vj.videoUrl2) updates.videoUrl2 = persisted;
    } catch (e) {
      errors.push(`part2: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (vj.thumbnailUrl) {
    try {
      const persisted = await persistRemoteImage(vj.thumbnailUrl, `thumbs/${id}-migrate`);
      if (persisted !== vj.thumbnailUrl) updates.thumbnailUrl = persisted;
    } catch (e) {
      errors.push(`thumb: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.videoJob.update({ where: { id: vj.id }, data: updates });
  }

  return NextResponse.json({
    migrated: Object.keys(updates),
    errors,
    videoJob: { ...vj, ...updates },
  });
}
