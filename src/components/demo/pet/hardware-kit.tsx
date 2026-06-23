import Link from "next/link";
import { ArrowRight, Quote } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import {
  HARDWARE_KIT_SECTION,
  ROADMAP_STAGES,
  type HardwareProductDemo,
  type HardwareStageTag,
  type RoadmapStageDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

const STAGE_CHIP: Record<HardwareStageTag, string> = {
  mvp: "border-(--pet-teal)/30 bg-(--pet-teal)/12 text-(--pet-teal)",
  b2b: "border-[var(--pet-orange)]/30 bg-(--pet-orange)/12 text-(--pet-orange)",
  future: "border-amber-500/30 bg-amber-500/12 text-amber-700",
};

const ROADMAP_DOT: Record<RoadmapStageDemo["status"], string> = {
  now: "bg-(--pet-teal)",
  next: "bg-(--pet-orange)",
  later: "bg-stone-400",
};

export function HardwareKit() {
  const s = HARDWARE_KIT_SECTION;
  return (
    <PetSection
      id="hardware-kit"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
    >
      {/* 主视觉海报 + 投资人核心话术 */}
      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <figure className="overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-(--pet-orange)/10">
          <PetImage
            src={s.heroImage}
            alt={s.heroImageAlt}
            className="aspect-video object-cover"
            fallbackLabel="Aivora 宠物内容智能采集套件"
          />
        </figure>
        <div className="flex flex-col justify-center rounded-3xl border border-(--pet-teal)/25 bg-(--pet-teal)/8 p-6">
          <Quote size={26} className="text-(--pet-teal)" />
          <p className="mt-3 text-lg font-semibold leading-8 text-foreground">
            {s.investorLine}
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            {s.investorLineEn}
          </p>
        </div>
      </div>

      {/* 三类硬件产品卡 */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {s.products.map((product) => (
          <ProductCard key={product.key} product={product} />
        ))}
      </div>

      {/* Demo / MVP / Expansion 路线条 */}
      <RoadmapStrip />
    </PetSection>
  );
}

function ProductCard({ product }: { product: HardwareProductDemo }) {
  return (
    <div className="pet-surface flex flex-col overflow-hidden rounded-3xl">
      <div className="relative bg-linear-to-br from-(--pet-cream) to-background">
        <PetImage
          src={product.image}
          alt={product.name}
            className="aspect-4/3 object-cover"
          fallbackLabel={product.name}
        />
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${STAGE_CHIP[product.stage]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {product.stageLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-foreground">
          {product.name}
        </h3>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {product.englishName}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {product.tagline}
        </p>

        <ul className="mt-4 space-y-2">
          {product.capabilities.map((c) => (
            <li
              key={c}
              className="flex items-start gap-2 text-xs leading-5 text-foreground/80"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-(--pet-orange)" />
              {c}
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-2xl border border-border bg-background/60 p-3">
          <p className="text-[11px] font-semibold text-foreground/70">
            市场验证参考（Market References）
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.marketReferences.map((ref) => (
              <span
                key={ref}
                className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {ref}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-(--pet-teal)/25 bg-(--pet-teal)/6 p-3">
          <p className="text-[11px] font-semibold text-(--pet-teal)">
            Aivora 的差异化
          </p>
          <ul className="mt-2 space-y-1.5">
            {product.aivoraDifference.map((d) => (
              <li
                key={d}
                className="flex items-start gap-2 text-xs leading-5 text-foreground/85"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-(--pet-teal)" />
                {d}
              </li>
            ))}
          </ul>
        </div>

        <Link
          href={product.cta.href}
          className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-(--pet-orange) transition hover:gap-2.5"
        >
          {product.cta.label} <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function RoadmapStrip() {
  const r = ROADMAP_STAGES;
  return (
    <div className="mt-8 rounded-3xl border border-border bg-card/60 p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-sm font-semibold text-foreground">{r.title}</h3>
        <span className="text-[11px] text-muted-foreground">{r.eyebrow}</span>
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-6 text-muted-foreground">
        {r.description}
      </p>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {r.stages.map((stage, idx) => (
          <li
            key={stage.stage}
            className="relative rounded-2xl border border-border bg-background/60 p-4"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${ROADMAP_DOT[stage.status]}`}
              />
              <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                {stage.stage}
              </span>
              <span className="ml-auto rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                {stage.statusLabel}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {idx + 1}. {stage.title}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {stage.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
