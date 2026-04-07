export type {
  Project,
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

export interface ProjectWithRelations {
  id: string;
  keyword: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
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
  DRAFT: "bg-zinc-100 text-zinc-600",
  CONTENT_GENERATED: "bg-violet-50 text-violet-600",
  VIDEO_GENERATING: "bg-amber-50 text-amber-600",
  VIDEO_FAILED: "bg-red-50 text-red-600",
  VIDEO_READY: "bg-emerald-50 text-emerald-600",
  PUBLISHING: "bg-amber-50 text-amber-600",
  PUBLISH_FAILED: "bg-red-50 text-red-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  ANALYTICS_PENDING: "bg-sky-50 text-sky-600",
  ANALYTICS_FETCHED: "bg-sky-50 text-sky-600",
  ANALYZED: "bg-violet-50 text-violet-600",
};
