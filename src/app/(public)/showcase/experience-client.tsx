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
    : "申请体验";

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <NavBar />

      <DemoHero ctaPrimaryHref={ctaPrimaryHref} ctaPrimaryLabel={ctaPrimaryLabel} />

      <div id="workflow" className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3 text-xs leading-5 text-amber-200/90">
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

      <section
        id="book-demo"
        className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:px-10"
      >
        <div className="rounded-[2rem] border border-primary/25 bg-primary/[0.07] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            带上你的素材，让系统帮你跑一遍
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            告诉我们你的目标，我们用这套流程帮你把素材跑成可发布的初稿。
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            告诉我们你做的是什么、你已经有多少素材，我们会把你加入下一轮 demo 队列，
            按这个流程跑一遍真实输出。
          </p>
          {isAuthenticated ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/business/create-ad-video"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                创建广告视频 <ArrowRight size={14} />
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
      <nav className="flex items-center justify-between rounded-full border border-white/10 bg-white/3 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={34} />
          <div>
            <p className="text-sm font-semibold leading-none">Aivora</p>
            <p className="text-[11px] text-muted-foreground">
              AI 视频工作流 · 产品体验
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="#workflow"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            查看生成流程
          </a>
          <a
            href="#local-product-sample"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            观看样片
          </a>
          <a
            href="#book-demo"
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_0_35px_rgba(92,255,214,0.16)] transition hover:opacity-90"
          >
            申请体验
          </a>
        </div>
      </nav>
    </header>
  );
}
