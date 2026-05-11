/**
 * 即梦 / Seedance 视频生成 Provider（T2V + I2V 统一）
 *
 * Mock 模式：VIDEO_ENGINE_MOCK=true 或 ARK_API_KEY 未配置
 * Real 模式：调用火山方舟 Ark Seedance API
 *
 * API 文档: https://www.volcengine.com/docs/82379/1520757
 *   POST /contents/generations/tasks        (提交)
 *   GET  /contents/generations/tasks/{id}   (查询)
 *
 * 设计要点（Phase Lifecycle Hardening · 2026-05）：
 * - 状态结果必须额外携带 rawProviderStatus，供调和层做决策（不要丢掉原始字符串）。
 * - 提交时若配置了 SEEDANCE_CALLBACK_URL，主动带上回调 URL（双保险：cron 轮询 + webhook）。
 * - getStatusReal 永远不抛出非业务异常—网络/解析问题统一抛 Error，
 *   方便调和函数把它当成「轮询失败、未到终态」处理而不是误终结任务。
 */

export interface SeedanceSubmitOptions {
  prompt: string;
  /**
   * I2V 时的参考图 URL。如果提供，会作为 first_frame 传给模型。
   * 支持 1-5 张；第 2 张以后会作为 last_frame 或内容辅助（按顺序）。
   */
  referenceImageUrls?: string[];
  duration?: number;
  resolution?: string;
  ratio?: string;
  model?: string;
  returnLastFrame?: boolean;
  /// 公网可达的 webhook 回调 URL；为空则不携带（仅依赖轮询）
  callbackUrl?: string;
}

export type SeedanceStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface SeedanceJobResult {
  jobId: string;
  /// 我们规约后的 4 态
  status: SeedanceStatus;
  /// Provider 原始状态字符串：queued / running / succeeded / failed / expired / cancelled / ...
  rawProviderStatus: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
  progress?: number;
  /// 完整 Provider 响应（仅 admin/debug 区使用，不要直接展示给客户）
  rawProviderResponse?: unknown;
}

const mockJobs = new Map<
  string,
  { status: string; createdAt: number; prompt: string }
>();

const MOCK_PROCESSING_TIME_MS = 10_000;

function isMockMode(): boolean {
  if (!process.env.ARK_API_KEY) return true;
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function isSeedanceConfigured(): boolean {
  return !!process.env.ARK_API_KEY && !isMockMode();
}

export async function submitSeedanceJob(
  options: SeedanceSubmitOptions,
): Promise<{ jobId: string }> {
  if (isMockMode()) return submitMock(options);
  return submitReal(options);
}

export async function getSeedanceStatus(
  jobId: string,
): Promise<SeedanceJobResult> {
  if (isMockMode() || jobId.startsWith("mock_")) return getStatusMock(jobId);
  return getStatusReal(jobId);
}

function submitMock(options: SeedanceSubmitOptions): { jobId: string } {
  const jobId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  mockJobs.set(jobId, {
    status: "processing",
    createdAt: Date.now(),
    prompt: options.prompt,
  });
  console.log(`[seedance:mock] 提交任务: ${jobId}`);
  return { jobId };
}

function getStatusMock(jobId: string): SeedanceJobResult {
  const job = mockJobs.get(jobId);
  if (!job) {
    return {
      jobId,
      status: "failed",
      rawProviderStatus: "not_found",
      errorMessage: "Mock 任务不存在",
    };
  }
  const elapsed = Date.now() - job.createdAt;
  if (elapsed < MOCK_PROCESSING_TIME_MS) {
    return {
      jobId,
      status: "processing",
      rawProviderStatus: "running",
      progress: Math.min(95, Math.floor((elapsed / MOCK_PROCESSING_TIME_MS) * 100)),
    };
  }
  mockJobs.delete(jobId);
  return {
    jobId,
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl: `https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4`,
    thumbnailUrl: `https://picsum.photos/seed/${jobId}/400/720`,
    progress: 100,
  };
}

async function submitReal(
  options: SeedanceSubmitOptions,
): Promise<{ jobId: string }> {
  const apiKey = process.env.ARK_API_KEY!;
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = options.model || process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";

  const MAX = 2000;
  const promptText =
    options.prompt.length > MAX
      ? options.prompt.slice(0, MAX).replace(/\s\S*$/, "")
      : options.prompt;

  const isSeedance2 = model.includes("seedance-2");
  const images = options.referenceImageUrls?.filter(Boolean) ?? [];

  type ContentPart =
    | {
        type: "image_url";
        image_url:
          | string
          | { url: string; role?: "first_frame" | "last_frame" };
      }
    | { type: "text"; text: string };
  const content: ContentPart[] = [];

  if (images[0]) {
    content.push({
      type: "image_url",
      image_url: isSeedance2
        ? { url: images[0], role: "first_frame" }
        : images[0],
    });
  }
  if (isSeedance2 && images[1]) {
    content.push({
      type: "image_url",
      image_url: { url: images[1], role: "last_frame" },
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
    if (options.returnLastFrame) body.return_last_frame = true;
  } else {
    body.resolution = options.resolution || "1080p";
  }

  const callbackUrl = options.callbackUrl || process.env.SEEDANCE_CALLBACK_URL;
  if (callbackUrl) {
    body.callback_url = callbackUrl;
  }

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
    throw new Error(`Seedance 提交失败: ${res.status} ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const taskId = data.id || data.task_id;
  if (!taskId) {
    throw new Error(
      `Seedance 响应未携带任务 ID（数据形态变更？）: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return { jobId: taskId };
}

async function getStatusReal(jobId: string): Promise<SeedanceJobResult> {
  const apiKey = process.env.ARK_API_KEY!;
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

  const res = await fetch(
    `${baseUrl}/contents/generations/tasks/${jobId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Seedance 查询失败: ${res.status} ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawStatus: string = typeof data.status === "string" ? data.status : "unknown";

  return {
    jobId,
    status: mapProviderStatus(rawStatus),
    rawProviderStatus: rawStatus,
    videoUrl: data.content?.video_url || data.video_url,
    thumbnailUrl: data.content?.cover_url || data.thumbnail_url,
    lastFrameUrl: data.content?.last_frame_url || data.last_frame_url,
    errorMessage: isFailureStatus(rawStatus)
      ? data.error?.message ||
        data.error?.code ||
        `Seedance 视频生成失败 (${rawStatus})`
      : undefined,
    rawProviderResponse: data,
  };
}

/// Provider 原始状态映射：保留所有可能的字符串，未知字符串归到 processing 以避免误终结
function mapProviderStatus(raw: string): SeedanceStatus {
  const normalized = raw.toLowerCase();
  if (["succeeded", "success", "completed", "done"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "error", "expired", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }
  if (["queued", "pending", "waiting"].includes(normalized)) {
    return "pending";
  }
  /// running / processing / unknown → 都视作仍在生成
  return "processing";
}

function isFailureStatus(raw: string): boolean {
  return ["failed", "error", "expired", "cancelled", "canceled"].includes(
    raw.toLowerCase(),
  );
}

/// 仅供测试导入：纯函数版本的状态映射
export const __test__ = { mapProviderStatus, isFailureStatus };
