/**
 * 即梦 / Seedance 视频生成 Provider
 *
 * Mock 模式：无 ARK_API_KEY 时模拟异步视频生成
 * Real 模式：调用火山方舟 Ark Seedance API
 *
 * API 文档: https://www.volcengine.com/docs/82379/1520757
 * 端点: POST /contents/generations/tasks  (提交)
 *       GET  /contents/generations/tasks/{id} (查询)
 */

export interface VideoGenerationOptions {
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
  const model =
    process.env.ARK_VIDEO_MODEL || "doubao-seedance-1-5-pro-251215";

  if (!apiKey) throw new Error("ARK_API_KEY 未配置");

  const body = {
    model,
    content: [
      {
        type: "text",
        text: options.prompt,
      },
    ],
    resolution: options.resolution || "720p",
    ratio: options.ratio || "9:16",
    duration: options.duration || 5,
    watermark: false,
  };

  console.log(`[jimeng:real] 提交视频生成任务, model=${model}, prompt=${options.prompt.slice(0, 80)}...`);

  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[jimeng:real] 提交失败: ${res.status}`, err);
    throw new Error(`即梦 API 提交失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  const jobId = data.id || data.task_id;
  console.log(`[jimeng:real] 任务已提交: ${jobId}`);

  return { jobId };
}

async function getStatusReal(jobId: string): Promise<VideoJobResult> {
  const apiKey = process.env.ARK_API_KEY;
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

  if (!apiKey) throw new Error("ARK_API_KEY 未配置");

  const res = await fetch(`${baseUrl}/contents/generations/tasks/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[jimeng:real] 查询失败: ${res.status}`, err);
    throw new Error(`即梦 API 查询失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  console.log(`[jimeng:real] 任务 ${jobId} 状态: ${data.status}`);

  const statusMap: Record<string, VideoJobResult["status"]> = {
    queued: "pending",
    running: "processing",
    succeeded: "completed",
    failed: "failed",
    expired: "failed",
    cancelled: "failed",
  };

  const videoUrl = data.content?.video_url || data.video_url;

  return {
    jobId,
    status: statusMap[data.status] || "processing",
    videoUrl,
    thumbnailUrl: data.content?.cover_url || data.thumbnail_url,
    errorMessage:
      data.status === "failed"
        ? data.error?.message || "视频生成失败"
        : data.status === "expired"
          ? "任务已过期"
          : undefined,
  };
}
