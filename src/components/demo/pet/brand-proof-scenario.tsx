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
      <p className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-(--pet-teal)/25 bg-(--pet-teal)/6 px-4 py-3 text-xs leading-6 text-foreground/80 sm:text-sm">
        <Building2 size={16} className="shrink-0 text-(--pet-teal)" />
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
    <div className="relative pet-surface flex flex-col rounded-3xl p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-(--pet-orange)/12 text-(--pet-orange)">
          <Icon size={18} />
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground">
          STEP {step.step}
        </span>
        {!isLast ? (
          <ArrowRight
            size={16}
            className="ml-auto hidden text-(--pet-orange)/50 lg:block"
          />
        ) : null}
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-(--pet-teal)">
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
