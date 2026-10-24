import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  MIN_RECIPES,
  MIN_SUBJECTS_PER_RECIPE,
  MIN_TRIALS_PER_RECIPE,
  RACING_DIMENSIONS,
  type RacingDimension,
  type RacingVerdict,
} from "@/lib/services/recipe-racing-service";
import { StatusTick } from "@/components/exchange/status-tick";
import { Button } from "@/components/ui/button";

/**
 * 战绩判定台账：一行一个维度，三列只放数字与动作 ——
 * 已有样本（达标几种 / 需要几种）、当前领先、下一步动作。
 * 样本不够时只报差多少，不给方向性结论（判定口径见 recipe-racing-service）。
 */

const DIMENSION: Record<RacingDimension, { label: string; noun: string }> = {
  recipe: { label: "结构", noun: "结构" },
  hookType: { label: "钩子", noun: "钩子" },
  templateId: { label: "模板", noun: "模板" },
  durationSec: { label: "时长", noun: "时长档" },
  aspectRatio: { label: "画幅", noun: "画幅" },
  brandPlacement: { label: "植入", noun: "植入档位" },
};

export type SampleCounts = {
  /// 达到判定门槛（条数 + 曝光）的组数 —— 够 MIN_RECIPES 组才可能下结论
  qualified: number;
  /// 有表现数据回流的组数
  withData: number;
  /// 这些组里一共有几条已发布内容
  subjects: number;
};

export function sampleCounts(verdict: RacingVerdict): SampleCounts {
  return {
    qualified: verdict.ranked.filter(
      (stats) => stats.subjectCount >= MIN_SUBJECTS_PER_RECIPE && stats.trials >= MIN_TRIALS_PER_RECIPE,
    ).length,
    withData: verdict.ranked.length,
    subjects: verdict.ranked.reduce((sum, stats) => sum + stats.subjectCount, 0),
  };
}

/** 至少还要再发几条：把条数最多的 MIN_RECIPES 组各补到门槛（曝光门槛另算，不折成条数）。 */
function postsNeeded(verdict: RacingVerdict): number {
  const counts = verdict.ranked.map((stats) => stats.subjectCount).sort((a, b) => b - a);
  let need = 0;
  for (let index = 0; index < MIN_RECIPES; index += 1) {
    need += Math.max(0, MIN_SUBJECTS_PER_RECIPE - (counts[index] ?? 0));
  }
  return need;
}

function nextAction(dimension: RacingDimension, verdict: RacingVerdict): { main: string; detail: string | null } {
  if (verdict.status === "winner") {
    return dimension === "recipe"
      ? { main: "围绕它多做变体", detail: "换角度和画面，别换结构" }
      : { main: "下一批优先用它", detail: null };
  }
  if (verdict.status === "no_difference") {
    return { main: "选你产得最快的那种", detail: "把发布频率提上来" };
  }
  const need = postsNeeded(verdict);
  if (need > 0) {
    return {
      main: `再发 ${need} 条`,
      detail: `${MIN_RECIPES} 种${DIMENSION[dimension].noun}各 ${MIN_SUBJECTS_PER_RECIPE} 条`,
    };
  }
  /// 条数够了、卡在曝光：报离门槛最近的那一组还差多少
  const waiting = verdict.ranked
    .filter((stats) => stats.subjectCount >= MIN_SUBJECTS_PER_RECIPE && stats.trials < MIN_TRIALS_PER_RECIPE)
    .sort((a, b) => b.trials - a.trials)[0];
  return waiting
    ? { main: "等曝光", detail: `${waiting.recipeId} ${waiting.trials} / ${MIN_TRIALS_PER_RECIPE} 次` }
    : { main: verdict.missing[0] ?? "先按本周计划把内容发出去", detail: null };
}

const CELL = "min-w-0 md:bg-card md:px-4 md:py-3.5";
/// 窄屏：每个维度是一格（名称 + 样本在首行，领先与动作各占一行，带行内标签）；
/// md 起行变成 subgrid，四列逐格拼接缝，格子各自铺 hull 底，接缝由 x-wall 的底色露出。
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 md:col-span-full md:grid-cols-subgrid md:items-stretch md:gap-px md:bg-transparent md:p-0";

export function DimensionLedger({
  dimensions,
  referenceStructureCount,
  plan,
}: {
  dimensions: Record<RacingDimension, RacingVerdict>;
  referenceStructureCount: number;
  plan: { theme: string; postCount: number; basis: string | null } | null;
}) {
  return (
    <div
      role="table"
      aria-label="判定台账"
      className="x-wall md:grid-cols-[minmax(5.5rem,0.5fr)_minmax(10rem,0.9fr)_minmax(0,1fr)_minmax(0,1.6fr)]"
    >
      <div role="row" className="hidden md:col-span-full md:grid md:grid-cols-subgrid md:gap-px md:bg-transparent">
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">维度</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">已有样本 · 达标 / 需要</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">当前领先</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">下一步动作</span>
      </div>

      {RACING_DIMENSIONS.map((dimension) => {
        const verdict = dimensions[dimension];
        const counts = sampleCounts(verdict);
        const ready = counts.qualified >= MIN_RECIPES;
        const action = nextAction(dimension, verdict);
        return (
          <div role="row" key={dimension} className={ROW}>
            <span role="rowheader" className={`${CELL} self-center text-body font-medium md:self-stretch`}>
              {DIMENSION[dimension].label}
            </span>

            <span role="cell" className={`${CELL} flex flex-col items-end gap-1 md:items-start`}>
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-body tabular-nums text-foreground">
                  {counts.qualified}
                  <span className="text-tertiary"> / {MIN_RECIPES}</span>
                </span>
                <StatusTick tone={ready ? "filled" : "idle"} label={ready ? "可判定" : "攒样本"} />
              </span>
              <span className="text-meta tabular-nums text-tertiary">
                有回流 {counts.withData} 种 · {counts.subjects} 条
              </span>
            </span>

            <span role="cell" className={`${CELL} col-span-2 flex min-w-0 items-baseline gap-3 md:col-span-1 md:flex-col md:gap-1`}>
              <span className="x-label w-16 shrink-0 md:hidden">当前领先</span>
              {verdict.status === "winner" ? (
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-gold" title={verdict.winner.recipeId}>{verdict.winner.recipeId}</span>
                  <span className="text-meta tabular-nums text-muted-foreground">
                    领先第二名 +{verdict.marginPoints.toFixed(1)} pt
                  </span>
                </span>
              ) : verdict.status === "no_difference" ? (
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-foreground">持平</span>
                  <span className="text-meta tabular-nums text-muted-foreground">
                    前 {MIN_RECIPES} 种区间重叠
                  </span>
                </span>
              ) : (
                <span className="text-tertiary">
                  <span aria-hidden>—</span>
                  <span className="sr-only">样本够了才排名</span>
                </span>
              )}
            </span>

            <span role="cell" className={`${CELL} col-span-2 flex min-w-0 items-baseline gap-3 md:col-span-1 md:flex-col md:gap-1`}>
              <span className="x-label w-16 shrink-0 md:hidden">下一步</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-body text-foreground">{action.main}</span>
                {action.detail ? (
                  <span className="text-meta tabular-nums text-muted-foreground">{action.detail}</span>
                ) : null}
                {dimension === "recipe" && referenceStructureCount > 0 ? (
                  <span className="text-meta text-muted-foreground">
                    另有 <span className="font-mono tabular-nums text-gold">{referenceStructureCount}</span> 种同行长期在投的结构可借 —— 借骨架，文案画面全部原创
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        );
      })}

      <div role="row" className={ROW}>
        <span role="rowheader" className={`${CELL} self-center text-body font-medium md:self-stretch`}>本周计划</span>
        <div role="cell" className={`${CELL} col-span-2 flex flex-wrap items-center justify-between gap-3 md:col-span-3`}>
          <div className="min-w-0 space-y-1">
            <p className="text-body font-medium">{plan ? plan.theme : "还没有本周计划"}</p>
            <p className="text-meta text-muted-foreground">
              {plan ? (
                <>
                  <span className="font-mono tabular-nums text-foreground">{plan.postCount}</span> 条内容已排进本周
                  {plan.basis ? ` · ${plan.basis}` : ""}
                </>
              ) : (
                "去「本周内容」用一句话排出第一周。"
              )}
            </p>
          </div>
          <Button render={<Link href="/app/plan" />} variant="outline" size="sm" className="shrink-0">
            {plan ? "打开本周内容" : "去排第一周"}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
