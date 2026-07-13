import { Layers, Camera, Sparkles, Building2, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PetSection } from "./pet-section";
import {
  BRAND_PROOF_SCENARIO,
  type BrandProofStepDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

const STEP_ICON: LucideIcon[] = [Layers, Camera, Sparkles, Building2];

export function BrandProofScenario() {
  const s = BRAND_PROOF_SCENARIO;
  return (
    <PetSection
      id="brand-proof-scenario"
      eyebrow={s.eyebrow}
      title={s.title}
      description={s.description}
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {s.steps.map((step, idx) => (
          <ScenarioStep
            key={step.step}
            step={step}
            index={idx}
            isLast={idx === s.steps.length - 1}
          />
        ))}
      </div>
      <p className="mt-6 inline-flex items-center gap-2 rounded-(--radius-lg) border border-success bg-success/10 px-4 py-3 text-xs leading-6 text-foreground/80 sm:text-sm">
        <Building2 size={16} className="shrink-0 text-success" />
        {s.pricingHint}
      </p>
    </PetSection>
  );
}

function ScenarioStep({
  step,
  index,
  isLast,
}: {
  step: BrandProofStepDemo;
  index: number;
  isLast: boolean;
}) {
  const Icon = STEP_ICON[index] ?? Sparkles;
  return (
    <div className="relative border border-border bg-card shadow-editorial flex flex-col rounded-(--radius-lg) p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-(--radius-lg) bg-primary/10 text-primary">
          <Icon size={18} />
        </span>
        <span className="text-meta font-semibold text-muted-foreground">
          STEP {step.step}
        </span>
        {!isLast ? (
          <ArrowRight
            size={16}
            className="ml-auto hidden text-primary/50 lg:block"
          />
        ) : null}
      </div>
      <p className="mt-3 text-meta font-semibold uppercase tracking-wide text-success">
        {step.actorLabel}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-foreground">
        {step.title}
      </h3>
      <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
        {step.detail}
      </p>
    </div>
  );
}
