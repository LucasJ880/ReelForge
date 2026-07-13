import { ArrowRight, Sparkles } from "lucide-react";
import { PetSection } from "./pet-section";
import { PhoneVideoMockup } from "@/components/demo/phone-video-mockup";
import { BEFORE_AFTER } from "@/lib/demo/pet-content-kit-demo-data";

export function BeforeAfter() {
  const b = BEFORE_AFTER;
  return (
    <PetSection
      id="before-after"
      eyebrow={b.eyebrow}
      title={b.title}
      description={b.description}
    >
      <div className="border border-border bg-card shadow-editorial rounded-lg p-5 sm:p-6">
        <div className="grid items-center gap-5 lg:grid-cols-[1fr_auto_1fr]">
          {/* Before */}
          <div className="flex flex-col items-center gap-3">
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
              {b.before.label}
            </span>
            <PhoneVideoMockup
              sizeClassName="h-[420px] w-full max-w-[236px]"
              videoUrl={b.before.videoUrl}
              posterUrl={b.before.posterUrl}
              videoMode="preview"
              statusBadge={b.before.durationLabel}
              fallbackTitle="原始素材"
              fallbackSubtitle="平淡 · 冗长 · 未剪辑"
            />
            <ul className="w-full max-w-[260px] space-y-1.5">
              {b.before.notes.map((n) => (
                <li
                  key={n}
                  className="flex items-start gap-2 text-meta leading-5 text-muted-foreground"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {n}
                </li>
              ))}
            </ul>
          </div>

          {/* 中间：AI 处理箭头 + 步骤 */}
          <div className="flex flex-col items-center gap-3 py-2">
            <span className="hidden text-primary lg:block">
              <ArrowRight size={28} />
            </span>
            <span className="text-primary lg:hidden">
              <ArrowRight size={24} className="rotate-90" />
            </span>
            <div className="flex flex-col items-center gap-1.5">
              {b.aiSteps.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-meta font-semibold text-primary"
                >
                  <Sparkles size={11} /> {s}
                </span>
              ))}
            </div>
          </div>

          {/* After */}
          <div className="flex flex-col items-center gap-3">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {b.after.label}
            </span>
            <PhoneVideoMockup
              sizeClassName="h-[420px] w-full max-w-[236px]"
              videoUrl={b.after.videoUrl}
              posterUrl={b.after.posterUrl}
              videoMode="preview"
              statusBadge={b.after.durationLabel}
              caption={b.after.caption ?? undefined}
              fallbackTitle="AI 成片"
              fallbackSubtitle="可发布 · 自动生成"
            />
            <ul className="w-full max-w-[260px] space-y-1.5">
              {b.after.notes.map((n) => (
                <li
                  key={n}
                  className="flex items-start gap-2 text-meta leading-5 text-foreground/80"
                >
                  <Sparkles
                    size={12}
                    className="mt-0.5 shrink-0 text-success"
                  />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-center text-meta leading-5 text-muted-foreground/80">
          {b.note}
        </p>
      </div>
    </PetSection>
  );
}
