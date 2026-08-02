/**
 * OpenAI TTS 配音适配器（b-roll 线路专用）。
 *
 * 为什么是 OpenAI 而不是 edge-tts（MoneyPrinterTurbo 的默认）：
 * edge-tts 逆向微软消费端接口、无 SLA，放进商用管线等于自造下一个 Shuyu。
 * 决策与备选（Azure Speech）见 docs/roadmap/2026-08-01-required-api-keys.md。
 *
 * 复用 `OPENAI_API_KEY`（0802 起项目已开通 tts-1 权限）。
 * 无 key 时诚实不可用，与 stock-footage / remove-bg 同一模式，不 mock。
 *
 * ⚠️ 只做 b-roll 的外挂配音。主线 Seedance 原生口播由生成视频直接说出，
 * 绝不在主线成片上二次覆盖 TTS（stitch-service 的既有纪律）。
 */

const OPENAI_TTS_ENDPOINT = "https://api.openai.com/v1/audio/speech";
const OPENAI_TTS_MODEL = "tts-1";

/**
 * 产品音色（audio-caption-controls 的 VOICE_OPTIONS id）→ OpenAI voice。
 * 未识别的 id 一律落到 nova：报错不如出片，音色偏差人耳可接受。
 */
const VOICE_MAP: Record<string, string> = {
  "warm-confident": "nova",
  "natural-friendly": "shimmer",
  "energetic-creator": "alloy",
};

const DEFAULT_VOICE = "nova";

export function isOpenAiTtsAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function resolveTtsVoice(voiceId: string | null | undefined): string {
  if (!voiceId) return DEFAULT_VOICE;
  return VOICE_MAP[voiceId] ?? DEFAULT_VOICE;
}

export class OpenAiTtsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OpenAiTtsError";
  }
}

/**
 * 合成一段口播，返回 mp3 Buffer。
 *
 * 调用方负责切段：b-roll 按镜头段逐段合成，段级时长用 ffprobe 实测，
 * 不信任何估算公式（中英混排的语速估算误差能到 ±40%）。
 */
export async function synthesizeVoiceover(args: {
  text: string;
  voiceId?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new OpenAiTtsError("OPENAI_API_KEY 未配置，TTS 不可用", null, false);
  }
  const text = args.text.trim();
  if (!text) {
    throw new OpenAiTtsError("口播文本为空", null, false);
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(OPENAI_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: resolveTtsVoice(args.voiceId),
      input: text,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    /// 日志脱敏：只留状态码与截断的错误体，不落 key、不落完整口播稿。
    const body = (await response.text().catch(() => "")).slice(0, 200);
    const retryable = response.status === 429 || response.status >= 500;
    throw new OpenAiTtsError(
      `TTS 合成失败：HTTP ${response.status} ${body}`,
      response.status,
      retryable,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1024) {
    throw new OpenAiTtsError("TTS 返回的音频异常（不足 1KB）", null, true);
  }
  return audio;
}
