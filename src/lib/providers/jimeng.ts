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
  referenceImageUrl?: string;
  firstFrameUrl?: string;
  /**
   * Brand Lock 软约束：指定视频"最后一帧"参考图，让模型尽量收束回这张图。
   * Seedance 2.0 支持 image_url + role="last_frame"。
   * 若 Pro 的主图传进来做首尾帧，可以帮助 logo 在开头和结尾都清晰出现。
   */
  lastFrameUrl?: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
  returnLastFrame?: boolean;
}

export interface VideoJobResult {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
  progress?: number;
}

const mockJobs = new Map<
  string,
  { status: string; createdAt: number; prompt: string }
>();

const MOCK_PROCESSING_TIME_MS = 15_000;

/**
 * Mock 模式触发条件（任一即启用 Mock）：
 *   1. 未配置 ARK_API_KEY
 *   2. VIDEO_ENGINE_MOCK=1 / true（即使有 API key 也走 Mock；用于预览/测试环境避免扣费）
 */
function isMockMode(): boolean {
  if (!process.env.ARK_API_KEY) return true;
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
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
    process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";

  if (!apiKey) throw new Error("ARK_API_KEY 未配置");

  const MAX_PROMPT_CHARS = 2000;
  const promptText = options.prompt.length > MAX_PROMPT_CHARS
    ? options.prompt.slice(0, MAX_PROMPT_CHARS).replace(/\s\S*$/, "")
    : options.prompt;

  const isSeedance2 = model.includes("seedance-2");

  // Seedance 2.0 支持多图 role（first_frame / last_frame）；旧模型只接受单图。
  type ImageSpec = { url: string; role?: "first_frame" | "last_frame" };
  type ContentPart =
    | { type: "image_url"; image_url: ImageSpec | string }
    | { type: "text"; text: string };
  const content: ContentPart[] = [];

  const primaryImage = options.firstFrameUrl || options.referenceImageUrl;
  if (primaryImage) {
    content.push({
      type: "image_url",
      image_url: isSeedance2
        ? { url: primaryImage, role: "first_frame" }
        : primaryImage,
    });
  }

  if (isSeedance2 && options.lastFrameUrl && options.lastFrameUrl !== primaryImage) {
    content.push({
      type: "image_url",
      image_url: { url: options.lastFrameUrl, role: "last_frame" },
    });
  }

  content.push({ type: "text", text: promptText });

  const body: Record<string, unknown> = {
    model,
    content,
    ratio: options.ratio || "9:16",
    duration: options.duration || 15,
    watermark: false,
  };

  if (isSeedance2) {
    body.generate_audio = true;
    if (options.returnLastFrame) {
      body.return_last_frame = true;
    }
  } else {
    body.resolution = options.resolution || "1080p";
  }

  console.log(`[jimeng:real] 提交视频生成任务, model=${model}, hasImage=${content.some(c => c.type === "image_url")}, prompt=${options.prompt.slice(0, 80)}...`);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  let res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok && content.some(c => c.type === "image_url")) {
    const errText = await res.text();
    console.warn(`[jimeng:real] 带图提交失败 (${res.status}), 降级为纯文本重试: ${errText.slice(0, 200)}`);
    const textOnlyContent = content.filter(c => c.type !== "image_url");
    const fallbackBody = { ...body, content: textOnlyContent };
    res = await fetch(`${baseUrl}/contents/generations/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(fallbackBody),
    });
  }

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
  const lastFrameUrl = data.content?.last_frame_url || data.last_frame_url;

  return {
    jobId,
    status: statusMap[data.status] || "processing",
    videoUrl,
    thumbnailUrl: data.content?.cover_url || data.thumbnail_url,
    lastFrameUrl,
    errorMessage:
      data.status === "failed"
        ? data.error?.message || "视频生成失败"
        : data.status === "expired"
          ? "任务已过期"
          : undefined,
  };
}
