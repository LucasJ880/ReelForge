import { Droplet, Send, Sparkles, Trophy, UserPlus } from "lucide-react";
import { PetSection } from "./pet-section";
import { viralSharing } from "@/lib/demo/pet-content-kit-demo-data";

const STEP_ICON = [Send, Droplet, UserPlus, Trophy] as const;

export function ViralSharing() {
  return (
    <PetSection
      id="sharing"
      eyebrow="病毒式分享裂变"
      title="宠物主人天然爱分享，分享就是增长"
      description={viralSharing.intro}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* 分享步骤 */}
        <div className="grid gap-4 sm:grid-cols-2">
          {viralSharing.steps.map((step, i) => {
            const Icon = STEP_ICON[i] ?? Sparkles;
            return (
              <div key={step.step} className="pet-surface rounded-3xl p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--pet-orange)]/12 text-[color:var(--pet-orange)]">
                    <Icon size={18} />
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    第 {step.step} 步
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            );
          })}
        </div>

        {/* 平台 + 水印 + 指标 */}
        <div className="pet-surface flex flex-col gap-5 rounded-3xl p-5">
          <div>
            <p className="text-xs font-semibold text-[color:var(--pet-teal)]">
              一键分享到
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {viralSharing.platforms.map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-foreground/80"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--pet-orange)]/25 bg-[var(--pet-orange)]/8 p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--pet-orange)]">
              <Droplet size={13} /> 自带水印 · 传播即获客
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {viralSharing.watermarkNote}
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-2">
            {viralSharing.metrics.map((m) => (
              <div
                key={m.label}
                className="flex items-center justify-between rounded-2xl border border-border bg-background/60 px-3 py-2.5"
              >
                <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
                <dd className="text-sm font-semibold text-foreground">
                  {m.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </PetSection>
  );
}
