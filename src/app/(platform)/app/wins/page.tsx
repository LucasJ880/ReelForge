import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { loadPerformanceRows } from "@/lib/services/performance-ingest-service";
import {
  MIN_RECIPES,
  MIN_SUBJECTS_PER_RECIPE,
  MIN_TRIALS_PER_RECIPE,
  explainVerdict,
  judgeAllDimensions,
  judgeRecipes,
} from "@/lib/services/recipe-racing-service";
import { resolveDerivationInput } from "@/lib/services/winner-derivation-service";
import { listContentPlans } from "@/lib/services/content-plan-store";
import {
  MIN_SAMPLE,
  postFirstPassRate,
  videoFirstPassRate,
  type FirstPassRate,
} from "@/lib/services/first-pass-rate-service";
import { QuoteHeader, type QuoteStat } from "@/components/exchange/quote-header";
import { SectionHead } from "@/components/exchange/section-head";
import { DimensionLedger, sampleCounts } from "@/components/wins/dimension-ledger";

export const dynamic = "force-dynamic";

/**
 * R5 · 战绩（PRD §4.3 / M5）。
 *
 * 不做大而全的看板。一页只回答三件事，全部落在一面判定台账里：
 *   1. 哪个结构在赢 —— 每个维度一行：达标样本 / 需要、当前领先
 *   2. 下一步建议试什么 —— 每行的「下一步动作」，样本不够就报还差几条
 *   3. 我帮你排了什么 —— 台账末行的本周计划
 *
 * 数据全部来自新赛马（judgeRecipes），与旧 racing-service 无关 ——
 * 旧「投放与赛马」页按 PRD §10.4 做 A 级下线：导航移除，路由保留可直达。
 */

export default async function WinsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/wins");

  const [rows, derivation, plans, videoPass, postPass] = await Promise.all([
    loadPerformanceRows({ userId: session.user.id, windowHours: 48 }),
    resolveDerivationInput({ userId: session.user.id }),
    listContentPlans(session.user.id, 1),
    videoFirstPassRate({ userId: session.user.id }),
    postFirstPassRate({ userId: session.user.id }),
  ]);
  const verdict = judgeRecipes(rows);
  const dimensions = judgeAllDimensions(rows);
  const latestPlan = plans[0] ?? null;
  const publishedSubjects = new Set(rows.map((row) => row.subjectId)).size;
  const recipeCounts = sampleCounts(verdict);

  /// 领先结构：有赢家写赢家；样本不够写「达标几种 / 需要几种」，不写形容词
  const leader: QuoteStat =
    verdict.status === "winner"
      ? {
          label: "领先结构",
          value: verdict.winner.recipeId,
          caption: `领先第二名 +${verdict.marginPoints.toFixed(1)} pt`,
          tone: "winner",
        }
      : verdict.status === "no_difference"
        ? { label: "领先结构", value: "持平", caption: `${recipeCounts.qualified} 种配方区间重叠` }
        : {
            label: "领先结构",
            value: (
              <>
                {recipeCounts.qualified} / {MIN_RECIPES}
                <span className="ml-2 text-meta text-muted-foreground">种配方</span>
              </>
            ),
            caption: `有回流 ${recipeCounts.withData} 种 · ${recipeCounts.subjects} 条`,
          };
  /* C3 一次通过率：样本不足时不显示假百分比，只报样本离门槛还差多少 */
  const passStat = (label: string, pass: FirstPassRate): QuoteStat => ({
    label,
    value: pass.rate !== null ? `${Math.round(pass.rate * 100)}%` : "—",
    caption: pass.rate !== null ? `样本 ${pass.sample}` : `样本 ${pass.sample} / ${MIN_SAMPLE}`,
    tone: pass.rate !== null ? "filled" : "neutral",
  });

  return (
    <div className="x-stack min-w-0" data-testid="wins-page">
      <QuoteHeader
        title="哪种内容在替你赚钱"
        subtitle="只看你自己发出去的内容。样本不够时这里只报数、不下结论——一个错的结论比没有结论更贵。"
        statsLabel="战绩读数"
        stats={[
          leader,
          { label: "有数据回流的内容", value: publishedSubjects },
          passStat("一次通过率 · 视频", videoPass),
          passStat("一次通过率 · 图文", postPass),
        ]}
        scope="判定窗口 48 小时 · 表现数据来自你自己授权的账号 · 不做全账号看板"
      />

      <section aria-label="判定台账" className="space-y-3">
        <SectionHead
          title="判定台账"
          hint={`每种至少 ${MIN_SUBJECTS_PER_RECIPE} 条、累计 ${MIN_TRIALS_PER_RECIPE} 次曝光才算达标 · 达标 ${MIN_RECIPES} 种才比较`}
        />
        <p className="max-w-[62ch] text-body text-muted-foreground">{explainVerdict(verdict)}</p>
        <DimensionLedger
          dimensions={dimensions}
          referenceStructureCount={derivation.referenceStructures.length}
          plan={latestPlan ? { theme: latestPlan.theme, postCount: latestPlan.posts.length, basis: latestPlan.planBasis } : null}
        />
      </section>
    </div>
  );
}
