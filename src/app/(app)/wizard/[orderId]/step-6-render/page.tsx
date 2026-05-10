import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import { db } from "@/lib/db";
import {
  isFfmpegAvailable,
} from "@/lib/services/wizard-render-service";
import { RenderStepClient } from "./render-step-client";

export default async function WizardStep6Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const [recentJobs, ffmpegOk] = await Promise.all([
    db.wizardRenderJob.findMany({
      where: { deliveryOrderId: orderId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    isFfmpegAvailable(),
  ]);

  const realModeOn =
    process.env.ENABLE_WIZARD_FFMPEG_RENDER === "true" && ffmpegOk;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          Step 6 · 生成 Draft 渲染
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Phase 2 默认走 Draft / Mock 模式，UI 会清楚标注当前预览类型；不会让 FFmpeg/Blob 阻塞向导。
        </p>
      </header>
      <RenderStepClient
        orderId={orderId}
        initialJobs={recentJobs}
        realModeOn={realModeOn}
        ffmpegOk={ffmpegOk}
      />
    </div>
  );
}
