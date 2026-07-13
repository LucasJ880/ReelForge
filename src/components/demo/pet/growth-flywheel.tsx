import { Fragment } from "react";
import { ArrowRight, ArrowDown, RefreshCw } from "lucide-react";
import { PetSection } from "./pet-section";
import { GROWTH_FLYWHEEL } from "@/lib/demo/pet-content-kit-demo-data";

export function GrowthFlywheel() {
  const f = GROWTH_FLYWHEEL;
  const last = f.nodes.length - 1;
  return (
    <PetSection
      id="flywheel"
      eyebrow={f.eyebrow}
      title={f.title}
      description={f.description}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
          <RefreshCw size={14} /> 复利飞轮
        </span>
      }
    >
      <div className="border border-border bg-card shadow-editorial rounded-(--radius-lg) p-5 sm:p-6">
        {/*
          移动端：纵向流（节点之间用向下箭头）；xl 及以上：单行横向流（向右箭头）。
          连接箭头只在节点之间出现，避免在换行处出现指向空白的悬空箭头。
        */}
        <ol className="flex flex-col items-stretch gap-2 xl:flex-row xl:items-stretch xl:gap-1">
          {f.nodes.map((node, idx) => (
            <Fragment key={node.label}>
              <li className="flex flex-col justify-center rounded-(--radius-lg) border border-border bg-background p-3 xl:min-w-0 xl:flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-meta font-bold text-primary">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold leading-4 text-foreground">
                    {node.label}
                  </span>
                </div>
                <p className="mt-1.5 pl-7 text-meta leading-4 text-muted-foreground">
                  {node.hint}
                </p>
              </li>
              {idx !== last ? (
                <span
                  aria-hidden
                  className="flex items-center justify-center text-primary/60"
                >
                  <ArrowDown size={16} className="xl:hidden" />
                  <ArrowRight size={16} className="hidden xl:block" />
                </span>
              ) : null}
            </Fragment>
          ))}
        </ol>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-success bg-success/10 px-4 py-2 text-xs font-semibold text-success">
          <RefreshCw size={13} /> {f.closingNote}
        </p>
      </div>
    </PetSection>
  );
}
