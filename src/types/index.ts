export type {
  Project,
  ProductCatalog,
  ContentPlan,
  VideoJob,
} from "@prisma/client";

export {
  ProjectStatus,
  VideoJobStatus,
} from "@prisma/client";

export interface ContentAngle {
  angle: string;
  reason: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ThumbnailVisualAnalysis {
  colorPalette: string;
  lightingStyle: string;
  sceneType: string;
  overallMood: string;
  productPresentation: string;
  suggestedVideoStyle: string;
}

export interface ProjectWithRelations {
  id: string;
  keyword: string;
  category: string | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  productId: string | null;
  imageUrls: string[];
  primaryImageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    productLine: string;
    color: string;
    description: string;
    features: string[];
  } | null;
  contentPlan: {
    id: string;
    script: string;
    videoPrompt: string;
    videoPromptPart2: string | null;
    caption: string;
    hashtags: string[];
    contentAngles: ContentAngle[];
    modelUsed: string;
    createdAt: Date;
  } | null;
  videoJob: {
    id: string;
    provider: string;
    providerJobId: string | null;
    status: string;
    videoUrl: string | null;
    videoUrl2: string | null;
    stitchedVideoUrl: string | null;
    thumbnailUrl: string | null;
    duration: number;
    resolution: string;
    ratio: string;
    segment: number | null;
    errorMessage: string | null;
    retryCount: number;
    createdAt: Date;
    completedAt: Date | null;
    channel: string;
    variants: unknown;
    selectedVariant: number;
    manifest: unknown;
  } | null;
}

export interface ProductVisualAnalysis {
  productAppearance: string;
  colorsAndMaterials: string;
  brandElements: string;
  suggestedAngles: string;
  visualHighlights: string;
}

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CONTENT_GENERATED: "内容已生成",
  VIDEO_GENERATING: "视频生成中",
  VIDEO_FAILED: "视频生成失败",
  VIDEO_READY: "视频已就绪",
  DONE: "已完成",
};

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-800/60 text-zinc-400",
  CONTENT_GENERATED: "bg-sky-500/15 text-sky-400",
  VIDEO_GENERATING: "bg-amber-500/15 text-amber-400",
  VIDEO_FAILED: "bg-red-500/15 text-red-400",
  VIDEO_READY: "bg-emerald-500/15 text-emerald-400",
  DONE: "bg-emerald-500/15 text-emerald-400",
};
