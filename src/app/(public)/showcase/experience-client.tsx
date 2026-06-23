"use client";

import Link from "next/link";
import { ArrowRight, PawPrint } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { PetHero } from "@/components/demo/pet/pet-hero";
import { DeviceDashboard } from "@/components/demo/pet/device-dashboard";
import { ActivityTimeline } from "@/components/demo/pet/activity-timeline";
import { DetectedMoments } from "@/components/demo/pet/detected-moments";
import { CompanionMode } from "@/components/demo/pet/companion-mode";
import { AutoVideos } from "@/components/demo/pet/auto-videos";
import { ViralSharing } from "@/components/demo/pet/viral-sharing";
import { ProductProofReport } from "@/components/demo/pet/product-proof-report";
import { CommunityPreview } from "@/components/demo/pet/community-preview";
import { MarketOpportunity } from "@/components/demo/pet/market-opportunity";
import { PetInvestorHighlights } from "@/components/demo/pet/pet-investor-highlights";
import { BusinessModel } from "@/components/demo/pet/business-model";
import { TeamSection } from "@/components/demo/pet/team-section";
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
 * 全中文、暖色卡片风（.aivora-pet-demo 作用域换肤）。按 CEO brief 的产品闭环
 * 顺序拼装 8 大区块 + 投资亮点 + 体验申请 CTA。数据全部来自
 * src/lib/demo/pet-content-kit-demo-data.ts，改内容只改 data 不改结构。
 */
export function RealFootageDemoExperience({
  isAuthenticated,
}: ExperienceClientProps) {
  const ctaPrimaryHref = isAuthenticated ? "/business/create-ad-video" : "#book-demo";
  const ctaPrimaryLabel = isAuthenticated ? "进入创意工作室" : "申请套件体验";

  return (
    <main className="aivora-pet-demo min-h-screen overflow-hidden text-foreground">
      <NavBar />

      <PetHero ctaPrimaryHref={ctaPrimaryHref} ctaPrimaryLabel={ctaPrimaryLabel} />

      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="rounded-2xl border border-[var(--pet-orange)]/25 bg-[var(--pet-orange)]/8 px-4 py-3 text-xs leading-5 text-foreground/75">
          {SAMPLE_DATA_DISCLAIMER}
        </div>
      </div>

      <DeviceDashboard />
      <ActivityTimeline />
      <DetectedMoments />
      <CompanionMode />
      <AutoVideos />
      <ViralSharing />
      <ProductProofReport />
      <CommunityPreview />
      <MarketOpportunity />
      <PetInvestorHighlights />
      <BusinessModel />
      <TeamSection />

      <section
        id="book-demo"
        className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:px-10"
      >
        <div className="rounded-[2rem] border border-primary/25 bg-linear-to-br from-[var(--pet-orange)]/12 via-card to-card p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[color:var(--pet-orange)]">
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
          <PetWaitlistForm />
        </div>
      </section>

      <ComplianceFooter />
    </main>
  );
}

function NavBar() {
  return (
    <header className="mx-auto w-full max-w-7xl px-5 pt-6 sm:px-8 lg:px-10">
      <nav className="flex items-center justify-between gap-3 rounded-full border border-border bg-card/80 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={34} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none text-foreground">
              Aivora
            </p>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              宠物内容智能采集套件 · 投资人 Demo
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="#devices"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            设备
          </a>
          <a
            href="#auto-videos"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            自动生成
          </a>
          <a
            href="#market"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            市场
          </a>
          <a
            href="#investor"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            投资亮点
          </a>
          <a
            href="#business-model"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground lg:inline-flex"
          >
            商业模式
          </a>
          <a
            href="#team"
            className="hidden rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground xl:inline-flex"
          >
            团队
          </a>
          <a
            href="#book-demo"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <PawPrint size={13} /> 申请体验
          </a>
        </div>
      </nav>
    </header>
  );
}

function ComplianceFooter() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8 lg:px-10">
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <p className="text-xs font-semibold text-foreground">合规说明</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {COMPLIANCE_NOTES.map((note) => (
            <li
              key={note}
              className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground"
            >
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--pet-orange)]" />
              {note}
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
