"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AIScriptSection } from "@/components/demo/ai-script-section";
import { AssetQAMockSection } from "@/components/demo/asset-qa-mock-section";
import { ComplianceNote } from "@/components/demo/compliance-note";
import { CreativeEvidenceCardsSection } from "@/components/demo/creative-evidence-cards-section";
import { DemoHero } from "@/components/demo/demo-hero";
import { DemoInputPanel } from "@/components/demo/demo-input-panel";
import { FinalOutputSection } from "@/components/demo/final-output-section";
import { InvestorHighlightsSection } from "@/components/demo/investor-highlights-section";
import { LocalProductSampleSection } from "@/components/demo/local-product-sample-section";
import { ReferencePreviewSection } from "@/components/demo/reference-preview-section";
import { StoryboardGrid } from "@/components/demo/storyboard-grid";
import {
  SAMPLE_DATA_DISCLAIMER,
  SELECTED_CARD_DEFAULT_SLUG,
  type CreativeEvidenceCardSlug,
} from "@/lib/demo/ai-video-workflow-demo-data";
import { RealFootageWaitlistForm } from "./waitlist-form";

interface ExperienceClientProps {
  isAuthenticated: boolean;
}

export function RealFootageDemoExperience({
  isAuthenticated,
}: ExperienceClientProps) {
  const [selectedSlug, setSelectedSlug] = useState<CreativeEvidenceCardSlug>(
    SELECTED_CARD_DEFAULT_SLUG,
  );

  const ctaPrimaryHref = isAuthenticated ? "/business/create-ad-video" : "#book-demo";
  const ctaPrimaryLabel = isAuthenticated
    ? "去试一遍真实流程"
    : "申请深度演示";

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <NavBar />

      <DemoHero ctaPrimaryHref={ctaPrimaryHref} ctaPrimaryLabel={ctaPrimaryLabel} />

      <div id="workflow" className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-200/90">
          {SAMPLE_DATA_DISCLAIMER}
        </div>
      </div>

      <DemoInputPanel />

      <CreativeEvidenceCardsSection
        selectedSlug={selectedSlug}
        onSelect={setSelectedSlug}
      />

      <ReferencePreviewSection selectedSlug={selectedSlug} />

      <AIScriptSection selectedSlug={selectedSlug} />

      <StoryboardGrid />

      <AssetQAMockSection />

      <FinalOutputSection />

      <LocalProductSampleSection />

      <InvestorHighlightsSection />

      <section
        id="book-demo"
        className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:px-10"
      >
        <div className="rounded-[2rem] border border-primary/25 bg-linear-to-br from-primary/10 via-card/40 to-card/60 p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            投资人 / 孵化器 / 战略合作
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            想看 Aivora 跑你那条赛道的客户？
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            留下品牌或基金信息，我们会安排创始人 1:1 深度演示：
            用你的真实素材跑一遍完整工作流，并给出投放与产品差异化建议。
            北美华人创业项目、加拿大本地中小品牌、孵化器项目优先安排档期。
          </p>
          {isAuthenticated ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/business/create-ad-video"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                直接进入创意工作室 <ArrowRight size={14} />
              </Link>
              <a
                href="#book-demo"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                或者在下方表单里留个联系方式。
              </a>
            </div>
          ) : null}
          <RealFootageWaitlistForm />
        </div>
      </section>

      <ComplianceNote />
    </main>
  );
}

function NavBar() {
  return (
    <header className="mx-auto w-full max-w-7xl px-5 pt-6 sm:px-8 lg:px-10">
      <nav className="flex items-center justify-between gap-3 rounded-full border border-white/10 bg-white/3 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={34} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">Aivora</p>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              AI 视频工作流 · 投资人版本案例展示
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="#workflow"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            完整工作流
          </a>
          <a
            href="#final-output"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            播放成片
          </a>
          <a
            href="#investor"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            投资亮点
          </a>
          <LocaleToggle />
          <a
            href="#book-demo"
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_0_35px_rgba(92,255,214,0.16)] transition hover:opacity-90"
          >
            申请演示
          </a>
        </div>
      </nav>
    </header>
  );
}

/**
 * 语言切换器（当前阶段：默认中文，英文版下一阶段上线）。
 *
 * 设计思路：本页所有客户案例、脚本、分镜都使用中文叙事，给中国投资人 / 孵化器
 * 看；英文版需要把案例文案全量翻译并保证术语一致性，作为下一阶段独立交付。
 * 在 NavBar 上保留可见但不可点的 EN 占位，是为了让投资人知道国际化在路线图里，
 * 而不是假装一个会让切换出 bug 的功能。
 */
function LocaleToggle() {
  return (
    <div
      className="hidden items-center gap-0.5 rounded-full border border-white/10 bg-white/3 p-0.5 text-[11px] font-semibold sm:inline-flex"
      role="group"
      aria-label="界面语言"
    >
      <span
        className="rounded-full bg-primary/15 px-2.5 py-1 text-primary"
        aria-current="true"
      >
        中文
      </span>
      <span
        className="cursor-not-allowed rounded-full px-2.5 py-1 text-muted-foreground/60"
        title="英文版即将上线"
        aria-disabled="true"
      >
        EN
      </span>
    </div>
  );
}
