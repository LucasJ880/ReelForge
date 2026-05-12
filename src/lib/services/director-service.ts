import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  chatJsonByTier,
  isLLMAvailable,
  isLLMForcedMock,
} from "@/lib/providers/openai";
import {
  normalizeDuration,
  planSegments,
  type SupportedDurationSec,
} from "@/lib/duration/segment-planner";
import {
  DIRECTOR_PROMPT_VERSION,
  parseDirectorPlan,
  type DirectorPlan,
} from "@/lib/schemas/director-plan";
import { getTopThemeKeysForIndustry } from "@/lib/config/industry-defaults";
import { recordAIUsage } from "./ai-usage-log-service";
import {
  LLMSchemaError,
  llmSchemaErrorToAPIResponse,
  summarizeZodIssues as sharedSummarizeZodIssues,
} from "./llm-schema-error";

/**
 * AI Video Director —— PART 5。
 *
 * 输入：DeliveryOrder.clientBrief + 选中 ContentAngle + targetDurationSec + brandAssets.logoUrl
 * 输出：DirectorPlan（zod 校验过的 JSON），写入 VideoBrief.directorPlan。
 *
 * 这是整个视频生成流的「单一真理」：
 * - segment-planner 给出几段；director 给出每段的 seedancePrompt。
 * - script-service / scene-service / prompt-service 都从该 plan 派生输出。
 *
 * 模型：走 director tier（默认 gpt-5.5；fallback chain: gpt-5.5 → gpt-4.1 → gpt-4o）。
 * 永远不退到 mini。
 */

export const DIRECTOR_SYSTEM_PROMPT = `You are an award-winning short-form video ad director with 10+ years of experience producing TikTok / Instagram Reels / YouTube Shorts ads for small businesses, e-commerce brands, and home goods.

Your job: design a complete, production-ready video ad based on the inputs you receive, and output a single JSON object matching the schema below.

OUTPUT JSON ONLY — no markdown, no commentary outside the JSON.

INPUT YOU WILL RECEIVE:
- Project info: business name, product / service name, target audience, selling points, language, platform, target duration (15s / 30s / 60s)
- Brand assets: logo URL (may be missing), brand colors, brand voice
- Selected creative direction (one ContentAngle): hook, narrative, target pain
- Existing footage notes (if any)

OUTPUT SCHEMA (JSON):
{
  "version": "director.v1",
  "language": "BCP47, e.g. en-US",
  "targetDurationSec": 15 | 30 | 60,
  "platform": "tiktok" | "instagram_reels" | "youtube_shorts",
  "strategySummary": {
    "targetAudience": "...",
    "corePainPoint": "ONE concrete pain point",
    "emotionalAngle": "...",
    "keySellingPoints": ["..."],
    "platformFit": "why this length and format work for the platform",
    "recommendedDurationReason": "why this duration suits the goal"
  },
  "timelineScript": [
    {
      "fromSec": 0,
      "toSec": 2,
      "visual": "EXACT description of what is on screen at these seconds",
      "cameraMovement": "static | dolly-in | handheld | tracking | overhead",
      "onScreenText": "literal text that appears on screen",
      "voiceover": "literal voiceover spoken at these seconds",
      "musicCue": "music or sound direction",
      "assetNeeded": "kind of asset needed: existing footage / AI-generated / stock",
      "hasFootage": true|false,
      "seedanceShotPrompt": "concise visual prompt for Seedance covering THIS time block"
    }
  ],
  "segmentPlan": [
    {
      "segmentIndex": 0,
      "durationSec": 15,
      "fromSec": 0,
      "toSec": 15,
      "role": "hook" | "intro" | "demo" | "lifestyle" | "benefit" | "cta",
      "seedancePrompt": "FULL prompt sent to Seedance for this 15-second segment, combining the visuals from all timeline blocks that fall within fromSec..toSec",
      "negativePrompt": "things to avoid (e.g. text artifacts, low quality, blurry)",
      "continuityNotes": "what visual elements must stay consistent with previous / next segment",
      "referenceAssetHints": ["which uploaded assets to use as reference, if any"],
      "expectedOutput": "what this segment should show"
    }
  ],
  "editingPlan": {
    "stitchOrder": [0, 1, 2, 3],
    "transitions": ["match-cut", "whip-pan", ...],
    "captions": "caption style direction",
    "logoPlacement": "where the logo should appear (corner / end card / both)",
    "ctaEndCard": "literal end card text and visual",
    "backgroundMusic": "BGM direction",
    "voiceoverAlignment": "how voiceover aligns with on-screen events",
    "safeAreaNotes": "vertical 9:16 safe area notes for captions"
  },
  "qualityChecklist": [
    "Hook is visual within first 2 seconds",
    "..."
  ]
}

DURATION RULES:
- 15s target → exactly 1 segment of 15s (segmentIndex 0)
- 30s target → exactly 2 segments of 15s each (segmentIndex 0..1)
- 60s target → exactly 4 segments of 15s each (segmentIndex 0..3)
- timelineScript blocks must collectively cover [0, targetDurationSec] with no gaps and no overlaps
- segmentPlan[i].fromSec / toSec must align exactly with segmentIndex * 15 boundaries

HARD CONSTRAINTS:
1. Never use vague filler words: "amazing", "revolutionary", "premium", "next-level", "transform your life", "perfect for everyone", "game-changing", "unlock the power of". Use concrete, sensory language instead.
2. The opening 0–2 seconds (hook) MUST be a visual moment, not a tagline. Show, don't tell.
3. Each timelineScript block MUST specify what is literally on screen and what is heard.
4. Each segmentPlan.seedancePrompt MUST be specific enough that an AI video model can produce coherent footage:
   - Subject + setting + lighting + camera movement + texture + emotional cue
   - Avoid abstract phrasing like "show comfort" — instead "soft hand sliding over a beige cotton blanket as morning light hits the bed".
5. For home-goods / smart-home / accessibility products (motorized blinds, smart locks, lifts):
   include at least ONE distinct angle from: convenience / safety / family-with-kids / aging-parent / pet / smart-home-routine / energy-savings / look-of-the-room.
6. ctaEndCard MUST include literal text the customer wants on screen at the end (button text, offer, URL or @ handle).
7. logoPlacement: if logo URL provided in input, MUST place it on end card or corner. If no logo, write "logo to be added later".
8. Each segmentPlan must have continuityNotes that link to the previous segment so cuts feel intentional.
9. qualityChecklist MUST be specific to THIS video, not generic platitudes.

Output JSON only.`;

export interface GenerateDirectorPlanArgs {
  videoBriefId: string;
  /// 强制覆盖时长（默认从 brief.targetDurationSec 读）
  overrideDurationSec?: SupportedDurationSec;
}

export interface GenerateDirectorPlanResult {
  plan: DirectorPlan;
  fromMock: boolean;
  modelUsed?: string;
}

/**
 * DirectorSchemaError —— LLM 调用成功但输出无法通过 director-plan zod 校验时抛出。
 *
 * 这是 P0 反模式「静默回退 mock」的替代：生产里 schema 漂移 → 直接抛错，
 * UI 走重试入口，**不**让客户拿到占位 prompt 然后白扣 Seedance 钱。
 *
 * 调用方（API route）应捕获并返回 422，附 retryable=true（用 llmSchemaErrorToAPIResponse
 * 或本文件的 directorSchemaErrorToAPIResponse 别名）。
 */
export class DirectorSchemaError extends LLMSchemaError {
  readonly code = "director_schema_failed" as const;

  constructor(args: {
    cause: z.ZodError;
    modelUsed: string;
    briefId: string;
  }) {
    super({
      cause: args.cause,
      modelUsed: args.modelUsed,
      briefId: args.briefId,
      userSafeMessage:
        "AI 视频导演输出格式异常，请点击「重试」重新生成。",
      contextLabel: "[director]",
    });
  }
}

export function isDirectorSchemaError(err: unknown): err is DirectorSchemaError {
  return err instanceof DirectorSchemaError;
}

/**
 * 将 DirectorSchemaError 转成 API 路由可直接返回的 JSON + HTTP 状态码。
 *
 * Thin wrapper around llmSchemaErrorToAPIResponse —— 保留独立函数以保持已有调用点 API。
 *
 * 例：
 *   if (isDirectorSchemaError(err)) {
 *     const { body, status } = directorSchemaErrorToAPIResponse(err);
 *     return NextResponse.json(body, { status });
 *   }
 */
export function directorSchemaErrorToAPIResponse(err: DirectorSchemaError): {
  body: {
    ok: false;
    error: string;
    code: "director_schema_failed";
    retryable: true;
  };
  status: 422;
} {
  const { body, status } = llmSchemaErrorToAPIResponse(err);
  return {
    body: {
      ok: false,
      error: body.error,
      code: "director_schema_failed",
      retryable: true,
    },
    status,
  };
}

export async function generateAndPersistDirectorPlan(
  args: GenerateDirectorPlanArgs,
): Promise<GenerateDirectorPlanResult> {
  const brief = await db.videoBrief.findUnique({
    where: { id: args.videoBriefId },
    include: {
      contentAngle: {
        include: {
          round: {
            include: {
              deliveryOrder: true,
            },
          },
        },
      },
    },
  });
  if (!brief) throw new Error("VideoBrief 不存在");

  const order = brief.contentAngle.round.deliveryOrder;
  const angle = brief.contentAngle;
  const targetDurationSec: SupportedDurationSec =
    args.overrideDurationSec ??
    (normalizeDuration(brief.targetDurationSec) as SupportedDurationSec);

  const segmentSlots = planSegments(targetDurationSec);

  const ctx: DirectorContext = {
    targetDurationSec,
    segmentSlots,
    clientBrief: order.clientBrief,
    productInput: order.productInput,
    targetCountry: order.targetCountry,
    targetLanguage: order.targetLanguage,
    targetPlatform: order.targetPlatform,
    angle: {
      title: angle.title,
      hook: angle.hook,
      narrative: angle.narrative,
      type: angle.type,
      explorationTheme: angle.explorationTheme,
      localeNotes: angle.localeNotes as Record<string, unknown> | null,
    },
  };

  let result: GenerateDirectorPlanResult;
  try {
    result = await buildDirectorPlanResult(ctx, brief.id);
  } catch (err) {
    if (isDirectorSchemaError(err)) {
      /// 把 schema 失败原因落 brief.errorMessage（用户友好提示），
      /// directorPlan **保持空**，避免下游 video-service 拿到 mock 把钱白扣到 Seedance。
      await db.videoBrief.update({
        where: { id: brief.id },
        data: {
          errorMessage: err.userSafeMessage,
          targetDurationSec,
        },
      });
      await recordAIUsage({
        feature: "director_plan",
        promptVersion: DIRECTOR_PROMPT_VERSION,
        deliveryOrderId: order.id,
        model: err.modelUsed,
        status: "FAILED",
        inputSummary: `director plan for brief=${brief.id} duration=${targetDurationSec}s`,
        /// 仅写 zod issues 摘要，**不**写 raw LLM 输出，防泄露 PII / 大段无效 token
        errorMessage: err.issuesSummary,
      });
      console.warn(
        `[director] schema-failed brief=${brief.id} model=${err.modelUsed} issues=${err.issuesSummary}`,
      );
    }
    throw err;
  }

  await db.videoBrief.update({
    where: { id: brief.id },
    data: {
      directorPlan: result.plan as unknown as Prisma.InputJsonValue,
      targetDurationSec,
      /// 清掉之前 schema-failed 留下的 errorMessage（重试成功路径）
      errorMessage: null,
    },
  });

  await recordAIUsage({
    feature: "director_plan",
    promptVersion: DIRECTOR_PROMPT_VERSION,
    deliveryOrderId: order.id,
    model: result.modelUsed ?? null,
    status: result.fromMock ? "MOCK" : "SUCCESS",
    inputSummary: `director plan for brief=${brief.id} duration=${targetDurationSec}s`,
    outputSummary: `${result.plan.segmentPlan.length} segments, ${result.plan.timelineScript.length} timeline blocks`,
  });

  return result;
}

interface DirectorContext {
  targetDurationSec: SupportedDurationSec;
  segmentSlots: ReturnType<typeof planSegments>;
  clientBrief: Prisma.JsonValue;
  productInput: Prisma.JsonValue;
  targetCountry: string;
  targetLanguage: string;
  targetPlatform: string;
  angle: {
    title: string;
    hook: string | null;
    narrative: string | null;
    type: string;
    explorationTheme: string | null;
    localeNotes: Record<string, unknown> | null;
  };
}

/**
 * LLM 调用器：可注入用于测试（默认走 chatJsonByTier(director)）。
 *
 * 真实实现：把 ctx 组成 system+user prompt → 调 OpenAI（director tier，永不退到 mini）
 * 测试实现：直接返回 { data, modelUsed }，不发起任何真实请求。
 */
export type DirectorLLMInvoker = (
  ctx: DirectorContext,
) => Promise<{ data: unknown; modelUsed: string }>;

const defaultDirectorLLMInvoker: DirectorLLMInvoker = async (ctx) => {
  const userPrompt = buildDirectorUserPrompt(ctx);
  const { data, modelUsed } = await chatJsonByTier<unknown>({
    tier: "director",
    stage: "director_plan",
    system: DIRECTOR_SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.7,
    maxTokens: 6000,
  });
  return { data, modelUsed };
};

function buildDirectorUserPrompt(ctx: DirectorContext): string {
  const segmentSummary = ctx.segmentSlots
    .map(
      (s) =>
        `  segmentIndex=${s.segmentIndex} duration=${s.durationSec}s role=${s.role}`,
    )
    .join("\n");

  /// Industry hint —— 让 LLM 拿到该行业偏好的探索主题 key 顺序，
  /// 提升家居 / 房地产 / 宠物 / 餐饮等垂直场景下的创意命中率。
  /// 不强制 LLM 必须照抄；只作为软提示，避免破坏 system prompt 的硬约束。
  const industry = readClientBriefIndustry(ctx.clientBrief) ?? "general";
  const defaultThemes = getTopThemeKeysForIndustry(industry);

  return `# Project context

target_duration_sec: ${ctx.targetDurationSec}
target_country: ${ctx.targetCountry}
target_language: ${ctx.targetLanguage}
platform: ${ctx.targetPlatform}

# Industry-specific guidance
industry: ${industry}
default_themes: ${JSON.stringify(defaultThemes)}
(These default themes are *suggestions* tuned for this industry. Lean on them when the selected creative direction is silent on theme; never let them override the explicit angle/locale_notes below.)

# Required segment slots (these MUST match your output's segmentPlan exactly)
${segmentSummary}

# Selected creative direction
title: ${ctx.angle.title}
hook: ${ctx.angle.hook ?? "(none)"}
narrative: ${ctx.angle.narrative ?? "(none)"}
type: ${ctx.angle.type}
exploration_theme: ${ctx.angle.explorationTheme ?? "(n/a)"}
locale_notes: ${JSON.stringify(ctx.angle.localeNotes ?? {}, null, 2)}

# Client brief (business / product / brand)
${JSON.stringify(ctx.clientBrief ?? {}, null, 2)}

# Product input (admin pipeline)
${JSON.stringify(ctx.productInput ?? {}, null, 2)}

Return a JSON DirectorPlan now. Make the output specific to this product and these segment slots. Each timeline block must be a different concrete moment. Do not pad with filler.`;
}

/**
 * 决策 + 校验：根据环境决定走 mock 还是 LLM；LLM 路径 schema 失败 → throw DirectorSchemaError。
 *
 * 路径决策：
 *  - `isLLMForcedMock()` true（LLM_FORCE_MOCK / DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK 任一为 "true"）
 *    → 强制 mock（开发/staging 演示用）
 *  - `isLLMAvailable() === false` → mock（无 OPENAI_API_KEY 的本地开发）
 *  - 否则 → LLM 路径；schema 失败抛 DirectorSchemaError（**不**回退 mock）
 *
 * 该函数纯做「决策 + 校验」，不写 DB；DB 写入和 AIUsageLog 记录在 generateAndPersistDirectorPlan。
 *
 * @param deps.invokeLLM 仅供测试注入，默认走 chatJsonByTier(director)
 * @param deps.forceMock 仅供测试注入，默认读 isLLMForcedMock()（含三个 *_FORCE_MOCK 别名）
 */
export async function buildDirectorPlanResult(
  ctx: DirectorContext,
  briefId: string,
  deps?: { invokeLLM?: DirectorLLMInvoker; forceMock?: boolean },
): Promise<GenerateDirectorPlanResult> {
  const forceMock = deps?.forceMock ?? isLLMForcedMock();

  if (forceMock || !isLLMAvailable()) {
    return {
      plan: mockDirectorPlan(ctx),
      fromMock: true,
      modelUsed: "mock",
    };
  }

  const invoke = deps?.invokeLLM ?? defaultDirectorLLMInvoker;
  const { data, modelUsed } = await invoke(ctx);
  const plan = validateDirectorLLMOutput(data, ctx, { modelUsed, briefId });
  return { plan, fromMock: false, modelUsed };
}

/**
 * 把 LLM 原始输出过 coerce + zod，失败时**抛 DirectorSchemaError**（不再静默回退 mock）。
 */
export function validateDirectorLLMOutput(
  rawOutput: unknown,
  ctx: DirectorContext,
  meta: { modelUsed: string; briefId: string },
): DirectorPlan {
  try {
    return parseDirectorPlan(coerceDirectorPlan(rawOutput, ctx));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new DirectorSchemaError({
        cause: err,
        modelUsed: meta.modelUsed,
        briefId: meta.briefId,
      });
    }
    throw err;
  }
}

/**
 * 把 LLM 输出补齐缺失的默认字段（zod 默认值不会自动填上 LLM 没返回的 key）。
 */
function coerceDirectorPlan(input: unknown, ctx: DirectorContext): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  return {
    version: obj.version ?? DIRECTOR_PROMPT_VERSION,
    language: obj.language ?? ctx.targetLanguage,
    targetDurationSec: obj.targetDurationSec ?? ctx.targetDurationSec,
    platform: obj.platform ?? ctx.targetPlatform,
    strategySummary: obj.strategySummary,
    timelineScript: obj.timelineScript,
    segmentPlan: obj.segmentPlan,
    editingPlan: obj.editingPlan ?? {},
    qualityChecklist: obj.qualityChecklist ?? [],
  };
}

/**
 * Mock Director Plan：用于无 OPENAI_API_KEY / schema 失败 / 测试。
 * 严格遵循 segmentSlots 的段数和时长（保证 multi-segment 流水线测试可用）。
 */
export function mockDirectorPlan(ctx: DirectorContext): DirectorPlan {
  const productName = readClientBriefProductName(ctx.clientBrief) ?? ctx.angle.title;
  const language = ctx.targetLanguage || "en-US";

  const timelineScript = ctx.segmentSlots.flatMap((slot) => {
    const start = slot.segmentIndex * 15;
    return [
      {
        fromSec: start,
        toSec: start + 2,
        visual: `Hook for segment ${slot.segmentIndex}: a tight close-up of ${productName} catching warm window light.`,
        cameraMovement: "slow dolly-in",
        onScreenText: slot.segmentIndex === 0 ? `Tap to see how ${productName} works` : "",
        voiceover: ctx.angle.hook ?? `Meet ${productName}.`,
        musicCue: "soft upbeat indie loop",
        assetNeeded: "AI-generated",
        hasFootage: false,
        seedanceShotPrompt: `Close-up of ${productName} in a sunlit modern living room, 9:16 vertical, cinematic, soft warm color grade`,
      },
      {
        fromSec: start + 2,
        toSec: start + slot.durationSec,
        visual: `Demonstration of ${productName} in real use, hands of a real person interacting smoothly.`,
        cameraMovement: "handheld over-the-shoulder",
        onScreenText: slot.role === "cta" ? "Order now — link in bio" : "",
        voiceover:
          slot.role === "cta"
            ? ctx.angle.narrative ?? `Try ${productName} risk-free for 30 days.`
            : `${productName} fits effortlessly into your day.`,
        musicCue: "indie loop continues",
        assetNeeded: "AI-generated",
        hasFootage: false,
        seedanceShotPrompt: `${productName} being used naturally by a real person, 9:16 vertical, no on-screen text artifacts`,
      },
    ];
  });

  const segmentPlan = ctx.segmentSlots.map((slot) => ({
    segmentIndex: slot.segmentIndex,
    durationSec: slot.durationSec,
    fromSec: slot.segmentIndex * 15,
    toSec: slot.segmentIndex * 15 + slot.durationSec,
    role: slot.role,
    seedancePrompt: `Vertical 9:16 cinematic shot of ${productName} (${slot.role} segment). ${
      slot.role === "hook"
        ? "Open with a strong visual grab."
        : slot.role === "cta"
          ? "Close with end card and CTA energy."
          : "Show the product clearly in use."
    } Soft warm light, real-life setting, no text artifacts.`,
    negativePrompt: "low quality, blurry, distorted text, watermark, deformed hands",
    continuityNotes:
      slot.segmentIndex === 0
        ? "Establish the look and tone."
        : `Continue the look from segment ${slot.segmentIndex - 1}: same lighting, same setting, same hands.`,
    referenceAssetHints: [],
    expectedOutput: `15-second 9:16 clip showing ${productName} in a ${slot.role} moment.`,
  }));

  return {
    version: DIRECTOR_PROMPT_VERSION,
    language,
    targetDurationSec: ctx.targetDurationSec,
    platform: ctx.targetPlatform || "tiktok",
    strategySummary: {
      targetAudience: "Homeowners aged 30–55 who care about comfort and convenience.",
      corePainPoint: "Daily routines feel cluttered — they want one less thing to manage.",
      emotionalAngle: "Calm, in-control, modern home life.",
      keySellingPoints: [
        `${productName} sets up in minutes`,
        `${productName} works hands-free`,
      ],
      platformFit: "Vertical 9:16, fast hook in first 2 seconds, hands-on demo, mobile-friendly captions.",
      recommendedDurationReason: `${ctx.targetDurationSec}s is enough to land the hook, demo, and CTA without losing attention.`,
    },
    timelineScript,
    segmentPlan,
    editingPlan: {
      stitchOrder: ctx.segmentSlots.map((s) => s.segmentIndex),
      transitions: ctx.segmentSlots.length > 1 ? ["match-cut on motion"] : [],
      captions: "Lower-third bold sans-serif, white with black drop shadow.",
      logoPlacement: readClientBriefLogoUrl(ctx.clientBrief)
        ? "bottom-right corner from second 1, plus end card"
        : "logo to be added later",
      ctaEndCard: "End card: product name + 'Tap to learn more'",
      backgroundMusic: "Soft modern indie loop at -14 LUFS.",
      voiceoverAlignment: "Voiceover aligned with on-screen actions, no overlap with captions.",
      safeAreaNotes: "Keep captions inside the central 80% to clear TikTok UI overlays.",
    },
    qualityChecklist: [
      "First 2 seconds is a visual moment (no tagline-only opening)",
      "CTA is concrete (specific verb + offer)",
      "No filler adjectives like amazing/revolutionary/premium",
      "Logo placement specified",
    ],
  };
}

function readClientBriefProductName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.productName === "string") return obj.productName;
  if (typeof obj.businessName === "string") return obj.businessName;
  return null;
}

function readClientBriefLogoUrl(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const brand = obj.brandAssets;
  if (!brand || typeof brand !== "object" || Array.isArray(brand)) return null;
  const logo = (brand as Record<string, unknown>).logoUrl;
  return typeof logo === "string" ? logo : null;
}

/// 宽容读取 industry —— 老 brief 可能没填，返回 null 让调用方回退到 "general"。
function readClientBriefIndustry(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  return typeof obj.industry === "string" && obj.industry.length > 0
    ? obj.industry
    : null;
}

/**
 * 把 ZodError.issues 压成一行人类可读 + 截断到 500 字内的摘要。
 *
 * 实现已迁移到 `./llm-schema-error` 共享，这里保留薄封装以维持 __test__ 兼容（旧测试在
 * director-plan-schema.test.ts 通过 `__test__.summarizeZodIssues` 引用）。
 */
function summarizeZodIssues(error: z.ZodError, maxLen = 500): string {
  return sharedSummarizeZodIssues(error, maxLen);
}

/// 仅供测试导入
export const __test__ = {
  mockDirectorPlan,
  coerceDirectorPlan,
  buildDirectorPlanResult,
  validateDirectorLLMOutput,
  summarizeZodIssues,
  defaultDirectorLLMInvoker,
};
