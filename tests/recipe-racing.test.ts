import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateByRecipe,
  explainVerdict,
  judgeRecipes,
  MIN_SUBJECTS_PER_RECIPE,
  MIN_TRIALS_PER_RECIPE,
  postRateInterval,
  studentT975,
  wilsonInterval,
  type PerformanceRow,
} from "../src/lib/services/recipe-racing-service";

function row(
  recipeId: string | null,
  subjectId: string,
  impressions: number | null,
  likes: number,
  extra: Partial<PerformanceRow> = {},
): PerformanceRow {
  return {
    recipeId,
    subjectId,
    impressions,
    views: null,
    likes,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    conversions: null,
    ...extra,
  };
}

/** 造 n 条同配方内容，每条 impressions 曝光、rate 互动率。 */
function recipeRows(
  recipeId: string,
  n: number,
  impressions: number,
  rate: number,
): PerformanceRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(recipeId, `${recipeId}-${i}`, impressions, Math.round(impressions * rate)),
  );
}

test("Wilson 区间不会给出负下界或超过 1 的上界", () => {
  for (const [s, n] of [
    [0, 10],
    [1, 3],
    [10, 10],
    [1, 1],
    [0, 1],
  ] as const) {
    const { lower, upper } = wilsonInterval(s, n);
    assert.ok(lower >= 0, `下界 ${lower} 不能为负`);
    assert.ok(upper <= 1, `上界 ${upper} 不能超过 1`);
    assert.ok(lower <= upper);
  }
  /// 分母为 0 时给最宽区间，而不是 NaN。
  assert.deepEqual(wilsonInterval(0, 0), { lower: 0, upper: 1 });
});

test("样本越小区间越宽 —— 这正是要让人看见的东西", () => {
  const small = wilsonInterval(5, 10);
  const large = wilsonInterval(500, 1000);
  assert.ok(
    small.upper - small.lower > large.upper - large.lower,
    "小样本的区间必须更宽",
  );
});

test("🔴 一条偶然爆了的帖子不能被判成赢家", () => {
  const rows = [
    /// 一条爆款：曝光巨大、互动率极高，但只有这一条。
    row("post:Reveal:carousel", "viral", 100_000, 20_000),
    ...recipeRows("post:Pain:text", 5, 2_000, 0.05),
  ];
  const verdict = judgeRecipes(rows);
  assert.equal(
    verdict.status,
    "insufficient",
    "单条内容代表不了一个配方，不管它多爆",
  );
  assert.ok(
    verdict.status === "insufficient" &&
      verdict.missing.some((m) => m.includes("post:Reveal:carousel")),
    "要说清楚是哪个配方样本不够",
  );
});

test("样本够但区间重叠 → no_difference，这是有用的结论不是失败", () => {
  const rows = [
    ...recipeRows("post:Pain:text", 4, 1_000, 0.051),
    ...recipeRows("post:Demo:text", 4, 1_000, 0.049),
  ];
  const verdict = judgeRecipes(rows);
  assert.equal(verdict.status, "no_difference");
  assert.match(explainVerdict(verdict), /看不出差别/);
});

test("差距够大且样本够 → 判赢家，并给出领先幅度", () => {
  const rows = [
    ...recipeRows("post:POV:single_image", 5, 5_000, 0.12),
    ...recipeRows("post:Demo:text", 5, 5_000, 0.03),
  ];
  const verdict = judgeRecipes(rows);
  assert.equal(verdict.status, "winner");
  if (verdict.status !== "winner") return;
  assert.equal(verdict.winner.recipeId, "post:POV:single_image");
  assert.ok(verdict.marginPoints > 8, "领先幅度应约 9 个百分点");
  assert.ok(
    verdict.winner.lower > verdict.runnerUp.upper,
    "只有区间不重叠才允许判赢",
  );
});

test("配方未知的内容一律排除，不归到默认桶", () => {
  const stats = aggregateByRecipe(
    [
      row(null, "legacy-1", 10_000, 5_000),
      row(null, "legacy-2", 10_000, 5_000),
      ...recipeRows("post:Pain:text", 3, 1_000, 0.05),
    ],
    "engagement_rate",
  );
  assert.equal(stats.length, 1, "历史成片不能自成一个配方参与比较");
  assert.equal(stats[0].recipeId, "post:Pain:text");
});

test("没有分母的行直接跳过，不用 0 或 1 兜底造出假比率", () => {
  const stats = aggregateByRecipe(
    [
      row("post:Pain:text", "a", null, 50),
      row("post:Pain:text", "b", 0, 50),
      row("post:Pain:text", "c", 1_000, 50),
    ],
    "engagement_rate",
  );
  assert.equal(stats[0].trials, 1_000, "只有第三行可用");
  assert.equal(stats[0].subjectCount, 1);
  assert.equal(stats[0].rate, 0.05);
});

test("impressions 缺失时退到 views，两者都缺才跳过", () => {
  const stats = aggregateByRecipe(
    [
      { ...row("r", "a", null, 100), views: 2_000 },
      row("r", "b", 1_000, 50),
    ],
    "engagement_rate",
  );
  assert.equal(stats[0].trials, 3_000);
  assert.equal(stats[0].successes, 150);
});

test("互动分子是点赞+评论+转发+收藏之和", () => {
  const stats = aggregateByRecipe(
    [
      {
        ...row("r", "a", "" as never, 0),
        impressions: 1_000,
        likes: 10,
        comments: 5,
        shares: 3,
        saves: 2,
      },
    ],
    "engagement_rate",
  );
  assert.equal(stats[0].successes, 20);
});

test("转化率口径只看 conversions，不掺互动", () => {
  const stats = aggregateByRecipe(
    [
      {
        ...row("r", "a", 1_000, 500),
        conversions: 7,
      },
    ],
    "conversion_rate",
  );
  assert.equal(stats[0].successes, 7, "互动数不能算进转化");
});

test("只有一种配方时说不出胜负，并说明原因", () => {
  const verdict = judgeRecipes(recipeRows("post:Pain:text", 5, 5_000, 0.05));
  assert.equal(verdict.status, "insufficient");
  if (verdict.status !== "insufficient") return;
  assert.ok(verdict.missing.some((m) => m.includes("至少要")));
});

test("insufficient 的说明要可执行：告诉商家还差几条", () => {
  const verdict = judgeRecipes([
    ...recipeRows("a", 1, 5_000, 0.05),
    ...recipeRows("b", 5, 5_000, 0.02),
  ]);
  assert.equal(verdict.status, "insufficient");
  if (verdict.status !== "insufficient") return;
  assert.ok(
    verdict.missing.some((m) => /再发 \d+ 条/.test(m)),
    `应给出还差几条：${JSON.stringify(verdict.missing)}`,
  );
});

test("曝光量不足时不判，即使条数够了", () => {
  const verdict = judgeRecipes([
    ...recipeRows("a", 4, 10, 0.5),
    ...recipeRows("b", 4, 10, 0.1),
  ]);
  assert.equal(
    verdict.status,
    "insufficient",
    `每条只有 10 次曝光，比率毫无意义（门槛 ${MIN_TRIALS_PER_RECIPE}）`,
  );
});

test("给商家的结论不用统计术语，但不把不确定说成确定", () => {
  const insufficient = judgeRecipes(recipeRows("a", 1, 100, 0.1));
  const text = explainVerdict(insufficient);
  assert.match(text, /还判不出/);
  for (const jargon of ["置信区间", "显著性", "p 值", "Wilson"]) {
    assert.ok(!text.includes(jargon), `不该出现术语：${jargon}`);
  }
});

test("门槛常量是刻意选的，改动要有理由", () => {
  assert.equal(MIN_SUBJECTS_PER_RECIPE, 3, "两条里爆一条就是 50% 被单点主导");
  assert.ok(MIN_TRIALS_PER_RECIPE >= 300);
});

/* ── 2026-10-25 审计 B5：互动数是事件计数，不是「曝光里的成功次数」 ─────────── */

/** 造 n 条同配方内容，每条 impressions 曝光、events 个互动（可以多于曝光）。 */
function eventRows(recipeId: string, n: number, impressions: number, events: number): PerformanceRow[] {
  return Array.from({ length: n }, (_, i) => row(recipeId, `${recipeId}-${i}`, impressions, events));
}

function assertFiniteInterval(stats: { rate: number; lower: number; upper: number }) {
  assert.ok(Number.isFinite(stats.rate), `比率必须是有限数：${stats.rate}`);
  assert.ok(Number.isFinite(stats.lower) && Number.isFinite(stats.upper), `区间必须是有限数：${stats.lower}–${stats.upper}`);
  assert.ok(stats.lower >= 0, "下限不为负");
  assert.ok(stats.lower <= stats.rate && stats.rate <= stats.upper, "比率落在区间里");
}

test("🔴 互动数可以超过曝光数：Wilson 在这里会出 NaN，判定口径照常给出有限的比率与区间", () => {
  /// 一个人可以既点赞又收藏：互动数 > 曝光数是真实数据，不是脏数据
  assert.ok(Number.isNaN(wilsonInterval(150, 100).lower), "成功数 > 试验数不是二项比例，Wilson 不适用");
  const stats = aggregateByRecipe(
    [
      { ...row("r", "a", 100, 80), saves: 70 },
      { ...row("r", "b", 100, 90), saves: 60 },
      { ...row("r", "c", 100, 85), saves: 65 },
    ],
    "engagement_rate",
  );
  assert.equal(stats[0].successes, 450);
  assert.equal(stats[0].trials, 300);
  assert.ok(stats[0].rate > 1, `每次曝光 1.5 个互动，比率应大于 1：${stats[0].rate}`);
  assertFiniteInterval(stats[0]);
});

test("🔴 旧口径的 NaN 区间绕过了「区间重叠不判赢家」：两组几乎一样的高互动内容不能判出赢家", () => {
  const verdict = judgeRecipes([
    ...eventRows("post:Pain:text", 3, 200, 300),
    ...eventRows("post:Demo:text", 3, 200, 290),
  ]);
  assert.equal(verdict.status, "no_difference", "每次曝光 1.5 vs 1.45 个互动，三条样本分不出高下");
  for (const stats of verdict.ranked) assertFiniteInterval(stats);
});

test("🔴 一条爆款撑起的配方：按帖子算、一条只占一票，不能靠一条爆款判赢", () => {
  /// 按曝光合并的话这一组是 2060 / 12000 ≈ 17%，对面 5%——旧口径会直接判它赢。
  /// 实际上它的另外两条只有 3%，比对面还低。
  const verdict = judgeRecipes([
    row("post:Reveal:carousel", "viral", 10_000, 2_000),
    row("post:Reveal:carousel", "flat-1", 1_000, 30),
    row("post:Reveal:carousel", "flat-2", 1_000, 30),
    ...recipeRows("post:Pain:text", 3, 1_000, 0.05),
  ]);
  assert.notEqual(verdict.status, "winner");
  assert.equal(verdict.ranked.find((stats) => stats.recipeId === "post:Reveal:carousel")?.subjectCount, 3);
});

test("区间随条数收窄、随帖子之间的差异放宽，但帖子再像也不会压成一个点", () => {
  const spread = [
    { events: 20, exposures: 1_000 },
    { events: 50, exposures: 1_000 },
    { events: 80, exposures: 1_000 },
  ];
  const width = (posts: Array<{ events: number; exposures: number }>) => {
    const interval = postRateInterval(posts, 0.05);
    return interval.upper - interval.lower;
  };
  assert.ok(width([...spread, ...spread, ...spread]) < width(spread), "同样的差异，九条比三条窄");
  const alike = Array.from({ length: 3 }, () => ({ events: 50, exposures: 1_000 }));
  assert.ok(width(alike) < width(spread), "帖子之间差得越多，区间越宽");
  assert.ok(width(alike) > 0, "三条恰好相同的帖子仍有抽样噪声，区间不是一个点");
  assert.deepEqual(postRateInterval([], 0.05), { rate: 0, lower: 0, upper: 0 });
});

test("平滑：曝光只有几十的帖子被拉向整体水平", () => {
  const stats = aggregateByRecipe(
    [row("tiny", "tiny-1", 20, 10), ...recipeRows("steady", 3, 5_000, 0.05)],
    "engagement_rate",
  );
  const tiny = stats.find((item) => item.recipeId === "tiny");
  assert.ok(tiny);
  assert.ok(tiny.rate < 0.2, `20 次曝光 10 个赞不该被当成 50%：${tiny.rate}`);
  assert.ok(tiny.rate > 0.05, "也不是直接抹成整体水平");
});

test("同一条内容的多平台行合并成一个样本（一条内容只占一票）", () => {
  const stats = aggregateByRecipe(
    [row("r", "a", 1_000, 50), row("r", "a", 500, 25), row("r", "b", 1_000, 50)],
    "engagement_rate",
  );
  assert.equal(stats[0].subjectCount, 2);
  assert.equal(stats[0].trials, 2_500);
  assert.equal(stats[0].successes, 125);
});

test("t 分位数：自由度越小越宽，永远不窄于正态的 1.96", () => {
  assert.equal(studentT975(1), 12.706);
  assert.equal(studentT975(2), 4.303);
  assert.equal(studentT975(30), 2.042);
  assert.equal(studentT975(0), Number.POSITIVE_INFINITY);
  let previous = Number.POSITIVE_INFINITY;
  for (let df = 1; df <= 200; df += 1) {
    const quantile = studentT975(df);
    assert.ok(quantile <= previous, `df=${df} 不应比 df=${df - 1} 更宽`);
    assert.ok(quantile > 1.96, `df=${df} 的分位数不能比正态还窄`);
    previous = quantile;
  }
});
