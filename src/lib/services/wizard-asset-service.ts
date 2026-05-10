import { Prisma, RawAssetStatus, RawAssetType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  evaluateAssetQA,
  type AssetQAOptions,
  type RunAssetQARowInput,
} from "./asset-qa-service";
import { requireClientBrief } from "./client-project-service";
import {
  parseMissingShotReport,
  type MissingShotReport,
} from "@/lib/schemas/asset-qa";
import { getCurrentWizardStoryboard } from "./wizard-storyboard-service";

/**
 * Wizard Asset Service —— Phase 2 step 5。
 *
 * 关键约束（满足 Phase 2 边界）：
 * - **不接 Vercel Blob direct upload**：客户先粘贴公网 URL（自己的 Drive / S3 / Cloudinary 都行），
 *   service 只做注册 + QA。Phase 3 接真上传后这层 API 不变。
 * - 客户可以手动绑定 RawAsset.matchedShotId → ScenePlan.id（来自 wizard storyboard），
 *   方便 Step 6 的 timeline 自动按 sceneIndex 排序。
 * - QA 结果即时写回，不依赖 cron / queue。
 */

export const wizardAssetRegisterSchema = z.object({
  type: z.enum([RawAssetType.VIDEO, RawAssetType.IMAGE, RawAssetType.AUDIO]),
  url: z.string().url(),
  name: z.string().min(1).max(160),
  mimeType: z.string().min(3).max(120).optional(),
  /// 客户自报，可选；缺失就让 evaluateAssetQA 跳过相关 check
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  /// 镜头用途：hook / proof / demo / lifestyle / cta / b_roll
  assetRole: z.string().min(1).max(40).optional(),
  /// 直接绑定 ScenePlan.id（来自 storyboard），可选
  matchedShotId: z.string().min(1).optional(),
  notes: z.string().max(800).optional(),
});
export type WizardAssetRegisterInput = z.infer<
  typeof wizardAssetRegisterSchema
>;

export const wizardAssetMatchShotSchema = z.object({
  matchedShotId: z.string().min(1).nullable(),
});

/**
 * 注册一个公网 URL 素材到 wizard 项目，并立刻跑 QA。
 *
 * - 校验 ScenePlan 归属（防止跨 order 串号）；
 * - 默认目标比例按 brief.targetPlatforms[0] 推断；
 * - 即使 QA 给出 RETAKE_RECOMMENDED，也会保存（让客户看到原因，再决定是否重传）。
 */
export async function registerWizardAsset(params: {
  deliveryOrderId: string;
  input: WizardAssetRegisterInput;
}) {
  const { deliveryOrderId } = params;
  const input = wizardAssetRegisterSchema.parse(params.input);

  const brief = await requireClientBrief(deliveryOrderId);

  /// 如果传了 matchedShotId，先校验它属于该 wizard order 的当前 storyboard
  if (input.matchedShotId) {
    await ensureShotBelongsToOrder(deliveryOrderId, input.matchedShotId);
  }

  const created = await db.rawAsset.create({
    data: {
      deliveryOrderId,
      type: input.type,
      status: RawAssetStatus.UPLOADED,
      name: input.name,
      url: input.url,
      mimeType: input.mimeType ?? null,
      durationMs: input.durationMs ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      notes: input.notes ?? null,
      assetRole: input.assetRole ?? null,
      matchedShotId: input.matchedShotId ?? null,
    },
  });

  /// 跑 QA
  const qaInput: RunAssetQARowInput = {
    type: created.type,
    mimeType: created.mimeType,
    fileSizeBytes: created.fileSizeBytes,
    durationMs: created.durationMs,
    width: created.width,
    height: created.height,
    url: created.url,
    name: created.name,
  };
  const options: AssetQAOptions = {
    targetOrientation: targetOrientationFor(brief.targetPlatforms[0]),
    targetAspectRatio: targetAspectRatioFor(brief.targetPlatforms[0]),
  };
  const qaResult = evaluateAssetQA(qaInput, options);

  return db.rawAsset.update({
    where: { id: created.id },
    data: {
      qaStatus: qaResult.status,
      qaResult: qaResult as unknown as Prisma.InputJsonValue,
      status: RawAssetStatus.INDEXED,
    },
    include: { matchedShot: true },
  });
}

/**
 * 把已存在的 RawAsset 与 ScenePlan 绑定/解绑。
 */
export async function matchWizardAssetToShot(params: {
  deliveryOrderId: string;
  rawAssetId: string;
  matchedShotId: string | null;
}) {
  const asset = await db.rawAsset.findUnique({
    where: { id: params.rawAssetId },
  });
  if (!asset) throw new Error("RawAsset 不存在");
  if (asset.deliveryOrderId !== params.deliveryOrderId) {
    throw new Error("RawAsset 不属于该 wizard 项目");
  }
  if (params.matchedShotId) {
    await ensureShotBelongsToOrder(
      params.deliveryOrderId,
      params.matchedShotId,
    );
  }
  return db.rawAsset.update({
    where: { id: params.rawAssetId },
    data: { matchedShotId: params.matchedShotId },
    include: { matchedShot: true },
  });
}

/**
 * 列出当前 wizard 项目的所有 RawAsset + 当前 storyboard 的缺镜头报告。
 */
export async function listWizardAssetsWithMissingReport(
  deliveryOrderId: string,
): Promise<{
  assets: Awaited<ReturnType<typeof db.rawAsset.findMany>>;
  missingReport: MissingShotReport;
}> {
  const assets = await db.rawAsset.findMany({
    where: { deliveryOrderId },
    orderBy: { createdAt: "desc" },
    include: { matchedShot: true },
  });
  const storyboard = await getCurrentWizardStoryboard(deliveryOrderId);
  const missingReport = computeMissingShotReport(storyboard, assets);
  return { assets, missingReport };
}

/**
 * 从 wizard 视角计算 missing-shot 报告：
 * 与 asset-qa-service.detectMissingShotsForBrief 不同，那个是基于 admin VideoBrief 的；
 * wizard 版本直接基于 deliveryOrderId + 当前 ScenePlan，更轻量。
 */
function computeMissingShotReport(
  storyboard: Awaited<ReturnType<typeof getCurrentWizardStoryboard>>,
  assets: Awaited<ReturnType<typeof db.rawAsset.findMany>>,
): MissingShotReport {
  if (!storyboard) {
    return parseMissingShotReport({
      total: 0,
      matched: 0,
      missingRequired: 0,
      shots: [],
    });
  }
  const matchedCount = new Map<string, number>();
  for (const a of assets) {
    if (!a.matchedShotId) continue;
    matchedCount.set(
      a.matchedShotId,
      (matchedCount.get(a.matchedShotId) ?? 0) + 1,
    );
  }
  let matched = 0;
  let missingRequired = 0;
  const shots = storyboard.scenePlans.map((s) => {
    const isMatched = (matchedCount.get(s.id) ?? 0) > 0;
    if (isMatched) matched += 1;
    if (s.requiredFlag && !isMatched) missingRequired += 1;
    return {
      scenePlanId: s.id,
      sceneIndex: s.sceneIndex,
      visualIntent: s.visualIntent,
      required: s.requiredFlag,
      matched: isMatched,
      reason: isMatched
        ? undefined
        : s.requiredFlag
          ? "必拍镜头尚未匹配到任何素材，请上传或在素材列表中绑定"
          : "可选镜头未匹配，可保留或补拍",
    };
  });
  return parseMissingShotReport({
    total: storyboard.scenePlans.length,
    matched,
    missingRequired,
    shots,
  });
}

async function ensureShotBelongsToOrder(
  deliveryOrderId: string,
  shotId: string,
) {
  const shot = await db.scenePlan.findUnique({
    where: { id: shotId },
    include: { script: { include: { videoBrief: true } } },
  });
  if (!shot) throw new Error("ScenePlan 不存在");
  /// 通过 script.videoBrief.contentAngle.round.deliveryOrderId 反查；MVP 用一次额外查询
  const round = await db.round.findFirst({
    where: {
      angles: { some: { videoBrief: { id: shot.script.videoBrief.id } } },
    },
    select: { deliveryOrderId: true },
  });
  if (!round || round.deliveryOrderId !== deliveryOrderId) {
    throw new Error("该 ScenePlan 不属于当前 wizard 项目");
  }
}

function targetOrientationFor(
  platform: string | undefined,
): "portrait" | "landscape" | "square" {
  switch (platform) {
    case "instagram_feed":
      return "square";
    case "youtube":
    case "facebook":
    case "website":
      return "landscape";
    case "tiktok":
    case "instagram_reels":
    case "youtube_shorts":
    default:
      return "portrait";
  }
}

function targetAspectRatioFor(platform: string | undefined): string {
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
