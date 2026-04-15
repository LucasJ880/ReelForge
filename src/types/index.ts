export type {
  Project,
  ProductCatalog,
  TrendReference,
  SearchKeyword,
  ContentPlan,
  VideoJob,
  Publication,
  AnalyticsSnapshot,
  AnalysisReport,
  TikTokAccount,
} from "@prisma/client";

export {
  ProjectStatus,
  VideoJobStatus,
  PublishStatus,
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

export interface ViralStyleAnalysis {
  narrativeStyle: string;
  emotionalTone: string;
  hookStrategy: string;
  contentStructure: string;
  visualStyle: string;
  cameraWork?: string;
  hookType?: string;
  successFactors?: string[];
}

export interface ThumbnailVisualAnalysis {
  colorPalette: string;
  lightingStyle: string;
  sceneType: string;
  overallMood: string;
  productPresentation: string;
  suggestedVideoStyle: string;
}

export interface TrendReferenceInfo {
  id: string;
  sourceUrl: string | null;
  platform: string;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  duration: number | null;
  styleAnalysis: ViralStyleAnalysis | null;
  visualAnalysis: ThumbnailVisualAnalysis | null;
}

export interface ProjectWithRelations {
  id: string;
  keyword: string;
  category: string | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  productId: string | null;
  trendRefId: string | null;
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
  trendRef: TrendReferenceInfo | null;
  contentPlan: {
    id: string;
    script: string;
    videoPrompt: string;
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
    thumbnailUrl: string | null;
    duration: number;
    resolution: string;
    ratio: string;
    errorMessage: string | null;
    retryCount: number;
    createdAt: Date;
    completedAt: Date | null;
  } | null;
  publication: {
    id: string;
    platform: string;
    platformVideoId: string | null;
    publishStatus: string;
    publishedAt: Date | null;
    errorMessage: string | null;
    snapshots: {
      id: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      fetchedAt: Date;
    }[];
  } | null;
  analysisReport: {
    id: string;
    performanceSummary: string;
    directionAdvice: string;
    optimizationTips: string[];
    overallScore: number | null;
    modelUsed: string;
    createdAt: Date;
  } | null;
}

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  CONTENT_GENERATED: "内容已生成",
  VIDEO_GENERATING: "视频生成中",
  VIDEO_FAILED: "视频生成失败",
  VIDEO_READY: "视频已就绪",
  PUBLISHING: "发布中",
  PUBLISH_FAILED: "发布失败",
  PUBLISHED: "已发布",
  ANALYTICS_PENDING: "等待数据",
  ANALYTICS_FETCHED: "数据已拉取",
  ANALYZED: "分析完成",
};

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-800/60 text-zinc-400",
  CONTENT_GENERATED: "bg-violet-500/15 text-violet-400",
  VIDEO_GENERATING: "bg-amber-500/15 text-amber-400",
  VIDEO_FAILED: "bg-red-500/15 text-red-400",
  VIDEO_READY: "bg-emerald-500/15 text-emerald-400",
  PUBLISHING: "bg-amber-500/15 text-amber-400",
  PUBLISH_FAILED: "bg-red-500/15 text-red-400",
  PUBLISHED: "bg-emerald-500/15 text-emerald-400",
  ANALYTICS_PENDING: "bg-sky-500/15 text-sky-400",
  ANALYTICS_FETCHED: "bg-sky-500/15 text-sky-400",
  ANALYZED: "bg-violet-500/15 text-violet-400",
};
