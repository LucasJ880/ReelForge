import OpenAI from "openai";
import { put } from "@vercel/blob";

/**
 * OpenAI 图像生成 Provider —— 内部代号「Image 2」。
 *
 * 用途：Logo 生成（Phase 4 PART 6）。
 *
 * 模型：默认 gpt-image-1（OPENAI_IMAGE_MODEL 可覆盖）。
 *
 * Mock 模式触发条件（任一为真即不发起真实调用）：
 *   1) 缺少 OPENAI_API_KEY
 *   2) IMAGE_ENGINE_MOCK=true
 *
 * Mock 返回固定占位 URL（不消耗 OpenAI 额度），便于本地开发 / E2E 测试。
 */

const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_SIZE: ImageSize = "1024x1024";
const DEFAULT_N = 3;

/// gpt-image-1 支持的尺寸；其它尺寸会被 OpenAI 拒绝
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface GenerateImagesArgs {
  prompt: string;
  /// 候选张数；默认 3，最多 10
  n?: number;
  size?: ImageSize;
  /// 用于在 Vercel Blob 上落盘的前缀（如 logos/{orderId}/）
  blobPrefix?: string;
  /// 强制 mock，便于测试调用
  forceMock?: boolean;
}

export interface GenerateImagesResult {
  urls: string[];
  modelUsed: string;
  fromMock: boolean;
}

export function isImageGenAvailable(): boolean {
  if (process.env.IMAGE_ENGINE_MOCK === "true") return false;
  return !!process.env.OPENAI_API_KEY;
}

export async function generateImages(
  args: GenerateImagesArgs,
): Promise<GenerateImagesResult> {
  const useMock = args.forceMock || !isImageGenAvailable();
  const n = clamp(args.n ?? DEFAULT_N, 1, 10);
  const size = args.size ?? DEFAULT_SIZE;

  if (useMock) {
    return {
      urls: mockUrls(n),
      modelUsed: "mock",
      fromMock: true,
    };
  }

  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  /// gpt-image-1 一次最多 10 张；同步调用即可
  const response = await openai.images.generate({
    model,
    prompt: args.prompt,
    n,
    size,
  });

  /// gpt-image-1 默认返回 b64_json（不返回 url），需要我们把 base64 持久化成 Blob 拿到稳定 URL
  const items = (response.data ?? []).filter(Boolean);
  if (items.length === 0) {
    throw new Error("OpenAI 图像生成返回空结果");
  }
  const urls: string[] = [];
  for (const [i, item] of items.entries()) {
    if (item.url) {
      urls.push(item.url);
      continue;
    }
    if (!item.b64_json) {
      throw new Error("OpenAI 图像返回缺少 url / b64_json");
    }
    const buffer = Buffer.from(item.b64_json, "base64");
    const blobPath = `${args.blobPrefix || "ai-images/"}${Date.now()}-${i}.png`;
    /// 强约束：缺 BLOB_READ_WRITE_TOKEN 时直接 throw，不再静默写 data URL。
    /// 历史问题：data:image/png;base64,... 写进 DB 会膨胀行 + 前端没办法分享。
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN not configured; cannot persist generated logo",
      );
    }
    const blob = await put(blobPath, buffer, {
      access: "public",
      contentType: "image/png",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    urls.push(blob.url);
  }

  return {
    urls,
    modelUsed: model,
    fromMock: false,
  };
}

/**
 * 构造 logo 生成 prompt 的标准结构。
 * 把 LogoGenerationForm 的字段编排成 OpenAI 友好的提示词。
 */
export function buildLogoPrompt(args: {
  businessName: string;
  industry?: string | null;
  styleHint?: string | null;
  colors?: string | null;
  slogan?: string | null;
  iconIdea?: string | null;
  language?: string | null;
}): string {
  const {
    businessName,
    industry,
    styleHint,
    colors,
    slogan,
    iconIdea,
    language,
  } = args;

  const parts: string[] = [
    `Logo design for "${businessName}".`,
    industry ? `Industry: ${industry}.` : "",
    styleHint ? `Style: ${styleHint}.` : "",
    colors ? `Color palette preference: ${colors}.` : "",
    iconIdea ? `Icon idea: ${iconIdea}.` : "",
    slogan ? `Tagline: "${slogan}".` : "",
    language ? `Wordmark language: ${language}.` : "",
    "Vector flat design, clean, modern, scalable, transparent or solid background.",
    "Centered composition, high contrast, suitable for social media avatar and end card.",
    "Avoid photorealism, no people faces, no copyrighted characters, no clutter.",
    "Output a single clear logo on solid background.",
  ];
  return parts.filter(Boolean).join(" ");
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

const MOCK_PALETTE = [
  "https://placehold.co/1024x1024/0ea5e9/ffffff?text=Logo+1",
  "https://placehold.co/1024x1024/8b5cf6/ffffff?text=Logo+2",
  "https://placehold.co/1024x1024/22c55e/ffffff?text=Logo+3",
  "https://placehold.co/1024x1024/ef4444/ffffff?text=Logo+4",
];

function mockUrls(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(MOCK_PALETTE[i % MOCK_PALETTE.length]);
  }
  return out;
}

/// 仅供测试导入
export const __test__ = {
  buildLogoPrompt,
  mockUrls,
};
