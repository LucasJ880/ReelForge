import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";
import { readClientBrief } from "./client-project-service";
import {
  PROMPT_VERSION,
  SHOOTING_GUIDE_SYSTEM,
  buildShootingGuideFromStoryboard,
  buildShootingGuideUser,
} from "@/lib/prompts/shooting-guide";
import {
  parseShootingGuideDoc,
  type ShootingGuideDoc,
  type ShootingGuideItem,
} from "@/lib/schemas/shooting-guide";
import {
  parseStoryboardOutput,
  type StoryboardOutput,
} from "@/lib/schemas/storyboard";
import type { ClientBrief } from "@/lib/schemas/client-brief";
import { withAIUsageTracking } from "./ai-usage-log-service";

const FEATURE = "shooting_guide";

/**
 * Shooting Guide Service —— storyboard → 商家拍摄清单。
 *
 * 默认走确定性 fallback（buildShootingGuideFromStoryboard），
 * 不消耗 LLM token；当 useLLM=true 且 OPENAI_API_KEY 可用时才走 LLM 增强（翻译 / 加常见错误）。
 */

export interface BuildShootingGuideInput {
  storyboard: StoryboardOutput;
  brief: ClientBrief;
  useLLM?: boolean;
  /// 关联到 deliveryOrder（用于 AIUsageLog）
  deliveryOrderId?: string;
}

export async function buildShootingGuide(input: BuildShootingGuideInput) {
  const baseline = buildShootingGuideFromStoryboard({
    storyboard: input.storyboard,
    brief: input.brief,
  });

  if (!input.useLLM || !isLLMAvailable()) {
    return baseline;
  }

  const result = await withAIUsageTracking(
    {
      feature: FEATURE,
      promptVersion: PROMPT_VERSION,
      deliveryOrderId: input.deliveryOrderId ?? null,
      inputForLog: JSON.stringify(input.brief).slice(0, 600),
    },
    async () => {
      const r = await chatJson<ShootingGuideDoc>({
        system: SHOOTING_GUIDE_SYSTEM,
        user: buildShootingGuideUser({
          storyboard: input.storyboard,
          brief: input.brief,
        }),
        temperature: 0.4,
        maxTokens: 2400,
      });
      return {
        data: parseShootingGuideDoc(r.data),
        modelUsed: r.modelUsed,
        tokenUsage: r.tokenUsage,
        raw: r.raw,
      };
    },
  );
  return result;
}

/**
 * 把 ShootingGuideDoc 写回每个 ScenePlan.shootingGuide JSON。
 */
export async function persistShootingGuideToScenePlans(
  scriptId: string,
  doc: ShootingGuideDoc,
) {
  const scenes = await db.scenePlan.findMany({
    where: { scriptId },
    orderBy: { sceneIndex: "asc" },
  });
  if (scenes.length === 0) {
    throw new Error(
      "该 Script 暂无 ScenePlan，无法持久化拍摄指导。请先生成分镜。",
    );
  }
  const itemBySceneIndex = new Map<number, ShootingGuideItem>(
    doc.items.map((i) => [i.sceneIndex, i]),
  );

  await db.$transaction(
    scenes.map((scene) => {
      const item = itemBySceneIndex.get(scene.sceneIndex);
      return db.scenePlan.update({
        where: { id: scene.id },
        data: {
          shootingGuide: (item ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          requiredFlag: item?.requiredFlag ?? scene.requiredFlag,
          humanRequired: item?.humanRequired ?? scene.humanRequired,
        },
      });
    }),
  );
}

/**
 * 从一个 brief 重建 ShootingGuideDoc：
 * 优先使用每个 ScenePlan.shootingGuide JSON（已持久化）；
 * 缺字段时用本地 builder 兜底，不一定调 LLM。
 */
export async function loadShootingGuideForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, take: 1 },
      contentAngle: {
        include: {
          round: {
            include: { deliveryOrder: true },
          },
        },
      },
    },
  });
  if (!brief) throw new Error("VideoBrief 不存在");
  const script = brief.scripts[0];
  if (!script) return null;

  const scenes = await db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
  });
  if (scenes.length === 0) return null;

  const items: ShootingGuideItem[] = scenes
    .filter((s) => s.shootingGuide)
    .map((s) => s.shootingGuide as unknown as ShootingGuideItem);

  if (items.length === 0) {
    /// 没有 shootingGuide JSON → 返回 null 由调用方决定要不要现场生成
    return null;
  }

  const requiredShots = items.filter((i) => i.requiredFlag).length;
  return parseShootingGuideDoc({
    totalDurationSec: items.reduce((sum, i) => sum + i.durationSec, 0),
    totalShots: items.length,
    requiredShots,
    optionalShots: items.length - requiredShots,
    preflightChecklist: [
      "拍摄前确认手机存储 ≥ 5GB，关闭省电模式",
      "白天自然光优先，避免顶光与逆光",
      "音频使用领夹麦或手机麦近距离录音",
      "竖屏 9:16 拍摄，不要拍横屏后再裁",
    ],
    items,
    summary: `共 ${items.length} 个镜头，总时长 ${items.reduce((sum, i) => sum + i.durationSec, 0)}s`,
  });
}

export type { ShootingGuideDoc };

/** 类型化的 brief 读取：复用 client-project-service 实现，便于上层一处导入 */
export const readBriefFromOrder = readClientBrief;

/** 类型化的 storyboard 读取（占位，便于 Phase 2 调用） */
export function readStoryboardFromScenes(scenes: Array<{
  sceneIndex: number;
  durationSec: number;
  visualIntent: string;
  shootingGuide: Prisma.JsonValue;
  requiredFlag: boolean;
  humanRequired: boolean;
}>): StoryboardOutput | null {
  if (scenes.length === 0) return null;
  return parseStoryboardOutput({
    totalDurationSec: scenes.reduce((sum, s) => sum + s.durationSec, 0),
    shots: scenes.map((s) => {
      const guide = s.shootingGuide as unknown as Partial<ShootingGuideItem> | null;
      return {
        sceneIndex: s.sceneIndex,
        durationSec: s.durationSec,
        shotType: guide?.shotType ?? "wide",
        visualIntent: s.visualIntent,
        whatToFilm: guide?.whatToFilm ?? s.visualIntent,
        composition: guide?.composition ?? "rule_of_thirds",
        cameraMovement: guide?.cameraMovement ?? "static",
        orientation: guide?.orientation ?? "portrait",
        requiredFlag: s.requiredFlag,
        humanRequired: s.humanRequired,
        requiredProps: guide?.requiredProps ?? [],
        captionText: guide?.captionText,
        voiceoverSegment: guide?.voiceoverSegment,
      };
    }),
  });
}
