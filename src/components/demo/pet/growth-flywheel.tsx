import { ArrowRight, RefreshCw } from "lucide-react";
import { PetSection } from "./pet-section";
import { GROWTH_FLYWHEEL } from "@/lib/demo/pet-content-kit-demo-data";

export function GrowthFlywheel() {
  const f = GROWTH_FLYWHEEL;
  return (
    <PetSection
      id="flywheel"
      eyebrow={f.eyebrow}
      title={f.title}
      description={f.description}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-(--pet-teal)/30 bg-(--pet-teal)/10 px-3 py-1.5 text-xs font-semibold text-(--pet-teal)">
          <RefreshCw size={14} /> 复利飞轮
        </span>
      }
    >
      <div className="pet-surface rounded-3xl p-6">
        <ol className="flex flex-wrap items-stretch gap-3">
          {f.nodes.map((node, idx) => (
            <li key={node.label} className="flex items-stretch gap-3">
              <div className="flex min-w-34 max-w-48 flex-1 flex-col justify-center rounded-2xl border border-border bg-background/70 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-(--pet-orange)/15 text-[10px] font-bold text-(--pet-orange)">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold leading-4 text-foreground">
                    {node.label}
                  </span>
                </div>
                <p className="mt-1.5 pl-7 text-[10px] leading-4 text-muted-foreground">
                  {node.hint}
                </p>
              </div>
              <span className="flex items-center text-(--pet-orange)/60">
                <ArrowRight size={16} />
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-(--pet-teal)/30 bg-(--pet-teal)/10 px-4 py-2 text-xs font-semibold text-(--pet-teal)">
          <RefreshCw size={13} /> {f.closingNote}
        </p>
      </div>
    </PetSection>
  );
}
