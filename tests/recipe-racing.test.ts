import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateByRecipe,
  explainVerdict,
  judgeRecipes,
  MIN_SUBJECTS_PER_RECIPE,
  MIN_TRIALS_PER_RECIPE,
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
