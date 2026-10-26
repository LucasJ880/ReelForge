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

/**
 * 分组维度（PRD §4.3 R3：「按钩子类型 / 模板 / 时长 / 画幅 / 植入档位分组比较」）。
 *
 * `recipe` 是默认维度，也是最有解释力的一维（结构本身）。
 * 其余四维回答的是另一类问题：「9:16 是不是比 1:1 强」「自然植入是不是比角标强」——
 * 决策 3 要验证换植入档位有没有用，靠的就是 `brandPlacement` 这一维。
 *
 * 每一维都走同一套样本门槛与区间检验，不因为维度换了就放松判据。
 */
export type RacingDimension =
  | "recipe"
  | "hookType"
  | "templateId"
  | "durationSec"
  | "aspectRatio"
  | "brandPlacement";

export type PerformanceRow = {
  recipeId: string | null;
  /// 以下四维来自 subject 上的配方快照，与 recipeId 同样是生成时冻结的。
  /// 缺失即未知，参与不了该维度的比较（而不是归进某个默认桶）。
  hookType?: string | null;
  templateId?: string | null;
  durationSec?: number | null;
  aspectRatio?: string | null;
  brandPlacement?: string | null;
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
  /// 这一组的标识。维度为 recipe 时是 recipeId，为 aspectRatio 时是 "9:16"，以此类推。
  recipeId: string;
  /// 这个配方下有几条内容被发布过。**这是能否下结论的关键**，不是曝光量。
  subjectCount: number;
  /// 累计曝光（impressions，缺了退到 views）——只用来卡「曝光够不够」的门槛。
  trials: number;
  /// 累计事件数：互动（点赞 + 评论 + 转发 + 收藏）或转化。**是计数不是二项「成功」**：
  /// 一个人可以既点赞又收藏，事件数完全可以大于曝光数。字段名沿用旧契约。
  successes: number;
  /// 每次曝光的事件数：各条帖子平滑后比率的平均（见 aggregateByRecipe），可以大于 1。
  rate: number;
  /// 95% 区间：按帖子之间的差异算（t 区间），下限不低于抽样噪声。样本小时它会很宽 ——
  /// 那正是我们要让人看见的东西。
  lower: number;
  upper: number;
};

export type RacingVerdict =
  | {
      status: "winner";
      metric: RacingMetric;
      dimension: RacingDimension;
      winner: RecipeStats;
      runnerUp: RecipeStats;
      /// 赢多少（百分点）。区间不重叠才会给这个数。
      marginPoints: number;
      ranked: RecipeStats[];
    }
  | {
      status: "no_difference";
      metric: RacingMetric;
      dimension: RacingDimension;
      ranked: RecipeStats[];
      /// 为什么判成「分不出高下」而不是「还判不了」
      reason: string;
    }
  | {
      status: "insufficient";
      metric: RacingMetric;
      dimension: RacingDimension;
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

/**
 * 取某一维度的分组键。
 *
 * 返回 null 表示这一行在该维度上是**未知**，直接排除 ——
 * 与 recipeId 为 null 的处理一致：未知不是一个可以比较的桶。
 */
export function groupKeyFor(
  row: PerformanceRow,
  dimension: RacingDimension,
): string | null {
  switch (dimension) {
    case "recipe":
      return row.recipeId ?? null;
    case "hookType":
      return row.hookType ?? null;
    case "templateId":
      return row.templateId ?? null;
    case "aspectRatio":
      return row.aspectRatio ?? null;
    case "brandPlacement":
      return row.brandPlacement ?? null;
    case "durationSec":
      /// 时长按秒分桶会碎成一堆单点，比不出东西。
      /// 按投放语境里真实存在的档位分：短 / 中 / 长。
      if (typeof row.durationSec !== "number" || row.durationSec <= 0) return null;
      if (row.durationSec <= 15) return "≤15s";
      if (row.durationSec <= 30) return "16-30s";
      return ">30s";
  }
}

/** 事件数：转化，或互动四项之和。是计数，可以大于曝光数；脏的负数按 0 算。 */
function successesFor(row: PerformanceRow, metric: RacingMetric): number {
  if (metric === "conversion_rate") return Math.max(0, row.conversions ?? 0);
  return Math.max(
    0,
    (row.likes ?? 0) +
      (row.comments ?? 0) +
      (row.shares ?? 0) +
      (row.saves ?? 0),
  );
}

function trialsFor(row: PerformanceRow): number | null {
  /// impressions 优先：views 的口径各平台差异更大。
  /// 两者都没有就是这行不可用，**不要用 1 或 0 兜底**，那会凭空造出一个比率。
  return row.impressions ?? row.views ?? null;
}

/**
 * Wilson score 区间——**只适用于真正的二项比例**（成功数 ≤ 试验数，每次试验成功或不成功）。
 *
 * 为什么不用正态近似（p ± 1.96·√(p(1-p)/n)）：小样本或极端比率下它会给出
 * 负下界这种明显荒谬的区间。
 *
 * ⚠️ 配方判定不再用它（2026-10-25 审计 B5）：互动数是事件计数、可以大于曝光数，
 * 喂进来 p > 1，根号里是负数，区间成 NaN。判定改走 postRateInterval。
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

/**
 * 平滑用的伪曝光（M）：每条帖子的比率按 (事件 + 先验率 × M) / (曝光 + M) 算——
 * 曝光只有几十的帖子被拉向整体水平（20 次曝光 10 个赞不该算 50%），几千曝光的帖子几乎不受影响。
 * 先验率取同一维度全部可用行的「总事件 ÷ 总曝光」：对所有分组一视同仁，不偏向任何一组。
 */
export const RATE_SMOOTHING_EXPOSURE = 100;

const Z_95 = 1.96;

/** 双侧 95% 的 Student t 分位数：自由度 1–30 查表，再往上取不小于真值的保守值。 */
const T_975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

export function studentT975(df: number): number {
  if (!Number.isFinite(df) || df < 1) return Number.POSITIVE_INFINITY;
  const whole = Math.floor(df);
  if (whole <= T_975.length) return T_975[whole - 1];
  if (whole <= 60) return 2.042;
  if (whole <= 120) return 2.0;
  return 1.98;
}

/** 一条已发布内容在某个窗口里的表现：事件数（互动或转化）与曝光。 */
export type PostSample = { events: number; exposures: number };

/**
 * 一组帖子的「每次曝光事件数」与 95% 区间（纯函数，便于单测）。
 *
 * 为什么不再用 Wilson：Wilson 是二项比例的区间，要求成功数 ≤ 试验数。互动数是事件计数，
 * 可以大于曝光数——比率 > 1 时 Wilson 的根号里是负数，区间成 NaN，而 NaN 的比较恒为假，
 * 「区间重叠就不判赢家」那道闸被直接绕过：任何两组都会被判出赢家。
 *
 * 现在：
 *  - 单位是帖子：每条帖子算自己的平滑比率，组的读数是这些比率的平均——一条爆款只占一票，
 *    不会因为曝光大就把整组顶上去（条数才是下结论的关键，见 RecipeStats.subjectCount）；
 *  - 区间 = 平均 ± t(n−1) × 标准误（帖子之间的差异）；帖子再像，也不窄于每条帖子自身的
 *    抽样噪声（泊松：方差 ≈ 比率 ÷ 曝光），几条恰好相同的帖子不会给出一个点；
 *  - 只有一条帖子时估不出帖子之间的差异，区间只含抽样噪声——这种组本来就进不了判定
 *    （MIN_SUBJECTS_PER_RECIPE）。
 */
export function postRateInterval(
  posts: readonly PostSample[],
  priorRate: number,
  smoothing = RATE_SMOOTHING_EXPOSURE,
): { rate: number; lower: number; upper: number } {
  const usable = posts.filter((post) => post.exposures > 0 && post.events >= 0);
  if (usable.length === 0) return { rate: 0, lower: 0, upper: 0 };
  const prior = Number.isFinite(priorRate) && priorRate > 0 ? priorRate : 0;
  const rates = usable.map((post) => (post.events + prior * smoothing) / (post.exposures + smoothing));
  const n = rates.length;
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / n;
  const samplingVariance =
    usable.reduce((sum, post) => sum + mean / (post.exposures + smoothing), 0) / (n * n);
  let halfWidth = Z_95 * Math.sqrt(samplingVariance);
  if (n >= 2) {
    const spread = rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / (n - 1);
    halfWidth = Math.max(halfWidth, studentT975(n - 1) * Math.sqrt(spread / n));
  }
  return { rate: mean, lower: Math.max(0, mean - halfWidth), upper: mean + halfWidth };
}

export function aggregateByRecipe(
  rows: PerformanceRow[],
  metric: RacingMetric,
  dimension: RacingDimension = "recipe",
): RecipeStats[] {
  const buckets = new Map<
    string,
    { posts: Map<string, PostSample>; trials: number; successes: number }
  >();
  let totalEvents = 0;
  let totalExposures = 0;

  for (const row of rows) {
    /// 该维度未知的内容一律排除，不归到某个默认桶里 ——
    /// 那会把「加列之前的历史成片」全部算成同一组，结论必然是错的。
    const key = groupKeyFor(row, dimension);
    if (!key) continue;
    const trials = trialsFor(row);
    if (trials === null || trials <= 0) continue;
    const events = successesFor(row, metric);

    const bucket = buckets.get(key) ?? {
      posts: new Map<string, PostSample>(),
      trials: 0,
      successes: 0,
    };
    /// 同一条内容可能有多行（不同平台）：按内容合并成一个样本，一条内容只占一票。
    const post = bucket.posts.get(row.subjectId) ?? { events: 0, exposures: 0 };
    post.events += events;
    post.exposures += trials;
    bucket.posts.set(row.subjectId, post);
    bucket.trials += trials;
    bucket.successes += events;
    buckets.set(key, bucket);
    totalEvents += events;
    totalExposures += trials;
  }

  const priorRate = totalExposures > 0 ? totalEvents / totalExposures : 0;
  return [...buckets.entries()]
    .map(([recipeId, bucket]) => {
      const { rate, lower, upper } = postRateInterval([...bucket.posts.values()], priorRate);
      return {
        recipeId,
        subjectCount: bucket.posts.size,
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
  dimension: RacingDimension = "recipe",
): RacingVerdict {
  const ranked = aggregateByRecipe(rows, metric, dimension);

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
    return { status: "insufficient", metric, dimension, ranked, missing };
  }

  const [winner, runnerUp] = eligible;
  /// 区间重叠 = 这个差距用现有数据解释不了，可能只是噪声。
  if (winner.lower <= runnerUp.upper) {
    return {
      status: "no_difference",
      metric,
      dimension,
      ranked,
      reason: `${winner.recipeId} 与 ${runnerUp.recipeId} 的置信区间重叠，现有数据分不出高下`,
    };
  }

  return {
    status: "winner",
    metric,
    dimension,
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

/**
 * 把五个维度一次判完（PRD §4.3 R3）。
 *
 * 为什么不只判 recipe：结构维度回答「哪种写法在赢」，
 * 其余四维回答「哪种规格在赢」—— 决策 3 要验证植入档位从角标换成自然植入
 * 有没有用，靠的正是 brandPlacement 这一维。
 *
 * 每一维独立判，互不影响：某一维样本够了不代表别的维也够。
 */
export const RACING_DIMENSIONS: RacingDimension[] = [
  "recipe",
  "hookType",
  "templateId",
  "durationSec",
  "aspectRatio",
  "brandPlacement",
];

export function judgeAllDimensions(
  rows: PerformanceRow[],
  metric: RacingMetric = "engagement_rate",
): Record<RacingDimension, RacingVerdict> {
  return Object.fromEntries(
    RACING_DIMENSIONS.map((dimension) => [
      dimension,
      judgeRecipes(rows, metric, dimension),
    ]),
  ) as Record<RacingDimension, RacingVerdict>;
}
