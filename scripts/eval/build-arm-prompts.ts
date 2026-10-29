/**
 * 视频评测集 · 用「当前 checkout 的代码」给每条用例算出故事板帧提示词与视频提示词。
 *
 * scripts/eval/video-golden-set.ts 会把本文件复制进各 git 版本的临时工作区，在那里跑：新旧两版各用自己的代码
 * 出提示词，提交、轮询、打分走主仓库同一套，对比只差提示词这一个变量。所以这里只能用两版都有的接口
 * （10-28 起就有的镜头卡、出帧计划、按故事板改写），新版多出来的入参（如口播稿）旧版会忽略。
 *
 * 只调 LLM（出方案、镜头卡），与线上「生成 AI 故事板 → 生成视频（Shuyu）」同一条路径；不碰供应商、不碰数据库。
 *
 * 用法（在工作区根目录）：node --import tsx scripts/eval/build-arm-prompts.ts <cases.json> <out.json> [--cases a,b]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildPlan } from "@/lib/video-generation/generation-supervisor";
import { mapPlanToDirectorPlan } from "@/lib/video-generation/plan-to-director";
import { designStoryboardShotCards, readShotCardFromFramePrompt } from "@/lib/video-generation/shot-cards";
import {
  STORYBOARD_BEATS_LONG,
  STORYBOARD_BEATS_SHORT,
  groundSegmentPromptInStoryboard,
} from "@/lib/video-generation/storyboard-beats";
import { buildStoryboardFramePlans } from "@/lib/video-generation/storyboard-service";
import type { UnifiedVideoGenerationRequest, VideoGenerationPlan } from "@/types/video-generation";

interface EvalCase {
  id: string;
  productImages: string[];
  story: string;
  voiceover: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
}

/**
 * Kelin 精控流程（10-29 起的版本才有这几个接口；旧版工作区里 import 失败 → null，走原路径）：
 * 原话译成英文 → 只出开场帧 → 从开场帧出人物设定图 → 首帧版视频提示词（实拍 + 设定图 + 开场帧）。
 */
/// 用变量路径加载：模块在旧版里不存在时 import 失败走原路径，类型检查也不要求它们存在（评测工具可以先于这批线上改动单独提交）
const loadOptionalModule = (specifier: string): Promise<Record<string, unknown> | null> =>
  import(specifier).then((module: Record<string, unknown>) => module).catch(() => null);

async function loadKelinMethod() {
  const english = await loadOptionalModule("@/lib/video-generation/story-english");
  const sheet = await loadOptionalModule("@/lib/video-generation/character-sheet");
  const beats: Record<string, unknown> = await import("@/lib/video-generation/storyboard-beats");
  const ground = beats.groundSegmentPromptForSeedanceOpeningFrame;
  if (
    typeof english?.renderStoryInEnglish !== "function" ||
    typeof sheet?.buildCharacterSheetPrompt !== "function" ||
    typeof sheet?.storyHasRecurringSubject !== "function" ||
    typeof ground !== "function"
  ) {
    return null;
  }
  return {
    renderStoryInEnglish: english.renderStoryInEnglish as (story: string) => Promise<string | null>,
    buildCharacterSheetPrompt: sheet.buildCharacterSheetPrompt as (input: { productPhotoCount: number }) => string,
    storyHasRecurringSubject: sheet.storyHasRecurringSubject as (cards: ReadonlyArray<string | null | undefined>) => boolean,
    sheetAspectRatio: String(sheet.CHARACTER_SHEET_ASPECT_RATIO ?? "16:9"),
    ground: ground as (original: string, input: Record<string, unknown>) => string,
  };
}

/// Kling 官方接口的提示词上限（Runway 侧 10-28 实测同值）；Shuyu 转发 Kling 时按它写，免得尾巴被截
const KLING_PROMPT_LIMIT = 2500;

async function promptsForCase(item: EvalCase, options: { characterSheet: boolean; klingPlanId: string | null }) {
  const request = {
    userType: "business",
    rawPrompt: item.story,
    attachments: item.productImages.map((url, index) => ({
      id: `${item.id}-photo-${index + 1}`,
      assetId: `${item.id}-photo-${index + 1}`,
      type: "IMAGE",
      inferredRole: "product_image",
      roleConfidence: 1,
      userAssignedRole: "product_image",
      url,
      mimeType: "image/png",
      fileName: `${item.id}-${index + 1}.png`,
    })),
    selectedDuration: item.durationSec,
    selectedAspectRatio: item.aspectRatio,
    selectedBrandEndingMode: "none",
    language: "zh-CN",
    audio: {
      voiceover: { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: item.voiceover },
      bgm: { trackId: "none", volume: 0 },
    },
  } as unknown as UnifiedVideoGenerationRequest;

  /// 与派发入口一样：服务端出方案 → 段计划（未按故事板改写的原版）
  const plan = JSON.parse(JSON.stringify(await buildPlan(request))) as VideoGenerationPlan;
  const director = mapPlanToDirectorPlan({ plan, language: "zh-CN" });
  const segment = director.segmentPlan[0];
  if (!segment || director.segmentPlan.length !== 1) throw new Error(`${item.id}: 评测集只收 15 秒单段`);

  /// 与建故事板一样：镜头卡 → 出帧计划（≤15 秒 4 帧）
  const beats = item.durationSec <= 15 ? STORYBOARD_BEATS_SHORT : STORYBOARD_BEATS_LONG;
  const shotCards = await designStoryboardShotCards({
    story: item.story,
    beats,
    durationSec: item.durationSec,
    aspectRatio: item.aspectRatio,
    productImageCount: item.productImages.length,
    personImageCount: 0,
    voiceoverScript: item.voiceover,
  } as Parameters<typeof designStoryboardShotCards>[0]);
  const kelin = await loadKelinMethod();
  const story = kelin ? (await kelin.renderStoryInEnglish(item.story)) ?? item.story : item.story;
  const framePlans = buildStoryboardFramePlans({
    prompt: story,
    durationSec: item.durationSec,
    aspectRatio: item.aspectRatio,
    productImageCount: item.productImages.length,
    shotCards,
  });

  if (kelin) {
    const cards = framePlans.map((frame) => readShotCardFromFramePrompt(frame.prompt));
    const withSheet = options.characterSheet && kelin.storyHasRecurringSubject(cards);
    /// 改投 Kling：开场帧排第一张（Kling 把第一张图当首帧）、2500 字、不拼负面（KEY CONSTRAINTS 已写要紧的）
    const kling = options.klingPlanId !== null;
    const videoPrompt = kelin.ground(segment.seedancePrompt, {
      aspectRatio: item.aspectRatio,
      story,
      beats: framePlans.map((frame) => frame.beat),
      productPhotoCount: item.productImages.length,
      anchorCount: 0,
      personCount: withSheet ? 1 : 0,
      personRole: "character_sheet",
      totalDurationSec: item.durationSec,
      fromSec: segment.fromSec,
      toSec: segment.toSec,
      negativePrompt: kling ? null : segment.negativePrompt,
      shotCards: cards,
      ...(kling ? { openingFrameFirst: true, promptLimit: KLING_PROMPT_LIMIT } : {}),
    });
    return {
      caseId: item.id,
      shotCardsDesigned: shotCards !== null,
      shotCards,
      storyEnglish: story,
      /// 只出开场帧：首帧版里后三帧不进视频（线上故事板照样出四帧给商家看）
      frames: framePlans.slice(0, 1).map((frame) => ({ ordinal: frame.ordinal, beat: frame.beat, prompt: frame.prompt })),
      characterSheet: withSheet
        ? { prompt: kelin.buildCharacterSheetPrompt({ productPhotoCount: item.productImages.length }), aspectRatio: kelin.sheetAspectRatio }
        : null,
      video: {
        prompt: videoPrompt,
        negativePrompt: kling ? null : segment.negativePrompt ?? null,
        durationSec: segment.durationSec,
        referencePlan: kling ? ("opening_frame_first" as const) : ("opening_frame" as const),
        ...(kling ? { planId: options.klingPlanId } : {}),
      },
    };
  }

  /// 与派发一样：按已确认的故事板改写段提示词（Shuyu 版；镜头卡从帧提示词读回）
  const videoPrompt = groundSegmentPromptInStoryboard(segment.seedancePrompt, {
    aspectRatio: item.aspectRatio,
    story: item.story,
    beats: framePlans.map((frame) => frame.beat),
    productPhotoCount: item.productImages.length,
    anchorCount: 0,
    personCount: 0,
    totalDurationSec: item.durationSec,
    fromSec: segment.fromSec,
    toSec: segment.toSec,
    negativePrompt: segment.negativePrompt,
    shotCards: framePlans.map((frame) => readShotCardFromFramePrompt(frame.prompt)),
  });

  return {
    caseId: item.id,
    shotCardsDesigned: shotCards !== null,
    shotCards,
    frames: framePlans.map((frame) => ({ ordinal: frame.ordinal, beat: frame.beat, prompt: frame.prompt })),
    video: { prompt: videoPrompt, negativePrompt: segment.negativePrompt ?? null, durationSec: segment.durationSec },
  };
}

async function main() {
  const [casesPath, outPath, ...flags] = process.argv.slice(2);
  if (!casesPath || !outPath) throw new Error("用法：build-arm-prompts.ts <cases.json> <out.json> [--cases a,b] [--no-character-sheet]");
  const casesAt = flags.indexOf("--cases");
  const only = casesAt === -1 ? [] : (flags[casesAt + 1] ?? "").split(",").filter(Boolean);
  const characterSheet = !flags.includes("--no-character-sheet");
  const klingAt = flags.indexOf("--kling-plan");
  const klingPlanId = klingAt === -1 ? null : flags[klingAt + 1] ?? null;
  const cases = (JSON.parse(readFileSync(casesPath, "utf8")) as { cases: EvalCase[] }).cases.filter(
    (item) => only.length === 0 || only.includes(item.id),
  );
  const results = [];
  for (const item of cases) {
    const started = Date.now();
    results.push(await promptsForCase(item, { characterSheet, klingPlanId }));
    console.log(`[eval:prompts] ${item.id} ready in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ builtAt: new Date().toISOString(), cases: results }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error("[eval:prompts] failed:", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
