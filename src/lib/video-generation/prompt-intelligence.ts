/**
 * Phase 5 — 段提示词（确定性模板）。
 *
 * 输入：CreativeBrief + ConsistencyBible + UnifiedSegmentSlot[] + classifiedAssets + classification
 * 输出：VideoSegment[]
 *
 * 每个 AI 段的提示词 = 片头定性句 + 一致性设定逐字注入（CHARACTER / LOCATION / PRODUCT / LIGHTING / 各类 LOCK）
 * + 带时间戳的模板镜头表 + Audio 行 + Style 行；开着口播时末尾带已确认口播稿的那一段（Spoken dialogue）。
 *
 * 不调模型。2026-11-09 起出方案就不再为段提示词调模型——单条视频派发时提示词会按已确认的故事板改写
 *（storyboard-beats 的 ground* 函数），这里的镜头表整段被替换，只有 PRODUCT / CHARACTER / LOCK / Audio /
 * Spoken dialogue 这几行与负面提示词会进成片提示词。瘦身第 4 批删掉了调模型的那条退路（PLANNING_FULL_LLM）
 * 和它的系统提示词、输出校验、负面改写。调用方只有出方案（generation-supervisor 的 buildPlan）。
 *
 * 模板镜头表不带台词：商家关了口播时 Audio 行固定写「只有环境声、不要旁白」；开着口播时只念已确认的口播稿。
 *
 * 硬约束：
 *  - prompt 不写 logo URL / 品牌名 / slogan / URL / QR / 精确 CTA 文本
 *  - negativePrompt 固定为 DEFAULT_NEGATIVE_PROMPT（再按一致性锁与真实招牌调整）
 */

import { effectiveAssetRole } from "@/types/video-generation";
import { presenterReferenceAssets } from "@/lib/video-generation/storyboard-person-refs";
import type {
  AspectRatio,
  ConsistencyBible,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
  VideoSegment,
  VoiceoverSettings,
} from "@/types/video-generation";
import { heuristicBible } from "@/lib/video-generation/consistency-bible";
import type { ConsistencyLock, StyleTemplate } from "@/lib/video-generation/style-templates";
import type { VisualReferenceAnalysis } from "@/lib/video-generation/visual-reference-analysis";
import { resolutionForAspectRatio, type UnifiedSegmentSlot } from "@/lib/video-generation/segment-planner-adapter";

/**
 * 1028 商品主体轮 P0：品牌跟着商品走。商品自己印着的 logo / 标签字样是商品的一部分，必须照参考图保留。
 * 旧写法把「no logo, no brand text, no readable text」一刀切写进负面（Shuyu 把负面拼成
 * 「Negative constraints: …」直接给模型读），模型会把保温杯上自己印的 logo 也抹掉或糊掉。
 * 现在只禁「额外添加」的字和 logo，拼错 / 乱码的字照禁。
 */
const PRODUCT_PRINT_GUARD =
  "no logo added and no brand text added (keep any logo or label printed on the product exactly as in the reference photos), no invented or misspelled lettering, no URLs, no QR codes";
const DEFAULT_NEGATIVE_PROMPT =
  `low quality, blurry, distorted hands, extra fingers, morphing face, inconsistent character, text artifacts, watermark, ${PRODUCT_PRINT_GUARD}, no subtitles, no captions, no on-screen text`;

export interface ShotLine {
  fromSec: number;
  toSec: number;
  visual: string;
  camera: string;
}

export interface BuildSegmentPromptsArgs {
  creativeBrief: CreativeBrief;
  segmentSlots: UnifiedSegmentSlot[];
  classifiedAssets: UploadedAsset[];
  classification: InputClassification;
  aspectRatio: AspectRatio;
  /// 跨镜头一致性设定；缺省时现算一份（测试直接调时用）
  consistencyBible?: ConsistencyBible | null;
  /// 口播/台词语言（如 "zh-CN" / "en-US"），默认英文
  language?: string;
  /// 风格模版（skill 模式）：约束分镜结构/镜头语言/台词口吻
  styleTemplate?: StyleTemplate | null;
  /// 一致性锁：逐字追加到每段 prompt 的约束行
  consistencyLocks?: ConsistencyLock[];
  /// 参考图视觉分析：真实门店场景时注入实景匹配指令 + 放开招牌文字渲染
  visualRefs?: VisualReferenceAnalysis | null;
  /** User-approved final wording: the only spoken words the prompt ever asks for. */
  voiceover?: VoiceoverSettings | null;
}

export interface SegmentPromptResult {
  segmentOrder: number;
  seedancePrompt: string;
  negativePrompt: string;
  cameraDirection: string;
  visualDirection: string;
  continuityNotes: string;
}

/**
 * 主入口：生成所有 segment 的 prompt + 把每段映射成完整 VideoSegment[]。
 */
export async function buildVideoSegments(
  args: BuildSegmentPromptsArgs,
): Promise<VideoSegment[]> {
  const aiSlots = args.segmentSlots.filter((s) => s.source === "ai");

  const bible =
    args.consistencyBible ??
    heuristicBible({
      creativeBrief: args.creativeBrief,
      classification: args.classification,
      classifiedAssets: args.classifiedAssets,
      aiSegmentCount: Math.max(1, aiSlots.length),
      language: args.language ?? "en-US",
    });

  const aiPrompts = aiSlots.length === 0 ? [] : heuristicSegmentPrompts(args, aiSlots, bible);

  const segments: VideoSegment[] = [];

  for (let idx = 0; idx < args.segmentSlots.length; idx++) {
    const slot = args.segmentSlots[idx];
    const sharedSpec = {
      aspectRatio: args.aspectRatio,
      resolution: resolutionForAspectRatio(args.aspectRatio),
    };

    if (slot.source === "uploaded") {
      segments.push({
        id: `seg_${idx}`,
        order: idx,
        type: "uploaded_clip",
        role: roleFromSlot(slot.role),
        durationSeconds:
          slot.durationSec ||
          estimateUploadedDuration(args, slot.uploadedAssetId ?? null),
        purpose: `Uploaded clip used at position ${idx} in the final video`,
        prompt: null,
        negativePrompt: null,
        sourceAssetIds: slot.uploadedAssetId ? [slot.uploadedAssetId] : [],
        uploadedAssetId: slot.uploadedAssetId ?? null,
        cameraDirection: null,
        visualDirection: null,
        outputSpec: sharedSpec,
      });
      continue;
    }

    if (slot.source === "brand_end_card") {
      segments.push({
        id: `seg_${idx}`,
        order: idx,
        type: "brand_end_card",
        role: "cta",
        durationSeconds: slot.durationSec,
        purpose:
          "Branded end card composited by Aivora (logo + CTA + brand text overlay)",
        prompt: null,
        negativePrompt: null,
        sourceAssetIds: [],
        uploadedAssetId: null,
        cameraDirection: null,
        visualDirection: null,
        outputSpec: sharedSpec,
      });
      continue;
    }

    /// AI segment — pick matching prompt row by aiSlots index
    const aiOrderInSlots = aiSlots.findIndex(
      (s) => s.segmentIndex === slot.segmentIndex,
    );
    const promptRow = aiOrderInSlots >= 0 ? aiPrompts[aiOrderInSlots] : undefined;
    segments.push({
      id: `seg_${idx}`,
      order: idx,
      type: "ai_generated_clip",
      role: roleFromSlot(slot.role),
      durationSeconds: slot.durationSec,
      purpose: descriptionForRole(slot.role, args.creativeBrief),
      prompt:
        promptRow?.seedancePrompt ??
        composeSeedancePrompt({
          bible,
          shots: heuristicShotList(slot, args, bible),
          slot,
          args,
          segIdxInAi: Math.max(0, aiOrderInSlots),
        }),
      negativePrompt: adjustNegativeForRealSignage(
        withLockNegatives(
          promptRow?.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
          args.consistencyLocks,
        ),
        args.visualRefs,
      ),
      sourceAssetIds: relevantReferenceAssetIds(args),
      uploadedAssetId: null,
      cameraDirection: promptRow?.cameraDirection ?? "handheld",
      visualDirection: promptRow?.visualDirection ?? "warm natural light, real setting",
      outputSpec: sharedSpec,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// 最终 prompt 组装（确定性代码，保证 bible 逐字一致）
// ---------------------------------------------------------------------------

/// Leave room for Shuyu's appended negative constraints under its 5,000-char cap.
/// 0805 收紧 4500→4200：真实场所的签牌负面块能到 ~600 字，4500 预算合并后
/// 溢出 5000 被 dispatch 422（walkthrough 实锤）；plan-to-director 另有兜底夹紧。
const PROMPT_CHAR_BUDGET = 4200;

function nearestSpeechBoundary(
  graphemes: string[],
  ideal: number,
  min: number,
  max: number,
): number {
  const isBoundary = (index: number) =>
    /[。！？!?；;，,\s]/u.test(graphemes[index - 1] ?? "");
  for (let offset = 0; offset <= Math.max(ideal - min, max - ideal); offset++) {
    const after = ideal + offset;
    if (after >= min && after <= max && isBoundary(after)) return after;
    const before = ideal - offset;
    if (before >= min && before <= max && isBoundary(before)) return before;
  }
  return Math.min(max, Math.max(min, ideal));
}

/**
 * Split the approved wording into contiguous, non-repeating segment chunks,
 * weighted by each AI segment's duration (P04-C, 2026-10-26): a 5s CTA segment
 * gets about a third of the wording a 15s segment gets instead of an equal share,
 * so the model is not asked to cram 15s of speech into 5s of footage.
 * Cuts snap to speech boundaries; joining the chunks reproduces the trimmed
 * script exactly.
 *
 * 同一规则在 audio-post-production.splitScriptByWindows 里还有一份（字幕按段窗口
 * 回退时要和派发时各段拿到的台词一致；拼接器 / runner 不能 import 本模块）。
 * 两边由 tests/unified-audio-contract.test.ts 的一致性用例锁住。
 */
export function splitVoiceoverScript(
  script: string,
  slots: ReadonlyArray<{ durationSec: number }>,
): string[] {
  const segmentCount = slots.length;
  if (segmentCount <= 0) return [];
  const graphemes = Array.from(script.trim());
  if (graphemes.length === 0) return Array.from({ length: segmentCount }, () => "");
  const weights = slots.map((slot) =>
    Number.isFinite(slot.durationSec) && slot.durationSec > 0 ? slot.durationSec : 1,
  );
  const chunks: string[] = [];
  let cursor = 0;
  for (let index = 0; index < segmentCount; index++) {
    if (index === segmentCount - 1) {
      chunks.push(graphemes.slice(cursor).join(""));
      break;
    }
    const remainingSegments = segmentCount - index;
    const remainingWeight = weights
      .slice(index)
      .reduce((sum, weight) => sum + weight, 0);
    const ideal =
      cursor +
      Math.round((graphemes.length - cursor) * (weights[index] / remainingWeight));
    const minimum = Math.min(graphemes.length, cursor + 1);
    const maximum = Math.max(
      minimum,
      graphemes.length - (remainingSegments - 1),
    );
    const boundary = nearestSpeechBoundary(
      graphemes,
      ideal,
      minimum,
      maximum,
    );
    chunks.push(graphemes.slice(cursor, boundary).join(""));
    cursor = boundary;
  }
  while (chunks.length < segmentCount) chunks.push("");
  return chunks;
}

function voiceoverChunkForSegment(
  args: BuildSegmentPromptsArgs,
  segmentIndex: number,
): string {
  if (!args.voiceover?.enabled) return "";
  const aiSlots = args.segmentSlots.filter((slot) => slot.source === "ai");
  return splitVoiceoverScript(args.voiceover.script, aiSlots)[segmentIndex] ?? "";
}

function escapeDialogueForPrompt(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replace(/\s+/gu, " ");
}

function fitPromptWithPriorityBlock(base: string, priorityBlock: string): string {
  if (!priorityBlock) {
    return base.length > PROMPT_CHAR_BUDGET
      ? base.slice(0, PROMPT_CHAR_BUDGET).replace(/\s+\S*$/u, "")
      : base;
  }
  const availableForBase = Math.max(
    0,
    PROMPT_CHAR_BUDGET - priorityBlock.length - 2,
  );
  const fittedBase =
    base.length > availableForBase
      ? base.slice(0, availableForBase).replace(/\s+\S*$/u, "")
      : base;
  return `${fittedBase.trimEnd()}\n\n${priorityBlock}`.trim();
}

function orientationLabel(aspect: AspectRatio): string {
  return aspect === "9:16"
    ? "9:16 vertical"
    : aspect === "16:9"
      ? "16:9 horizontal"
      : "1:1 square";
}

function composeSeedancePrompt(params: {
  bible: ConsistencyBible;
  shots: ShotLine[];
  slot: UnifiedSegmentSlot;
  args: BuildSegmentPromptsArgs;
  /// 该段在 AI 段序列中的序号（取 lightingArc 用）
  segIdxInAi: number;
}): string {
  const { bible, shots, slot, args, segIdxInAi } = params;
  const orientation = orientationLabel(args.aspectRatio);
  const hasProductRefs = args.classifiedAssets.some((a) => {
    const r = effectiveAssetRole(a);
    return r === "product_image" || r === "reference_image";
  });
  const lighting =
    bible.lightingArc[segIdxInAi] ?? bible.lightingArc[bible.lightingArc.length - 1] ?? "";

  const shotLines = shots
    .map((s) => {
      const camera = s.camera.trim() ? ` Camera: ${s.camera.trim()}.` : "";
      return `${s.fromSec}-${s.toSec}s: ${s.visual.trim().replace(/\.*$/, "")}.${camera}`;
    })
    .join("\n");

  const voiceoverChunk = voiceoverChunkForSegment(args, segIdxInAi);
  /// 镜头表不带台词：关着口播时固定写「不要旁白」，开着时只念已确认的口播稿。
  const audioLine = args.voiceover?.enabled
    ? voiceoverChunk
      ? "Audio: generate native speech for the approved voice-only dialogue below, with subtle real room ambience."
      : "Audio: subtle real room ambience only; do not improvise narration in this segment."
    : "Audio: real environment ambience only, no background music, no narration.";
  const voiceStyle = args.voiceover?.voiceId.replaceAll("-", " ") ?? "";
  const nativeDialogueBlock =
    args.voiceover?.enabled && voiceoverChunk
      ? [
          `Spoken dialogue (voice only, exact wording, ${args.voiceover.language}, ${voiceStyle}): "${escapeDialogueForPrompt(voiceoverChunk)}"`,
          /// 1028 P0：不再写「readable text」——那会让模型连商品自己印的字一起抹掉；这行只管台词别烧成字幕
          "Do not render subtitles, captions, on-screen text, or a music bed.",
        ].join("\n")
      : "";

  /// 真实场所参考图 → 强制画面复现实拍场景（与 Omni-Reference 图片锚配合）
  const refs = args.visualRefs;
  /// 0805：品牌文字按物理落位分道 —— 店招「室内禁止出现」，产品印字
  /// 「原位保留、禁止放大/复制/抹除」。旧数据无 signageKind 时按店招（旧行为）。
  /// 1028 P0：产品印字跟着商品走——写进 PRODUCT 行，不再只在真实场所时才写
  ///（白底商品图也要保留印字；故事板 grounding 也只保留 PRODUCT 行，REAL LOCATION 行会被换掉）。
  const productPrintSentence = refs?.signageText && refs.signageKind === "product_print"
    ? ` The brand mark printed on the product reads exactly "${refs.signageText}" — reproduce it faithfully exactly where it appears on the product in the reference photos, same size, position and finish; never enlarge it, never duplicate it onto walls, glass or other surfaces, and never erase it.`
    : "";
  const storefrontSignLine = refs?.signageText && refs.signageKind !== "product_print"
    ? `The storefront sign reads exactly "${refs.signageText}" — render this text accurately ONLY on the exterior storefront facade; the signage must NEVER appear inside the store, reflected, mirrored or duplicated on interior walls or glass.`
    : "";

  const productLine = hasProductRefs
    ? `PRODUCT (must exactly match the reference images): ${bible.productDescription}${productPrintSentence}`
    : `PRODUCT: ${bible.productDescription}${productPrintSentence}`;

  const realLocationLine =
    refs?.isRealLocation
      ? [
          "REAL LOCATION (the reference images are actual photos of this place): reproduce the photographed location faithfully — same layout, same furniture, same materials and colors. Do not redesign or restyle the space.",
          storefrontSignLine,
          refs.keyFeatures.length > 0
            ? `Signature features that must stay recognizable: ${refs.keyFeatures.join("; ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : null;

  /// 空间边界控制（防「视觉延伸」）：照片覆盖不到的区域一律不准脑补。
  /// 照片越少边界越紧：≤3 张 → 只拍照片视角 + 中近景为主；≥4 张 → 允许照片视角间的自然衔接。
  const boundaryLine = refs?.isRealLocation
    ? refs.photoCount <= 3
      ? `SPATIAL BOUNDARY (only ${refs.photoCount} reference photo(s) provided${refs.viewsCovered.length > 0 ? `, covering: ${refs.viewsCovered.join(" / ")}` : ""}): every shot must stay within these photographed views. Favor medium shots and close-ups of people, pets and photographed features; avoid wide establishing shots of unphotographed areas; NEVER invent adjacent rooms, corridors, extra aisles or unseen exterior angles.`
      : `SPATIAL BOUNDARY: the ${refs.photoCount} reference photos define the full visible space${refs.viewsCovered.length > 0 ? ` (${refs.viewsCovered.join(" / ")})` : ""}. Move the camera freely between these photographed views, but never extend the space beyond what the photos show.`
    : null;

  /// 风格模版决定「片头定性句」：商业质感模版不再自称 UGC 手机拍摄
  const isCommercialStyle =
    params.args.styleTemplate != null && params.args.styleTemplate.scaffold.dialogueStyle == null;
  const openingLine = isCommercialStyle
    ? `${orientation} premium commercial product video, ${slot.durationSec}s story told in ${shots.length} precisely edited cuts.`
    : `${orientation} UGC-style short video shot on a phone, ${slot.durationSec}s continuous story told in ${shots.length} quick cuts.`;

  const lockLines = (params.args.consistencyLocks ?? [])
    .map((l) => l.promptFragment)
    .join("\n");

  /// 纯产品质感模版（无角色 hint 且无口播）→ 不写 CHARACTER 行，产品即唯一主角
  const productOnly =
    params.args.styleTemplate != null &&
    !params.args.styleTemplate.scaffold.characterHint &&
    params.args.styleTemplate.scaffold.dialogueStyle == null;
  /// 有主播参考图（开关放行且素材标了 person）时，人物身份以照片为准（P02-C）；纯产品模版遇到主播图时
  /// 主播优先——不写「NO on-camera person」去和主播锁自相矛盾。
  const hasPresenterRef = presenterReferenceAssets(args.classifiedAssets).length > 0;
  const characterLine = productOnly && !hasPresenterRef
    ? "NO on-camera person: the product is the only hero of every shot."
    : `CHARACTER (${hasPresenterRef ? "must match the presenter reference photo — same face, hair, skin tone and build; " : ""}keep 100% identical in every cut): ${bible.characterProfile}`;

  const prompt = [
    openingLine,
    "",
    characterLine,
    `LOCATION: ${bible.environmentProfile}`,
    ...(realLocationLine ? [realLocationLine] : []),
    ...(boundaryLine ? [boundaryLine] : []),
    productLine,
    `LIGHTING: ${lighting}`,
    ...(lockLines ? ["", lockLines] : []),
    "",
    shotLines,
    "",
    audioLine,
    `Style: ${bible.styleKeywords}`,
  ].join("\n");

  return fitPromptWithPriorityBlock(prompt, nativeDialogueBlock);
}

// ---------------------------------------------------------------------------
// 模板镜头表（唯一路径）
// ---------------------------------------------------------------------------

/** 每个 AI 段一份：模板镜头表拼成的提示词 + 固定负面提示词。不调模型。 */
export function heuristicSegmentPrompts(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
  bible?: ConsistencyBible,
): SegmentPromptResult[] {
  const b =
    bible ??
    heuristicBible({
      creativeBrief: args.creativeBrief,
      classification: args.classification,
      classifiedAssets: args.classifiedAssets,
      aiSegmentCount: Math.max(1, aiSlots.length),
      language: args.language ?? "en-US",
    });
  return aiSlots.map((slot, i) => ({
    segmentOrder: i,
    seedancePrompt: composeSeedancePrompt({
      bible: b,
      shots: heuristicShotList(slot, args, b),
      slot,
      args,
      segIdxInAi: i,
    }),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    cameraDirection: i === 0 ? "handheld selfie" : "handheld over-the-shoulder",
    visualDirection: b.lightingArc[i] ?? "warm natural light, real setting",
    continuityNotes:
      i === 0 ? "Establish look and tone" : `Continue look from slot ${i - 1}`,
  }));
}

/** 按 role + 时长生成一个合理的多分镜列表（结构对齐同行：钩子→引入→展示→反差→收尾） */
function heuristicShotList(
  slot: UnifiedSegmentSlot,
  args: BuildSegmentPromptsArgs,
  bible: ConsistencyBible,
): ShotLine[] {
  const subject = subjectFromBrief(args.creativeBrief);
  const d = slot.durationSec;

  /// 短段（≤6s）：2-3 镜；标准 15s：5 镜
  if (d <= 6) {
    return retile(
      [
        {
          visual: `close-up of the character reacting with visible emotion to ${args.creativeBrief.corePainPoint}`,
          camera: "handheld selfie",
        },
        {
          visual: `the character holds up the product to camera, genuine delighted expression`,
          camera: "phone propped at eye level",
        },
      ],
      d,
    );
  }

  const base: Array<Omit<ShotLine, "fromSec" | "toSec">> = [
    {
      visual: `tight close-up on the character's face showing frustration with ${args.creativeBrief.corePainPoint}, mid-reaction`,
      camera: "handheld selfie, slightly shaky",
    },
    {
      visual: "the character grabs the product and shows it to camera, quick natural move",
      camera: "whip cut to phone propped on furniture",
    },
    {
      visual: `the character uses the product exactly as intended, hands clearly visible interacting with it`,
      camera: "close-up pan following the hands",
    },
    {
      visual: `the visible before/after payoff of using ${subject}, character reacts with surprise and relief`,
      camera: "slow push-in on the result",
    },
    {
      visual: "the character settles back relaxed and satisfied, natural smile at camera, calm closing energy",
      camera: "static phone framing, centered",
    },
  ];
  void bible;
  return retile(base, d);
}

/** 把无时间戳的镜头列表按均匀权重铺满 duration */
function retile(
  shots: Array<Omit<ShotLine, "fromSec" | "toSec">>,
  durationSec: number,
): ShotLine[] {
  const out: ShotLine[] = [];
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const remaining = shots.length - i;
    const span =
      i === shots.length - 1
        ? durationSec - cursor
        : Math.max(1, Math.round((durationSec - cursor) / remaining));
    out.push({ ...shots[i], fromSec: cursor, toSec: cursor + span });
    cursor += span;
  }
  return out.filter((s) => s.toSec > s.fromSec);
}

function subjectFromBrief(brief: CreativeBrief): string {
  if (brief.keySellingPoints.length > 0) {
    return brief.keySellingPoints[0];
  }
  return "the product";
}

/**
 * 真实门店有招牌文字时，放开 negative 里的「禁一切可读文字/logo」，
 * 否则 Seedance 会主动抹掉客户的真实招牌；改为只禁「乱码/拼错的文字」。
 * 1028 P0：商品印字不再只认「真实场所」——白底商品图上印的 logo 一样要防复制、放大、抹除；
 * 「不准脑补房间」只对真实场所的照片成立（商品图的场景由故事板决定，不加）。
 */
function adjustNegativeForRealSignage(
  negative: string,
  refs?: VisualReferenceAnalysis | null,
): string {
  if (!refs?.signageText) return negative;
  const productPrint = refs.signageKind === "product_print";
  if (!refs.isRealLocation && !productPrint) return negative;
  const roomBounds = refs.isRealLocation ? ", invented rooms, space extending beyond reference photos" : "";
  const cleaned = negative
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      const l = s.toLowerCase();
      return !(
        l === "no logo" ||
        l === "no brand text" ||
        l === "no readable text" ||
        l === "text artifacts"
      );
    })
    .join(", ");
  /// 0805：产品印字禁的是「复制/放大/挪位」，绝不能禁「室内出现」——
  /// 印字本来就在室内的产品上（店招负面照旧）。
  if (productPrint) {
    return `${cleaned}, misspelled brand text, gibberish lettering, warped text, duplicated brand mark, brand text on walls or glass, oversized brand mark${roomBounds}`;
  }
  return `${cleaned}, misspelled signage, gibberish lettering, warped text, signage visible indoors, duplicated signage, mirrored signage text${roomBounds}`;
}

/** 一致性锁的 negative 片段追加（去重靠简单包含判断） */
function withLockNegatives(negative: string, locks?: ConsistencyLock[]): string {
  const frags = (locks ?? [])
    .map((l) => l.negativeFragment)
    .filter((f): f is string => !!f && !negative.includes(f));
  if (frags.length === 0) return negative;
  return `${negative}, ${frags.join(", ")}`;
}

function descriptionForRole(
  role: UnifiedSegmentSlot["role"],
  brief: CreativeBrief,
): string {
  switch (role) {
    case "hook":
      return `Open with: ${brief.hook}`;
    case "demo":
      return "Demonstrate the product in real use";
    case "lifestyle":
      return "Show product in lifestyle / daily routine";
    case "benefit":
      return `Visual proof of: ${brief.corePainPoint}`;
    case "cta":
      return "Closing moment leading to brand end card or CTA overlay";
    case "intro":
      return "Establishing shot setting the scene";
    default:
      return "Cinematic segment";
  }
}

function roleFromSlot(slotRole: UnifiedSegmentSlot["role"]): VideoSegment["role"] {
  return slotRole;
}

function relevantReferenceAssetIds(args: BuildSegmentPromptsArgs): string[] {
  return args.classifiedAssets
    .filter((a) => {
      const r = effectiveAssetRole(a);
      return r === "product_image" || r === "reference_image";
    })
    .map((a) => a.id);
}

function estimateUploadedDuration(
  args: BuildSegmentPromptsArgs,
  uploadedAssetId: string | null,
): number {
  if (!uploadedAssetId) return 5;
  const asset = args.classifiedAssets.find((a) => a.id === uploadedAssetId);
  return asset?.durationSeconds ?? 5;
}

export const __test__ = {
  heuristicSegmentPrompts,
  composeSeedancePrompt,
  heuristicShotList,
  subjectFromBrief,
  DEFAULT_NEGATIVE_PROMPT,
};
