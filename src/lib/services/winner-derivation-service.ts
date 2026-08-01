import { loadPerformanceRows } from "@/lib/services/performance-ingest-service";
import { judgeRecipes } from "@/lib/services/recipe-racing-service";
import {
  listIndustryStructures,
  structuresToPromptLines,
} from "@/lib/services/ad-intel-service";

/**
 * R4 · 赢家自动派生变体 + O4 冷启动配方（PRD §3 / §4 / M4）。
 *
 * 复现 Arcads 那个循环：**一条内容开始赢，就自动围绕它派生变体。**
 *
 * 两种输入按优先级：
 * 1. 自己的战绩（赛马判出赢家）—— 有证据，优先用。
 * 2. 同行长期在投的结构（广告情报）—— 冷启动时没有战绩，先借已验证的结构。
 *
 * 关键约束：**判不出赢家时不派生。** 拿一个噪声当赢家去派生一整周内容，
 * 等于让商家照着错的方向继续投入 —— 那比不派生伤害大得多。
 */

export type DerivationInput = {
  winningRecipe: { hookType: string; format: string } | null;
  referenceStructures: string[];
  /// 给商家看的一句话，说明这一周为什么这么排
  basis: string;
};

/**
 * `post:POV:single_image` → `{ hookType: "POV", format: "single_image" }`
 * 拆不出来就返回 null —— 派生依赖结构，猜错结构比不派生更糟。
 */
export function parseRecipeId(
  recipeId: string,
): { hookType: string; format: string } | null {
  const parts = recipeId.split(":");
  if (parts.length !== 3 || parts[0] !== "post") return null;
  const [, hookType, format] = parts;
  if (!hookType || !format) return null;
  return { hookType, format };
}

export async function resolveDerivationInput(args: {
  userId: string;
  industry?: string | null;
  windowHours?: number;
}): Promise<DerivationInput> {
  const rows = await loadPerformanceRows({
    userId: args.userId,
    windowHours: args.windowHours ?? 48,
  });
  const verdict = judgeRecipes(rows);

  if (verdict.status === "winner") {
    const parsed = parseRecipeId(verdict.winner.recipeId);
    if (parsed) {
      return {
        winningRecipe: parsed,
        referenceStructures: [],
        basis: `按你自己的战绩排的：${parsed.hookType} 这种结构目前表现最好，本周围绕它多做几条。`,
      };
    }
  }

  /// 没有战绩（或判不出）就借同行已验证的结构 —— 但要说清楚这是借来的，
  /// 不能让商家以为这是他自己的数据结论。
  const structures = args.industry
    ? await listIndustryStructures({ industry: args.industry, limit: 5 })
    : [];

  return {
    winningRecipe: null,
    referenceStructures: structuresToPromptLines(structures),
    basis: structures.length
      ? `你自己的数据还判不出胜负，本周先参考同行长期在投的 ${structures.length} 种结构。`
      : "这是第一周，先把节奏跑起来；发够几条之后就能看出哪种结构在替你赚钱。",
  };
}
