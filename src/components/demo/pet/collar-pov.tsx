import { Mic, Eye, Sparkles, ArrowRight } from "lucide-react";
import { PetSection } from "./pet-section";
import { PetImage } from "./pet-image";
import {
  COLLAR_POV,
  type CollarPovStepDemo,
} from "@/lib/demo/pet-content-kit-demo-data";

const STEP_ICON = [Mic, Eye, Sparkles] as const;

export function CollarPov() {
  const c = COLLAR_POV;
  return (
    <PetSection
      id="collar-pov"
      eyebrow={c.eyebrow}
      title={c.title}
      description={c.description}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700">
          扩展阶段 · 概念演示
        </span>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        {/* 产品 + 模拟交互 */}
        <div className="pet-surface flex flex-col overflow-hidden rounded-3xl">
          <div className="bg-linear-to-br from-(--pet-cream) to-background">
            <PetImage
              src={c.povImage}
              alt="Aivora 第一视角项圈摄影机"
              className="aspect-4/3 object-cover"
              fallbackLabel="第一视角项圈摄影机"
            />
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-(--pet-orange)/12 px-3 py-2 text-xs font-semibold text-(--pet-orange)">
              <Mic size={14} /> 远程发声「奶豆～」
            </span>
            <ArrowRight size={16} className="text-muted-foreground" />
            <span className="inline-flex items-center gap-2 rounded-full bg-(--pet-teal)/12 px-3 py-2 text-xs font-semibold text-(--pet-teal)">
              <Sparkles size={14} /> 自动成片
            </span>
          </div>
        </div>

        {/* 三步流程 */}
        <div className="flex flex-col gap-3">
          {c.steps.map((step, idx) => (
            <PovStep key={step.step} step={step} index={idx} />
          ))}
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-(--pet-orange)/25 bg-(--pet-orange)/8 px-3 py-1.5 text-[11px] font-semibold text-(--pet-orange)">
            <Sparkles size={12} /> {c.challengeLabel}
          </span>
          <p className="text-[11px] leading-5 text-muted-foreground/80">
            {c.futureNote}
          </p>
        </div>
      </div>
    </PetSection>
  );
}

function PovStep({ step, index }: { step: CollarPovStepDemo; index: number }) {
  const Icon = STEP_ICON[index] ?? Sparkles;
  return (
    <div className="pet-surface flex items-start gap-3 rounded-2xl p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--pet-orange)/12 text-(--pet-orange)">
        <Icon size={16} />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {step.step}. {step.title}
        </h3>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">
          {step.detail}
        </p>
      </div>
    </div>
  );
}
