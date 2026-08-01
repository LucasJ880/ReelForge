/**
 * R3 · 配方维度胜负判定（PRD §4 / M2）。
 *
 * ⚠️ 这不是 racing-service / scoring-service 的改造版。那套是为旧概念
 * （代运营的投放效果评估）建的，输入是变体、判据是投放表现、输出是排名。
 * 新赛马的输入是**创意配方**、判据是**配方之间的结构差异**、输出要能回答
 * 「哪种结构在替我赚钱」。PRD §10.3 明确要求重写。
 *
 * 本模块只做判定，不碰数据采集 —— 表现数据由青砚发布后回流。
 *
 * ## 最重要的设计：宁可说「判不了」
 *
 * 小商家一周发 3-5 条，样本天然稀少。这种量级下：
 * - 一条偶然爆了的帖子会把它所属的配方顶上第一名；
 * - 「A 的互动率比 B 高」在 n=1 时几乎全是噪声。
 *
 * 所以这里**不给方向性结论**。样本不够就明确说判不了，并说明还差什么。
 * 给一个错的赢家比不给结论伤害大得多 —— 商家会照着它继续投入。
 */

/** 判定用的比率口径。分母不同不可混用。 */
export type RacingMetric = "engagement_rate" | "conversion_rate";

export type PerformanceRow = {
  recipeId: string | null;
  subjectId: string;
  impressions: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  conversions: number | null;
};

export type RecipeStats = {
  recipeId: string;
  /// 这个配方下有几条内容被发布过。**这是能否下结论的关键**，不是曝光量。
  subjectCount: number;
  trials: number;
  successes: number;
  rate: number;
  /// Wilson 区间。样本小时它会很宽 —— 那正是我们要让人看见的东西。
  lower: number;
  upper: number;
};

export type RacingVerdict =
  | {
      status: "winner";
      metric: RacingMetric;
      winner: RecipeStats;
      runnerUp: RecipeStats;
      /// 赢多少（百分点）。区间不重叠才会给这个数。
      marginPoints: number;
      ranked: RecipeStats[];
    }
  | {
      status: "no_difference";
      metric: RacingMetric;
      ranked: RecipeStats[];
      /// 为什么判成「分不出高下」而不是「还判不了」
      reason: string;
    }
  | {
      status: "insufficient";
      metric: RacingMetric;
      ranked: RecipeStats[];
      /// 差什么，说人话，让商家知道再发几条就能有结论
      missing: string[];
    };

/**
 * 判定门槛。
 *
 * `MIN_SUBJECTS_PER_RECIPE = 3`：一条内容代表不了一个配方。
 * 两条也不行 —— 两条里有一条爆了就是 50% 的样本被单点主导。
 * 三条是「至少能看出这不是偶然」的最低线，仍然不高，所以还要配区间检验。
 */
export const MIN_SUBJECTS_PER_RECIPE = 3;
/// 分母太小的时候比率毫无意义（10 次曝光里 1 次互动 = 10%）。
export const MIN_TRIALS_PER_RECIPE = 300;
/// 至少要有两个配方才谈得上比较。
export const MIN_RECIPES = 2;

function successesFor(row: PerformanceRow, metric: RacingMetric): number {
  if (metric === "conversion_rate") return row.conversions ?? 0;
  return (
    (row.likes ?? 0) +
    (row.comments ?? 0) +
    (row.shares ?? 0) +
    (row.saves ?? 0)
  );
}

function trialsFor(row: PerformanceRow): number | null {
  /// impressions 优先：views 的口径各平台差异更大。
  /// 两者都没有就是这行不可用，**不要用 1 或 0 兜底**，那会凭空造出一个比率。
  return row.impressions ?? row.views ?? null;
}

/**
 * Wilson score 区间。
 *
 * 为什么不用正态近似（p ± 1.96·√(p(1-p)/n)）：小样本或极端比率下它会给出
 * 负下界这种明显荒谬的区间，而赛马恰好总是在小样本区间工作。
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): { lower: number; upper: number } {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    lower: Math.max(0, (center - spread) / denominator),
    upper: Math.min(1, (center + spread) / denominator),
  };
}

export function aggregateByRecipe(
  rows: PerformanceRow[],
  metric: RacingMetric,
): RecipeStats[] {
  const buckets = new Map<
    string,
    { subjects: Set<string>; trials: number; successes: number }
  >();

  for (const row of rows) {
    /// 配方未知的内容一律排除，不归到某个默认桶里 ——
    /// 那会把「加列之前的历史成片」全部算成同一个配方，结论必然是错的。
    if (!row.recipeId) continue;
    const trials = trialsFor(row);
    if (trials === null || trials <= 0) continue;

    const bucket = buckets.get(row.recipeId) ?? {
      subjects: new Set<string>(),
      trials: 0,
      successes: 0,
    };
    bucket.subjects.add(row.subjectId);
    bucket.trials += trials;
    bucket.successes += successesFor(row, metric);
    buckets.set(row.recipeId, bucket);
  }

  return [...buckets.entries()]
    .map(([recipeId, bucket]) => {
      const rate = bucket.trials ? bucket.successes / bucket.trials : 0;
      const { lower, upper } = wilsonInterval(bucket.successes, bucket.trials);
      return {
        recipeId,
        subjectCount: bucket.subjects.size,
        trials: bucket.trials,
        successes: bucket.successes,
        rate,
        lower,
        upper,
      };
    })
    .sort((a, b) => b.rate - a.rate);
}

/**
 * 判定入口。
 *
 * 三种结果，缺一不可：
 * - `winner`：区间不重叠，可以说 A 赢了 B。
 * - `no_difference`：样本够了，但区间重叠 —— 这两种结构目前分不出高下，
 *   这是一个**有用的结论**（别在它们之间纠结了），不是失败。
 * - `insufficient`：样本不够，什么都不能说。附上还差什么。
 */
export function judgeRecipes(
  rows: PerformanceRow[],
  metric: RacingMetric = "engagement_rate",
): RacingVerdict {
  const ranked = aggregateByRecipe(rows, metric);

  const missing: string[] = [];
  const eligible = ranked.filter(
    (stats) =>
      stats.subjectCount >= MIN_SUBJECTS_PER_RECIPE &&
      stats.trials >= MIN_TRIALS_PER_RECIPE,
  );

  if (ranked.length < MIN_RECIPES) {
    missing.push(
      `目前只有 ${ranked.length} 种配方有数据，至少要 ${MIN_RECIPES} 种才能比较`,
    );
  }
  for (const stats of ranked) {
    if (stats.subjectCount < MIN_SUBJECTS_PER_RECIPE) {
      missing.push(
        `配方 ${stats.recipeId} 只发过 ${stats.subjectCount} 条，再发 ${
          MIN_SUBJECTS_PER_RECIPE - stats.subjectCount
        } 条才能判`,
      );
    } else if (stats.trials < MIN_TRIALS_PER_RECIPE) {
      missing.push(
        `配方 ${stats.recipeId} 曝光量仅 ${stats.trials}，样本太小，比率还不稳`,
      );
    }
  }

  if (eligible.length < MIN_RECIPES) {
    return { status: "insufficient", metric, ranked, missing };
  }

  const [winner, runnerUp] = eligible;
  /// 区间重叠 = 这个差距用现有数据解释不了，可能只是噪声。
  if (winner.lower <= runnerUp.upper) {
    return {
      status: "no_difference",
      metric,
      ranked,
      reason: `${winner.recipeId} 与 ${runnerUp.recipeId} 的置信区间重叠，现有数据分不出高下`,
    };
  }

  return {
    status: "winner",
    metric,
    winner,
    runnerUp,
    marginPoints: (winner.rate - runnerUp.rate) * 100,
    ranked,
  };
}

/**
 * 给商家看的一句话结论。
 *
 * 刻意不用「置信区间」「显著性」这类词：看这句话的人是开窗帘店的，
 * 不是数据分析师。但也**不能因此把不确定说成确定**。
 */
export function explainVerdict(verdict: RacingVerdict): string {
  switch (verdict.status) {
    case "winner":
      return `${verdict.winner.recipeId} 这种结构目前表现最好，比第二名高 ${verdict.marginPoints.toFixed(
        1,
      )} 个百分点，数据已经足够支持这个判断。`;
    case "no_difference":
      return "这几种结构目前看不出差别，可以按你自己顺手的来，不用在它们之间纠结。";
    case "insufficient":
      return `还判不出哪种结构更好。${verdict.missing[0] ?? "样本还不够"}。`;
  }
}
