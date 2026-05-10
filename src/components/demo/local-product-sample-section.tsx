import { Sparkles } from "lucide-react";
import {
  localProductSample,
  mainConceptVideo,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

/**
 * 真实商家案例 · 本地产品商家（本地毛毯 / 家居用品）。
 *
 * 这一段放在 FinalOutputSection 之后，作为「同一套工作流也能服务本地
 * 产品类商家」的真实样片证明。视频使用已接入的 mainConceptVideo，
 * 而不是房地产 final output 的占位。
 */
export function LocalProductSampleSection() {
  return (
    <DemoSection
      id="local-product-sample"
      eyebrow="真实商家案例 · 本地产品商家"
      title="另一个行业案例：本地毛毯产品广告样片。"
      description="同一套工作流不只适用于房地产。客户提供产品素材后，也可以生成有痛点、有卖点、有生活感、有 CTA 的短视频样片。"
      rightSlot={<SampleDataBadge label="Concept sample" />}
    >
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <div className="flex flex-col items-center gap-4">
          <PhoneVideoMockup
            size="lg"
            videoUrl={localProductSample.videoUrl}
            posterUrl={localProductSample.thumbnailUrl}
            videoMode="preview"
            statusBadge={`${localProductSample.aspectRatio} · ${mainConceptVideo.durationLabel}`}
            fallbackGradient="from-amber-400/30 via-rose-500/20 to-violet-500/20"
            fallbackTitle={localProductSample.title}
            fallbackSubtitle="痛点 · 材质 · 使用场景 · 卖点 · CTA"
          />
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-amber-200">
              <Sparkles size={11} />
              {localProductSample.badge}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {localProductSample.industryLabel}
            </span>
          </div>
          <p className="max-w-xs text-center text-xs leading-5 text-muted-foreground">
            本地毛毯 / 家居用品商家的概念样片，用来证明 Aivora 的工作流也能扩展到本地零售和产品类商家。
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-card/60 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            本地毛毯样片 · 分镜节奏
          </p>
          <h3 className="mt-2 text-xl font-semibold leading-snug">
            {localProductSample.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {localProductSample.description}
          </p>

          <ol className="mt-4 space-y-3">
            {localProductSample.beats.map((beat) => (
              <li
                key={beat.time}
                className="grid grid-cols-[68px_1fr] gap-3 rounded-2xl bg-white/[0.03] p-3 sm:grid-cols-[88px_1fr]"
              >
                <div>
                  <p className="font-mono text-xs text-primary">{beat.time}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {beat.label}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm leading-6 break-words">{beat.visual}</p>
                  {beat.caption ? (
                    <p className="mt-1 rounded-xl bg-white/[0.04] px-2.5 py-1 text-xs italic leading-5 text-muted-foreground break-words">
                      “{beat.caption}”
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-sm leading-6 text-foreground">
              {localProductSample.cta}
            </p>
          </div>

          <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-muted-foreground">
            当前样片用于展示本地产品商家场景。房地产最终样片完成后，将接入上方
            「房地产工作流 · 最终输出」位，与本案例形成「房地产 + 本地产品」两条
            行业证据线。
          </p>
        </div>
      </div>
    </DemoSection>
  );
}
