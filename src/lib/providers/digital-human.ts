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
      voice: input.audioName || "经纪人录音 / voice clone slot",
      avatar: input.avatarName || "数字人形象 / avatar slot",
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
        detail: "保留经纪人/顾问的真实声音资产，后续可接 HeyGen voice 或自建 TTS。",
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
