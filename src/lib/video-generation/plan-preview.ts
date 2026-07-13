/**
 * Phase 5 — Plan preview.
 *
 * 把 VideoGenerationPlan 渲染成一句人类可读的话 + 结构化 breakdown，
 * 给 UI 直接展示。
 *
 * 例子：
 *   "Aivora will create 2 AI-generated product clips, insert 1 uploaded store clip,
 *    and append a 3s branded end card. Final output: 30s vertical ad."
 */

import type {
  AssemblyPlan,
  BrandPackagingPlan,
  PlanPreview,
  VideoSegment,
  AspectRatio,
} from "@/types/video-generation";

export interface BuildPlanPreviewArgs {
  segments: VideoSegment[];
  brandPackaging: BrandPackagingPlan;
  assemblyPlan: AssemblyPlan;
  aspectRatio: AspectRatio;
  userType: "business" | "personal" | "platform";
}

export function buildPlanPreview(args: BuildPlanPreviewArgs): PlanPreview {
  const { segments, brandPackaging, assemblyPlan, aspectRatio, userType } = args;

  const aiClipCount = segments.filter((s) => s.type === "ai_generated_clip").length;
  const uploadedClipCount = segments.filter((s) => s.type === "uploaded_clip").length;
  const hasBrandEndCard =
    brandPackaging.mode !== "none" && brandPackaging.endCardDurationSeconds > 0;
  const finalDurationSec = Math.round(assemblyPlan.finalDurationSeconds);

  const summary = renderSummary({
    aiClipCount,
    uploadedClipCount,
    hasBrandEndCard,
    endCardSec: brandPackaging.endCardDurationSeconds,
    finalDurationSec,
    aspectRatio,
    userType,
  });

  return {
    summary,
    breakdown: {
      aiClipCount,
      uploadedClipCount,
      hasBrandEndCard,
      finalDurationSec,
      aspectRatio,
    },
  };
}

function renderSummary(args: {
  aiClipCount: number;
  uploadedClipCount: number;
  hasBrandEndCard: boolean;
  endCardSec: number;
  finalDurationSec: number;
  aspectRatio: AspectRatio;
  userType: "business" | "personal" | "platform";
}): string {
  const parts: string[] = [];

  if (args.aiClipCount > 0) {
    parts.push(
      `${args.aiClipCount} AI-generated ${
        args.aiClipCount === 1 ? "clip" : "clips"
      }`,
    );
  }
  if (args.uploadedClipCount > 0) {
    parts.push(
      `${args.uploadedClipCount} uploaded ${
        args.uploadedClipCount === 1 ? "clip" : "clips"
      }`,
    );
  }
  if (args.hasBrandEndCard) {
    parts.push(
      `a ${args.endCardSec}s ${args.userType !== "personal" ? "branded" : ""} end card`.replace(
        / +/g,
        " ",
      ),
    );
  }

  const orientation = orientationLabel(args.aspectRatio);
  const audience =
    args.userType !== "personal" ? "ad" : "video";

  const pieceList =
    parts.length === 0
      ? "your final video"
      : parts.length === 1
        ? parts[0]
        : parts.length === 2
          ? `${parts[0]} and ${parts[1]}`
          : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;

  return `Aivora will assemble ${pieceList} into a ${args.finalDurationSec}s ${orientation} ${audience}.`;
}

function orientationLabel(ratio: AspectRatio): string {
  switch (ratio) {
    case "9:16":
      return "vertical";
    case "16:9":
      return "horizontal";
    case "1:1":
      return "square";
  }
}
