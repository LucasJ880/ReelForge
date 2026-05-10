import { notFound } from "next/navigation";
import { getClientProject } from "@/lib/services/client-project-service";
import {
  listWizardAssetsWithMissingReport,
} from "@/lib/services/wizard-asset-service";
import { UploadStepClient } from "./upload-step-client";

export default async function WizardStep5Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const project = await getClientProject(orderId);
  if (!project || !project.brief) notFound();

  const { assets, missingReport } = await listWizardAssetsWithMissingReport(
    orderId,
  );
  const shotChoices = missingReport.shots.map((s) => ({
    id: s.scenePlanId,
    label: `Shot ${s.sceneIndex} · ${s.visualIntent.slice(0, 40)}`,
    matched: s.matched,
    required: s.required,
  }));

  /// Server 端探测 Vercel Blob 是否就绪：传给 client 决定默认 tab，且不暴露 token
  const blobReady = !!process.env.BLOB_READ_WRITE_TOKEN;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          Step 5 · 上传素材 + AI QA
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          支持两种方式：直接上传 ≤100MB 的视频/图片，或粘贴公网 URL（Cloudinary / S3 / Drive）。
          直传不可用时会自动切换到 URL 模式，wizard 不会卡住。
        </p>
      </header>
      <UploadStepClient
        orderId={orderId}
        initialAssets={assets}
        initialMissingReport={missingReport}
        shotChoices={shotChoices}
        blobReady={blobReady}
      />
    </div>
  );
}
