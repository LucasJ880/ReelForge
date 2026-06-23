import { ArrowRight, Sparkles, TrendingUp } from "lucide-react";
import { PetSection } from "./pet-section";
import { WHY_NOW_SECTION } from "@/lib/demo/pet-content-kit-demo-data";

/**
 * Why Now · 为什么是现在 —— 投资人视角的时机叙事版块（/showcase #why-now）。
 *
 * 讲清「宠物正在成为新一代情绪消费入口」「新口红效应」「从养宠到宠物情绪经济」
 * 「为什么是 Aivora」「市场四点变化」「五个趋势的交汇」与定位语。
 * 数据全部来自 WHY_NOW_SECTION，改文案只改 data。
 */
export function WhyNow() {
  const s = WHY_NOW_SECTION;
  return (
    <PetSection
      id="why-now"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.intro}
    >
      {/* 口红效应 + 从养宠到情绪经济 */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* The New Lipstick Effect */}
        <article className="pet-surface flex flex-col rounded-3xl p-6">
          <BlockEyebrow en={s.lipstick.eyebrow} zh={s.lipstick.title} />
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {s.lipstick.body}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {s.lipstick.bullets.map((b) => (
              <div
                key={b}
                className="rounded-2xl border border-(--pet-orange)/20 bg-(--pet-orange)/6 px-3 py-2.5 text-xs font-medium text-foreground/85"
              >
                {b}
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-7 text-foreground/80">
            {s.lipstick.footer}
          </p>
        </article>

        {/* From Pet Care to Pet Emotion */}
        <article className="pet-surface flex flex-col rounded-3xl p-6">
          <BlockEyebrow en={s.emotion.eyebrow} zh={s.emotion.title} />
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {s.emotion.body}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <TagGroup label={s.emotion.from.label} items={s.emotion.from.items} tone="muted" />
            <ArrowRight
              size={18}
              className="mx-auto hidden shrink-0 text-(--pet-orange) sm:block"
            />
            <TagGroup label={s.emotion.to.label} items={s.emotion.to.items} tone="accent" />
          </div>
          <p className="mt-4 text-sm leading-7 text-foreground/80">
            {s.emotion.footer}
          </p>
        </article>
      </div>

      {/* Why Aivora */}
      <article className="mt-5 rounded-3xl border border-(--pet-teal)/25 bg-(--pet-teal)/8 p-6 sm:p-8">
        <BlockEyebrow en={s.whyAivora.eyebrow} zh={s.whyAivora.title} />
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          {s.whyAivora.body}
        </p>
        <p className="mt-4 text-base font-semibold leading-8 text-foreground sm:text-lg">
          {s.whyAivora.formula}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {s.whyAivora.generates.map((g) => (
            <span
              key={g}
              className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground/85 shadow-sm"
            >
              <Sparkles size={12} className="text-(--pet-teal)" />
              {g}
            </span>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-foreground/80">
          {s.whyAivora.footer}
        </p>
      </article>

      {/* The Market Shift */}
      <div className="mt-8">
        <BlockEyebrow en={s.marketShift.eyebrow} zh={s.marketShift.title} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {s.marketShift.items.map((item) => (
            <div key={item.index} className="pet-surface rounded-3xl p-5">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold text-(--pet-orange)/70">
                  {item.index}
                </span>
                <h4 className="text-sm font-semibold text-foreground">
                  {item.title}
                </h4>
              </div>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Aivora's Timing · 五个趋势 */}
      <div className="mt-8 rounded-3xl border border-border bg-card/60 p-6 sm:p-8">
        <BlockEyebrow en={s.timing.eyebrow} zh={s.timing.title} />
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {s.timing.intro}
        </p>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {s.timing.trends.map((t, i) => (
            <li
              key={t}
              className="flex items-start gap-2.5 rounded-2xl border border-border bg-background/60 p-3 text-xs leading-6 text-foreground/85"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--pet-orange)/15 text-[11px] font-bold text-(--pet-orange)">
                {i + 1}
              </span>
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-(--pet-teal)">
          <TrendingUp size={16} /> {s.timing.closing}
        </p>
      </div>

      {/* Positioning Statement */}
      <div className="mt-8 rounded-[2rem] border border-primary/25 bg-linear-to-br from-(--pet-orange)/12 via-card to-card p-6 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-(--pet-orange)">
          Positioning Statement
        </p>
        <p className="mt-3 text-xl font-semibold leading-9 text-foreground sm:text-2xl">
          {s.positioning.en}
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
          {s.positioning.zh}
        </p>
      </div>

      {/* Page Highlight Copy */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {s.highlights.map((line) => (
          <p
            key={line}
            className="flex items-start gap-2.5 rounded-2xl border border-(--pet-orange)/20 bg-(--pet-orange)/5 px-4 py-3 text-sm leading-7 text-foreground/85"
          >
            <Sparkles size={15} className="mt-1 shrink-0 text-(--pet-orange)" />
            {line}
          </p>
        ))}
      </div>
    </PetSection>
  );
}

function BlockEyebrow({ en, zh }: { en: string; zh: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-(--pet-orange)">
        {en}
      </p>
      <h3 className="mt-1 text-lg font-semibold text-foreground">{zh}</h3>
    </div>
  );
}

function TagGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: ReadonlyArray<string>;
  tone: "muted" | "accent";
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/60 p-3">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className={
              tone === "accent"
                ? "rounded-full bg-(--pet-teal)/12 px-2.5 py-1 text-[11px] font-medium text-(--pet-teal)"
                : "rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground/70"
            }
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
