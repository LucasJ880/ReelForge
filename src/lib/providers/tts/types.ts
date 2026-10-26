import type { TtsProviderId } from "@/lib/providers/tts/config";

/** 逐词时间戳（毫秒，相对本段音频起点）。只有原生给出时间戳的供应商才填，不做估算。 */
export type TtsWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type TtsSynthesizeInput = {
  text: string;
  /** 产品音色 id（audio-caption-controls 的 VOICE_OPTIONS），由各供应商的音色表映射 */
  voiceId?: string | null;
  /** BCP-47 或简码（zh / en-US）；不支持多语种参数的供应商可以忽略 */
  language: string;
};

export type TtsSynthesizeResult = {
  audio: Buffer;
  mime: string;
  /** 供应商直接给出的时长；没有就留空，调用方用 ffprobe 实测 */
  durationMs?: number;
  words?: TtsWord[];
};

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly model: string;
  /** 为 true 时 synthesize 的结果一定带 words（字幕逐词高亮的来源） */
  readonly supportsWordTimestamps: boolean;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly provider: TtsProviderId,
  ) {
    super(message);
    this.name = "TtsError";
  }
}
