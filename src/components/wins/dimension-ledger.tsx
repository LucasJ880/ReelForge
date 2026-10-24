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
import { MonoTag } from "@/components/exchange/mono-tag";
import { Button } from "@/components/ui/button";
import type { PlatformCopy } from "@/i18n/platform-copy";

/**
 * 战绩判定台账：一行一个维度，三列只放数字与动作 ——
 * 已有样本（达标几种 / 需要几种）、当前领先、下一步动作。
 * 样本不够时只报差多少，不给方向性结论（判定口径见 recipe-racing-service）。
 * 文案全部来自 platform-copy 的 wins 段（1025 · B2.7，中英双语）。
 */

export type WinsCopy = PlatformCopy["wins"];

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

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

/**
 * 组名给人看：图文结构 `post:POV:single_image` → `POV · 单图`，时长 `15` → `15s`；
 * 其余维度的值本身就是人话（钩子名、画幅、模板 slug）。
 */
export function groupLabel(dimension: RacingDimension, value: string, formats: Record<string, string>): string {
  const post = /^post:([^:]+):([a-z_]+)$/i.exec(value);
  if (post) return `${post[1]} · ${formats[post[2].toUpperCase()] ?? post[2]}`;
  if (dimension === "durationSec" && /^\d+$/.test(value)) return `${value}s`;
  return value;
}

/** 样本还差什么：按 recipe-racing-service 的同一套门槛从结构化数据重算，中英同义（服务层只出中文）。 */
export function missingReason(verdict: RacingVerdict, dimension: RacingDimension, copy: WinsCopy, formats: Record<string, string>): string {
  if (verdict.ranked.length < MIN_RECIPES) {
    return fill(copy.missingKinds, { n: verdict.ranked.length, min: MIN_RECIPES });
  }
  for (const stats of verdict.ranked) {
    const recipe = groupLabel(dimension, stats.recipeId, formats);
    if (stats.subjectCount < MIN_SUBJECTS_PER_RECIPE) {
      return fill(copy.missingPosts, { recipe, n: stats.subjectCount, more: MIN_SUBJECTS_PER_RECIPE - stats.subjectCount });
    }
    if (stats.trials < MIN_TRIALS_PER_RECIPE) {
      return fill(copy.missingReach, { recipe, n: stats.trials });
    }
  }
  return copy.missingDefault;
}

/** 一句话结论（替代服务层只有中文的 explainVerdict）。 */
export function explainVerdictCopy(verdict: RacingVerdict, copy: WinsCopy, formats: Record<string, string>): string {
  switch (verdict.status) {
    case "winner":
      return fill(copy.explainWinner, {
        recipe: groupLabel(verdict.dimension, verdict.winner.recipeId, formats),
        margin: verdict.marginPoints.toFixed(1),
      });
    case "no_difference":
      return copy.explainTie;
    case "insufficient":
      return fill(copy.explainInsufficient, { reason: missingReason(verdict, verdict.dimension, copy, formats) });
  }
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

function nextAction(
  dimension: RacingDimension,
  verdict: RacingVerdict,
  copy: WinsCopy,
  formats: Record<string, string>,
): { main: string; detail: string | null } {
  if (verdict.status === "winner") {
    return dimension === "recipe"
      ? { main: copy.actionVariants, detail: copy.actionVariantsDetail }
      : { main: copy.actionUseNext, detail: null };
  }
  if (verdict.status === "no_difference") {
    return { main: copy.actionFastest, detail: copy.actionFastestDetail };
  }
  const need = postsNeeded(verdict);
  if (need > 0) {
    return {
      main: fill(copy.actionPostMore, { n: need }),
      detail: fill(copy.actionPostMoreDetail, { recipes: MIN_RECIPES, noun: copy.dimensions[dimension][1], subjects: MIN_SUBJECTS_PER_RECIPE }),
    };
  }
  /// 条数够了、卡在曝光：报离门槛最近的那一组还差多少
  const waiting = verdict.ranked
    .filter((stats) => stats.subjectCount >= MIN_SUBJECTS_PER_RECIPE && stats.trials < MIN_TRIALS_PER_RECIPE)
    .sort((a, b) => b.trials - a.trials)[0];
  if (waiting) {
    return {
      main: copy.actionWaitReach,
      detail: fill(copy.actionWaitReachDetail, {
        recipe: groupLabel(dimension, waiting.recipeId, formats),
        trials: waiting.trials,
        min: MIN_TRIALS_PER_RECIPE,
      }),
    };
  }
  const reason = missingReason(verdict, dimension, copy, formats);
  return { main: reason === copy.missingDefault ? copy.actionPublish : reason, detail: null };
}

const CELL = "min-w-0 md:bg-card md:px-4 md:py-3.5";
/// 窄屏：每个维度是一格（名称 + 样本在首行，领先与动作各占一行，带行内标签）；
/// md 起行变成 subgrid，四列逐格拼接缝，格子各自铺 hull 底，接缝由 x-wall 的底色露出。
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3.5 md:col-span-full md:grid-cols-subgrid md:items-stretch md:gap-px md:bg-transparent md:p-0";

export function DimensionLedger({
  dimensions,
  referenceStructureCount,
  plan,
  copy,
  formats,
}: {
  dimensions: Record<RacingDimension, RacingVerdict>;
  referenceStructureCount: number;
  plan: { theme: string; postCount: number; basis: string | null } | null;
  copy: WinsCopy;
  /// 内容形态的人话名（单图 / 轮播…），给结构组名用
  formats: Record<string, string>;
}) {
  return (
    <div
      role="table"
      aria-label={copy.ledger}
      className="x-wall md:grid-cols-[minmax(5.5rem,0.5fr)_minmax(10rem,0.9fr)_minmax(0,1fr)_minmax(0,1.6fr)]"
    >
      <div role="row" className="hidden md:col-span-full md:grid md:grid-cols-subgrid md:gap-px md:bg-transparent">
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">{copy.columns.dimension}</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">{copy.columns.samples}</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">{copy.columns.leader}</span>
        <span role="columnheader" className="x-label bg-sunken px-4 py-2.5">{copy.columns.next}</span>
      </div>

      {RACING_DIMENSIONS.map((dimension) => {
        const verdict = dimensions[dimension];
        const counts = sampleCounts(verdict);
        const ready = counts.qualified >= MIN_RECIPES;
        const action = nextAction(dimension, verdict, copy, formats);
        return (
          <div role="row" key={dimension} className={ROW}>
            <span role="rowheader" className={`${CELL} self-center text-body font-medium md:self-stretch`}>
              {copy.dimensions[dimension][0]}
            </span>

            <span role="cell" className={`${CELL} flex flex-col items-end gap-1 md:items-start`}>
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-body tabular-nums text-foreground">
                  {counts.qualified}
                  <span className="text-tertiary"> / {MIN_RECIPES}</span>
                </span>
                <MonoTag className={ready ? "border-success text-success" : undefined}>{ready ? copy.ready : copy.collecting}</MonoTag>
              </span>
              <span className="text-meta tabular-nums text-tertiary">
                {fill(copy.withData, { kinds: counts.withData, posts: counts.subjects })}
              </span>
            </span>

            <span role="cell" className={`${CELL} col-span-2 flex min-w-0 items-baseline gap-3 md:col-span-1 md:flex-col md:gap-1`}>
              <span className="x-label w-16 shrink-0 md:hidden">{copy.leaderShort}</span>
              {verdict.status === "winner" ? (
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-gold" title={verdict.winner.recipeId}>
                    {groupLabel(dimension, verdict.winner.recipeId, formats)}
                  </span>
                  <span className="text-meta tabular-nums text-muted-foreground">
                    {fill(copy.leaderMargin, { margin: verdict.marginPoints.toFixed(1) })}
                  </span>
                </span>
              ) : verdict.status === "no_difference" ? (
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-foreground">{copy.tie}</span>
                  <span className="text-meta tabular-nums text-muted-foreground">
                    {fill(copy.tieDetail, { n: MIN_RECIPES })}
                  </span>
                </span>
              ) : (
                <span className="text-tertiary">
                  <span aria-hidden>—</span>
                  <span className="sr-only">{copy.rankLater}</span>
                </span>
              )}
            </span>

            <span role="cell" className={`${CELL} col-span-2 flex min-w-0 items-baseline gap-3 md:col-span-1 md:flex-col md:gap-1`}>
              <span className="x-label w-16 shrink-0 md:hidden">{copy.nextShort}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-body text-foreground">{action.main}</span>
                {action.detail ? (
                  <span className="text-meta tabular-nums text-muted-foreground">{action.detail}</span>
                ) : null}
                {dimension === "recipe" && referenceStructureCount > 0 ? (
                  <span className="text-meta text-muted-foreground">
                    {copy.reference.split("{n}")[0]}
                    <span className="font-mono tabular-nums text-gold">{referenceStructureCount}</span>
                    {copy.reference.split("{n}")[1] ?? ""}
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        );
      })}

      <div role="row" className={ROW}>
        <span role="rowheader" className={`${CELL} self-center text-body font-medium md:self-stretch`}>{copy.planRow}</span>
        <div role="cell" className={`${CELL} col-span-2 flex flex-wrap items-center justify-between gap-3 md:col-span-3`}>
          <div className="min-w-0 space-y-1">
            <p className="text-body font-medium">{plan ? plan.theme : copy.planEmpty}</p>
            <p className="text-meta text-muted-foreground">
              {plan ? (
                <>
                  {copy.planPosts.split("{n}")[0]}
                  <span className="font-mono tabular-nums text-foreground">{plan.postCount}</span>
                  {copy.planPosts.split("{n}")[1] ?? ""}
                  {plan.basis ? ` · ${plan.basis}` : ""}
                </>
              ) : (
                copy.planEmptyHint
              )}
            </p>
          </div>
          <Button render={<Link href="/app/plan" />} variant="outline" size="sm" className="shrink-0">
            {plan ? copy.planOpen : copy.planStart}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
