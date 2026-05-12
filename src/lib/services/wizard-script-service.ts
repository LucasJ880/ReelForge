import {
  AIUsageStatus,
  Prisma,
  VideoBriefStatus,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  chatJsonByTier,
  isLLMAvailable,
  isLLMForcedMock,
} from "@/lib/providers/openai";
import {
  SINGLE_DIRECTION_ANGLE_TITLE,
  ensureSingleDirectionRound,
} from "./angle-service";
import {
  CLIENT_SCRIPT_SYSTEM,
  PROMPT_VERSION as CLIENT_SCRIPT_PROMPT_VERSION,
  buildClientScriptUser,
  defaultLanguageForIndustry,
  mockClientScript,
} from "@/lib/prompts/client-script";
import {
  scriptOutputSchema,
  type ScriptOutput,
  parseScriptOutput,
} from "@/lib/schemas/script-output";
import {
  recordAIUsage,
  withAIUsageTracking,
} from "./ai-usage-log-service";
import { requireClientBrief } from "./client-project-service";
import { getCreativeEvidenceCard } from "./creative-evidence-service";
import {
  parseCreativeEvidenceCardCore,
  type CreativeEvidenceCardCore,
} from "@/lib/schemas/creative-evidence";
import {
  WIZARD_FALLBACK,
} from "./wizard-fallback-messages";
import {
  LLMSchemaError,
  llmSchemaErrorToAPIResponse,
} from "./llm-schema-error";

/**
 * Wizard Script Service —— Phase 2 step 3。
 *
 * 设计要点（2026-05 P0-1 follow-up 更新后）：
 * - **mock 路径仅在显式条件下触发**：`!isLLMAvailable()`（无 API key）或 `isLLMForcedMock()`
 *   （LLM_FORCE_MOCK / DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK 任一为 true）。
 *   其它情况一律走真 LLM。
 * - **schema 失败必抛 WizardScriptSchemaError**：与 director-service 对齐，再也不静默回退 mock
 *   写占位脚本给客户 —— 否则 UI 不会感知问题、客户继续往下走。
 * - **不创建并行表**：Script/ScenePlan 仍走现有 VideoBrief→Script→ScenePlan 路径，
 *   wizard 第一次生成时自动创建占位 Round/ContentAngle/VideoBrief 脚手架。
 */

export type WizardScriptResult = {
  scriptOutput: ScriptOutput;
  fromMock: boolean;
  reason?: string | null;
  scriptId: string;
  videoBriefId: string;
};

/**
 * WizardScriptSchemaError —— LLM 调用成功但 ScriptOutput zod 校验失败时抛出。
 *
 * 与 DirectorSchemaError 同设计：调用方应捕获并返回 422 + retryable=true，
 * UI 走重试入口，**不**让客户拿到占位脚本然后继续往下流转。
 */
export class WizardScriptSchemaError extends LLMSchemaError {
  readonly code = "script_schema_failed" as const;

  constructor(args: {
    cause: z.ZodError;
    modelUsed: string;
    /// wizard 第一次生成脚本时 brief 尚未创建，这里用 deliveryOrderId 作占位标识；
    /// 重新生成场景下传 VideoBrief.id。
    briefId: string;
  }) {
    super({
      cause: args.cause,
      modelUsed: args.modelUsed,
      briefId: args.briefId,
      userSafeMessage:
        "AI 视频脚本输出格式异常，请点击「重试」重新生成。",
      contextLabel: "[wizard-script]",
    });
  }
}

export function isWizardScriptSchemaError(
  err: unknown,
): err is WizardScriptSchemaError {
  return err instanceof WizardScriptSchemaError;
}

/**
 * Thin wrapper around llmSchemaErrorToAPIResponse — 保留独立函数以保持
 * API route 调用点的类型 narrowing 和 code literal。
 */
export function wizardScriptSchemaErrorToAPIResponse(
  err: WizardScriptSchemaError,
): {
  body: {
    ok: false;
    error: string;
    code: "script_schema_failed";
    retryable: true;
  };
  status: 422;
} {
  const { body, status } = llmSchemaErrorToAPIResponse(err);
  return {
    body: {
      ok: false,
      error: body.error,
      code: "script_schema_failed",
      retryable: true,
    },
    status,
  };
}

/**
 * LLM 调用器（DI seam）：测试通过 deps.invokeLLM 注入；
 * 生产默认走 chatJsonByTier(script tier, gpt-5.5)。
 *
 * 返回 { data: unknown, modelUsed: string }，与 director-service 一致。
 */
export type WizardScriptLLMInvoker = (params: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<{ data: unknown; modelUsed: string }>;

/**
 * 入口：生成或重新生成脚本，返回 ScriptOutput + 持久化的 scriptId。
 *
 * @param params.deps  仅供测试注入；生产路径不要传。
 *                     `invokeLLM` 替换真 OpenAI 调用；`forceMock` 覆盖 isLLMForcedMock() 判定。
 */
export async function generateAndPersistWizardScript(params: {
  deliveryOrderId: string;
  /// 选填：覆盖默认目标语言
  targetLanguage?: string;
  deps?: {
    invokeLLM?: WizardScriptLLMInvoker;
    forceMock?: boolean;
  };
}): Promise<WizardScriptResult> {
  const { deliveryOrderId } = params;
  const brief = await requireClientBrief(deliveryOrderId);

  /// 加载选中的卡片（如果有）
  let selectedCard: CreativeEvidenceCardCore | null = null;
  let selectedCardId: string | null = null;
  if (brief.selectedCardSlug) {
    const card = await getCreativeEvidenceCard(brief.selectedCardSlug);
    if (card) {
      selectedCard = parseCreativeEvidenceCardCore(card);
      selectedCardId = card.id;
    }
  }

  const { scriptOutput, fromMock, reason } = await generateScript({
    deliveryOrderId,
    brief,
    selectedCard,
    selectedCardId,
    targetLanguage: params.targetLanguage,
    deps: params.deps,
  });

  /// 确保有脚手架（Round/ContentAngle/VideoBrief）
  const videoBrief = await ensureWizardVideoBrief(deliveryOrderId, {
    durationSec: brief.videoLengthSec,
    aspectRatio: defaultAspectRatioForBrief(brief.targetPlatforms[0]),
  });

  /// 旧 Script 标 isCurrent=false
  await db.script.updateMany({
    where: { videoBriefId: videoBrief.id, isCurrent: true },
    data: { isCurrent: false },
  });

  /// 计算 version
  const lastVersion = await db.script.findFirst({
    where: { videoBriefId: videoBrief.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const fullText = composeFullText(scriptOutput);

  /// Phase 3A：把完整 ScriptOutput 序列化进 metadata；
  /// fullText/hook/cta 仍维持现有写入，admin 流程零改动。
  const script = await db.script.create({
    data: {
      videoBriefId: videoBrief.id,
      version: (lastVersion?.version ?? 0) + 1,
      language: scriptOutput.language,
      fullText,
      hook: scriptOutput.hook,
      cta: scriptOutput.cta,
      isCurrent: true,
      metadata: serializeScriptOutputForMetadata(scriptOutput),
    },
  });

  /// VideoBrief 状态推进（仅当还在 BRIEF_PENDING / SCRIPT_DRAFTING）
  if (
    videoBrief.status === VideoBriefStatus.BRIEF_PENDING ||
    videoBrief.status === VideoBriefStatus.SCRIPT_DRAFTING
  ) {
    await db.videoBrief.update({
      where: { id: videoBrief.id },
      data: { status: VideoBriefStatus.SCRIPT_READY },
    });
  }

  return {
    scriptOutput,
    fromMock,
    reason: reason ?? null,
    scriptId: script.id,
    videoBriefId: videoBrief.id,
  };
}

interface GenerateScriptParams {
  deliveryOrderId: string;
  brief: Awaited<ReturnType<typeof requireClientBrief>>;
  selectedCard: CreativeEvidenceCardCore | null;
  /// CreativeEvidenceCard.id（不在 Core schema 上），用于 AIUsageLog 关联
  selectedCardId: string | null;
  targetLanguage?: string;
  deps?: {
    invokeLLM?: WizardScriptLLMInvoker;
    forceMock?: boolean;
  };
}

const defaultWizardScriptLLMInvoker: WizardScriptLLMInvoker = async ({
  systemPrompt,
  userPrompt,
}) => {
  /// 走 script tier（GPT-5.5 → gpt-4.1 → gpt-4o）—— 从不退到 mini，
  /// 因为这是客户最终看到的视频脚本。openai.ts 内部已根据 model family
  /// 自动选 max_completion_tokens vs max_tokens。
  const { data, modelUsed } = await chatJsonByTier<unknown>({
    tier: "script",
    stage: "client_script",
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.7,
  });
  return { data, modelUsed };
};

/**
 * 把 LLM 原始输出过 zod，失败时**抛 WizardScriptSchemaError**（不再静默回退 mock）。
 * 与 director-service 的 validateDirectorLLMOutput 完全镜像。
 */
export function validateScriptLLMOutput(
  rawOutput: unknown,
  meta: { modelUsed: string; briefId: string },
): ScriptOutput {
  const parsed = scriptOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    throw new WizardScriptSchemaError({
      cause: parsed.error,
      modelUsed: meta.modelUsed,
      briefId: meta.briefId,
    });
  }
  return parsed.data;
}

/**
 * 纯生成（不落库）：mock 路径 = 「无 API key」 或 「isLLMForcedMock()」；
 * 真 LLM 路径 schema 失败必抛 WizardScriptSchemaError，**不**再静默回退 mock。
 */
async function generateScript(params: GenerateScriptParams): Promise<{
  scriptOutput: ScriptOutput;
  fromMock: boolean;
  reason?: string;
}> {
  const {
    brief,
    selectedCard,
    selectedCardId,
    targetLanguage,
    deliveryOrderId,
    deps,
  } = params;
  const promptInput = {
    brief,
    selectedCard,
    targetLanguage:
      targetLanguage ?? defaultLanguageForIndustry(brief.industry),
  };

  const forceMock = deps?.forceMock ?? isLLMForcedMock();

  /// Mock 路径：仅这两种情况触发
  ///  1) 无 OPENAI_API_KEY —— 本地开发 / CI；
  ///  2) isLLMForcedMock() —— LLM_FORCE_MOCK / DIRECTOR_FORCE_MOCK / SCRIPT_FORCE_MOCK 任一为 true。
  /// 其它一律走真 LLM；schema 失败时**直接 throw**，让 UI 走重试，绝不写占位脚本。
  if (forceMock || !isLLMAvailable()) {
    const mock = mockClientScript(promptInput);
    const reason = forceMock
      ? "LLM_FORCE_MOCK env enabled — skipping real OpenAI call (forced mock mode)"
      : WIZARD_FALLBACK.scriptMissingKey;
    await recordAIUsage({
      feature: "client_script",
      promptVersion: CLIENT_SCRIPT_PROMPT_VERSION,
      deliveryOrderId,
      creativeCardId: selectedCardId,
      status: AIUsageStatus.MOCK,
      inputSummary: forceMock
        ? `mock fallback (LLM_FORCE_MOCK) for ${brief.businessName}`
        : `mock fallback (no OPENAI_API_KEY) for ${brief.businessName}`,
      outputSummary: mock.title,
      durationMs: 0,
    });
    return {
      scriptOutput: parseScriptOutput(mock),
      fromMock: true,
      reason,
    };
  }

  const systemPrompt = CLIENT_SCRIPT_SYSTEM;
  const userPrompt = buildClientScriptUser(promptInput);
  const invokeLLM = deps?.invokeLLM ?? defaultWizardScriptLLMInvoker;

  /// withAIUsageTracking 已封装：成功写 SUCCESS，调用层异常写 FAILED + errorMessage。
  /// 我们额外在 schema 失败处把通用 Error wrap 成 WizardScriptSchemaError 再 throw。
  let modelUsed: string | undefined;
  const data = await withAIUsageTracking(
    {
      feature: "client_script",
      promptVersion: CLIENT_SCRIPT_PROMPT_VERSION,
      deliveryOrderId,
      creativeCardId: selectedCardId,
      inputForLog: userPrompt.slice(0, 1024),
    },
    async () => {
      const result = await invokeLLM({ systemPrompt, userPrompt });
      modelUsed = result.modelUsed;
      return { data: result.data, modelUsed: result.modelUsed };
    },
  );

  const validated = validateScriptLLMOutput(data, {
    modelUsed: modelUsed ?? "unknown",
    /// 这里 brief 尚未持久化（generateAndPersistWizardScript 后才创建 VideoBrief），
    /// 用 deliveryOrderId 当 briefId 占位，方便日志关联。
    briefId: deliveryOrderId,
  });
  return { scriptOutput: validated, fromMock: false };
}

/**
 * 取得当前 wizard 的 current Script + 完整 ScriptOutput（如有）。
 * UI 渲染用 / storyboard 二次输入用。
 *
 * Phase 3A：scriptOutput 来自 Script.metadata（兼容旧数据：缺失或 parse 失败 → null，不抛错）。
 */
export async function getCurrentWizardScript(deliveryOrderId: string) {
  const videoBrief = await findWizardVideoBrief(deliveryOrderId);
  if (!videoBrief) return null;
  const script = await db.script.findFirst({
    where: { videoBriefId: videoBrief.id, isCurrent: true },
    orderBy: { version: "desc" },
  });
  if (!script) return null;
  return {
    scriptId: script.id,
    videoBriefId: videoBrief.id,
    language: script.language,
    fullText: script.fullText,
    hook: script.hook,
    cta: script.cta,
    version: script.version,
    scriptOutput: readScriptOutputFromMetadata(script.metadata),
  };
}

/**
 * 宽容读取：parse 失败返回 null，从不抛错。
 * 老数据（admin 流程或 Phase 3A 之前的 wizard 行）metadata=null → 直接返回 null，
 * 调用方（storyboard service）自行兜底到 markdown 反向解析。
 */
export function readScriptOutputFromMetadata(
  metadata: unknown,
): ScriptOutput | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  try {
    return parseScriptOutput(metadata);
  } catch {
    return null;
  }
}

/**
 * 把已通过 zod 校验的 ScriptOutput 序列化为 Prisma JSON 输入。
 * 单独提一个工具函数，便于测试 round-trip。
 */
export function serializeScriptOutputForMetadata(
  scriptOutput: ScriptOutput,
): Prisma.InputJsonValue {
  return scriptOutput as unknown as Prisma.InputJsonValue;
}

/**
 * 直接编辑 hook / cta / fullText。
 * Wizard step 3 允许客户在生成后微调，不需要重跑 LLM。
 */
export async function patchWizardScript(params: {
  deliveryOrderId: string;
  hook?: string;
  cta?: string;
  fullText?: string;
}) {
  const videoBrief = await findWizardVideoBrief(params.deliveryOrderId);
  if (!videoBrief) throw new Error("Wizard 还未生成脚本，无法编辑");
  const current = await db.script.findFirst({
    where: { videoBriefId: videoBrief.id, isCurrent: true },
  });
  if (!current) throw new Error("当前 Wizard 没有可编辑的 Script");
  return db.script.update({
    where: { id: current.id },
    data: {
      hook: params.hook ?? current.hook,
      cta: params.cta ?? current.cta,
      fullText: params.fullText ?? current.fullText,
    },
  });
}

/// ---------- 内部：脚手架 ----------

/**
 * 与 angle-service.SINGLE_DIRECTION_ANGLE_TITLE 共享同一常量，
 * 让 wizard 与 director 服务都识别同一条 angle 是「单方向 wizard angle」。
 */
const WIZARD_ANGLE_TITLE = SINGLE_DIRECTION_ANGLE_TITLE;

async function findWizardVideoBrief(deliveryOrderId: string) {
  const round = await db.round.findFirst({
    where: { deliveryOrderId },
    orderBy: { roundIndex: "desc" },
    include: {
      angles: {
        orderBy: { sortOrder: "asc" },
        include: { videoBrief: true },
      },
    },
  });
  if (!round) return null;
  for (const angle of round.angles) {
    if (angle.videoBrief) return angle.videoBrief;
  }
  return null;
}

async function ensureWizardVideoBrief(
  deliveryOrderId: string,
  defaults: { durationSec: number; aspectRatio: "9:16" | "1:1" | "16:9" },
) {
  const existing = await findWizardVideoBrief(deliveryOrderId);
  if (existing) return existing;

  /// 委托给 angle-service.ensureSingleDirectionRound：单创意方向 + 1 Round + 1 ContentAngle，
  /// 不进赛马。两处共享同一 helper 避免双套 Round 创建逻辑漂移。
  const { angleId } = await ensureSingleDirectionRound(deliveryOrderId);

  /// 双保险：如果该 angle 标题不是 WIZARD_ANGLE_TITLE（可能由 admin 创建），
  /// 仍然继续在这条 angle 上挂 VideoBrief —— 我们不抢占 admin angle。
  void WIZARD_ANGLE_TITLE;

  const existingBrief = await db.videoBrief.findUnique({
    where: { contentAngleId: angleId },
  });
  if (existingBrief) return existingBrief;

  return db.videoBrief.create({
    data: {
      contentAngleId: angleId,
      status: VideoBriefStatus.SCRIPT_DRAFTING,
      durationSec: defaults.durationSec,
      aspectRatio: defaults.aspectRatio,
      tone: null,
    },
  });
}

function defaultAspectRatioForBrief(
  platform: string | undefined,
): "9:16" | "1:1" | "16:9" {
  switch (platform) {
    case "instagram_feed":
      return "1:1";
    case "youtube":
    case "facebook":
    case "website":
      return "16:9";
    case "tiktok":
    case "instagram_reels":
    case "youtube_shorts":
    default:
      return "9:16";
  }
}

function composeFullText(script: ScriptOutput): string {
  const captionLines = script.captions
    .map((c) => `  [Scene ${c.sceneIndex}] ${c.text}`)
    .join("\n");
  return [
    `# ${script.title}`,
    "",
    "## Hook",
    script.hook,
    "",
    "## Voiceover",
    script.voiceover,
    "",
    "## Captions",
    captionLines || "(none)",
    "",
    "## CTA",
    script.cta,
    script.complianceNotes.length
      ? `\n## Compliance\n${script.complianceNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/// 仅供测试导入
export const __test__ = {
  defaultWizardScriptLLMInvoker,
  validateScriptLLMOutput,
};
