import { createHash } from "node:crypto";
import { assertMockVideoRuntimeAllowed } from "@/lib/config/env";
import { generateMockClip } from "@/lib/video-generation/mock-clip-generator";
import { normalizeStatusBuiltin } from "./types";
import type {
  CreateVideoJobOptions,
  CreateVideoJobResult,
  NormalizedVideoStatus,
  VideoJobStatusResult,
  VideoProvider,
} from "./types";

interface EncodedMockJob {
  c: number; // createdAt epoch ms
  l: number; // latency ms
  o: "success" | "failure" | "stall";
  s: number; // deterministic seed
  i: number; // batch index
  d: number; // duration sec
  r: string; // aspect ratio
  b: string; // batch/brief id
}

const generatedOutputs = new Map<string, Promise<string>>();

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function rateEnv(name: string, fallback: number): number {
  return Math.min(1, Math.max(0, numberEnv(name, fallback)));
}

function unitFromSeed(seed: number, salt: string): number {
  const value = createHash("sha256")
    .update(`${seed}:${salt}`)
    .digest()
    .readUInt32BE(0);
  return value / 0x1_0000_0000;
}

function encodeJob(payload: EncodedMockJob): string {
  return `batchmock_${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeJob(id: string): EncodedMockJob {
  if (!id.startsWith("batchmock_")) throw new Error("无效 Mock provider job id");
  const parsed = JSON.parse(
    Buffer.from(id.slice("batchmock_".length), "base64url").toString("utf8"),
  ) as EncodedMockJob;
  if (
    !Number.isFinite(parsed.c) ||
    !Number.isFinite(parsed.l) ||
    !Number.isFinite(parsed.s)
  ) {
    throw new Error("Mock provider job id 数据损坏");
  }
  return parsed;
}

function chooseOutcome(seed: number, batchIndex?: number): EncodedMockJob["o"] {
  const stallRate = rateEnv("MOCK_STALL_RATE", 0.02);
  const failureRate = rateEnv("MOCK_FAILURE_RATE", 0.05);
  // 连续 100 条用互质乘数做全排列：默认配置下稳定得到 2 stall + 5 failure，
  // 大规模 E2E 不受随机波动影响；没有 batchIndex 时回退 seed hash。
  const roll =
    batchIndex == null
      ? unitFromSeed(seed, "outcome")
      : ((batchIndex * 37) % 100) / 100;
  if (roll < stallRate) return "stall";
  if (roll < stallRate + failureRate) return "failure";
  return "success";
}

function latencyForSeed(seed: number): number {
  const base = Math.max(0, numberEnv("MOCK_LATENCY_MS", 3000));
  const jitterRatio = rateEnv("MOCK_LATENCY_JITTER", 0.2);
  const centered = unitFromSeed(seed, "latency") * 2 - 1;
  return Math.max(0, Math.round(base * (1 + centered * jitterRatio)));
}

async function outputUrl(payload: EncodedMockJob): Promise<string> {
  const configured = process.env.MOCK_OUTPUT_VIDEO_URL?.trim();
  if (configured) return configured;

  // 只生成最多 6 个可播放缓存片，100/200 条任务复用，避免测试时启动 200 次 ffmpeg。
  const bucket = payload.s % 6;
  const key = `${payload.r}:${payload.d}:${bucket}`;
  let pending = generatedOutputs.get(key);
  if (!pending) {
    pending = generateMockClip({
      briefId: payload.b,
      segmentIndex: bucket,
      segmentCount: 6,
      durationSec: payload.d,
      aspectRatio: payload.r,
      purpose: "batch-provider-placeholder",
    }).then((clip) => clip.url);
    generatedOutputs.set(key, pending);
  }
  return pending;
}

/**
 * 无进程内 job 状态依赖：createdAt/outcome/seed 全编码在 external id，
 * Vercel 实例重启后仍可恢复，避免 mock 自己制造孤儿任务。
 */
export class MockVideoProvider implements VideoProvider {
  readonly id = "mock" as const;
  readonly displayName = "Aivora Mock Video Provider";
  readonly manualRetryBillingRisk = "none" as const;

  isConfigured(): boolean {
    return true;
  }

  isMockMode(): boolean {
    return true;
  }

  async createVideoJob(
    options: CreateVideoJobOptions,
  ): Promise<CreateVideoJobResult> {
    assertMockVideoRuntimeAllowed();
    const seed = (options.seed ?? 0) & 0x7fffffff;
    /// 故障注入排列是为批量测试设计的（batchIndex 0..99 稳定得到 2 stall +
    /// 5 failure）。单条视频段的 segmentIndex 恒为 0，套进排列会 100% stall；
    /// 单条链路的失败/watchdog 场景由测试直接改 DB 注入，这里保持确定性成功。
    const injectOutcome = options.mockHints?.purpose === "batch-template";
    const payload: EncodedMockJob = {
      c: Date.now(),
      l: latencyForSeed(seed),
      o:
        !injectOutcome || (options.mockHints?.retryAttempt ?? 0) > 0
          ? "success"
          : chooseOutcome(seed, options.mockHints?.segmentIndex),
      s: seed,
      i: options.mockHints?.segmentIndex ?? 0,
      d: options.durationSec ?? 10,
      r: options.aspectRatio ?? "9:16",
      b: options.mockHints?.briefId ?? "batch",
    };
    return { providerJobId: encodeJob(payload), providerId: this.id };
  }

  async getVideoJobStatus(
    providerJobId: string,
  ): Promise<VideoJobStatusResult> {
    assertMockVideoRuntimeAllowed();
    const job = decodeJob(providerJobId);
    const elapsed = Date.now() - job.c;
    const createdSec = Math.floor(job.c / 1000);

    if (job.o === "stall") {
      return {
        providerJobId,
        normalizedStatus: "processing",
        rawProviderStatus: "running",
        progress: Math.min(95, Math.floor((elapsed / Math.max(job.l, 1)) * 100)),
        rawProviderResponse: {
          status: "running",
          created_at: createdSec,
          updated_at: createdSec,
          mock_outcome: "stall",
        },
      };
    }
    if (elapsed < job.l) {
      return {
        providerJobId,
        normalizedStatus: "processing",
        rawProviderStatus: "running",
        progress: Math.min(95, Math.floor((elapsed / Math.max(job.l, 1)) * 100)),
        rawProviderResponse: {
          status: "running",
          created_at: createdSec,
          // 明确推进，避免正常 mock 被 provider_stalled 误杀。
          updated_at: createdSec + Math.max(1, Math.floor(elapsed / 1000)),
          mock_outcome: job.o,
        },
      };
    }
    if (job.o === "failure") {
      return {
        providerJobId,
        normalizedStatus: "failed",
        rawProviderStatus: "failed",
        errorMessage: "Mock provider 注入失败",
        progress: 100,
        rawProviderResponse: {
          status: "failed",
          created_at: createdSec,
          updated_at: Math.floor(Date.now() / 1000),
          mock_outcome: "failure",
        },
      };
    }
    return {
      providerJobId,
      normalizedStatus: "succeeded",
      rawProviderStatus: "succeeded",
      progress: 100,
      videoUrl: await outputUrl(job),
      rawProviderResponse: {
        status: "succeeded",
        created_at: createdSec,
        updated_at: Math.floor(Date.now() / 1000),
        mock_outcome: "success",
      },
    };
  }

  async cancelVideoJob(): Promise<{
    supported: boolean;
    cancelled?: boolean;
  }> {
    assertMockVideoRuntimeAllowed();
    return { supported: true, cancelled: true };
  }

  getGeneratedVideoUrl(status: VideoJobStatusResult): string | null {
    return status.videoUrl ?? null;
  }

  normalizeProviderStatus(raw: string): NormalizedVideoStatus {
    return normalizeStatusBuiltin(raw);
  }
}

export const __test__ = {
  encodeJob,
  decodeJob,
  chooseOutcome,
  latencyForSeed,
  unitFromSeed,
  resetOutputCache(): void {
    generatedOutputs.clear();
  },
};
