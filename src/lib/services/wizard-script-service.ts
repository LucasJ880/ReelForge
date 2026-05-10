import {
  AIUsageStatus,
  AngleType,
  Prisma,
  RoundStatus,
  VideoBriefStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  CLIENT_SCRIPT_SYSTEM,
  PROMPT_VERSION as CLIENT_SCRIPT_PROMPT_VERSION,
  buildClientScriptUser,
  defaultLanguageForIndustry,
  mockClientScript,
} from "@/lib/prompts/client-script";
import {
  parseScriptOutput,
  type ScriptOutput,
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
  fallbackReasonWithError,
} from "./wizard-fallback-messages";

/**
 * Wizard Script Service —— Phase 2 step 3。
 *
 * 设计要点（满足 Phase 2 边界）：
 * - **mock fallback**：无 OPENAI_API_KEY 或 LLM 调用/解析失败 → 自动 fallback 到 mockClientScript，
 *   并写入 AIUsageLog，status=MOCK 或 FAILED；wizard 永不被 LLM 卡住。
 * - **不创建并行表**：Script/ScenePlan 仍走现有 VideoBrief→Script→ScenePlan 路径，
 *   wizard 第一次生成时自动创建占位 Round/ContentAngle/VideoBrief 脚手架。
 * - **每次重新生成会把旧 Script.isCurrent=false**，老 ScenePlan 在重新生成 storyboard 时整体 deleteMany
 *   （由 wizard-storyboard-service 负责），wizard-script-service 这里只负责脚本。
 */

export type WizardScriptResult = {
  scriptOutput: ScriptOutput;
  fromMock: boolean;
  reason?: string | null;
  scriptId: string;
  videoBriefId: string;
};

/**
 * 入口：生成或重新生成脚本，返回 ScriptOutput + 持久化的 scriptId。
 */
export async function generateAndPersistWizardScript(params: {
  deliveryOrderId: string;
  /// 选填：覆盖默认目标语言
  targetLanguage?: string;
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
}

/**
 * 纯生成（不落库）：尝试真 LLM，失败则 mock。
 * 始终返回 { scriptOutput, fromMock, reason }。
 */
async function generateScript(params: GenerateScriptParams): Promise<{
  scriptOutput: ScriptOutput;
  fromMock: boolean;
  reason?: string;
}> {
  const { brief, selectedCard, selectedCardId, targetLanguage, deliveryOrderId } = params;
  const promptInput = {
    brief,
    selectedCard,
    targetLanguage:
      targetLanguage ?? defaultLanguageForIndustry(brief.industry),
  };

  if (!isLLMAvailable()) {
    const mock = mockClientScript(promptInput);
    await recordAIUsage({
      feature: "client_script",
      promptVersion: CLIENT_SCRIPT_PROMPT_VERSION,
      deliveryOrderId,
      creativeCardId: selectedCardId,
      status: AIUsageStatus.MOCK,
      inputSummary: `mock fallback (no OPENAI_API_KEY) for ${brief.businessName}`,
      outputSummary: mock.title,
      durationMs: 0,
    });
    return {
      scriptOutput: parseScriptOutput(mock),
      fromMock: true,
      reason: WIZARD_FALLBACK.scriptMissingKey,
    };
  }

  const userPrompt = buildClientScriptUser(promptInput);
  try {
    const data = await withAIUsageTracking(
      {
        feature: "client_script",
        promptVersion: CLIENT_SCRIPT_PROMPT_VERSION,
        model: "gpt-4o-mini",
        deliveryOrderId,
        creativeCardId: selectedCardId,
        inputForLog: userPrompt.slice(0, 1024),
      },
      () =>
        chatJson<unknown>({
          system: CLIENT_SCRIPT_SYSTEM,
          user: userPrompt,
          model: "gpt-4o-mini",
          temperature: 0.7,
        }),
    );
    const validated = parseScriptOutput(data);
    return { scriptOutput: validated, fromMock: false };
  } catch (err) {
    /// LLM 调用或 schema 校验失败 —— withAIUsageTracking 已写入 FAILED log，
    /// 这里再补一条 MOCK fallback 记录。
    const mock = mockClientScript(promptInput);
    await recordAIUsage({
      feature: "client_script",
      promptVersion: CLIENT_SCRIPT_PROMPT_VERSION,
      deliveryOrderId,
      creativeCardId: selectedCardId,
      status: AIUsageStatus.MOCK,
      inputSummary: `mock fallback after LLM error: ${(err as Error).message.slice(0, 200)}`,
      outputSummary: mock.title,
      durationMs: 0,
    });
    return {
      scriptOutput: parseScriptOutput(mock),
      fromMock: true,
      reason: fallbackReasonWithError(WIZARD_FALLBACK.scriptLlmFailedPrefix, err),
    };
  }
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

const WIZARD_ANGLE_TITLE = "Wizard primary angle";

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

  /// 找/建 Round（roundIndex=1）
  let round = await db.round.findFirst({
    where: { deliveryOrderId, roundIndex: 1 },
  });
  if (!round) {
    round = await db.round.create({
      data: {
        deliveryOrderId,
        roundIndex: 1,
        status: RoundStatus.ANGLES_READY,
        optimizationSlots: 1,
        explorationSlots: 0,
      },
    });
  }

  /// 找/建 ContentAngle
  let angle = await db.contentAngle.findFirst({
    where: { roundId: round.id, title: WIZARD_ANGLE_TITLE },
  });
  if (!angle) {
    angle = await db.contentAngle.create({
      data: {
        roundId: round.id,
        sortOrder: 1,
        type: AngleType.OPTIMIZATION,
        title: WIZARD_ANGLE_TITLE,
        hook: null,
        narrative: "Auto-created by wizard for client-facing flow.",
      },
    });
  }

  /// 找/建 VideoBrief
  const existingBrief = await db.videoBrief.findUnique({
    where: { contentAngleId: angle.id },
  });
  if (existingBrief) return existingBrief;

  return db.videoBrief.create({
    data: {
      contentAngleId: angle.id,
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
