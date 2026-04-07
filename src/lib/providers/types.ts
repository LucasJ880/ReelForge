export interface VideoProvider {
  name: string;
  submit(options: VideoGenOptions): Promise<{ jobId: string }>;
  getStatus(jobId: string): Promise<VideoJobResult>;
}

export interface VideoGenOptions {
  prompt: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
}

export interface VideoJobResult {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  progress?: number;
}

export interface ContentProvider {
  name: string;
  generateContent(options: ContentGenOptions): Promise<ContentGenResult>;
  generateAnalysis(input: AnalysisInput): Promise<AnalysisResult>;
}

export interface ContentGenOptions {
  keyword: string;
}

export interface ContentGenResult {
  script: string;
  videoPrompt: string;
  caption: string;
  hashtags: string[];
  contentAngles: { angle: string; reason: string }[];
  modelUsed: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface AnalysisInput {
  keyword: string;
  script: string;
  caption: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
}

export interface AnalysisResult {
  summary: string;
  topicScore: string;
  suggestions: string[];
  shouldContinue: boolean;
  overallScore: number;
  modelUsed: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface PublishProvider {
  name: string;
  publish(options: PublishOptions): Promise<PublishResult>;
  fetchMetrics(videoId: string, accessToken: string): Promise<VideoMetrics>;
}

export interface PublishOptions {
  videoUrl: string;
  caption: string;
  accessToken: string;
  openId: string;
}

export interface PublishResult {
  status: "published" | "pending" | "failed";
  platformVideoId?: string;
  errorMessage?: string;
}

export interface VideoMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}
