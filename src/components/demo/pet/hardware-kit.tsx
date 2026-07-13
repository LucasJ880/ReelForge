import Link from "next/link";
import { ArrowRight, Quote } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import { ImageLightbox } from "./image-lightbox";
import {
  HARDWARE_KIT_SECTION,
  type HardwareProductDemo,
  type HardwareStageTag,
} from "@/lib/demo/pet-content-kit-demo-data";

const STAGE_CHIP: Record<HardwareStageTag, string> = {
  mvp: "border-success bg-success/10 text-success",
  b2b: "border-primary/30 bg-primary/10 text-primary",
  future: "border-warning bg-warning/10 text-warning",
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
        <figure className="overflow-hidden rounded-lg border border-border bg-card shadow-editorial">
          <ImageLightbox
            src={s.heroImage}
            alt={s.heroImageAlt}
            thumbClassName="aspect-video object-cover"
            fallbackLabel="Aivora 宠物内容智能采集套件"
            zoomHint="点击放大看数据细节"
          />
        </figure>
        <div className="flex flex-col justify-center rounded-lg border border-success bg-success/10 p-6">
          <Quote size={26} className="text-success" />
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
    </PetSection>
  );
}

function ProductCard({ product }: { product: HardwareProductDemo }) {
  return (
    <div className="border border-border bg-card shadow-editorial flex flex-col overflow-hidden rounded-lg">
      <div className="relative bg-muted">
        <PetImage
          src={product.image}
          alt={product.name}
            className="aspect-4/3 object-cover"
          fallbackLabel={product.name}
        />
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold  ${STAGE_CHIP[product.stage]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {product.stageLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-semibold text-foreground">
          {product.name}
        </h3>
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground/80">
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
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {c}
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-lg border border-border bg-background p-3">
          <p className="text-meta font-semibold text-foreground/70">
            市场验证参考（Market References）
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.marketReferences.map((ref) => (
              <span
                key={ref}
                className="rounded-full border border-border bg-card px-2 py-0.5 text-meta text-muted-foreground"
              >
                {ref}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-success bg-success/10 p-3">
          <p className="text-meta font-semibold text-success">
            Aivora 的差异化
          </p>
          <ul className="mt-2 space-y-1.5">
            {product.aivoraDifference.map((d) => (
              <li
                key={d}
                className="flex items-start gap-2 text-xs leading-5 text-foreground/85"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                {d}
              </li>
            ))}
          </ul>
        </div>

        <Link
          href={product.cta.href}
          className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-primary"
        >
          {product.cta.label} <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
