import { MapPin, Sparkles, Store } from "lucide-react";
import { localProductSample } from "@/lib/demo/ai-video-workflow-demo-data";
import { DemoSection, SampleDataBadge } from "./demo-section";
import { PhoneVideoMockup } from "./phone-video-mockup";

/**
 * 案例 B · Mapleside Living（本地家居织物 · 概念样片）。
 *
 * 放在 Sunny Shutter Final Output 之后，作为「同一套工作流也能服务本地零售
 * 商家」的第二份证据。视频使用 public/generated/ 下的真实样片，证明 Aivora
 * 在本地零售批量化短视频场景下也能跑出可投放的成片。
 */
export function LocalProductSampleSection() {
  return (
    <DemoSection
      id="local-product-sample"
      eyebrow="案例 B · 本地零售批量化"
      title="Mapleside Living · 多伦多本地家居织物品牌。"
      description={
        <>
          <p>
            同一套工作流不只服务高端品牌。本地零售商家上传产品素材后，
            可以批量化产出有痛点、有卖点、有生活感、有 CTA 的短视频样片，
            按周交付到独立站和门店投流账号。
          </p>
          <p className="mt-2 text-xs text-muted-foreground/85">
            {localProductSample.positioning}
          </p>
        </>
      }
      rightSlot={<SampleDataBadge label="Concept sample" />}
    >
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <div className="flex flex-col items-center gap-4">
          <PhoneVideoMockup
            size="lg"
            videoUrl={localProductSample.videoUrl}
            posterUrl={localProductSample.thumbnailUrl}
            videoMode="preview"
            statusBadge={`${localProductSample.aspectRatio} · ${localProductSample.durationSec}s`}
            fallbackTitle={localProductSample.title}
            fallbackSubtitle="痛点 · 材质 · 场景 · 卖点 · CTA"
          />
          <div className="flex flex-wrap items-center justify-center gap-2 text-meta">
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-warning">
              <Sparkles size={11} />
              {localProductSample.badge}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Store size={11} />
              {localProductSample.industryLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <MapPin size={11} />
              {localProductSample.city}
            </span>
          </div>
        </div>

        <div className="rounded-(--radius-lg) border border-border bg-card p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {localProductSample.brandName} · 分镜节奏
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
                className="grid grid-cols-[68px_1fr] gap-3 rounded-(--radius-lg) bg-muted p-3 sm:grid-cols-[88px_1fr]"
              >
                <div>
                  <p className="font-mono text-xs text-primary">{beat.time}</p>
                  <p className="mt-0.5 text-meta uppercase tracking-[0.16em] text-muted-foreground">
                    {beat.label}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm leading-6 wrap-break-word">{beat.visual}</p>
                  {beat.caption ? (
                    <p className="mt-1 rounded-(--radius-md) bg-muted px-2.5 py-1 text-xs italic leading-5 text-muted-foreground wrap-break-word">
                      “{beat.caption}”
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {localProductSample.industryStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-(--radius-lg) border border-border bg-muted px-3 py-3"
              >
                <p className="text-meta uppercase tracking-[0.18em] text-muted-foreground">
                  {stat.label}
                </p>
                <p className="mt-1 text-sm font-semibold leading-tight">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-(--radius-lg) border border-primary/25 bg-primary/6 px-4 py-3">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-sm leading-6 text-foreground">
              {localProductSample.cta}
            </p>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
