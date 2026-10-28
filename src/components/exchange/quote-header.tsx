import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuoteTone = "neutral" | "live" | "filled" | "winner" | "fault" | "ai";

export type QuoteStat = {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: QuoteTone;
  /** 这一格指向哪里（成品库的生产线读数）：整格可点，用拉伸链接实现，dl 结构不变。 */
  href?: string;
};

const TONE: Record<QuoteTone, string> = {
  neutral: "text-foreground",
  live: "text-accent",
  filled: "text-success",
  winner: "text-gold",
  fault: "text-danger",
  ai: "text-iris",
};


export type QuoteHeaderProps = {
  /** 标题：工作区页面一律是导航名（用 WorkspacePage 传 nav）；详情页是这一条的名字。 */
  title: React.ReactNode;
  /** 副标题：口号 + 一句说明，限宽 62ch。 */
  subtitle?: React.ReactNode;
  /** 标题下的状态 / 元信息行（详情页：状态记号、时长、编号）。 */
  meta?: React.ReactNode;
  /**
   * 主行动：一页一枚实心主钮。没有主行动也要显式写 `null`——
   * 「右侧主行动」之前只在 2/11 页成立，就是因为这个位置可以随手不写。
   */
  primaryAction: React.ReactNode | null;
  /** 次要行动（描边 / 幽灵钮），排在主行动左侧。 */
  secondaryActions?: React.ReactNode;
  /** 模式切换（视频 / 产品图）：和行动分开放，不占主行动的位置。 */
  modeSwitch?: React.ReactNode;
  /** 读数墙：真实数字，零就写零；取不到写「—」，不放示例数字。 */
  readings: QuoteStat[];
  readingsLabel: string;
  /** 统计口径：一行写清楚这些数数的是什么。必填。 */
  scope: React.ReactNode;
  className?: string;
};

/**
 * 页面头：每个工作区页面的开场。2026-10-28 学 LibTV：一个页面标题 + 一句说明 + 右侧行动；
 * 读数不再是一面大格子墙，而是一排紧凑的小数据卡（真实数字，零就写零）+ 一行小字统计口径。
 * 主行动 / 次要行动 / 模式切换各有插槽；不加眉题，标题自己承重。
 */
export function QuoteHeader({
  title,
  subtitle,
  meta,
  primaryAction,
  secondaryActions,
  modeSwitch,
  readings,
  readingsLabel,
  scope,
  className,
}: QuoteHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  return (
    <header className={cn("space-y-6", className)} data-quote-header>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-4xl space-y-3">
          <h1 className="studio-title">{title}</h1>
          {meta ? <div className="text-meta text-muted-foreground">{meta}</div> : null}
          {subtitle ? <p className="studio-subtitle text-pretty">{subtitle}</p> : null}
        </div>
        {modeSwitch || hasActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {modeSwitch ? <div data-slot="mode-switch">{modeSwitch}</div> : null}
            {hasActions ? (
              <div data-slot="actions" className="flex flex-wrap items-center gap-2">
                {secondaryActions}
                {primaryAction}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {readings.length > 0 ? (
          <dl aria-label={readingsLabel} className="flex flex-wrap gap-2">
            {readings.map((stat) => (
              <div
                key={stat.label}
                title={typeof stat.caption === "string" ? stat.caption : undefined}
                className={cn(
                  "studio-stat relative flex min-w-36 max-w-full flex-col gap-1",
                  stat.href && "group transition-colors duration-fast ease-out hover:bg-raised focus-within:bg-raised motion-reduce:transition-none",
                )}
              >
                {/* 名字与口径在窄屏折行，不截断：390px 两列一格只有 ~170px，截断后「近 7 天」与口径都读不到（B2.1 读数与口径必填）。只有大数字保留单行。 */}
                <dt className="flex items-start justify-between gap-3 text-meta text-tertiary">
                  {stat.href ? (
                    <Link
                      href={stat.href}
                      className="min-w-0 break-words text-pretty after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                    >
                      {stat.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 break-words text-pretty">{stat.label}</span>
                  )}
                  {stat.href ? (
                    <ArrowRight className="mt-px size-3.5 shrink-0 text-tertiary transition-colors group-hover:text-accent" aria-hidden />
                  ) : null}
                </dt>
                <dd className={cn("truncate text-subhead font-semibold tabular-nums", TONE[stat.tone ?? "neutral"])}>{stat.value}</dd>
                {/* 口径说明不再撑大卡片：悬停可见（title），读屏照常读到 */}
                {stat.caption ? <dd className="sr-only">{stat.caption}</dd> : null}
              </div>
            ))}
          </dl>
        ) : null}
        <p className="text-meta text-tertiary text-pretty" data-slot="scope">{scope}</p>
      </div>
    </header>
  );
}
