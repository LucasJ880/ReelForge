import { Sparkles } from "lucide-react";
import {
  mainConceptVideo,
  petGroomingSample,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

export function PetGroomingExtensionSection() {
  return (
    <DemoSection
      id="pet-grooming"
      eyebrow="行业扩展 · 同一套工作流"
      title="换个行业：宠物美容也能跑出同样质感的样片。"
      description="同一套工作流——选方向、写脚本、出分镜、质检素材、出片——只要换上行业素材，就能跑出右上角这种风格的成片。下面是宠物美容行业的分镜节奏示例，最终成片仍由你的脚本、分镜和审核通过的素材决定。"
      rightSlot={<SampleDataBadge />}
    >
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <PhoneVideoMockup
          size="lg"
          videoUrl={mainConceptVideo.url}
          posterUrl={mainConceptVideo.posterUrl}
          videoMode="autoplay"
          caption="概念样片 · 同一套工作流的成片质感"
          statusBadge={`${mainConceptVideo.aspectRatio} · ${mainConceptVideo.durationLabel}`}
          fallbackGradient="from-amber-400/30 via-rose-500/20 to-violet-500/20"
          fallbackTitle={petGroomingSample.industryLabel}
          fallbackSubtitle="洗护前 / 洗护流程 / 洗护后 / 预约 CTA"
        />

        <div className="rounded-3xl border border-white/10 bg-card/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            宠物美容 · 分镜节奏示例
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            把素材换成宠物店的门店、洗护过程与宠物镜头，工作流跑完后能产出与左侧
            概念样片相同质感的成片初稿。
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
