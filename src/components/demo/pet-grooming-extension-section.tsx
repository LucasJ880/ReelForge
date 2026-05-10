import { Sparkles } from "lucide-react";
import { petGroomingSample } from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

export function PetGroomingExtensionSection() {
  return (
    <DemoSection
      id="pet-grooming"
      eyebrow="行业扩展 · 不抢主线"
      title="同一套工作流，换个行业：宠物美容。"
      description="同样的流程也适用于宠物店、本地服务。下面的样片是真实合规的宠物店素材，仅用作行业扩展示例，不抢地产主线。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <PhoneVideoMockup
          size="lg"
          videoUrl={petGroomingSample.videoUrl}
          posterUrl={petGroomingSample.thumbnailUrl}
          statusBadge={`${petGroomingSample.aspectRatio} · ${petGroomingSample.durationSec} 秒`}
          fallbackGradient="from-amber-400/30 via-rose-500/20 to-violet-500/20"
          fallbackTitle={petGroomingSample.industryLabel}
          fallbackSubtitle="洗护前 / 洗护流程 / 洗护后 / 预约 CTA"
        />

        <div className="rounded-3xl border border-white/10 bg-card/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            分镜节奏
          </p>
          <ol className="mt-3 space-y-3">
            {petGroomingSample.beats.map((beat) => (
              <li
                key={beat.time}
                className="grid grid-cols-[80px_1fr] gap-3 rounded-2xl bg-white/[0.03] p-3"
              >
                <div>
                  <p className="font-mono text-xs text-primary">{beat.time}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {beat.label}
                  </p>
                </div>
                <div>
                  <p className="text-sm leading-6">{beat.visual}</p>
                  {beat.caption ? (
                    <p className="mt-1 rounded-xl bg-white/[0.04] px-2.5 py-1 text-xs italic text-muted-foreground">
                      “{beat.caption}”
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
            <Sparkles size={16} className="text-primary" />
            <p className="text-sm text-foreground">{petGroomingSample.cta}</p>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
