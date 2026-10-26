import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { SectionHead } from "@/components/exchange/section-head";
import { MonoTag } from "@/components/exchange/mono-tag";
import { TickGlyph, tickToneClass } from "@/components/exchange/status-tick";
import { WallVideo } from "@/components/exchange/wall-controls";
import type { Locale } from "@/i18n/config";
import { getGrowthCopy, type LeadStatusKey, type TrackedLinkChannel } from "@/i18n/growth-copy";
import { LANDING_HERO_SCENES, LANDING_PROOF_VIDEOS, LANDING_STORYBOARD_FRAMES } from "@/lib/config/landing-media";
import { stateTone, stateWord } from "@/lib/exchange/state-vocab";
import { cn } from "@/lib/utils";
import { PilotApplicationForm } from "./pilot-application-form";

/** 模板库真实计数（1.5 秒取不到就是 null，整条事实不显示，不写示例数字）。 */
export type LandingCounts = { templates: number; samples: number };

const pad = (value: number) => String(value).padStart(2, "0");

/// 一周样例里排程的形状：视频 / 图文 / 空档。只是界面示意，整节标「样例」。
const PLAN_SHAPE: ReadonlyArray<ReadonlyArray<"video" | "post">> = [
  ["video"],
  ["post"],
  ["video", "post"],
  [],
  ["post"],
  ["video"],
  [],
];
const LINK_CHANNELS: readonly TrackedLinkChannel[] = ["ig_bio", "google_business", "qr"];
const LEAD_PIPELINE: readonly LeadStatusKey[] = ["NEW", "CONTACTED", "BOOKED", "WON"];

function fillCounts(template: string, counts: LandingCounts): string {
  return template.replace("{templates}", String(counts.templates)).replace("{samples}", String(counts.samples));
}

/**
 * 公开首页（未登录访客）。一条主线、两种开始方式：
 *  - 主行动（全页唯一实心钮）：免费试做 3 条 → 注册 → /app/welcome 上手向导；
 *  - 次行动：申请 30 天陪跑 → 本页申请表。
 * 英雄墙是 AI 生成的上门服务场景（标 AI 生成，不冒充客户实拍）；真实交付只放关联方 SunnyShutter 的成片并写明关系。
 * 不写价格、不写效果主张；「一周会发生什么」是界面样例，整节标「样例」，不放读数。
 */
export function PilotLanding({
  locale,
  counts,
  fallbackEmail,
}: {
  locale: Locale;
  counts: LandingCounts | null;
  fallbackEmail: string | null;
}) {
  const growth = getGrowthCopy(locale);
  const copy = growth.landing;
  const facts = copy.tape.flatMap((fact) =>
    fact.includes("{") ? (counts ? [fillCounts(fact, counts)] : []) : [fact],
  );
  const signUp = <Link href="/register" />;
  const toApply = <a href="#pilot-apply" />;

  return (
    <div className="gate-theme desk-canvas relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="x-pane relative z-10 flex h-16 items-center justify-between gap-3 border-b px-4 sm:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={copy.home}
        >
          <Logo size={36} />
          <span className="font-heading text-[15px] font-semibold tracking-[0.14em]">AIVORA</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher variant="inline" className="hidden w-auto min-w-32 sm:flex" />
          <Button render={<Link href="/login" />} variant="ghost">
            {copy.signIn}
          </Button>
        </div>
      </header>

      {facts.length > 0 ? (
        <div className="x-pane relative z-10 border-b">
          <div className="x-tape h-9 items-center">
            {[0, 1].map((track) => (
              <ul
                key={track}
                className="x-tape-track items-center"
                aria-label={track === 0 ? copy.tapeLabel : undefined}
                aria-hidden={track === 1 || undefined}
              >
                {facts.map((fact) => (
                  <li key={fact} className="flex shrink-0 items-center gap-3 whitespace-nowrap font-mono text-data tabular-nums text-muted-foreground">
                    <span className="size-1 rounded-(--radius-sm) bg-border-bright" aria-hidden />
                    {fact}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      ) : null}

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-20 px-4 py-12 sm:px-8 lg:px-12 lg:py-16">
        <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
          <div className="min-w-0 space-y-7">
            {/* 中文每行是一个意群，不许在词中间折行：字号按左栏宽度封顶（7 个字 ≤ 栏宽）；英文按词折行 */}
            <h1 className="x-display text-balance text-[clamp(2.5rem,8.5vw,4.5rem)] lg:text-[clamp(2.75rem,4.4vw,4.5rem)]">
              {copy.titleLines.map((line, index) => (
                <span
                  key={line}
                  className={cn(
                    "block",
                    locale !== "en-US" && "whitespace-nowrap",
                    index === copy.titleLines.length - 1 && "text-accent",
                  )}
                >
                  {line}
                </span>
              ))}
            </h1>
            <p className="max-w-[56ch] text-body leading-relaxed text-muted-foreground">{copy.subtitle}</p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button render={<Link href="/register" />} size="lg">
                  {copy.trial}
                  <ArrowRight aria-hidden />
                </Button>
                <Button render={<a href="#pilot-apply" />} size="lg" variant="outline">
                  {copy.apply}
                </Button>
              </div>
              <p className="font-mono text-data text-tertiary">{copy.trialHint}</p>
            </div>
            <LanguageSwitcher variant="inline" className="w-auto min-w-32 sm:hidden" />
          </div>

          <figure className="min-w-0 space-y-2.5">
            <ul aria-label={copy.heroWallLabel} className="x-wall x-frame grid-cols-3">
              {LANDING_HERO_SCENES.map((item, index) => (
                <li key={item.scene} className={cn("min-w-0", index === 0 && "col-span-3")}>
                  <div className={cn("relative overflow-hidden bg-sunken", index === 0 ? "aspect-[16/7]" : "aspect-[4/3]")}>
                    <WallVideo src={item.video} poster={item.poster} label={copy.heroScenes[item.scene]} />
                    <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                    <span className="absolute left-2 top-2">
                      <AiGeneratedLabel compact={index !== 0} />
                    </span>
                    <span
                      className={cn(
                        "absolute inset-x-2 bottom-2 truncate font-mono text-foreground",
                        index === 0 ? "text-data" : "text-micro",
                      )}
                    >
                      {copy.heroScenes[item.scene]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <figcaption className="font-mono text-data text-tertiary">{copy.heroNote}</figcaption>
          </figure>
        </section>

        <section aria-labelledby="landing-week" className="space-y-4">
          <SectionHead
            title={<span id="landing-week">{copy.weekTitle}</span>}
            hint={
              <span className="inline-flex flex-wrap items-center gap-2">
                <MonoTag>{copy.sampleTag}</MonoTag>
                {copy.weekHint}
              </span>
            }
          />
          <ol className="x-wall grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 sm:max-lg:[&>*:last-child]:col-span-2">
            {copy.week.map((step, index) => (
              <li key={step.day} className="flex min-w-0 flex-col gap-4 px-5 py-5">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-data tabular-nums text-accent">{pad(index + 1)}</span>
                  <span className="x-label">{step.day}</span>
                </span>
                <div className="space-y-2">
                  <h3 className="text-subhead font-medium">{step.title}</h3>
                  <p className="text-meta leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
                <div className="x-well mt-auto rounded-(--radius-md) p-3" aria-hidden>
                  <WeekSpecimen index={index} locale={locale} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="landing-proof"
          className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-center lg:gap-14"
        >
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="landing-proof" className="text-section font-light leading-tight">
                {copy.proofTitle}
              </h2>
              <MonoTag>{copy.proofTag}</MonoTag>
            </div>
            <p className="text-subhead font-medium">{copy.proofHint}</p>
            <p className="max-w-[46ch] text-body leading-relaxed text-muted-foreground">{copy.proofNote}</p>
            {counts ? (
              <p className="font-mono text-data tabular-nums text-tertiary">{fillCounts(copy.templateCounts, counts)}</p>
            ) : null}
          </div>
          <ul aria-label={copy.proofHint} className="x-wall x-frame grid-cols-3">
            {LANDING_PROOF_VIDEOS.map((item, index) => (
              <li key={item.video} className="min-w-0">
                <div className="relative aspect-[9/16] overflow-hidden bg-sunken">
                  <WallVideo src={item.video} poster={item.poster} label={copy.proofItems[index] ?? copy.proofHint} />
                  <div className="pointer-events-none absolute inset-0 bg-(image:--scrim)" aria-hidden />
                  <span className="absolute left-1.5 top-1.5">
                    <AiGeneratedLabel compact />
                  </span>
                </div>
                <p className="truncate px-3 py-2 text-meta text-muted-foreground">{copy.proofItems[index]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="landing-paths" className="space-y-4">
          <SectionHead title={<span id="landing-paths">{copy.pathsTitle}</span>} />
          <div className="x-wall grid-cols-1 md:grid-cols-2">
            {copy.paths.map((path, index) => {
              const target = index === 0 ? signUp : toApply;
              return (
                <div key={path.title} className="flex min-w-0 flex-col gap-5 px-6 py-6">
                  <h3 className="text-title font-light">{path.title}</h3>
                  <ol className="space-y-3">
                    {path.points.map((point, pointIndex) => (
                      <li key={point} className="flex items-baseline gap-3 text-meta text-muted-foreground">
                        <span className="font-mono text-data tabular-nums text-tertiary">{pad(pointIndex + 1)}</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-auto pt-1">
                    <Button render={target} variant="outline">
                      {path.cta}
                      <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="pilot-rules" className="space-y-4">
          <SectionHead title={<span id="pilot-rules">{copy.rulesTitle}</span>} />
          <dl className="x-wall grid-cols-1 sm:grid-cols-2">
            {copy.rules.map((rule) => (
              <div key={rule.title} className="min-w-0 space-y-2 px-5 py-5">
                <dt className="text-body font-medium">{rule.title}</dt>
                <dd className="max-w-[56ch] text-meta leading-relaxed text-muted-foreground">{rule.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="pilot-apply"
          aria-labelledby="pilot-apply-title"
          className="grid scroll-mt-8 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(380px,1fr)] lg:gap-14"
        >
          <div className="min-w-0 space-y-5">
            <h2 id="pilot-apply-title" className="text-section font-light leading-tight">
              {copy.applyTitle}
            </h2>
            <p className="max-w-[46ch] text-body leading-relaxed text-muted-foreground">{copy.applyLead}</p>
            <ol className="space-y-3">
              {copy.applyNext.map((item, index) => (
                <li key={item} className="flex items-baseline gap-3 text-meta text-muted-foreground">
                  <span className="font-mono text-data tabular-nums text-tertiary">{pad(index + 1)}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="x-panel x-frame min-w-0">
            <PilotApplicationForm locale={locale} fallbackEmail={fallbackEmail} />
          </div>
        </section>
      </main>

      <footer className="x-pane relative z-10 flex min-h-12 items-center justify-center gap-5 border-t px-4 text-meta text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">
          {copy.privacy}
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          {copy.terms}
        </Link>
      </footer>
    </div>
  );
}

/** 「一周会发生什么」每一格下面的界面示意：排程、故事板、追踪链接、询盘、跟进。都不是任何人的数据。 */
function WeekSpecimen({ index, locale }: { index: number; locale: Locale }) {
  const growth = getGrowthCopy(locale);
  const specimen = growth.landing.weekSpecimen;
  switch (index) {
    case 0:
      return (
        <div className="grid grid-cols-7 gap-1">
          {specimen.days.map((day, dayIndex) => {
            const slots = PLAN_SHAPE[dayIndex] ?? [];
            return (
              <div key={dayIndex} className="flex min-w-0 flex-col items-center gap-1.5">
                <span className="font-mono text-micro text-tertiary">{day}</span>
                <div className="flex h-14 w-full flex-col gap-1">
                  {slots.length === 0 ? (
                    <span className="x-hatch h-full w-full rounded-(--radius-sm)" />
                  ) : (
                    slots.map((kind, slotIndex) => (
                      <span
                        key={slotIndex}
                        className={cn(
                          "h-6 w-full rounded-(--radius-sm) border-l-2",
                          kind === "video" ? "border-accent bg-accent-soft" : "border-azure bg-azure-soft",
                        )}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    case 1:
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {LANDING_STORYBOARD_FRAMES.map((url, frameIndex) => (
              <div key={url} className="relative aspect-[9/16] overflow-hidden rounded-(--radius-sm) bg-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                <span className="absolute left-1 top-1 font-mono text-micro tabular-nums text-foreground">{pad(frameIndex + 1)}</span>
              </div>
            ))}
          </div>
          <p className="truncate font-mono text-micro text-tertiary">{specimen.storyboard}</p>
        </div>
      );
    case 2:
      return (
        <ul className="space-y-2">
          {LINK_CHANNELS.map((channel, linkIndex) => (
            <li key={channel} className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-data text-foreground">{specimen.linkCodes[linkIndex]}</span>
              <span className="text-micro text-muted-foreground">{growth.channels[channel]}</span>
            </li>
          ))}
        </ul>
      );
    case 3: {
      const tone = stateTone("lead", "NEW");
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("inline-flex items-center gap-1 font-mono text-data", tickToneClass(tone))}>
              <TickGlyph tone={tone} />
              {stateWord("lead", "NEW", locale)}
            </span>
            <span className="font-mono text-micro tabular-nums text-tertiary">{specimen.inquiryAt}</span>
          </div>
          <p className="text-meta font-medium">{specimen.inquiryName}</p>
          <p className="text-meta leading-snug text-muted-foreground">{specimen.inquiryNeed}</p>
          <MonoTag>{growth.channels.ig_bio}</MonoTag>
        </div>
      );
    }
    default:
      return (
        <ol className="relative space-y-2.5 pl-1">
          {LEAD_PIPELINE.map((status) => {
            const tone = stateTone("lead", status);
            return (
              <li key={status} className={cn("flex items-center gap-2 font-mono text-data", tickToneClass(tone))}>
                <TickGlyph tone={tone} />
                <span>{stateWord("lead", status, locale)}</span>
              </li>
            );
          })}
        </ol>
      );
  }
}
