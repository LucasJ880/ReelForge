export type DigitalHumanProviderName = "mock" | "heygen";

export interface DigitalHumanDemoInput {
  goal: string;
  audience: string;
  footageName?: string;
  audioName?: string;
  avatarName?: string;
  style: "real-estate" | "product-demo" | "founder-intro";
}

export interface DigitalHumanDemoResult {
  provider: DigitalHumanProviderName;
  status: "mock_ready" | "submitted";
  jobId: string;
  headline: string;
  script: string;
  timeline: {
    label: string;
    detail: string;
    status: "ready" | "queued" | "provider";
  }[];
  assets: {
    footage: string;
    voice: string;
    avatar: string;
  };
  previewVideoUrl?: string;
  providerDashboardUrl?: string;
  notes: string[];
}

export interface HeyGenProofInput {
  title: string;
  script: string;
  avatarId?: string;
  voiceId?: string;
  /**
   * 客户上传到 Vercel Blob 的人像 URL；存在时走 talking_photo 路线，
   * 否则走默认 avatar。
   */
  talkingPhotoUrl?: string;
}

export interface HeyGenProofResult {
  provider: "heygen";
  status: "submitted";
  jobId: string;
  avatarId: string;
  voiceId: string;
  dashboardUrl: string;
  notes: string[];
}

export interface HeyGenProofStatus {
  provider: "heygen";
  jobId: string;
  status: "waiting" | "processing" | "completed" | "failed" | "unknown";
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string | null;
}

const MOCK_PREVIEW_URL =
  "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4";

export async function createDigitalHumanDemo(
  input: DigitalHumanDemoInput,
): Promise<DigitalHumanDemoResult> {
  const provider = getProviderName();
  if (provider === "heygen") {
    return createHeyGenDemo(input);
  }
  return createMockDemo(input);
}

function getProviderName(): DigitalHumanProviderName {
  const raw = process.env.DIGITAL_HUMAN_PROVIDER?.toLowerCase();
  return raw === "heygen" ? "heygen" : "mock";
}

function createMockDemo(input: DigitalHumanDemoInput): DigitalHumanDemoResult {
  const script = buildDemoScript(input);
  const jobId = `demo_mock_${Date.now()}`;

  return {
    provider: "mock",
    status: "mock_ready",
    jobId,
    headline: "Aivora demo pipeline is ready for a live provider.",
    script,
    assets: {
      footage: input.footageName || "现场实拍视频（demo placeholder）",
      voice: input.audioName || "客户声音 / voice clone slot",
      avatar: input.avatarName || "客户数字人形象 / avatar slot",
    },
    timeline: [
      {
        label: "素材理解",
        detail: "识别实拍视频里的空间、产品或服务场景，并提取可讲解的亮点。",
        status: "ready",
      },
      {
        label: "脚本生成",
        detail: "根据客户目标自动生成 15-30 秒讲解脚本和字幕节奏。",
        status: "ready",
      },
      {
        label: "声音绑定",
        detail: "保留客户/顾问的真实声音资产，后续可接 HeyGen voice 或自建 TTS。",
        status: "queued",
      },
      {
        label: "数字人口型同步",
        detail: "当前以 mock 演示完整流程；导入 HeyGen API key 后切换为真实生成。",
        status: "provider",
      },
      {
        label: "合成与 QA",
        detail: "输出竖屏成片、字幕、卖点检查和客户可读的生成报告。",
        status: "ready",
      },
    ],
    previewVideoUrl: MOCK_PREVIEW_URL,
    notes: [
      "Demo 默认不消耗 HeyGen 额度，适合现场演示稳定流程。",
      "导入 HEYGEN_API_KEY 后，可把 DIGITAL_HUMAN_PROVIDER 切到 heygen。",
      "Seedance 仍可负责背景镜头、产品氛围和补充 B-roll。",
    ],
  };
}

async function createHeyGenDemo(
  input: DigitalHumanDemoInput,
): Promise<DigitalHumanDemoResult> {
  const apiKey = process.env.HEYGEN_API_KEY;
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  if (!apiKey || !avatarId || !voiceId) {
    return {
      ...createMockDemo(input),
      provider: "heygen",
      headline:
        "HeyGen provider selected, but HEYGEN_API_KEY / HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID is incomplete.",
      notes: [
        "请在 Vercel 环境变量里补齐 HeyGen key、avatar_id、voice_id 后 redeploy。",
        "在凭证完整前，Demo 自动返回 mock 结果，避免客户演示中断。",
      ],
    };
  }

  const script = buildDemoScript(input);
  const response = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: avatarId,
            avatar_style: "normal",
          },
          voice: {
            type: "text",
            input_text: script,
            voice_id: voiceId,
          },
        },
      ],
      dimension: {
        width: 720,
        height: 1280,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: { video_id?: string };
    message?: string;
  };

  if (!response.ok || !data.data?.video_id) {
    throw new Error(data.message || "HeyGen 任务提交失败");
  }

  const base = createMockDemo(input);
  return {
    ...base,
    provider: "heygen",
    status: "submitted",
    jobId: data.data.video_id,
    headline: "HeyGen digital-human generation submitted.",
    previewVideoUrl: undefined,
    providerDashboardUrl: "https://app.heygen.com/videos",
    timeline: base.timeline.map((step) =>
      step.label === "数字人口型同步"
        ? {
            ...step,
            detail: "HeyGen 已接收任务，生成完成后可在 HeyGen dashboard 查看。",
            status: "provider",
          }
        : step,
    ),
    notes: [
      "当前接口先用 HeyGen avatar + text voice 路线；voice clone 音频绑定可在拿到账号权限后升级。",
      "返回 video_id 后，下一步可加轮询接口把结果同步回 Aivora。",
    ],
  };
}

export async function submitHeyGenProof(
  input: HeyGenProofInput,
): Promise<HeyGenProofResult> {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY 未配置");
  }

  const proofScript = compactProofScript(input.script);

  let character: Record<string, unknown>;
  let avatarId = input.avatarId || process.env.HEYGEN_AVATAR_ID || "";
  if (input.talkingPhotoUrl) {
    const talkingPhotoId = await uploadTalkingPhoto(apiKey, input.talkingPhotoUrl);
    character = {
      type: "talking_photo",
      talking_photo_id: talkingPhotoId,
      talking_photo_style: "normal",
    };
    avatarId = `talking_photo:${talkingPhotoId}`;
  } else {
    const resolved = await resolveHeyGenAssets(apiKey, input);
    avatarId = resolved.avatarId;
    character = {
      type: "avatar",
      avatar_id: resolved.avatarId,
      avatar_style: "normal",
    };
  }

  const voiceId =
    input.voiceId ||
    process.env.HEYGEN_VOICE_ID ||
    (await listDefaultVoice(apiKey));

  const response = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({
      title: input.title || "Aivora client proof",
      caption: true,
      video_inputs: [
        {
          character,
          voice: {
            type: "text",
            input_text: proofScript,
            voice_id: voiceId,
          },
        },
      ],
      dimension: {
        width: 720,
        height: 1280,
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: { video_id?: string };
    message?: string;
    error?: string;
  };

  if (!response.ok || !data.data?.video_id) {
    throw new Error(data.message || data.error || "HeyGen proof 任务提交失败");
  }

  return {
    provider: "heygen",
    status: "submitted",
    jobId: data.data.video_id,
    avatarId,
    voiceId,
    dashboardUrl: "https://app.heygen.com/videos",
    notes: input.talkingPhotoUrl
      ? [
          "已用客户上传的人像生成 talking_photo 数字人。",
          "生成是异步任务，可在 HeyGen dashboard 查看结果。",
        ]
      : [
          "已提交一条短脚本 proof，控制成本。",
          "生成是异步任务，可在 HeyGen dashboard 查看结果。",
          "下一步可接 /v1/video_status.get 或 v3 videos 轮询，把结果回写到 Aivora。",
        ],
  };
}

/**
 * 把公网图片（例如客户刚上传到 Vercel Blob 的人像）上传到 HeyGen，
 * 返回可在 v2/video/generate 中直接用的 talking_photo_id。
 */
async function uploadTalkingPhoto(
  apiKey: string,
  imageUrl: string,
): Promise<string> {
  const sourceResp = await fetch(imageUrl);
  if (!sourceResp.ok) {
    throw new Error(`下载客户人像失败 status=${sourceResp.status}`);
  }
  const contentType = sourceResp.headers.get("content-type") || "image/jpeg";
  if (!/^image\/(jpeg|jpg|png)$/i.test(contentType)) {
    throw new Error(`不支持的人像格式：${contentType}`);
  }
  const body = Buffer.from(await sourceResp.arrayBuffer());

  const upload = await fetch("https://upload.heygen.com/v1/talking_photo", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": contentType,
    },
    body,
  });
  const data = (await upload.json().catch(() => ({}))) as {
    data?: { talking_photo_id?: string };
    message?: string;
    error?: string;
  };
  if (!upload.ok || !data.data?.talking_photo_id) {
    throw new Error(
      data.message || data.error || "HeyGen 人像上传失败，请稍后再试",
    );
  }
  return data.data.talking_photo_id;
}

export async function getHeyGenProofStatus(
  videoId: string,
): Promise<HeyGenProofStatus> {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY 未配置");
  }

  const response = await fetch(
    `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { headers: { "X-Api-Key": apiKey } },
  );
  const data = (await response.json().catch(() => ({}))) as {
    data?: {
      status?: string;
      video_url?: string;
      thumbnail_url?: string;
      duration?: number;
      error?: string | null;
    };
    message?: string;
  };

  if (!response.ok) {
    throw new Error(data.message || "读取 HeyGen 生成状态失败");
  }

  const rawStatus = data.data?.status ?? "unknown";
  const status = normalizeHeyGenStatus(rawStatus);

  return {
    provider: "heygen",
    jobId: videoId,
    status,
    videoUrl: data.data?.video_url,
    thumbnailUrl: data.data?.thumbnail_url,
    duration: data.data?.duration,
    error: data.data?.error ?? null,
  };
}

async function resolveHeyGenAssets(
  apiKey: string,
  input: HeyGenProofInput,
): Promise<{ avatarId: string; voiceId: string }> {
  const configuredAvatar = input.avatarId || process.env.HEYGEN_AVATAR_ID;
  const configuredVoice = input.voiceId || process.env.HEYGEN_VOICE_ID;
  if (configuredAvatar && configuredVoice) {
    return { avatarId: configuredAvatar, voiceId: configuredVoice };
  }

  const [avatarId, voiceId] = await Promise.all([
    configuredAvatar ?? listDefaultAvatar(apiKey),
    configuredVoice ?? listDefaultVoice(apiKey),
  ]);

  if (!avatarId || !voiceId) {
    throw new Error("无法自动解析 HeyGen avatar_id / voice_id，请在环境变量中显式配置");
  }
  return { avatarId, voiceId };
}

async function listDefaultAvatar(apiKey: string): Promise<string> {
  const response = await fetch("https://api.heygen.com/v2/avatars", {
    headers: { "X-Api-Key": apiKey },
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: {
      avatars?: Array<{
        avatar_id?: string;
        premium?: boolean;
        default_voice_id?: string | null;
      }>;
    };
    message?: string;
  };
  if (!response.ok) throw new Error(data.message || "读取 HeyGen avatars 失败");
  const avatar =
    data.data?.avatars?.find((a) => a.avatar_id && !a.premium) ??
    data.data?.avatars?.find((a) => a.avatar_id);
  if (!avatar?.avatar_id) throw new Error("HeyGen 账号没有可用 avatar");
  return avatar.avatar_id;
}

async function listDefaultVoice(apiKey: string): Promise<string> {
  const response = await fetch("https://api.heygen.com/v2/voices", {
    headers: { "X-Api-Key": apiKey },
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: {
      voices?: Array<{
        voice_id?: string;
        language?: string;
        locale?: string;
        support_pause?: boolean;
      }>;
    };
    message?: string;
  };
  if (!response.ok) throw new Error(data.message || "读取 HeyGen voices 失败");
  const voices = data.data?.voices ?? [];
  const preferred =
    voices.find((v) => v.voice_id && /zh|chinese|mandarin/i.test(`${v.language} ${v.locale}`)) ??
    voices.find((v) => v.voice_id);
  if (!preferred?.voice_id) throw new Error("HeyGen 账号没有可用 voice");
  return preferred.voice_id;
}

function compactProofScript(script: string): string {
  const cleaned = script.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 178)}。`;
}

function normalizeHeyGenStatus(status: string): HeyGenProofStatus["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "waiting") return "waiting";
  if (status === "processing" || status === "pending") return "processing";
  return "unknown";
}

function buildDemoScript(input: DigitalHumanDemoInput): string {
  const styleLine = {
    "real-estate": "这套空间最适合需要快速判断价值的买家。",
    "product-demo": "这个产品的核心优势是把复杂卖点变成可理解的短视频。",
    "founder-intro": "这段介绍会帮客户在 30 秒内理解你的专业度。",
  }[input.style];

  return [
    `大家好，我是 Aivora 的 AI 数字人助手。`,
    styleLine,
    `我们会先分析实拍素材，再结合目标客户「${input.audience || "潜在客户"}」生成讲解脚本。`,
    `最后把真实声音、数字人形象和竖屏视频合成为一条可以直接发给客户的视频。`,
  ].join("");
}
