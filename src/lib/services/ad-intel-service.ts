import { z } from "zod";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import { HOOK_TYPES, isHookType } from "@/lib/video-generation/creative-recipe";

/**
 * O4 · 同行广告情报与仿写（PRD §3 O4 / M4）。
 *
 * 做什么：采集官方广告透明库的公开广告 → 提取**结构骨架** → 存进配方库 →
 * 喂进生成（结构来自配方，画面与文案全部原创）。
 *
 * 不做什么：**任何形式的素材落地**。这个模块不接收、不存储、不返回
 * 素材 URL、缩略图、下载地址。搬运他人成片是版权侵权，且风险落在发布者
 * ——也就是我们的 to B 客户——头上，换平台不解决。
 *
 * 合规边界不是靠自觉：`AdIntelRecipe` 表里没有素材字段，
 * `adIntelObservationSchema` 会剥掉入参里的素材字段，
 * 并有回归测试守着这两点。
 */

/**
 * 采集到的一条广告观测。
 *
 * 注意它**故意不包含**任何 media / download / thumbnail 字段：
 * 采集器就算拿到了，也不该往这里传。
 */
export const adIntelObservationSchema = z.object({
  source: z.enum([
    "META_AD_LIBRARY",
    "TIKTOK_AD_LIBRARY",
    "GOOGLE_ADS_TRANSPARENCY",
    "APIFY_ORGANIC",
  ]),
  externalRef: z.string().min(1).max(200),
  industry: z.string().min(1).max(100),
  /// 供 LLM 做结构标注的文字描述：广告文案、字幕、画面描述。
  /// 这是**文本**，不是素材文件。
  observedCopy: z.string().min(1).max(8000),
  durationSec: z.number().int().positive().max(600).nullish(),
  aspectRatio: z.string().min(1).max(16).nullish(),
  /// 透明库给的「首次投放时间」推出来的连续投放天数。
  daysRunning: z.number().int().nonnegative().max(3650).nullish(),
  observedAt: z.coerce.date(),
});

export type AdIntelObservation = z.infer<typeof adIntelObservationSchema>;

/** 结构标注的产出。这就是我们保留的全部内容。 */
export const adStructureSchema = z.object({
  hookType: z.enum(HOOK_TYPES),
  openingBeats: z.string().min(1),
  pacing: z.string().min(1),
  sellingPointOrder: z.array(z.string().min(1)).max(10),
  socialProof: z.string().nullable(),
  ctaForm: z.string().nullable(),
});

export type AdStructure = z.infer<typeof adStructureSchema>;

const ANNOTATE_SYSTEM_PROMPT = `You extract the STRUCTURE of an advertisement, never its content.

Return JSON only:
{
  "hookType": "POV" | "Curiosity" | "Stat" | "Reveal" | "Pain" | "Demo",
  "openingBeats": "what physically happens in the first 3 seconds (action, not dialogue)",
  "pacing": "shot rhythm, e.g. '3 cuts in 5s then one long hold'",
  "sellingPointOrder": ["ordered list of what is claimed, generically described"],
  "socialProof": "review / number / authority / none",
  "ctaForm": "how the call to action is delivered, or null"
}

HARD RULES:
1. Describe STRUCTURE ONLY. Never copy or paraphrase the advertiser's exact wording,
   taglines, slogans, or brand claims. Say "price anchor stated" — not the price.
2. sellingPointOrder entries are CATEGORIES ("durability", "install speed"),
   not the advertiser's sentences.
3. Never output URLs, file names, or handles.
4. Output JSON only.`;

/**
 * 把一条观测标注成结构。
 *
 * 提示词里明确禁止复制原文措辞：结构、策略、创意方向不受版权保护，
 * 受保护的是**具体表达**。抄措辞就越过了那条线。
 */
export async function annotateAdStructure(
  observation: AdIntelObservation,
): Promise<AdStructure | null> {
  if (isLLMForcedMock() || !isLLMAvailable()) return null;
  try {
    const { data } = await chatJsonByTier<unknown>({
      tier: "research",
      stage: "ad_intel_structure",
      system: ANNOTATE_SYSTEM_PROMPT,
      user: `industry: ${observation.industry}
duration: ${observation.durationSec ?? "unknown"}s
observed copy and on-screen description:
${observation.observedCopy}`,
      temperature: 0.2,
      maxTokens: 900,
    });
    return coerceStructure(data);
  } catch (err) {
    console.warn(
      "[ad-intel] 结构标注失败：",
      (err as Error).message,
    );
    return null;
  }
}

export function coerceStructure(raw: unknown): AdStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const openingBeats = str(value.openingBeats);
  const pacing = str(value.pacing);
  /// 钩子类型与开场是结构的骨干，缺了这条观测就没有留存价值 ——
  /// 与其存一条半残的配方，不如不存。
  if (!isHookType(value.hookType) || !openingBeats || !pacing) return null;

  return {
    hookType: value.hookType,
    openingBeats,
    pacing,
    sellingPointOrder: Array.isArray(value.sellingPointOrder)
      ? value.sellingPointOrder
          .map((item) => str(item))
          .filter((item): item is string => Boolean(item))
          .slice(0, 10)
      : [],
    socialProof: str(value.socialProof),
    ctaForm: str(value.ctaForm),
  };
}

/**
 * 落库。
 *
 * 入参经过 schema 解析，素材字段在这一步就被剥掉了 ——
 * 采集器即使传了 downloadUrl，也进不到这里。
 */
export async function saveAdIntelRecipe(
  observation: AdIntelObservation,
  structure: AdStructure,
) {
  const data = {
    industry: observation.industry,
    hookType: structure.hookType,
    openingBeats: structure.openingBeats,
    pacing: structure.pacing,
    sellingPointOrder: structure.sellingPointOrder,
    socialProof: structure.socialProof,
    ctaForm: structure.ctaForm,
    durationSec: observation.durationSec ?? null,
    aspectRatio: observation.aspectRatio ?? null,
    daysRunning: observation.daysRunning ?? null,
    observedAt: observation.observedAt,
  };
  return db.adIntelRecipe.upsert({
    where: {
      source_externalRef: {
        source: observation.source,
        externalRef: observation.externalRef,
      },
    },
    create: { source: observation.source, externalRef: observation.externalRef, ...data },
    update: data,
  });
}

/**
 * 按行业取**长期在投**的广告结构清单。
 *
 * 验收标准要的是「该行业长期在投广告的结构清单」，
 * 而不只是一堆视频链接。所以排序键是 daysRunning ——
 * 长期在投 = 还在赚钱，这是搬运拿不到的筛选依据。
 */
export async function listIndustryStructures(args: {
  industry: string;
  minDaysRunning?: number;
  limit?: number;
}) {
  return db.adIntelRecipe.findMany({
    where: {
      industry: args.industry,
      /// 没有投放天数的观测排在结论之外：拿不到「还在赚钱」这个信号，
      /// 它就只是一条看起来不错的广告。
      daysRunning: { gte: args.minDaysRunning ?? 14 },
    },
    orderBy: [{ daysRunning: "desc" }, { observedAt: "desc" }],
    take: args.limit ?? 20,
    select: {
      id: true,
      source: true,
      industry: true,
      hookType: true,
      openingBeats: true,
      pacing: true,
      sellingPointOrder: true,
      socialProof: true,
      ctaForm: true,
      durationSec: true,
      aspectRatio: true,
      daysRunning: true,
      observedAt: true,
    },
  });
}

/**
 * 把外部配方转成喂给内容生成的提示词行。
 *
 * 只带结构，不带任何原文 —— 画面与文案全部原创。
 */
export function structuresToPromptLines(
  structures: Awaited<ReturnType<typeof listIndustryStructures>>,
): string[] {
  return structures.map(
    (structure, index) =>
      `参考结构 ${index + 1}（同行已连续投放 ${structure.daysRunning ?? "?"} 天）：` +
      `钩子=${structure.hookType}；开场=${structure.openingBeats}；` +
      `节奏=${structure.pacing}；` +
      `卖点顺序=${structure.sellingPointOrder.join(" → ") || "未标注"}；` +
      `社会证明=${structure.socialProof ?? "无"}；CTA=${structure.ctaForm ?? "无"}`,
  );
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none" || trimmed === "null") {
    return null;
  }
  return trimmed;
}
