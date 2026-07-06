/**
 * Phase 5 — Prompt Intelligence Engine（2026-07 质量对齐重写）。
 *
 * 输入：CreativeBrief + ConsistencyBible + UnifiedSegmentSlot[] + classifiedAssets + classification
 * 输出：VideoSegment[]
 *
 * 对齐同行成片质量的核心改造：
 *  1. 单段 prompt 不再是「一个镜头晃 15 秒」，而是 Seedance 2.0 官方推荐的
 *     **时间戳分镜格式**（0-3s / 3-5s / ...），一个 15s 段内含 4-6 个剪辑点，
 *     叙事结构 = 痛点钩子 → 引入 → 展示 → 反差/高光 → 卖点 → 收尾。
 *  2. 每段 prompt 头部**逐字注入** ConsistencyBible（角色/场景/产品锚），
 *     跨段人物、场景、产品完全一致（同行用角色板/产品板，我们文字锚+参考图双保险）。
 *  3. 每个分镜可带台词（Dialogue），配合 Seedance 2.0 generate_audio 产出原生口播。
 *  4. 光线弧（lightingArc）按段推进，光线本身讲故事。
 *
 * 路径：
 *  - isLLMForcedMock() / isLLMAvailable()==false → 启发式
 *  - 否则 → 调 chatJsonByTier(tier: "videoPrompt")；失败回退启发式
 *
 * 硬约束（不论 LLM / heuristic）：
 *  - prompt 不写 logo URL / 品牌名 / slogan / URL / QR / 精确 CTA 文本
 *  - negativePrompt 始终 append brand guard
 */

import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/providers/openai";
import { effectiveAssetRole } from "@/types/video-generation";
import type {
  AspectRatio,
  ConsistencyBible,
  CreativeBrief,
  InputClassification,
  UploadedAsset,
  VideoSegment,
} from "@/types/video-generation";
import { heuristicBible } from "@/lib/video-generation/consistency-bible";
import type { ConsistencyLock, StyleTemplate } from "@/lib/video-generation/style-templates";
import type { VisualReferenceAnalysis } from "@/lib/video-generation/visual-reference-analysis";
import { resolutionForAspectRatio, type UnifiedSegmentSlot } from "@/lib/video-generation/segment-planner-adapter";

const SEEDANCE_BRAND_GUARD_RULE = `
ABSOLUTE BRAND CONSTRAINT (most important rule, never violate):
- DO NOT instruct the model to render exact logos, brand names, slogans, URLs, QR codes, promo text, CTA button text, or any specific on-screen text that must be precise.
- These are post-processed by Aivora's overlay layer, not by the AI video model.
- You MAY describe spatial regions that will receive overlays later (e.g., "leave a clean lower-third area for caption overlay").
- For end-card / CTA moments, focus on visual atmosphere, NOT the literal text.
- Dialogue is VOICE ONLY: the model must never burn subtitles/captions into the frame. AI video models misrender CJK glyphs (wrong or archaic characters), so all captions are added by the post-production overlay layer instead.
- Negative prompts MUST include: "no logo, no brand text, no URLs, no readable text, no QR codes, no watermarks, no subtitles, no captions, no on-screen text".
`.trim();

const SEEDANCE_CONTINUITY_RULE = `
HARD CONTINUITY CONSTRAINTS (violating any of these ruins the whole video):
- ONE segment = ONE physical space. If the reference images show different rooms, anchor the entire segment in a single room; NEVER blend rooms or cut between different reference spaces inside one segment.
- If a person appears, it is the SAME person in every shot: identical face, hair, wardrobe. NEVER cut to a disembodied hand, a different person, or different clothing performing the action — show the established character doing it in frame.
- The product keeps ONE identity for the whole segment: same color, same shape, same hardware. When the character interacts with the product, it must be the exact same product instance already shown.
`.trim();

const PROMPT_INTELLIGENCE_SYSTEM_PROMPT = `You are a short-form ad director writing shot lists for an AI video model (Seedance 2.0). Each video segment (max 15s) is generated as ONE task, but must contain MULTIPLE quick cuts told with timestamps — this is what makes the result feel like a real edited ad instead of one boring continuous shot.

You are given a consistency bible (character / location / product / lighting arc). The bible is injected into the final prompt automatically — do NOT restate it inside shot descriptions; just make sure your shots are consistent with it.

For EACH segment slot, return:

{
  "segmentOrder": 0,
  "shots": [
    { "fromSec": 0, "toSec": 3, "visual": "concrete action + framing, max 22 words", "camera": "handheld selfie | phone propped on desk | close-up pan | whip cut | slow push-in | overhead", "dialogue": "spoken line in the target language, or empty string" }
  ],
  "negativePrompt": "things to avoid",
  "cameraDirection": "dominant camera style of this segment",
  "visualDirection": "lighting + color grade + mood",
  "continuityNotes": "what must stay identical with the previous segment"
}

SHOT LIST RULES (critical for quality):
1. A 15s segment needs 4-6 shots; a 10s segment 3-4; a 5s segment 2-3. Timestamps must tile the full duration exactly, no gaps.
2. Story structure inside each segment: pain-point hook (first 2s MUST grab attention) → product enters → demonstration/transformation → payoff. Use before/after contrast where possible.
3. dialogue: natural spoken language, like a real person talking to camera — contractions, casual, NEVER ad-copy. Total spoken words per segment must fit the duration (~2.3 words/sec English, ~3.5 chars/sec Chinese). Some shots can have empty dialogue for visual beats.
4. visual: concrete and physical — what the viewer literally sees (subject + action + framing). Never abstract ("shows the benefit") or vague filler (amazing, premium, revolutionary).
5. If product reference images are provided, at least half the shots must feature the product; write "the product (match the reference images exactly)" when it appears.
6. Emotion on the character's face matters: annoyed, surprised, delighted, relieved — direct it explicitly.

${SEEDANCE_CONTINUITY_RULE}

${SEEDANCE_BRAND_GUARD_RULE}

Output JSON only, in this exact envelope: {"segments": [ ...one entry per segment slot, same order... ]}`;

const DEFAULT_NEGATIVE_PROMPT =
  "low quality, blurry, distorted hands, extra fingers, morphing face, inconsistent character, text artifacts, watermark, no logo, no brand text, no URLs, no readable text, no QR codes, no subtitles, no captions, no on-screen text";

export interface ShotLine {
  fromSec: number;
  toSec: number;
  visual: string;
  camera: string;
  dialogue: string;
}

export interface BuildSegmentPromptsArgs {
  creativeBrief: CreativeBrief;
  segmentSlots: UnifiedSegmentSlot[];
  classifiedAssets: UploadedAsset[];
  classification: InputClassification;
  aspectRatio: AspectRatio;
  /// 跨镜头一致性圣经；缺省时用启发式兜底（兼容旧调用方/测试）
  consistencyBible?: ConsistencyBible | null;
  /// 口播/台词语言（如 "zh-CN" / "en-US"），默认英文
  language?: string;
  /// 风格模版（skill 模式）：约束分镜结构/镜头语言/台词口吻
  styleTemplate?: StyleTemplate | null;
  /// 一致性锁：逐字追加到每段 prompt 的约束行
  consistencyLocks?: ConsistencyLock[];
  /// 参考图视觉分析：真实门店场景时注入实景匹配指令 + 放开招牌文字渲染
  visualRefs?: VisualReferenceAnalysis | null;
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

  const aiPrompts =
    aiSlots.length === 0
      ? []
      : isLLMForcedMock() || !isLLMAvailable()
        ? heuristicSegmentPrompts(args, aiSlots, bible)
        : await tryLLMSegmentPrompts(args, aiSlots, bible);

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
// 最终 prompt 组装（确定性代码，保证 bible 逐字一致，不依赖 LLM 抄写）
// ---------------------------------------------------------------------------

/// Seedance 英文建议 ≤1000 词；这里给最终 prompt 一个安全字符预算
const PROMPT_CHAR_BUDGET = 3300;

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
      const dialogue = s.dialogue.trim()
        ? ` Dialogue (spoken to camera): "${s.dialogue.trim()}"`
        : "";
      const camera = s.camera.trim() ? ` Camera: ${s.camera.trim()}.` : "";
      return `${s.fromSec}-${s.toSec}s: ${s.visual.trim().replace(/\.*$/, "")}.${camera}${dialogue}`;
    })
    .join("\n");

  const hasDialogue = shots.some((s) => s.dialogue.trim().length > 0);
  const audioLine = hasDialogue
    ? `Audio: natural voiceover speaking the quoted dialogue lines (${bible.voiceProfile ?? "casual natural voice"}), real room ambience, no background music.`
    : "Audio: real environment ambience only, no background music, no narration.";

  const productLine = hasProductRefs
    ? `PRODUCT (must exactly match the reference images): ${bible.productDescription}`
    : `PRODUCT: ${bible.productDescription}`;

  /// 真实场所参考图 → 强制画面复现实拍场景（与 Omni-Reference 图片锚配合）
  const refs = args.visualRefs;
  const realLocationLine =
    refs?.isRealLocation
      ? [
          "REAL LOCATION (the reference images are actual photos of this place): reproduce the photographed location faithfully — same layout, same furniture, same materials and colors. Do not redesign or restyle the space.",
          refs.signageText
            ? `The storefront sign reads exactly "${refs.signageText}" — render this text accurately ONLY on the exterior storefront facade; the signage must NEVER appear inside the store, reflected, mirrored or duplicated on interior walls or glass.`
            : "",
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
  const characterLine = productOnly
    ? "NO on-camera person: the product is the only hero of every shot."
    : `CHARACTER (keep 100% identical in every cut): ${bible.characterProfile}`;

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

  return prompt.length > PROMPT_CHAR_BUDGET
    ? prompt.slice(0, PROMPT_CHAR_BUDGET).replace(/\s\S*$/, "")
    : prompt;
}

// ---------------------------------------------------------------------------
// LLM 路径
// ---------------------------------------------------------------------------

async function tryLLMSegmentPrompts(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
  bible: ConsistencyBible,
): Promise<SegmentPromptResult[]> {
  try {
    const userPrompt = buildLLMUserPrompt(args, aiSlots, bible);
    const { data } = await chatJsonByTier<unknown>({
      tier: "videoPrompt",
      stage: "unified_segment_prompts",
      system: PROMPT_INTELLIGENCE_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: 0.7,
      maxTokens: 4000,
    });

    /// LLM 可能直接返回 array 也可能包裹在 { prompts: [...] }
    const arr = extractArray(data);
    if (!arr) {
      console.warn("[prompt-intelligence] LLM did not return array; falling back");
      return heuristicSegmentPrompts(args, aiSlots, bible);
    }

    return aiSlots.map((slot, i) => {
      const raw = arr[i] && typeof arr[i] === "object" ? (arr[i] as Record<string, unknown>) : {};
      const shots = normalizeShots(raw.shots, slot.durationSec);
      const seedancePrompt =
        shots.length > 0
          ? composeSeedancePrompt({ bible, shots, slot, args, segIdxInAi: i })
          : composeSeedancePrompt({
              bible,
              shots: heuristicShotList(slot, args, bible),
              slot,
              args,
              segIdxInAi: i,
            });
      return {
        segmentOrder: i,
        seedancePrompt,
        negativePrompt:
          typeof raw.negativePrompt === "string" && raw.negativePrompt.trim().length > 0
            ? appendBrandGuard(raw.negativePrompt)
            : DEFAULT_NEGATIVE_PROMPT,
        cameraDirection:
          typeof raw.cameraDirection === "string" ? raw.cameraDirection : "handheld",
        visualDirection:
          typeof raw.visualDirection === "string"
            ? raw.visualDirection
            : "warm natural light",
        continuityNotes:
          typeof raw.continuityNotes === "string" ? raw.continuityNotes : "",
      };
    });
  } catch (err) {
    console.warn(
      "[prompt-intelligence] LLM failed; falling back to heuristic:",
      (err as Error).message,
    );
    return heuristicSegmentPrompts(args, aiSlots, bible);
  }
}

/** 校验 + 修正 LLM 返回的 shot list：时间轴必须铺满时长、字段齐全 */
function normalizeShots(raw: unknown, durationSec: number): ShotLine[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const shots: ShotLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const visual = typeof o.visual === "string" ? o.visual.trim() : "";
    if (!visual) continue;
    shots.push({
      fromSec: Number(o.fromSec) || 0,
      toSec: Number(o.toSec) || 0,
      visual,
      camera: typeof o.camera === "string" ? o.camera : "",
      dialogue: typeof o.dialogue === "string" ? o.dialogue : "",
    });
  }
  if (shots.length === 0) return [];

  /// 重铺时间轴：按 LLM 给的相对时长比例归一到 [0, durationSec]，杜绝缺口/溢出
  const weights = shots.map((s) => Math.max(1, s.toSec - s.fromSec));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const span =
      i === shots.length - 1
        ? durationSec - cursor
        : Math.max(1, Math.round((weights[i] / total) * durationSec));
    shots[i].fromSec = cursor;
    shots[i].toSec = Math.min(durationSec, cursor + span);
    cursor = shots[i].toSec;
  }
  shots[shots.length - 1].toSec = durationSec;
  return shots.filter((s) => s.toSec > s.fromSec);
}

function extractArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    /// 单 segment 时 LLM 常直接返回一个 entry 对象（含 shots 字段）
    if (Array.isArray(obj.shots)) return [obj];
    for (const key of ["prompts", "segments", "segmentPrompts", "results", "entries", "output"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    /// 兜底：对象里第一个「对象数组」值
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v;
    }
  }
  return null;
}

function buildLLMUserPrompt(
  args: BuildSegmentPromptsArgs,
  aiSlots: UnifiedSegmentSlot[],
  bible: ConsistencyBible,
): string {
  const slotSummary = aiSlots
    .map(
      (s, i) =>
        `  - slot ${i}: role=${s.role} duration=${s.durationSec}s lighting="${bible.lightingArc[i] ?? ""}"`,
    )
    .join("\n");

  const referenceAssets = args.classifiedAssets
    .filter((a) => {
      const r = effectiveAssetRole(a);
      return r === "product_image" || r === "reference_image";
    })
    .map((a) => `  - ${a.fileName} (${effectiveAssetRole(a)})`)
    .join("\n");

  const refs = args.visualRefs;
  const locationSection =
    refs?.isRealLocation && refs.locationDescription
      ? `
# REAL LOCATION (client's actual photos, also fed to the video model as references)
This video takes place in a real place: ${refs.locationDescription}
${refs.signageText ? `- storefront sign reads exactly: "${refs.signageText}" (exterior establishing shot ONLY — never show signage from inside)` : ""}
${refs.keyFeatures.length > 0 ? `- weave these real features into your shots: ${refs.keyFeatures.join("; ")}` : ""}
- photo coverage (${refs.photoCount} photo(s)): ${refs.viewsCovered.join(" / ") || "unspecified"}
- CRITICAL: design shots ONLY within these photographed views. ${refs.photoCount <= 3 ? "Coverage is limited — use medium shots / close-ups of people, pets and photographed features instead of wide shots of unseen areas." : "You may cut between photographed views freely."} Never invent unseen rooms or angles.
`
      : "";

  const tpl = args.styleTemplate;
  const templateSection = tpl
    ? `
# LOCKED STYLE TEMPLATE: "${tpl.name}" (obey strictly)
- shot pattern to follow (adapt to the brief, keep the structure): ${tpl.scaffold.shotPattern}
- camera language to use: ${tpl.scaffold.cameraLanguage}
- ${tpl.scaffold.dialogueStyle ? `dialogue style: ${tpl.scaffold.dialogueStyle}` : "NO dialogue in any shot (pure visual style): every shot's dialogue must be an empty string"}
`
    : "";

  return `# Creative brief
${JSON.stringify(args.creativeBrief, null, 2)}
${locationSection}${templateSection}
# Consistency bible (already injected into the final prompt — keep your shots consistent with it)
${JSON.stringify(bible, null, 2)}

# Segment slots to fill (return one entry per slot, in the same order)
${slotSummary}

# Product reference images (passed to the video model; do NOT include URLs)
${referenceAssets || "  (none)"}

# Output spec
aspect_ratio: ${args.aspectRatio}
generation_mode: ${args.classification.generationMode}
dialogue_language: ${args.language ?? "en-US"}

Return the JSON array now.`;
}

// ---------------------------------------------------------------------------
// 启发式路径（mock / LLM 故障兜底）
// ---------------------------------------------------------------------------

/** 启发式 prompt 生成器 —— 无 LLM / mock / LLM 失败时使用 */
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
          dialogue: "",
        },
        {
          visual: `the character holds up the product to camera, genuine delighted expression`,
          camera: "phone propped at eye level",
          dialogue: "",
        },
      ],
      d,
    );
  }

  const base: Array<Omit<ShotLine, "fromSec" | "toSec">> = [
    {
      visual: `tight close-up on the character's face showing frustration with ${args.creativeBrief.corePainPoint}, mid-reaction`,
      camera: "handheld selfie, slightly shaky",
      dialogue: hookLine(args),
    },
    {
      visual: "the character grabs the product and shows it to camera, quick natural move",
      camera: "whip cut to phone propped on furniture",
      dialogue: "",
    },
    {
      visual: `the character uses the product exactly as intended, hands clearly visible interacting with it`,
      camera: "close-up pan following the hands",
      dialogue: benefitLine(args),
    },
    {
      visual: `the visible before/after payoff of using ${subject}, character reacts with surprise and relief`,
      camera: "slow push-in on the result",
      dialogue: "",
    },
    {
      visual: "the character settles back relaxed and satisfied, natural smile at camera, calm closing energy",
      camera: "static phone framing, centered",
      dialogue: closeLine(args),
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

function isZh(args: BuildSegmentPromptsArgs): boolean {
  return (args.language ?? "").toLowerCase().startsWith("zh");
}

function hookLine(args: BuildSegmentPromptsArgs): string {
  return isZh(args)
    ? "又来了，真的受不了了"
    : "okay this was driving me CRAZY";
}

function benefitLine(args: BuildSegmentPromptsArgs): string {
  const point = args.creativeBrief.keySellingPoints[0] ?? "it just works";
  return isZh(args) ? `就这一下，问题直接解决` : `look at this — ${truncateWords(point, 8)}`;
}

function closeLine(args: BuildSegmentPromptsArgs): string {
  return isZh(args) ? "早点买就好了" : "why did I wait so long for this";
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
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
 */
function adjustNegativeForRealSignage(
  negative: string,
  refs?: VisualReferenceAnalysis | null,
): string {
  if (!refs?.isRealLocation || !refs.signageText) return negative;
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
  return `${cleaned}, misspelled signage, gibberish lettering, warped text, signage visible indoors, duplicated signage, mirrored signage text, invented rooms, space extending beyond reference photos`;
}

/** 一致性锁的 negative 片段追加（去重靠简单包含判断） */
function withLockNegatives(negative: string, locks?: ConsistencyLock[]): string {
  const frags = (locks ?? [])
    .map((l) => l.negativeFragment)
    .filter((f): f is string => !!f && !negative.includes(f));
  if (frags.length === 0) return negative;
  return `${negative}, ${frags.join(", ")}`;
}

function appendBrandGuard(negative: string): string {
  let out = negative.trim().replace(/[,\s]+$/, "");
  if (!out.toLowerCase().includes("no logo")) {
    out = `${out}, no logo, no brand text, no URLs, no readable text, no QR codes`;
  }
  /// AI 模型烧录的中文字幕常出现错字/异体字（如「晒」→「曬」），字幕一律走后期 overlay
  if (!out.toLowerCase().includes("no subtitles")) {
    out = `${out}, no subtitles, no captions, no on-screen text`;
  }
  return out;
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
  normalizeShots,
  appendBrandGuard,
  subjectFromBrief,
  DEFAULT_NEGATIVE_PROMPT,
  SEEDANCE_BRAND_GUARD_RULE,
};
