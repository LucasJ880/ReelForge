import { AIUsageStatus, Prisma, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import {
  STORYBOARD_SYSTEM,
  PROMPT_VERSION as STORYBOARD_PROMPT_VERSION,
  buildStoryboardUser,
  mockStoryboard,
} from "@/lib/prompts/storyboard";
import { buildShootingGuideFromStoryboard } from "@/lib/prompts/shooting-guide";
import {
  parseStoryboardOutput,
  checkStoryboardDurationConsistency,
  type StoryboardOutput,
  type StoryboardShot,
} from "@/lib/schemas/storyboard";
import {
  parseScriptOutput,
  type ScriptOutput,
} from "@/lib/schemas/script-output";
import {
  recordAIUsage,
  withAIUsageTracking,
} from "./ai-usage-log-service";
import { requireClientBrief } from "./client-project-service";
import { getCurrentWizardScript } from "./wizard-script-service";
import {
  parseShootingGuideDoc,
  type ShootingGuideItem,
} from "@/lib/schemas/shooting-guide";
import {
  WIZARD_FALLBACK,
  fallbackReasonWithError,
} from "./wizard-fallback-messages";

/**
 * Wizard Storyboard Service —— Phase 2 step 4。
 *
 * 设计要点：
 * - 输入：当前 wizard Script（必须存在）+ ClientBrief；
 * - 输出：StoryboardOutput + ShootingGuideDoc，并把每个 shot 写成 ScenePlan 行（带 shootingGuide JSON）；
 * - mock fallback：与 script service 一致 —— 无 LLM 或失败时走 mockStoryboard，AIUsageLog 记 MOCK；
 * - 重新生成时：先 deleteMany 旧 ScenePlan（matchedShotId onDelete:SetNull 会保护 RawAsset）。
 *
 * Shooting Guide 当前用 deterministic builder（buildShootingGuideFromStoryboard），
 * 不强制 LLM 二次调用 —— 这是 Phase 1 已经定的策略。
 */

export type WizardStoryboardResult = {
  storyboard: StoryboardOutput;
  shootingGuideItems: ShootingGuideItem[];
  fromMock: boolean;
  reason?: string | null;
  scriptId: string;
  scenePlanIds: string[];
  durationConsistencyIssues: string[];
};

export async function generateAndPersistWizardStoryboard(params: {
  deliveryOrderId: string;
}): Promise<WizardStoryboardResult> {
  const { deliveryOrderId } = params;
  const brief = await requireClientBrief(deliveryOrderId);

  /// 必须先有 Script
  const current = await getCurrentWizardScript(deliveryOrderId);
  if (!current) {
    throw new Error(
      "Wizard 还未生成脚本：请先在 Step 3 生成脚本，再回来生成分镜。",
    );
  }
  const scriptOutput = await reconstructScriptOutputForPrompt(current);

  const { storyboard, fromMock, reason } = await generateStoryboard({
    deliveryOrderId,
    brief,
    script: scriptOutput,
  });

  /// 持久化：先清旧 ScenePlan，再批量插入 + 同步 shooting guide
  await db.scenePlan.deleteMany({ where: { scriptId: current.scriptId } });

  const guideDoc = parseShootingGuideDoc(
    buildShootingGuideFromStoryboard({ storyboard, brief }),
  );
  /// guideDoc.items 与 storyboard.shots 一一对应（同 sceneIndex）
  const guideByScene = new Map(guideDoc.items.map((it) => [it.sceneIndex, it]));

  const created = await Promise.all(
    storyboard.shots.map((shot: StoryboardShot) =>
      db.scenePlan.create({
        data: {
          scriptId: current.scriptId,
          sceneIndex: shot.sceneIndex,
          durationSec: shot.durationSec,
          visualIntent: shot.visualIntent,
          onCameraNote: shot.onCameraNote ?? null,
          requiredFlag: shot.requiredFlag,
          humanRequired: shot.humanRequired,
          shootingGuide:
            (guideByScene.get(shot.sceneIndex) as unknown as Prisma.InputJsonValue) ??
            Prisma.JsonNull,
        },
      }),
    ),
  );

  /// VideoBrief 状态推进（仅当 SCRIPT_READY → SCENE_PROMPT_READY）
  if (current.videoBriefId) {
    const vb = await db.videoBrief.findUnique({
      where: { id: current.videoBriefId },
      select: { status: true },
    });
    if (
      vb &&
      (vb.status === VideoBriefStatus.SCRIPT_READY ||
        vb.status === VideoBriefStatus.SCRIPT_DRAFTING ||
        vb.status === VideoBriefStatus.BRIEF_PENDING)
    ) {
      await db.videoBrief.update({
        where: { id: current.videoBriefId },
        data: { status: VideoBriefStatus.SCENE_PROMPT_READY },
      });
    }
  }

  return {
    storyboard,
    shootingGuideItems: guideDoc.items,
    fromMock,
    reason: reason ?? null,
    scriptId: current.scriptId,
    scenePlanIds: created.map((c) => c.id),
    durationConsistencyIssues: checkStoryboardDurationConsistency(
      storyboard,
      brief.videoLengthSec,
    ),
  };
}

async function generateStoryboard(params: {
  deliveryOrderId: string;
  brief: Awaited<ReturnType<typeof requireClientBrief>>;
  script: ScriptOutput;
}): Promise<{
  storyboard: StoryboardOutput;
  fromMock: boolean;
  reason?: string;
}> {
  const promptInput = { brief: params.brief, script: params.script };

  if (!isLLMAvailable()) {
    const mock = mockStoryboard(promptInput);
    await recordAIUsage({
      feature: "storyboard",
      promptVersion: STORYBOARD_PROMPT_VERSION,
      deliveryOrderId: params.deliveryOrderId,
      status: AIUsageStatus.MOCK,
      inputSummary: `mock fallback (no OPENAI_API_KEY) for ${params.brief.businessName}`,
      outputSummary: `${mock.shots.length} shots, total ${mock.totalDurationSec}s`,
      durationMs: 0,
    });
    return {
      storyboard: parseStoryboardOutput(mock),
      fromMock: true,
      reason: WIZARD_FALLBACK.storyboardMissingKey,
    };
  }

  const userPrompt = buildStoryboardUser(promptInput);
  try {
    const data = await withAIUsageTracking(
      {
        feature: "storyboard",
        promptVersion: STORYBOARD_PROMPT_VERSION,
        model: "gpt-4o-mini",
        deliveryOrderId: params.deliveryOrderId,
        inputForLog: userPrompt.slice(0, 1024),
      },
      () =>
        chatJson<unknown>({
          system: STORYBOARD_SYSTEM,
          user: userPrompt,
          model: "gpt-4o-mini",
          temperature: 0.6,
        }),
    );
    return { storyboard: parseStoryboardOutput(data), fromMock: false };
  } catch (err) {
    const mock = mockStoryboard(promptInput);
    await recordAIUsage({
      feature: "storyboard",
      promptVersion: STORYBOARD_PROMPT_VERSION,
      deliveryOrderId: params.deliveryOrderId,
      status: AIUsageStatus.MOCK,
      inputSummary: `mock fallback after LLM error: ${(err as Error).message.slice(0, 200)}`,
      outputSummary: `${mock.shots.length} shots`,
      durationMs: 0,
    });
    return {
      storyboard: parseStoryboardOutput(mock),
      fromMock: true,
      reason: fallbackReasonWithError(WIZARD_FALLBACK.storyboardLlmFailedPrefix, err),
    };
  }
}

/**
 * 读取当前 wizard storyboard + shooting guide，用于 step 4 / step 5 / step 6 展示。
 */
export async function getCurrentWizardStoryboard(deliveryOrderId: string) {
  const current = await getCurrentWizardScript(deliveryOrderId);
  if (!current) return null;
  const scenePlans = await db.scenePlan.findMany({
    where: { scriptId: current.scriptId },
    orderBy: { sceneIndex: "asc" },
  });
  if (scenePlans.length === 0) return null;
  return {
    scriptId: current.scriptId,
    scenePlans: scenePlans.map((s) => ({
      id: s.id,
      sceneIndex: s.sceneIndex,
      durationSec: s.durationSec,
      visualIntent: s.visualIntent,
      requiredFlag: s.requiredFlag,
      humanRequired: s.humanRequired,
      shootingGuide: s.shootingGuide as unknown,
      onCameraNote: s.onCameraNote,
    })),
  };
}

/**
 * 把数据库存的 Script 还原成 ScriptOutput 形态，喂给 storyboard prompt。
 *
 * Phase 3A 之后的优先策略：
 *   1. 优先使用 Script.metadata.scriptOutput（含完整 captions / complianceNotes / platformVariants）
 *   2. 兜底：当 metadata 缺失或无法 parse（旧 Script 或 admin 流程的 Script）才走 markdown 反向解析
 */
export async function reconstructScriptOutputForPrompt(current: {
  scriptId: string;
  language: string;
  fullText: string;
  hook: string | null;
  cta: string | null;
  scriptOutput?: ScriptOutput | null;
}): Promise<ScriptOutput> {
  if (current.scriptOutput) {
    /// 已经是 zod parse 通过的对象（getCurrentWizardScript 已 parse），直接复用
    return current.scriptOutput;
  }
  return parseScriptOutput({
    language: current.language,
    title: extractTitleFromFullText(current.fullText),
    hook: current.hook ?? "Hook missing",
    voiceover: extractVoiceoverFromFullText(current.fullText),
    captions: [],
    cta: current.cta ?? "Visit us today.",
    complianceNotes: [],
    copiedFromReference: false,
  });
}

function extractTitleFromFullText(text: string): string {
  const m = text.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim().slice(0, 160) ?? "Wizard Script";
}

function extractVoiceoverFromFullText(text: string): string {
  const m = text.match(/##\s+Voiceover\s*\n([\s\S]*?)(?=\n##\s|$)/);
  const body = (m?.[1] ?? text).trim();
  /// schema 要求 voiceover >= 10 chars
  return body.length >= 10 ? body.slice(0, 2400) : `${body} ...`.padEnd(10, ".");
}
