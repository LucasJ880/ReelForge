import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { getStorageProvider } from "@/lib/storage";

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

/// 旧版 gpt-image-1 / gpt-image-1-mini 严格支持的尺寸（保留为联合类型作为
/// 现网 logo-generator 的默认 / 文档化「安全选项」）。gpt-image-2 接受任意
/// 满足约束的分辨率（详见 OpenAI 文档），所以 size 入参类型放宽为
/// `ImageSize | string`，调用方可以对新模型直接传 "1080x1920" 之类的 9:16 串。
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "auto" | "low" | "medium" | "high";

export interface GenerateImagesArgs {
  prompt: string;
  /// 候选张数；默认 3，最多 10
  n?: number;
  /// 旧严格联合类型 + 任意自定义字符串（仅 gpt-image-2 等新模型支持任意分辨率）
  size?: ImageSize | string;
  /// gpt-image-2 支持 low / medium / high / auto；旧调用方不传则保持 SDK 默认。
  quality?: ImageQuality;
  /// 用于在 Vercel Blob 上落盘的前缀（如 logos/{orderId}/）
  blobPrefix?: string;
  /// 强制 mock，便于测试调用
  forceMock?: boolean;
  /**
   * 显式覆盖模型 ID。优先级：args.model > OPENAI_IMAGE_MODEL > "gpt-image-1"。
   * 注意：传 "gpt-image-2" 等新模型时，size 可以是任意满足模型约束的分辨率
   * （例如 9:16 demo 分镜帧用 "1080x1920"）。
   */
  model?: string;
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

  const model = args.model || process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  /// gpt-image-1/2 单次最多 10 张；同步调用即可。
  /// 注意：size 入参在新模型（gpt-image-2）下可以是任意满足约束的分辨率字符串，
  /// SDK 类型对其它字符串可能严格 → 这里用 unknown 强转避开类型墙，运行时由 OpenAI 校验。
  const response = await openai.images.generate({
    model,
    prompt: args.prompt,
    n,
    size: size as unknown as "1024x1024" | "1024x1536" | "1536x1024",
    quality: args.quality,
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
    const key = `${args.blobPrefix || "ai-images/"}${Date.now()}-${i}.png`;
    /// 强约束：storage provider 必须已配置；不再静默写 data URL。
    /// 历史问题：data:image/png;base64,... 写进 DB 会膨胀行 + 前端没办法分享。
    const storage = getStorageProvider();
    if (!storage.isConfigured()) {
      throw new Error(
        `Storage provider "${storage.id}" 未配置；无法持久化生成的 logo。` +
          ` 请配置 ${storage.id === "vercel_blob" ? "BLOB_READ_WRITE_TOKEN" : "VOLCENGINE_ACCESS_KEY_ID/SECRET/ENDPOINT/BUCKET_RENDERS"}。`,
      );
    }
    /// AI 生成产物 → renders bucket（与用户上传素材的 uploads bucket 隔离）
    const obj = await storage.uploadBuffer("renders", buffer, {
      key,
      access: "public",
      contentType: "image/png",
    });
    urls.push(obj.url);
  }

  return {
    urls,
    modelUsed: model,
    fromMock: false,
  };
}

/* ------------------------------------------------------------------ */
/* 多图参考合成（数字人 / 模特 × 门店场景关键帧）                          */
/* ------------------------------------------------------------------ */

export interface ReferenceImageInput {
  /// 图片二进制
  data: Buffer | Uint8Array;
  /// MIME 类型（默认 image/png）
  mimeType?: string;
  /// 文件名（仅用于 multipart 标识）
  fileName?: string;
}

export interface ComposeReferenceImageArgs {
  /// 编辑指令：描述要合成的画面（如「把图1里的女生放进图2的宠物店货架前，自然站姿，微笑」）
  prompt: string;
  /**
   * 参考图（按顺序对应 prompt 里的「图1 / 图2 ...」）。
   * gpt-image-1 的 images.edit 支持多张输入图，第一张通常作为主体/身份锚点。
   */
  referenceImages: ReferenceImageInput[];
  /// 输出分辨率；9:16 竖版关键帧用 "1024x1536"
  size?: ImageSize | string;
  quality?: ImageQuality;
  /// Blob 落盘前缀（如 "digital-human/{run}/keyframes/"）
  blobPrefix?: string;
  /// 覆盖模型；默认 OPENAI_IMAGE_MODEL > gpt-image-1
  model?: string;
  forceMock?: boolean;
}

export interface ComposeReferenceImageResult {
  url: string;
  modelUsed: string;
  fromMock: boolean;
}

/**
 * 用 gpt-image-1 的 images.edit 做「多图参考合成」：把模特图 + 门店/产品图合成成
 * 一张身份一致的关键帧（数字人探店管线的核心）。
 *
 * 与 generateImages（纯文生图）的区别：这里把若干参考图作为输入，模型在保持
 * 主体（人脸/服装/场景）一致的前提下重绘整图——是把「同一个模特放进不同门店
 * 场景」的关键能力。
 *
 * Mock：缺 OPENAI_API_KEY 或 IMAGE_ENGINE_MOCK=true / forceMock → 返回占位图。
 */
export async function composeReferenceImage(
  args: ComposeReferenceImageArgs,
): Promise<ComposeReferenceImageResult> {
  const useMock = args.forceMock || !isImageGenAvailable();
  if (useMock) {
    return { url: mockUrls(1)[0], modelUsed: "mock", fromMock: true };
  }
  if (!args.referenceImages.length) {
    throw new Error("composeReferenceImage 至少需要一张参考图");
  }

  const model = args.model || process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const size = args.size ?? "1024x1536";
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  /// 把参考图转成 SDK 可上传的 File（multipart）。
  const files = await Promise.all(
    args.referenceImages.map((img, i) =>
      toFile(Buffer.from(img.data), img.fileName ?? `ref-${i}.png`, {
        type: img.mimeType ?? "image/png",
      }),
    ),
  );

  const response = await openai.images.edit({
    model,
    image: files,
    prompt: args.prompt,
    size: size as unknown as "1024x1024" | "1024x1536" | "1536x1024",
    quality: args.quality,
  });

  const item = (response.data ?? []).filter(Boolean)[0];
  if (!item) throw new Error("OpenAI 图像合成返回空结果");

  if (item.url) {
    return { url: item.url, modelUsed: model, fromMock: false };
  }
  if (!item.b64_json) {
    throw new Error("OpenAI 图像合成返回缺少 url / b64_json");
  }

  const storage = getStorageProvider();
  if (!storage.isConfigured()) {
    throw new Error(
      `Storage provider "${storage.id}" 未配置；无法持久化合成的关键帧。`,
    );
  }
  const buffer = Buffer.from(item.b64_json, "base64");
  const key = `${args.blobPrefix || "ai-images/compose/"}${Date.now()}.png`;
  const obj = await storage.uploadBuffer("renders", buffer, {
    key,
    access: "public",
    contentType: "image/png",
    overwrite: true,
  });
  return { url: obj.url, modelUsed: model, fromMock: false };
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
