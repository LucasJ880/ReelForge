import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Sparkles,
  Target,
} from "lucide-react";
import {
  INVESTOR_SECTION,
  type InvestorRoadmapItem,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection } from "./demo-section";

/**
 * 投资人 / 政府孵化器专区。
 *
 * 把整个 demo page 在叙事上从「产品演示」拉高到「这是一家可投的小型公司」。
 * 数据全部来自 ai-video-workflow-demo-data.ts 的 INVESTOR_SECTION，
 * 修改时只改数据，不改组件结构。
 */
export function InvestorHighlightsSection() {
  return (
    <DemoSection
      id="investor"
      eyebrow={INVESTOR_SECTION.eyebrow}
      title={INVESTOR_SECTION.title}
      description={INVESTOR_SECTION.description}
      rightSlot={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-meta font-semibold uppercase tracking-[0.2em] text-primary">
          <Target size={12} />
          投资人 / 孵化器视角
        </span>
      }
    >
      {/* Top — 4 关键指标 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INVESTOR_SECTION.metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-(--radius-lg) border border-primary/20 bg-card p-5"
          >
            <p className="text-meta font-semibold uppercase tracking-[0.22em] text-primary/85">
              {metric.label}
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {metric.value}
            </p>
            {metric.hint ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {metric.hint}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {/* Middle — 4 个核心支柱 */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {INVESTOR_SECTION.pillars.map((pillar, idx) => (
          <div
            key={pillar.title}
            className="rounded-(--radius-lg) border border-border bg-card p-6"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-(--radius-lg) bg-primary/10 text-primary">
                <span className="font-mono text-sm font-semibold">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="text-lg font-semibold tracking-tight">
                {pillar.title}
              </h3>
            </div>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {pillar.body}
            </p>
          </div>
        ))}
      </div>

      {/* Roadmap — 4 阶段 */}
      <div className="mt-10 rounded-(--radius-lg) border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              产品节奏 · Roadmap
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight">
              已完成 · 进行中 · 下一步
            </h3>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            每个阶段都对应可验证的里程碑或可点击的页面入口
          </p>
        </div>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INVESTOR_SECTION.roadmap.map((item) => (
            <RoadmapCard key={item.phase} item={item} />
          ))}
        </ol>
      </div>

      {/* Bottom — 创始人 + CTA */}
      <div className="mt-8 grid gap-4 rounded-(--radius-lg) border border-primary/25 bg-primary/5 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            创始人 · Founder
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">
            {INVESTOR_SECTION.teamHighlight.name}
          </h3>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {INVESTOR_SECTION.teamHighlight.title}
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {INVESTOR_SECTION.teamHighlight.body}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href={INVESTOR_SECTION.cta.primary.href}
            className="inline-flex items-center justify-between gap-3 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={14} />
              {INVESTOR_SECTION.cta.primary.label}
            </span>
            <ArrowRight size={14} />
          </a>
          <a
            href={INVESTOR_SECTION.cta.secondary.href}
            className="inline-flex items-center justify-between gap-3 rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 size={14} />
              {INVESTOR_SECTION.cta.secondary.label}
            </span>
            <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </DemoSection>
  );
}

const STATUS_STYLES: Record<
  InvestorRoadmapItem["status"],
  { tone: string; icon: React.ReactNode }
> = {
  shipped: {
    tone: "border-success bg-success/10 text-success",
    icon: <CheckCircle2 size={11} />,
  },
  in_progress: {
    tone: "border-primary/30 bg-primary/10 text-primary",
    icon: <Clock size={11} />,
  },
  next: {
    tone: "border-border bg-muted text-muted-foreground",
    icon: <Target size={11} />,
  },
};

function RoadmapCard({ item }: { item: InvestorRoadmapItem }) {
  const style = STATUS_STYLES[item.status];
  return (
    <li className="flex h-full flex-col gap-3 rounded-(--radius-lg) border border-border bg-muted p-4">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold uppercase tracking-[0.18em] ${style.tone}`}
      >
        {style.icon}
        {item.statusLabel}
      </span>
      <h4 className="text-sm font-semibold leading-snug text-foreground">
        {item.phase}
      </h4>
      <p className="text-xs leading-5 text-muted-foreground">{item.body}</p>
    </li>
  );
}
