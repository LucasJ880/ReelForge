import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { loadPerformanceRows } from "@/lib/services/performance-ingest-service";
import {
  explainVerdict,
  judgeAllDimensions,
  judgeRecipes,
  type RacingDimension,
} from "@/lib/services/recipe-racing-service";
import { resolveDerivationInput } from "@/lib/services/winner-derivation-service";
import { listContentPlans } from "@/lib/services/content-plan-store";
import {
  postFirstPassRate,
  videoFirstPassRate,
} from "@/lib/services/first-pass-rate-service";
import styles from "./wins.module.css";

export const dynamic = "force-dynamic";

/**
 * R5 · 战绩（PRD §4.3 / M5）。
 *
 * 不做大而全的看板。一页只回答三件事：
 *   1. 哪个结构在赢
 *   2. 下一步建议试什么
 *   3. 我帮你排了什么
 *
 * 数据全部来自新赛马（judgeRecipes），与旧 racing-service 无关 ——
 * 旧「投放与赛马」页按 PRD §10.4 做 A 级下线：导航移除，路由保留可直达。
 */

const DIMENSION_LABEL: Record<RacingDimension, string> = {
  recipe: "结构",
  hookType: "钩子",
  templateId: "模板",
  durationSec: "时长",
  aspectRatio: "画幅",
  brandPlacement: "植入",
};

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

  /// 下一步建议：赢家 → 派生变体；判不出 → 差什么补什么；分不出 → 别纠结。
  const nextStep =
    verdict.status === "winner"
      ? `围绕 ${verdict.winner.recipeId} 多做几条变体 —— 换角度和画面，别换结构。`
      : verdict.status === "insufficient"
        ? verdict.missing[0] ?? "先按本周计划把内容发出去"
        : "这几种结构分不出高下，选你产得最快的那种，把频率提上来。";

  const publishedSubjects = new Set(rows.map((row) => row.subjectId)).size;

  return (
    <div className={styles.root} data-testid="wins-page">
      <div className={styles.perf} aria-hidden="true" />

      <header className={styles.head}>
        <div className={styles.slug}>战绩</div>
        <h1 className={styles.h1}>哪种内容在替你赚钱</h1>
        <p className={styles.sub}>
          只看你自己发出去的内容。样本不够时这里会直说「还判不了」——
          一个错的结论比没有结论更贵。
        </p>
      </header>

      <section className={styles.grid} aria-label="三个问题">
        <div className={styles.cell}>
          <p className={styles.label}>01 · 哪个结构在赢</p>
          <h2 className={styles.answer}>
            {verdict.status === "winner"
              ? verdict.winner.recipeId
              : verdict.status === "no_difference"
                ? "暂时分不出"
                : "还判不了"}
          </h2>
          <p className={styles.body}>{explainVerdict(verdict)}</p>

          <table className={styles.dims}>
            <thead>
              <tr>
                <th>维度</th>
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(dimensions) as RacingDimension[]).map((dim) => {
                const value = dimensions[dim];
                return (
                  <tr key={dim}>
                    <td>{DIMENSION_LABEL[dim]}</td>
                    <td className={value.status === "winner" ? styles.dimReady : undefined}>
                      {value.status === "winner"
                        ? `${value.winner.recipeId} 领先`
                        : value.status === "no_difference"
                          ? "无显著差异"
                          : "样本不足"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.cell}>
          <p className={styles.label}>02 · 下一步试什么</p>
          <h2 className={styles.answer}>
            {verdict.status === "winner" ? "复制赢家结构" : "先把样本发够"}
          </h2>
          <p className={styles.body}>{nextStep}</p>
          {derivation.referenceStructures.length > 0 ? (
            <p className={styles.body} style={{ marginTop: 10 }}>
              另外有 <span className={styles.actionNumber}>{derivation.referenceStructures.length}</span>{" "}
              种同行长期在投的结构可以借 —— 借的是骨架，文案画面全部原创。
            </p>
          ) : null}
        </div>

        <div className={styles.cell}>
          <p className={styles.label}>03 · 我帮你排了什么</p>
          <h2 className={styles.answer}>
            {latestPlan ? latestPlan.theme : "还没有本周计划"}
          </h2>
          <p className={styles.body}>
            {latestPlan
              ? `${latestPlan.posts.length} 条内容已排进本周` +
                (latestPlan.planBasis ? ` · ${latestPlan.planBasis}` : "")
              : "去「本周内容」用一句话排出第一周。"}
          </p>
          <p className={styles.body} style={{ marginTop: 10 }}>
            已有 {publishedSubjects} 条内容有表现数据回流。
          </p>
        </div>
      </section>

      <footer className={styles.foot}>
        判定窗口 48 小时 · 表现数据来自你自己授权的账号 · 不做全账号看板
        {" · "}
        {/* C3 一次通过率：样本不足时不显示假百分比 */}
        一次通过率{" "}
        {videoPass.rate !== null
          ? `视频 ${Math.round(videoPass.rate * 100)}%`
          : `视频样本不足（${videoPass.sample}）`}
        {" / "}
        {postPass.rate !== null
          ? `图文 ${Math.round(postPass.rate * 100)}%`
          : `图文样本不足（${postPass.sample}）`}
      </footer>
    </div>
  );
}
