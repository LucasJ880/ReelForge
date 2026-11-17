import { directorScriptSpeechWords, readStoredDirectorScript } from "@/lib/video-generation/director-line";
import { signoffActive } from "@/lib/video-generation/brand-signoff";
import type { PostProductionPlan } from "@/types/video-generation";
import { db } from "@/lib/db";
import {
  StitchCompositionError,
  type MediaBudget,
  type TimelineClipReport,
} from "@/lib/media/stitch-pipeline";
import { readDirectorPlanVoiceoverChunks } from "@/lib/schemas/director-plan";
import { DEFAULT_TAIL_TRIM_SECONDS } from "@/lib/video-generation/tail-trim";
import type { UploadedAsset } from "@/types/video-generation";
import {
  composeAndPersistTimeline,
  BROLL_ROUTE_RETIRED_MESSAGE,
  extractBrollClaimSegments,
  isStitchCandidateReady,
  parsePersistedPostProduction,
  planHasUnifiedAssembly,
  type NormalizeAndConcatClip,
} from "./stitch-service";

/**
 * 应用内合成器的编排层（C3：生产 inprocess 与开发 local 唯一的合成入口）。
 *
 * 按 FinalVideo 的形态挑分支，组出时间线，交给 composeAndPersistTimeline：
 *   - assembly ：unified plan 的 assemblyPlan —— AI 段 + 客户上传片段 + 客户选的品牌尾卡 /
 *                CTA 卡（现场渲染），trimToFit、字幕窗口（尾卡不背字幕）、logo 角标策略
 *   - legacy   ：没有 unified plan 的多段 / 单段 AI 视频
 * AI 生成段默认做语音安全裁尾（杀尾帧幻觉出的假名片 / 乱码电话，不切口播）；
 * 客户上传片段、尾卡不裁。
 *
 * 实拍图库（b-roll）线路 2026-11-16 删除：旧的 b-roll 成片照常能看能下载，但不能再重新合成——
 * 段里存的是图库原片 + 配音文件，要先「素材 + 配音 → 段」再拼，那段代码随线路一起删了。
 * 认出这种成片（extractBrollClaimSegments）就以 BROLL_ROUTE_RETIRED 明确失败，绝不把图库原片当成片拼出去。
 *
 * 只读数据库、不写库：结果由 runClaimedStitchAttempt 交给唯一成功写入点 finishStitchTask。
 */

export type ComposeBranch = "assembly" | "legacy";

export interface ComposedFinalVideo {
  stitchedVideoUrl: string;
  thumbnailUrl: string | null;
  subtitleFileUrl: string | null;
  branch: ComposeBranch;
  durationSec: number;
  captionWindowSec: number | null;
  warnings: string[];
  clips: TimelineClipReport[];
  timings: Record<string, number>;
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * AI 段默认裁尾秒数：STITCH_AI_TAIL_TRIM_SEC（默认 0.8，与品牌封装同值；0 / off 关闭）。
 * 语音安全：口播讲到片尾时自动缩短甚至放弃；裁完不足 5s 的短段不裁。
 */
export function resolveAiTailTrimSeconds(env: Env = process.env): number {
  const raw = (env.STITCH_AI_TAIL_TRIM_SEC ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_TAIL_TRIM_SECONDS;
  if (raw === "off" || raw === "false" || raw === "none") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_TAIL_TRIM_SECONDS;
  return Math.min(value, 3);
}

/**
 * 纯函数：assembly 片段 → 时间线片段（裁尾只给 AI 段；尾卡 / CTA 卡不背字幕）。
 */
export function assemblyClipsToTimeline(
  clips: Array<{
    type: string;
    url: string;
    intendedDurationSec: number;
    trimToFit: boolean;
  }>,
  aiTailTrimSec: number,
): NormalizeAndConcatClip[] {
  return clips.map((clip) => {
    const isEndCard = clip.type === "brand_end_card" || clip.type === "cta_card";
    const isAi = clip.type === "ai_generated_clip";
    return {
      url: clip.url,
      intendedDurationSec: clip.intendedDurationSec,
      trimToFit: clip.trimToFit,
      role: isAi ? "ai_generated" : isEndCard ? "end_card" : clip.type === "uploaded_clip" ? "uploaded" : "other",
      ...(isAi && aiTailTrimSec > 0 ? { tailTrimSec: aiTailTrimSec } : {}),
      ...(isEndCard ? { excludeFromCaptions: true } : {}),
    } satisfies NormalizeAndConcatClip;
  });
}

/**
 * 纯函数：legacy 段（全部是 AI 生成段）→ 时间线片段。
 * 段的计划时长（VideoJob.segmentDurationSec）只给字幕：旧数据没有持久化台词时按它切，
 * 不按语音安全裁尾后的实测（实测不等长会把语句边界吸偏）。不填 intendedDurationSec，裁剪规则不变。
 */
export function legacySegmentsToTimeline(
  segments: Array<{ outputVideoUrl: string | null; segmentDurationSec?: number | null }>,
  aiTailTrimSec: number,
): NormalizeAndConcatClip[] {
  return segments.map((segment) => ({
    url: segment.outputVideoUrl as string,
    intendedDurationSec: null,
    trimToFit: false,
    role: "ai_generated" as const,
    ...(aiTailTrimSec > 0 ? { tailTrimSec: aiTailTrimSec } : {}),
    ...(segment.segmentDurationSec && segment.segmentDurationSec > 0
      ? { plannedDurationSec: segment.segmentDurationSec }
      : {}),
  }));
}

/**
 * 片尾落款要带的 Logo：只在落款开着且勾了「带 Logo」时取；取成片主人**自己工作区**的品牌包
 *（默认的那个优先），不取全局包——10-28 的「保温杯配窗帘厂 logo」就是别人的品牌被带了进来。
 * 取不到（没有品牌包 / 读库失败）= 不带 Logo，落款文字照常。
 */
export async function resolveSignoffLogoUrl(
  postProduction: PostProductionPlan | null,
  ownerUserId: string | null,
): Promise<string | null> {
  const signoff = postProduction?.signoff;
  if (!signoffActive(signoff) || !signoff.logo || !ownerUserId) return null;
  return resolveOwnerBrandLogoUrl(ownerUserId, "sign-off");
}

/**
 * 右上角 Logo 要用的图：快照里 cornerLogo 开着才取，来源和片尾落款的 Logo 一样（成片主人自己工作区的默认品牌包）。
 */
export async function resolveCornerLogoUrl(
  postProduction: PostProductionPlan | null,
  ownerUserId: string | null,
): Promise<string | null> {
  if (postProduction?.cornerLogo !== true || !ownerUserId) return null;
  return resolveOwnerBrandLogoUrl(ownerUserId, "corner");
}

async function resolveOwnerBrandLogoUrl(ownerUserId: string, purpose: "sign-off" | "corner"): Promise<string | null> {
  try {
    const { listWorkspaceBrandPackagesForUser } = await import("@/lib/services/workspace-brand-package-service");
    const own = (await listWorkspaceBrandPackagesForUser(ownerUserId)).filter((entry) => entry.scope === "workspace");
    const pick = own.find((entry) => entry.isDefault) ?? own[0] ?? null;
    return pick?.logoAsset?.url ?? null;
  } catch (error) {
    console.warn(`[stitch] ${purpose} logo lookup failed; composing without it`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function composeFinalVideoForStitch(args: {
  finalVideoId: string;
  budget?: MediaBudget;
  checkpoint?: () => Promise<void>;
  env?: Env;
}): Promise<ComposedFinalVideo> {
  const env = args.env ?? process.env;
  const fv = await db.finalVideo.findUnique({
    where: { id: args.finalVideoId },
    include: {
      brief: {
        select: {
          id: true,
          aspectRatio: true,
          videoGenerationPlan: true,
          /// P04-C：各段台词（segmentPlan[].voiceoverChunk）给字幕逐段对齐
          directorPlan: true,
          contentAngle: {
            select: {
              round: {
                select: {
                  deliveryOrder: { select: { productInput: true, targetPlatform: true, createdById: true } },
                },
              },
            },
          },
        },
      },
      segments: { orderBy: { segmentIndex: "asc" } },
    },
  });
  if (!fv) {
    throw new StitchCompositionError("FINAL_VIDEO_MISSING", "FinalVideo 不存在");
  }
  if (!isStitchCandidateReady(fv)) {
    throw new StitchCompositionError(
      "SEGMENTS_NOT_READY",
      "not every segment has SUCCEEDED with an output URL",
    );
  }
  let postProduction;
  try {
    postProduction = parsePersistedPostProduction(fv.postProduction);
  } catch (err) {
    throw new StitchCompositionError("POST_PRODUCTION_INVALID", (err as Error).message);
  }
  const aspectRatio = fv.brief?.aspectRatio || "9:16";
  const aiTailTrimSec = resolveAiTailTrimSeconds(env);
  const warnings: string[] = [];
  /// 派发时持久化的各 AI 段台词；旧计划没有 → null，字幕按计划时长重切
  const voiceoverChunks = readDirectorPlanVoiceoverChunks(fv.brief?.directorPlan);
  /// 目标平台：抖音成片字幕让开界面安全区，并烧入常驻「AI生成」角标
  const platform = fv.brief?.contentAngle?.round?.deliveryOrder?.targetPlatform ?? null;
  /// 片尾落款带 Logo：快照里只有一个开关，图片在这里按成片主人取——他自己工作区的默认品牌包。
  const ownerUserId = fv.brief?.contentAngle?.round?.deliveryOrder?.createdById ?? null;
  const signoffLogoUrl = await resolveSignoffLogoUrl(postProduction ?? null, ownerUserId);
  const cornerLogoUrl = await resolveCornerLogoUrl(postProduction ?? null, ownerUserId);
  /// 导演线路（11-17）：这条片是按一份镜头脚本一次生成的。字幕按脚本里每句台词所在镜头的时间排；
  /// 最后一个镜头是停住的商品定格，最后一句台词落在上面，所以不裁尾（裁掉 0.8 秒会切到行动指引）。
  const directorLine = readStoredDirectorScript(
    (fv.brief?.directorPlan as { directorLine?: unknown } | null)?.directorLine,
  );
  const scriptSpeechWords = directorLine ? directorScriptSpeechWords(directorLine.job) : null;
  const tailTrimSec = directorLine ? 0 : aiTailTrimSec;

  // ---------------- b-roll（线路已删）----------------
  /// 必须排在其它分支之前：b-roll 的段是「图库原片 + 配音」，落进 legacy 分支会把没有配音的原片拼成成片。
  if (extractBrollClaimSegments(fv.segments) !== null) {
    throw new StitchCompositionError("BROLL_ROUTE_RETIRED", BROLL_ROUTE_RETIRED_MESSAGE);
  }

  // ---------------- unified assembly ----------------
  if (planHasUnifiedAssembly(fv.brief?.videoGenerationPlan)) {
    const { resolveAssemblyInputs, applyAssemblyLogoOverlay } = await import(
      "@/lib/video-generation/assembly-executor"
    );
    const inputs = await resolveAssemblyInputs(fv);
    warnings.push(...inputs.warnings);
    await args.checkpoint?.();
    const result = await composeAndPersistTimeline({
      finalVideoId: args.finalVideoId,
      aspectRatio: inputs.aspectRatio,
      clips: assemblyClipsToTimeline(inputs.clips, tailTrimSec),
      postProduction,
      signoffLogoUrl,
      cornerLogoUrl,
      scriptSpeechWords,
      voiceoverChunks,
      platform,
      extractThumbnail: true,
      budget: args.budget,
      checkpoint: args.checkpoint,
    });
    const stitchedVideoUrl = await applyAssemblyLogoOverlay({
      finalVideoId: args.finalVideoId,
      aspectRatio: inputs.aspectRatio,
      sourceVideoUrl: result.stitchedVideoUrl,
      plan: inputs.plan.brandPackagingPlan,
      assets: (inputs.plan.classifiedAssets ?? []) as UploadedAsset[],
      fallbackLogoUrl: inputs.brandKitLogoUrl,
      warnings,
    });
    return { ...result, stitchedVideoUrl, branch: "assembly", warnings };
  }

  // ---------------- legacy ----------------
  const result = await composeAndPersistTimeline({
    finalVideoId: args.finalVideoId,
    aspectRatio,
    clips: legacySegmentsToTimeline(fv.segments, tailTrimSec),
    postProduction,
    signoffLogoUrl,
    cornerLogoUrl,
    scriptSpeechWords,
    voiceoverChunks,
    platform,
    extractThumbnail: true,
    budget: args.budget,
    checkpoint: args.checkpoint,
  });
  return { ...result, branch: "legacy", warnings };
}
