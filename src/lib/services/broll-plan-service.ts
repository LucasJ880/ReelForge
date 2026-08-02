import { z } from "zod";
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import {
  isStockFootageAvailable,
  searchStockClips,
  stockClipSchema,
  type StockAspect,
  type StockClip,
} from "@/lib/providers/stock-footage";

/**
 * b-roll 视频计划（借鉴 MoneyPrinterTurbo 的编排，MIT）。
 * 分析与决策见 docs/roadmap/2026-08-01-moneyprinterturbo-review.md。
 *
 * 做什么：把一段口播脚本变成「镜头段 × 搜索词 × 候选素材」的选片清单，
 * 交给现有 ffmpeg stitch 合成 —— 不生成一帧 AI 画面，成本趋零。
 *
 * 定位：视频形态的第三条线路与兜底（PRD 风险 #5），不替代产品锚定主线。
 * b-roll 做不了产品一致性，讲流程/种草可以，展示 SKU 细节不行。
 *
 * MPT 的两条关键经验直接进契约：
 * 1. **搜索词按脚本叙事顺序生成**（match_script_order）：乱序会导致
 *    开头讲量尺、画面却是完工特写。每段一个词，顺序即叙事顺序。
 * 2. **maxClipDurationSec 控制切换频率**：短视频节奏本质是「几秒一切」，
 *    它同时是我们创意配方 pacing 维度的落点。
 */

export const brollSegmentSchema = z.object({
  order: z.number().int().nonnegative(),
  /// 这一段口播说什么（用于字幕与时长估算）
  narration: z.string().min(1),
  /// 给图库的英文搜索词 —— 图库索引以英文为主，中文词召回极差。
  searchTerm: z.string().min(1),
  /// 画面要传达什么（人审时看的，不进 API）
  visualIntent: z.string().min(1),
});

export const brollPlanSchema = z.object({
  aspect: z.enum(["portrait", "landscape"]),
  /// 每个素材片段在成片里的最长停留秒数（切换频率）。
  maxClipDurationSec: z.number().int().min(2).max(10),
  segments: z.array(brollSegmentSchema).min(2).max(12),
});

export type BrollPlan = z.infer<typeof brollPlanSchema>;

export const brollPickSchema = z.object({
  segment: brollSegmentSchema,
  /// 该段的候选素材，按分辨率降序。空数组 = 这个词没搜到，要换词重试。
  candidates: z.array(stockClipSchema).max(5),
});

export type BrollPick = z.infer<typeof brollPickSchema>;

const PLAN_SYSTEM_PROMPT = `You break a short-form video narration script into b-roll shot segments.

Return JSON only:
{
  "aspect": "portrait" | "landscape",
  "maxClipDurationSec": 3-6,
  "segments": [
    {
      "order": 0,
      "narration": "the sentence(s) spoken over this shot",
      "searchTerm": "2-4 ENGLISH words for stock footage search",
      "visualIntent": "what the viewer should see and why"
    }
  ]
}

HARD RULES:
1. Segments MUST follow the narration's storytelling order. Search terms must
   match each segment's content — never front-load the ending visuals.
2. searchTerm is ENGLISH only (stock libraries index in English), generic and
   shootable: "measuring window frame", not brand names or abstract concepts.
3. One segment per narrative beat; 4-8 segments for a 30-60s script.
4. Output JSON only.`;

export class BrollPlanError extends Error {
  constructor(
    message: string,
    readonly reason: "llm_unavailable" | "bad_script" | "footage_unavailable",
  ) {
    super(message);
    this.name = "BrollPlanError";
  }
}

/**
 * 脚本 → 镜头段计划。
 *
 * 与内容计划不同，这里**没有启发式兜底**：兜底搜索词会拉回一堆不相干素材，
 * 成片质量塌方后商家不会知道是兜底导致的。宁可明确失败。
 */
export async function buildBrollPlan(args: {
  script: string;
  aspect: StockAspect;
}): Promise<BrollPlan> {
  if (isLLMForcedMock() || !isLLMAvailable()) {
    throw new BrollPlanError("LLM 不可用，无法拆分镜头段", "llm_unavailable");
  }
  const script = args.script.trim();
  if (script.length < 20) {
    throw new BrollPlanError("脚本太短，拆不出镜头段", "bad_script");
  }

  const { data } = await chatJsonByTier<unknown>({
    tier: "creative",
    stage: "broll_shot_plan",
    system: PLAN_SYSTEM_PROMPT,
    user: `aspect: ${args.aspect}\nnarration script:\n${script}`,
    temperature: 0.4,
    maxTokens: 1800,
  });

  const parsed = brollPlanSchema.safeParse(coercePlan(data, args.aspect));
  if (!parsed.success) {
    throw new BrollPlanError("镜头段结构不合规，请重试", "bad_script");
  }
  return parsed.data;
}

function coercePlan(raw: unknown, aspect: StockAspect): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as Record<string, unknown>;
  const segments = Array.isArray(value.segments)
    ? value.segments.map((segment, index) => ({
        ...(typeof segment === "object" && segment ? segment : {}),
        /// 顺序以数组位置为准：模型给的 order 经常重复或跳号，
        /// 而顺序错乱正是这条管线最要防的事故。
        order: index,
      }))
    : [];
  return {
    aspect: value.aspect === "landscape" ? "landscape" : aspect,
    maxClipDurationSec:
      typeof value.maxClipDurationSec === "number"
        ? Math.min(10, Math.max(2, Math.round(value.maxClipDurationSec)))
        : 4,
    segments,
  };
}

/**
 * 按计划逐段搜索素材，产出选片清单。
 *
 * 候选跨段去重：同一条素材出现在两个镜头段里，观众一眼就看出来是凑的。
 */
export async function pickFootageForPlan(args: {
  plan: BrollPlan;
  fetchImpl?: typeof fetch;
}): Promise<BrollPick[]> {
  if (!isStockFootageAvailable()) {
    throw new BrollPlanError(
      "图库素材线路尚未接入（即将上线）：缺 PEXELS_API_KEYS / PIXABAY_API_KEYS",
      "footage_unavailable",
    );
  }

  const used = new Set<string>();
  const picks: BrollPick[] = [];
  for (const segment of args.plan.segments) {
    const clips = await searchStockClips({
      term: segment.searchTerm,
      aspect: args.plan.aspect,
      fetchImpl: args.fetchImpl,
    });
    const candidates: StockClip[] = [];
    for (const clip of clips) {
      if (used.has(clip.id)) continue;
      candidates.push(clip);
      if (candidates.length >= 5) break;
    }
    /// 只把首选标记为已用：后备候选仍可被后续段落复用，
    /// 否则前面的段落会把素材池吃空。
    if (candidates[0]) used.add(candidates[0].id);
    picks.push({ segment, candidates });
  }
  return picks;
}

/**
 * 选片清单的可交付性判定：每一段都得有素材，缺一段就不能进合成。
 * 缺的段落返回出来 —— 调用方要么换搜索词重试，要么把那段改成产品图卡。
 */
export function missingSegments(picks: BrollPick[]): number[] {
  return picks
    .filter((pick) => pick.candidates.length === 0)
    .map((pick) => pick.segment.order);
}
