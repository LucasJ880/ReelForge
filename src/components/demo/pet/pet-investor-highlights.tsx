import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import {
  INVESTOR_SECTION,
  type InvestorRoadmapItem,
} from "@/lib/demo/pet-content-kit-demo-data";

const ROADMAP_ICON = {
  shipped: CheckCircle2,
  in_progress: Loader2,
  next: CircleDashed,
} as const;

const ROADMAP_STYLE = {
  shipped: "text-success",
  in_progress: "text-warning",
  next: "text-muted-foreground",
} as const;

export function PetInvestorHighlights() {
  const s = INVESTOR_SECTION;
  return (
    <section id="investor" className="relative overflow-hidden bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          {s.eyebrow}
        </p>
        <h2 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {s.title}
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
          {s.description}
        </p>

        {/* 指标 */}
        <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {s.metrics.map((m) => (
            <div key={m.label} className="border border-border bg-card shadow-editorial rounded-lg p-5">
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="mt-1.5 text-2xl font-semibold text-foreground">
                {m.value}
              </dd>
              {m.hint ? (
                <p className="mt-1 text-meta leading-4 text-muted-foreground/80">
                  {m.hint}
                </p>
              ) : null}
            </div>
          ))}
        </dl>

        {/* 四支柱 */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {s.pillars.map((p) => (
            <div key={p.title} className="border border-border bg-card shadow-editorial rounded-lg p-6">
              <h3 className="text-base font-semibold text-foreground">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        {/* Roadmap */}
        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          {s.roadmap.map((r) => (
            <RoadmapCard key={r.phase} item={r} />
          ))}
        </div>

        {/* CTA */}
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href={s.cta.primary.href}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {s.cta.primary.label} <ArrowRight size={15} />
          </Link>
          <a
            href={s.cta.secondary.href}
            className="inline-flex items-center rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            {s.cta.secondary.label}
          </a>
        </div>
      </div>
    </section>
  );
}

function RoadmapCard({ item }: { item: InvestorRoadmapItem }) {
  const Icon = ROADMAP_ICON[item.status];
  return (
    <div className="border border-border bg-card shadow-editorial rounded-lg p-5">
      <div className="flex items-center gap-2">
        <Icon size={16} className={ROADMAP_STYLE[item.status]} />
        <span className="text-xs font-semibold text-foreground">
          {item.statusLabel}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        {item.phase}
      </h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{item.body}</p>
    </div>
  );
}
