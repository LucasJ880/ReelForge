import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { loadPerformanceRows } from "@/lib/services/performance-ingest-service";
import {
  MIN_RECIPES,
  MIN_SUBJECTS_PER_RECIPE,
  MIN_TRIALS_PER_RECIPE,
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
import type { QuoteStat } from "@/components/exchange/quote-header";
import { SectionHead } from "@/components/exchange/section-head";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { Button } from "@/components/ui/button";
import {
  DimensionLedger,
  explainVerdictCopy,
  groupLabel,
  sampleCounts,
} from "@/components/wins/dimension-ledger";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

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
 * 1025 · B2.7：标题 = 导航名「战绩」，文案全部来自 platform-copy（中英双语）。
 *
 * 2026-10-25 审计 B5：表现数据回流（青砚同步）还没开，本页入口已撤出导航（路由保留可直达）。
 * 一条表现数据都没有时不摆判定台账——六行「再发几条」会让人以为多发就能出结论——
 * 只如实写「还没有表现数据回流」，读数格照常写零。
 */

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

export default async function WinsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/wins");

  const [rows, derivation, plans, videoPass, postPass, locale] = await Promise.all([
    loadPerformanceRows({ userId: session.user.id, windowHours: 48 }),
    resolveDerivationInput({ userId: session.user.id }),
    listContentPlans(session.user.id, 1),
    videoFirstPassRate({ userId: session.user.id }),
    postFirstPassRate({ userId: session.user.id }),
    getServerLocale(),
  ]);
  const platformCopy = getPlatformCopy(locale);
  const copy = platformCopy.wins;
  const formats: Record<string, string> = platformCopy.plan.formats;
  const verdict = judgeRecipes(rows);
  const dimensions = judgeAllDimensions(rows);
  const latestPlan = plans[0] ?? null;
  const hasPerformanceData = rows.length > 0;
  const publishedSubjects = new Set(rows.map((row) => row.subjectId)).size;
  const recipeCounts = sampleCounts(verdict);

  /// 领先结构：有赢家写赢家；样本不够写「达标几种 / 需要几种」，不写形容词
  const leader: QuoteStat =
    verdict.status === "winner"
      ? {
          label: copy.leader,
          value: groupLabel("recipe", verdict.winner.recipeId, formats),
          caption: fill(copy.leaderMargin, { margin: verdict.marginPoints.toFixed(1) }),
          tone: "winner",
        }
      : verdict.status === "no_difference"
        ? { label: copy.leader, value: copy.tie, caption: fill(copy.tieCaption, { n: recipeCounts.qualified }) }
        : {
            label: copy.leader,
            value: (
              <>
                {recipeCounts.qualified} / {MIN_RECIPES}
                <span className="ml-2 text-meta text-muted-foreground">{copy.recipesUnit}</span>
              </>
            ),
            caption: fill(copy.withData, { kinds: recipeCounts.withData, posts: recipeCounts.subjects }),
          };
  /* C3 一次通过率：样本不足时不显示假百分比，只报样本离门槛还差多少 */
  const passStat = (label: string, pass: FirstPassRate): QuoteStat => ({
    label,
    value: pass.rate !== null ? `${Math.round(pass.rate * 100)}%` : "—",
    caption: pass.rate !== null ? fill(copy.sample, { n: pass.sample }) : fill(copy.sampleNeed, { n: pass.sample, min: MIN_SAMPLE }),
    tone: pass.rate !== null ? "filled" : "neutral",
  });

  return (
    <WorkspacePage
      nav="wins"
      locale={locale}
      testId="wins-page"
      subtitle={copy.subtitle}
      primaryAction={null}
      readingsLabel={copy.readingsLabel}
      readings={[
        leader,
        { label: copy.published, value: publishedSubjects },
        passStat(copy.passVideo, videoPass),
        passStat(copy.passPost, postPass),
      ]}
      scope={copy.scope}
    >
      <section aria-label={copy.ledger} className="space-y-3">
        <SectionHead
          title={copy.ledger}
          hint={fill(copy.ledgerHint, { subjects: MIN_SUBJECTS_PER_RECIPE, trials: MIN_TRIALS_PER_RECIPE, recipes: MIN_RECIPES })}
        />
        {hasPerformanceData ? (
          <>
            <p className="max-w-[62ch] text-body text-muted-foreground">{explainVerdictCopy(verdict, copy, formats)}</p>
            <DimensionLedger
              dimensions={dimensions}
              referenceStructureCount={derivation.referenceStructures.length}
              plan={latestPlan ? { theme: latestPlan.theme, postCount: latestPlan.posts.length, basis: latestPlan.planBasis } : null}
              copy={copy}
              formats={formats}
            />
          </>
        ) : (
          <div className="x-well space-y-3 rounded-(--radius-md) px-4 py-4" data-testid="wins-empty">
            <p className="text-body font-medium">{copy.emptyTitle}</p>
            <p className="max-w-[62ch] text-body text-muted-foreground">{copy.emptyBody}</p>
            <Button render={<Link href="/app/plan" />} variant="outline" size="sm">
              {latestPlan ? copy.planOpen : copy.planStart}
            </Button>
          </div>
        )}
      </section>
    </WorkspacePage>
  );
}
