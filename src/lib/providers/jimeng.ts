/**
 * 即梦 / Seedance 视频生成 Provider
 *
 * Mock 模式：模拟异步视频生成流程（提交 → 处理中 → 完成）
 * Real 模式：调用火山方舟 Ark Seedance API（待接入 ARK_API_KEY 后启用）
 */

export interface VideoGenerationOptions {
  prompt: string;
  duration?: number;
  resolution?: string;
}

export interface VideoJobResult {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  progress?: number;
}

const mockJobs = new Map<
  string,
  { status: string; createdAt: number; prompt: string }
>();

const MOCK_PROCESSING_TIME_MS = 15_000;

function isMockMode(): boolean {
  return !process.env.ARK_API_KEY;
}

export async function submitVideoGeneration(
  options: VideoGenerationOptions
): Promise<{ jobId: string }> {
  if (isMockMode()) {
    return submitMock(options);
  }
  return submitReal(options);
}

export async function getVideoJobStatus(
  jobId: string
): Promise<VideoJobResult> {
  if (isMockMode()) {
    return getStatusMock(jobId);
  }
  return getStatusReal(jobId);
}

// ============================================================
// Mock 实现
// ============================================================

function submitMock(options: VideoGenerationOptions): { jobId: string } {
  const jobId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  mockJobs.set(jobId, {
    status: "processing",
    createdAt: Date.now(),
    prompt: options.prompt,
  });
  console.log(`[jimeng:mock] 视频生成任务已提交: ${jobId}`);
  return { jobId };
}

function getStatusMock(jobId: string): VideoJobResult {
  const job = mockJobs.get(jobId);

  if (!job) {
    return { jobId, status: "failed", errorMessage: "任务不存在" };
  }

  const elapsed = Date.now() - job.createdAt;

  if (elapsed < MOCK_PROCESSING_TIME_MS) {
    const progress = Math.min(
      95,
      Math.floor((elapsed / MOCK_PROCESSING_TIME_MS) * 100)
    );
    return { jobId, status: "processing", progress };
  }

  mockJobs.delete(jobId);
  return {
    jobId,
    status: "completed",
    videoUrl: `https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4`,
    thumbnailUrl: `https://picsum.photos/seed/${jobId}/400/720`,
    progress: 100,
  };
}

// ============================================================
// 真实 API 实现（火山方舟 Ark Seedance）
// ============================================================

async function submitReal(
  options: VideoGenerationOptions
): Promise<{ jobId: string }> {
  const apiKey = process.env.ARK_API_KEY;
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = process.env.ARK_VIDEO_MODEL || "doubao-seedance-1-5-pro-251215";

  if (!apiKey) throw new Error("ARK_API_KEY 未配置");

  const res = await fetch(`${baseUrl}/video/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      duration: options.duration || 5,
      resolution: options.resolution || "720p",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`即梦 API 提交失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { jobId: data.id || data.task_id };
}

async function getStatusReal(jobId: string): Promise<VideoJobResult> {
  const apiKey = process.env.ARK_API_KEY;
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

  if (!apiKey) throw new Error("ARK_API_KEY 未配置");

  const res = await fetch(`${baseUrl}/video/generations/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`即梦 API 查询失败: ${res.status} ${err}`);
  }

  const data = await res.json();

  const statusMap: Record<string, VideoJobResult["status"]> = {
    pending: "pending",
    running: "processing",
    processing: "processing",
    succeeded: "completed",
    completed: "completed",
    failed: "failed",
  };

  return {
    jobId,
    status: statusMap[data.status] || "processing",
    videoUrl: data.video_url || data.output?.video_url,
    thumbnailUrl: data.thumbnail_url || data.output?.cover_url,
    errorMessage: data.error?.message,
  };
}
