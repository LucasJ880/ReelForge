"use client";

import Link from "next/link";
import { ArrowRight, PawPrint } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PetHero } from "@/components/demo/pet/pet-hero";
import { HardwareKit } from "@/components/demo/pet/hardware-kit";
import { DemoStory } from "@/components/demo/pet/demo-story";
import { DeviceDashboard } from "@/components/demo/pet/device-dashboard";
import { ActivityTimeline } from "@/components/demo/pet/activity-timeline";
import { DetectedMoments } from "@/components/demo/pet/detected-moments";
import { CompanionMode } from "@/components/demo/pet/companion-mode";
import { CollarPov } from "@/components/demo/pet/collar-pov";
import { AutoVideos } from "@/components/demo/pet/auto-videos";
import { BeforeAfter } from "@/components/demo/pet/before-after";
import { ViralSharing } from "@/components/demo/pet/viral-sharing";
import { BrandProofScenario } from "@/components/demo/pet/brand-proof-scenario";
import { ProductProofReport } from "@/components/demo/pet/product-proof-report";
import { CommunityPreview } from "@/components/demo/pet/community-preview";
import { BenchmarkComparison } from "@/components/demo/pet/benchmark-comparison";
import { WhyNow } from "@/components/demo/pet/why-now";
import { MarketOpportunity } from "@/components/demo/pet/market-opportunity";
import { GrowthFlywheel } from "@/components/demo/pet/growth-flywheel";
import { PetInvestorHighlights } from "@/components/demo/pet/pet-investor-highlights";
import { BusinessModel } from "@/components/demo/pet/business-model";
import { TeamSection } from "@/components/demo/pet/team-section";
import { DeckShell, type DeckSlideDef } from "@/components/demo/pet/deck-shell";
import {
  COMPLIANCE_NOTES,
  SAMPLE_DATA_DISCLAIMER,
} from "@/lib/demo/pet-content-kit-demo-data";
import { PetWaitlistForm } from "./pet-waitlist-form";

interface ExperienceClientProps {
  isAuthenticated: boolean;
}

/**
 * Aivora 宠物内容智能采集套件 —— 投资人 Demo 主体验页（/showcase）。
 *
 * 自 2026-06 起改造为「网页幻灯片」：原先 21 个纵向堆叠区块归并为 13 张
 * 整屏吸附幻灯片（见 DeckShell），用方向键 / 滚动 / 右侧圆点逐页浏览，
 * 像翻 PPT 一样轻松，避免「一股脑往下滑太长」。
 *
 * 内容仍来自 src/lib/demo/pet-content-kit-demo-data.ts，改文案只改 data；
 * 调整章节分组只改下面的 slides 数组，不动各区块组件本身。
 */
export function RealFootageDemoExperience({
  isAuthenticated,
}: ExperienceClientProps) {
  const slides: DeckSlideDef[] = [
    {
      id: "cover",
      label: "封面",
      node: (
        <>
          <PetHero
            ctaPrimaryHref={
              isAuthenticated ? "/business/create-ad-video" : "#book-demo"
            }
            ctaPrimaryLabel={isAuthenticated ? "进入创意工作室" : "申请套件体验"}
          />
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
            <div className="rounded-(--radius-lg) border border-primary/25 bg-accent-soft px-4 py-3 text-meta leading-5 text-foreground">
              {SAMPLE_DATA_DISCLAIMER}
            </div>
          </div>
        </>
      ),
    },
    { id: "why-now", label: "为什么是现在", node: <WhyNow /> },
    { id: "hardware-kit", label: "硬件套装", node: <HardwareKit /> },
    {
      id: "capture",
      label: "采集闭环",
      node: (
        <>
          <DemoStory />
          <DeviceDashboard />
          <ActivityTimeline />
        </>
      ),
    },
    {
      id: "ai-moments",
      label: "AI 看懂宠物",
      node: (
        <>
          <DetectedMoments />
          <CollarPov />
          <CompanionMode />
        </>
      ),
    },
    {
      id: "auto-videos",
      label: "自动出片",
      node: (
        <>
          <AutoVideos />
          <BeforeAfter />
        </>
      ),
    },
    {
      id: "growth",
      label: "病毒增长",
      node: (
        <>
          <ViralSharing />
          <GrowthFlywheel />
          <CommunityPreview />
        </>
      ),
    },
    {
      id: "b2b-proof",
      label: "B2B 证据",
      node: (
        <>
          <BrandProofScenario />
          <ProductProofReport />
        </>
      ),
    },
    { id: "benchmark", label: "竞争壁垒", node: <BenchmarkComparison /> },
    { id: "market", label: "市场机会", node: <MarketOpportunity /> },
    { id: "business-model", label: "商业模式", node: <BusinessModel /> },
    {
      id: "investor",
      label: "投资 & 团队",
      node: (
        <>
          <PetInvestorHighlights />
          <TeamSection />
        </>
      ),
    },
    {
      id: "book-demo",
      label: "申请体验",
      node: <BookDemoSlide isAuthenticated={isAuthenticated} />,
    },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <DeckShell
        slides={slides}
        brand={<BrandMark />}
        cta={
          isAuthenticated ? (
            <Link
              href="/business/create-ad-video"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-(--radius-md) border border-primary bg-primary px-3 text-meta font-semibold text-primary-foreground"
            >
              <PawPrint size={13} /> 进入工作室
            </Link>
          ) : (
            <a
              href="#book-demo"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-(--radius-md) border border-primary bg-primary px-3 text-meta font-semibold text-primary-foreground"
            >
              <PawPrint size={13} /> 申请体验
            </a>
          )
        }
      />
    </main>
  );
}

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Logo size={30} />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-none text-foreground">
          Aivora
        </p>
        <p className="hidden text-meta leading-tight text-muted-foreground sm:block">
          宠物内容智能采集套件 · 投资人 Demo
        </p>
      </div>
    </Link>
  );
}

function BookDemoSlide({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section
      id="book-demo"
      className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-10"
    >
      <div className="rounded-(--radius-lg) border border-primary/25 bg-card p-5 shadow-editorial sm:p-8">
        <p className="text-meta font-semibold uppercase tracking-widest text-primary">
          投资人 / 宠物品牌 / 战略合作
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          想看 Aivora 跑你家宠物或你的品牌？
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          留下联系方式，我们会安排创始人 1:1 深度演示：用真实宠物素材跑一遍完整闭环，
          并给出内容、增长与商业化建议。投资人、宠物品牌、宠物店与代运营机构优先安排。
        </p>
        {isAuthenticated ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/business/create-ad-video"
              className="inline-flex min-h-11 items-center gap-2 rounded-(--radius-md) bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
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
        <PetWaitlistForm />
      </div>

      <div className="mt-6 rounded-(--radius-lg) border border-border bg-card p-5 shadow-editorial">
        <p className="text-meta font-semibold text-foreground">合规说明</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {COMPLIANCE_NOTES.map((note) => (
            <li
              key={note}
              className="flex items-start gap-2 text-meta leading-5 text-muted-foreground"
            >
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {note}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
