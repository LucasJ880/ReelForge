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
  /**
   * 生成模式（Seedance 2.0）：
   * - 不传 / "i2v"  → 既有行为：第 1 张 referenceImageUrls 作 first_frame、第 2 张作 last_frame；
   * - "reference"   → 多模态参考生视频（Omni-Reference）：referenceImageUrls 全部以
   *                   `role: reference_image` 注入（最多 9 张），prompt 里用「图片1/图片2」按
   *                   顺序引用。与 first_frame/last_frame 互斥，用于数字人/主体跨镜头一致性。
   *
   * 仅 Seedance 2 模型支持 reference；Seedance-1 会忽略并按 first_frame 处理。
   */
  mode?: "i2v" | "reference";
  duration?: number;
  resolution?: string;
  ratio?: string;
  model?: string;
  returnLastFrame?: boolean;
  /**
   * Seedance 2 only。是否要求模型生成原生音频。
   * 默认 `true`（与 wrapper 既有行为一致；不传不会破坏现网调用）。
   * 设为 `false` 时会在请求体里显式带 `generate_audio: false`，适合
   * 投资人 demo 这类「后期会铺自家音乐床或干脆静音」的场景，避免 5 段
   * 段间 ambience 不一致拉低质感。Seedance-1 模型不存在该字段，会被忽略。
   */
  generateAudio?: boolean;
  /// 公网可达的 webhook 回调 URL；为空则不携带（仅依赖轮询）
  callbackUrl?: string;
  /**
   * 仅在 VIDEO_ENGINE_MOCK=true 时生效；real Seedance payload 永远不会包含此字段。
   * 用于让 mock 路径渲染出「每段都不一样、肉眼可辨、可拼接」的占位 MP4。
   */
  mockHints?: {
    briefId: string;
    segmentIndex: number;
    segmentCount: number;
    durationSec: number;
    aspectRatio: string;
    purpose?: string;
  };
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

type MockJobRecord = {
  status: string;
  createdAt: number;
  prompt: string;
  mockHints?: SeedanceSubmitOptions["mockHints"];
};

const mockJobs = new Map<string, MockJobRecord>();

const MOCK_PROCESSING_TIME_MS = Number(
  process.env.VIDEO_ENGINE_MOCK_LATENCY_MS ?? "1500",
);

/**
 * Mock 模式判定（Phase 2 收紧）：
 *   - VIDEO_ENGINE_MOCK 显式 true/1/yes  → mock
 *   - VIDEO_ENGINE_MOCK 显式 false/0/no  → real（即便 ARK_API_KEY 缺失也走 real，
 *       让 submitReal/getStatusReal 抛清晰错误，避免 silent fall-back to mock 导致
 *       生产误以为「在跑真实任务」）
 *   - 未设置                              → 缺 ARK_API_KEY 时退回 mock（dev 便利）
 */
function isMockMode(): boolean {
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return !process.env.ARK_API_KEY;
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

/** Seedance I2V first_frame blocked for photorealistic persons / privacy. */
export function isSeedancePrivacyBlockError(message: string): boolean {
  return /SensitiveContent|real person|PrivacyInformation/i.test(message);
}

/**
 * Submit to Seedance; on I2V privacy rejection, retry once as T2V (no reference images).
 */
export async function submitSeedanceJobResilient(
  options: SeedanceSubmitOptions,
): Promise<{ jobId: string }> {
  const hadRef = (options.referenceImageUrls?.filter(Boolean).length ?? 0) > 0;
  try {
    return await submitSeedanceJob(options);
  } catch (err) {
    const msg = (err as Error).message;
    if (hadRef && isSeedancePrivacyBlockError(msg)) {
      return submitSeedanceJob({
        ...options,
        referenceImageUrls: undefined,
      });
    }
    throw err;
  }
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
    mockHints: options.mockHints,
  });
  if (options.mockHints) {
    console.log(
      `[seedance:mock] 提交任务: ${jobId} (seg ${
        options.mockHints.segmentIndex + 1
      }/${options.mockHints.segmentCount}, ${options.mockHints.durationSec}s, ${options.mockHints.aspectRatio})`,
    );
  } else {
    console.log(`[seedance:mock] 提交任务: ${jobId}`);
  }
  return { jobId };
}

/**
 * Dev mock：Next.js HMR 会清空进程内 mockJobs。按 externalJobId 从 DB 恢复 hints，
 * 避免轮询误判「任务不存在」→ 整单 RENDER_FAILED。
 */
async function recoverMockJobRecord(jobId: string): Promise<MockJobRecord | null> {
  if (!jobId.startsWith("mock_")) return null;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.videoJob.findFirst({
      where: { externalJobId: jobId },
      select: {
        videoBriefId: true,
        segmentIndex: true,
        segmentDurationSec: true,
        submittedAt: true,
        startedAt: true,
        videoBrief: {
          select: {
            aspectRatio: true,
            finalVideo: { select: { segmentCount: true } },
          },
        },
      },
    });
    if (!row || row.segmentIndex == null) return null;
    const segmentCount = row.videoBrief.finalVideo?.segmentCount ?? 1;
    return {
      status: "processing",
      createdAt: (row.submittedAt ?? row.startedAt ?? new Date()).getTime(),
      prompt: "",
      mockHints: {
        briefId: row.videoBriefId,
        segmentIndex: row.segmentIndex,
        segmentCount,
        durationSec: row.segmentDurationSec ?? 15,
        aspectRatio: row.videoBrief.aspectRatio ?? "9:16",
      },
    };
  } catch {
    return null;
  }
}

async function getStatusMock(jobId: string): Promise<SeedanceJobResult> {
  let job = mockJobs.get(jobId);
  if (!job) {
    const recovered = await recoverMockJobRecord(jobId);
    if (recovered) {
      job = recovered;
      mockJobs.set(jobId, recovered);
    }
  }
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

  /// 优先用 mockHints 渲染唯一可拼接 MP4；缺失则回退到通用 9:16 静态占位
  const fallbackHints: NonNullable<SeedanceSubmitOptions["mockHints"]> = {
    briefId: "unknown",
    segmentIndex: 0,
    segmentCount: 1,
    durationSec: 5,
    aspectRatio: "9:16",
    purpose: "fallback",
  };
  const hints = job.mockHints ?? fallbackHints;
  let videoUrl: string;
  try {
    const { generateMockClip } = await import(
      "@/lib/video-generation/mock-clip-generator"
    );
    const clip = await generateMockClip(hints);
    videoUrl = clip.url;
  } catch (err) {
    /// 渲染失败：返回 failed 让上层走重试 / 用户可见错误，不要 silent fall back to bunny URL
    return {
      jobId,
      status: "failed",
      rawProviderStatus: "mock_render_failed",
      errorMessage: `Mock 视频渲染失败: ${(err as Error).message}`,
    };
  }
  mockJobs.delete(jobId);
  return {
    jobId,
    status: "completed",
    rawProviderStatus: "succeeded",
    videoUrl,
    thumbnailUrl: undefined,
    progress: 100,
  };
}

async function submitReal(
  options: SeedanceSubmitOptions,
): Promise<{ jobId: string }> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Seedance 真实模式已开启（VIDEO_ENGINE_MOCK=false），但 ARK_API_KEY 未配置；请配置密钥或将 VIDEO_ENGINE_MOCK 设为 true。",
    );
  }
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  const model = options.model || process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";

  const isSeedance2 = model.includes("seedance-2");

  /// Seedance 2.0 官方建议英文 ≤1000 词（约 6000 字符）；多分镜时间轴 prompt 通常 2500-3300 字符。
  /// Seedance 1.x 维持旧 2000 上限。
  const MAX = isSeedance2 ? 4000 : 2000;
  const promptText =
    options.prompt.length > MAX
      ? options.prompt.slice(0, MAX).replace(/\s\S*$/, "")
      : options.prompt;
  const images = options.referenceImageUrls?.filter(Boolean) ?? [];
  /// reference 模式仅在 Seedance 2 上有意义（多模态参考生视频）。
  const useReferenceMode = options.mode === "reference" && isSeedance2;

  type ContentPart =
    | {
        type: "image_url";
        image_url:
          | string
          | { url: string; role?: "first_frame" | "last_frame" };
        /// Seedance 2.0 多模态参考：role 作为 content item 的同级字段（官方原生格式）
        role?: "reference_image";
      }
    | { type: "text"; text: string };
  const content: ContentPart[] = [];

  if (useReferenceMode) {
    /// 最多 9 张 reference_image（Omni-Reference）；role 为 content item 同级字段。
    for (const url of images.slice(0, 9)) {
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    }
  } else {
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
    /// 默认 true 保持向后兼容（旧调用方不传该字段时，原本就硬编码 true）；
    /// 显式传 false 才关闭，便于投资人 demo 用静音 + 自家音乐床。
    body.generate_audio = options.generateAudio ?? true;
    if (options.returnLastFrame) body.return_last_frame = true;
    /// Seedance 2.0 支持 resolution（720p/1080p）；仅在显式提供时下发，避免改动既有默认行为。
    if (options.resolution) body.resolution = options.resolution;
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
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Seedance 真实模式已开启（VIDEO_ENGINE_MOCK=false），但 ARK_API_KEY 未配置；无法查询任务状态。",
    );
  }
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
