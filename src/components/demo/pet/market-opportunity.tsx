import { TrendingUp } from "lucide-react";
import { PetSection } from "./pet-section";
import { MARKET_SECTION } from "@/lib/demo/pet-content-kit-demo-data";

const WEDGE_STYLE = {
  TAM: "border-[var(--pet-teal)]/30 bg-[var(--pet-teal)]/8",
  SAM: "border-[var(--pet-orange)]/30 bg-[var(--pet-orange)]/8",
  SOM: "border-amber-500/30 bg-amber-500/10",
} as const;

export function MarketOpportunity() {
  const s = MARKET_SECTION;
  return (
    <PetSection
      id="market"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pet-teal)]/30 bg-[var(--pet-teal)]/10 px-3 py-1.5 text-xs font-semibold text-[color:var(--pet-teal)]">
          <TrendingUp size={14} /> 价值深耕拐点
        </span>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {s.stats.map((stat) => (
          <div key={stat.label} className="pet-surface rounded-3xl p-5">
            <dt className="text-2xl font-semibold text-foreground sm:text-3xl">
              {stat.value}
            </dt>
            <dd className="mt-2 text-xs font-medium text-foreground/80">
              {stat.label}
            </dd>
            {stat.hint ? (
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {stat.hint}
              </p>
            ) : null}
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="pet-surface rounded-3xl p-6">
          <h3 className="text-sm font-semibold text-foreground">关键趋势</h3>
          <ul className="mt-3 space-y-3">
            {s.trends.map((t) => (
              <li
                key={t}
                className="flex items-start gap-2 text-sm leading-7 text-muted-foreground"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pet-orange)]" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          {s.wedges.map((w) => (
            <div
              key={w.tier}
              className={`rounded-3xl border p-5 ${WEDGE_STYLE[w.tier]}`}
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-bold tracking-wide text-foreground">
                  {w.tier}
                </span>
                <h3 className="text-sm font-semibold text-foreground">
                  {w.title}
                </h3>
              </div>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {w.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted-foreground/80">
        {s.sourceNote}
      </p>
    </PetSection>
  );
}
