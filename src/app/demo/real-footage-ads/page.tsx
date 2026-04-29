import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Film,
  Gauge,
  LineChart,
  Play,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import {
  DEMO_SEED_VIDEO_THUMBNAIL,
  DEMO_SEED_VIDEO_URL,
} from "@/lib/data/demo-seed";
import { RealFootageWaitlistForm } from "@/app/demo/real-footage-ads/waitlist-form";

export const metadata: Metadata = {
  title: "Aivora Real-Footage Ads Demo",
  description:
    "Aivora turns messy real product footage into 5 testable short-form ads, then learns from performance data to generate the next round.",
};

const storySteps = [
  {
    icon: Upload,
    label: "Raw footage upload",
    detail: "客户上传门店、商品、UGC 或生产现场的真实素材。",
  },
  {
    icon: Film,
    label: "Shot index",
    detail: "系统把素材切成可复用镜头，标注画面、节奏、用途和质量。",
  },
  {
    icon: Clapperboard,
    label: "5 ad plans",
    detail: "围绕不同 hook 与卖点生成 5 条可测试剪辑计划。",
  },
  {
    icon: CheckCircle2,
    label: "AI review",
    detail: "Reviewer 按 hook、清晰度、素材匹配、节奏和技术质量打分。",
  },
  {
    icon: Play,
    label: "Rendered MP4",
    detail: "FFmpeg 导出 9:16 MP4，进入人工确认或客户演示。",
  },
  {
    icon: LineChart,
    label: "Metrics loop",
    detail: "导入播放、留存、互动等指标，蒸馏下一轮创意建议。",
  },
] as const;

const scoringDimensions = [
  ["Hook", "开头 3 秒是否清楚、真实、有停留理由", "8.6"],
  ["Clarity", "用户是否能快速理解业务、商品与 CTA", "8.1"],
  ["Footage match", "剪辑计划是否充分使用真实可用镜头", "8.8"],
  ["Pacing", "镜头时长、转场和信息密度是否适合短视频", "7.9"],
  ["Technical quality", "画幅、音量、可读性、渲染稳定性", "8.3"],
] as const;

const aiReviewerOutput = {
  overallScore: "8.3",
  strengths: [
    "真实门店开场先建立可信度，不像纯生成广告。",
    "宠物反应和货架镜头能自然连接本地养宠人群。",
    "5 条计划覆盖不同 hook，适合第一轮快速测试。",
  ],
  improvements: [
    "下一轮补一段店主或顾客口播，增强信任与转化。",
    "将 CTA 再压短，避免最后 4 秒信息过密。",
    "为高分计划补充更近距离的商品和服务细节镜头。",
  ],
} as const;

type TimelineClip = {
  time: string;
  clip: string;
  thumbnail?: string;
  overlay: string;
};

type CustomerAdPlan = {
  angleName: string;
  hook: string;
  targetAudience: string;
  coreMessage: string;
  cta: string;
  aiScore: string;
  renderStatus: "Rendered" | "Ready to render" | "Needs footage";
  timeline: TimelineClip[];
};

const customerAdPlans: CustomerAdPlan[] = [
  {
    angleName: "Pet reaction hook",
    hook: "你家毛孩子进店第一眼会被什么吸引？",
    targetAudience: "附近 3-5 公里养宠家庭、年轻白领",
    coreMessage: "用真实宠物反应带出门店氛围、商品丰富度和可信服务。",
    cta: "周末带它来店里逛一圈。",
    aiScore: "8.7",
    renderStatus: "Rendered",
    timeline: [
      {
        time: "0-3s",
        clip: "真实门店入口",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "真实宠物店，不是模板广告",
      },
      {
        time: "3-11s",
        clip: "宠物靠近货架",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "毛孩子先替你试逛",
      },
      {
        time: "11-24s",
        clip: "商品与护理服务",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "零食、玩具、护理一次看清",
      },
      {
        time: "24-31s",
        clip: "温暖收尾",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "附近养宠家庭周末可到店",
      },
    ],
  },
  {
    angleName: "Local trust proof",
    hook: "附近这家宠物店，为什么老客愿意反复来？",
    targetAudience: "重视距离、服务和稳定体验的本地养宠用户",
    coreMessage: "真实空间、整洁陈列和服务细节证明门店值得第一次到访。",
    cta: "保存地址，下次遛弯顺路来。",
    aiScore: "8.4",
    renderStatus: "Ready to render",
    timeline: [
      {
        time: "0-4s",
        clip: "真实外观与进店",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "就在附近，真实可到店",
      },
      {
        time: "4-13s",
        clip: "店内环境扫过",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "干净、明亮、好逛",
      },
      {
        time: "13-23s",
        clip: "商品货架细节",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "常用好物一站补齐",
      },
      {
        time: "23-31s",
        clip: "宠物互动收尾",
        overlay: "第一次来，也不陌生",
      },
    ],
  },
  {
    angleName: "One-stop care",
    hook: "洗护、零食、玩具，不用跑三家。",
    targetAudience: "时间有限、希望省心的一站式养宠家庭",
    coreMessage: "把门店从“卖货”升级为省心的本地宠物生活解决方案。",
    cta: "把本周养宠清单交给我们。",
    aiScore: "8.1",
    renderStatus: "Ready to render",
    timeline: [
      {
        time: "0-3s",
        clip: "用户清单式开场",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "本周养宠要买什么？",
      },
      {
        time: "3-12s",
        clip: "护理用品与服务",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "护理用品先备齐",
      },
      {
        time: "12-22s",
        clip: "零食玩具陈列",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "奖励和玩具也一起带走",
      },
      {
        time: "22-31s",
        clip: "门店整体氛围",
        overlay: "一次到店，省下三次搜索",
      },
    ],
  },
  {
    angleName: "Giftable pet moment",
    hook: "给毛孩子的小礼物，也可以很有仪式感。",
    targetAudience: "愿意为宠物消费、喜欢记录生活的年轻用户",
    coreMessage: "用礼物感和情绪价值推动零食、玩具、用品组合销售。",
    cta: "来挑一份它会喜欢的小礼物。",
    aiScore: "7.9",
    renderStatus: "Needs footage",
    timeline: [
      {
        time: "0-4s",
        clip: "宠物可爱反应",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "它开心的样子很值得",
      },
      {
        time: "4-14s",
        clip: "礼物式商品组合",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "零食 + 玩具 + 小用品",
      },
      {
        time: "14-24s",
        clip: "近景包装与拿取",
        overlay: "建议补拍手拿商品近景",
      },
      {
        time: "24-31s",
        clip: "宠物互动结尾",
        overlay: "今天给它一个小惊喜",
      },
    ],
  },
  {
    angleName: "Weekend store visit",
    hook: "周末不知道带它去哪？先来宠物店逛 20 分钟。",
    targetAudience: "周末会带宠物出门、喜欢本地生活内容的人群",
    coreMessage: "把到店体验包装成轻松的周末本地生活选择。",
    cta: "收藏这条，周末来逛。",
    aiScore: "8.2",
    renderStatus: "Ready to render",
    timeline: [
      {
        time: "0-3s",
        clip: "周末问题开场",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "周末带它去哪？",
      },
      {
        time: "3-10s",
        clip: "进店与空间",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "20 分钟轻松逛完",
      },
      {
        time: "10-23s",
        clip: "货架与宠物互动",
        thumbnail: DEMO_SEED_VIDEO_THUMBNAIL,
        overlay: "它看玩具，你挑用品",
      },
      {
        time: "23-31s",
        clip: "地址/行动收尾",
        overlay: "附近养宠家庭可收藏",
      },
    ],
  },
];

const proofDashboard = [
  ["Waitlist leads", "12", "来自公开 demo 表单与手动导入线索"],
  ["Real-footage demo runs", "4", "已完成或可复现的真实素材演示轮次"],
  ["Videos rendered", "6", "已导出的竖屏 MP4 样片"],
  ["Willing to upload footage", "5", "明确愿意提供真实素材试跑的客户"],
  ["Pricing-positive conversations", "3", "表达预算、付费意愿或采购路径的对话"],
] as const;

const valueComparison = [
  {
    old: "人工先看素材、手写脚本、剪 1-2 条版本，再等客户反馈。",
    new: "上传素材后快速生成 5 个测试方向，先验证 hook 和素材组合。",
  },
  {
    old: "每轮改片依赖剪辑师时间，复盘常停留在主观偏好。",
    new: "每条广告带分数、指标和复盘，下一轮建议可重复生成。",
  },
  {
    old: "小商家或代理商很难持续低成本测试多版本短视频。",
    new: "把真实素材变成可规模化的创意测试资产，降低首轮剪辑成本。",
  },
] as const;

const roadmap = [
  {
    phase: "MVP Now",
    points: [
      "真实素材上传与镜头索引",
      "5 条 AdEditPlan 生成",
      "AI Reviewer 打分",
      "FFmpeg 9:16 MP4 导出",
      "CSV metrics import 与下一轮建议",
    ],
  },
  {
    phase: "V1.5",
    points: [
      "更稳定的素材库管理",
      "客户审核链接与批注",
      "广告账户/达人发布交接清单",
      "多行业 demo 模板",
    ],
  },
  {
    phase: "V2",
    points: [
      "自动发布与平台数据回流",
      "创意胜率模型",
      "团队/代理商工作流",
      "生产级渲染 worker 与队列",
    ],
  },
] as const;

const limitations = [
  "MVP 暂未自动发布 TikTok，当前以人工发布或演示链接为主。",
  "指标回流先使用 CSV 导入，平台 API 自动同步留到后续版本。",
  "Director/Reviewer 可在 demo mode 使用 mock，保证现场演示稳定。",
  "生产规模渲染需要 worker/队列部署；当前 demo 环境用于验证闭环。",
] as const;

export default function RealFootageAdsDemoPage() {
  const walkthroughVideoUrl = process.env.DEMO_WALKTHROUGH_VIDEO_URL?.trim();
  const hasWalkthroughVideo = Boolean(walkthroughVideoUrl);
  const heroVideoUrl = walkthroughVideoUrl || DEMO_SEED_VIDEO_URL;
  const heroVideoLabel = hasWalkthroughVideo
    ? "60-second product walkthrough"
    : "Exported sample MP4";
  const heroVideoDescription = hasWalkthroughVideo
    ? "16:9 customer/investor overview"
    : "9:16 real-footage result";

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 ambient-glow" />
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-16 px-5 py-6 sm:px-8 lg:px-10">
        <nav className="flex items-center justify-between rounded-full border border-white/10 bg-white/3 px-4 py-3 backdrop-blur">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={34} />
            <div>
              <p className="text-sm font-semibold leading-none">Aivora</p>
              <p className="text-[11px] text-muted-foreground">
                Real-footage ad agent
              </p>
            </div>
          </Link>
          <a
            href="#book-demo"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_35px_rgba(92,255,214,0.16)] transition hover:opacity-90"
          >
            Book demo
          </a>
        </nav>

        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles size={14} />
              Investor/customer demo ready
            </div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Turn messy real footage into 5 testable short-form ads.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Aivora turns messy real product footage into 5 testable
              short-form ads, then learns from performance data to generate the
              next round.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#case-study"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                View the proof loop <ArrowRight size={16} />
              </a>
              <a
                href="#book-demo"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
              >
                Join waitlist
              </a>
            </div>
            <div className="mt-8 grid max-w-2xl grid-cols-3 gap-3">
              <MetricPill label="Raw clips" value="3" />
              <MetricPill label="Indexed shots" value="24" />
              <MetricPill label="Ad plans" value="5" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-primary/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-card shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    {heroVideoLabel}
                  </p>
                  <p className="text-sm font-medium">{heroVideoDescription}</p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                  {hasWalkthroughVideo ? "Walkthrough" : "Rendered"}
                </span>
              </div>
              <div className="bg-black">
                <video
                  className={`mx-auto w-full object-contain ${
                    hasWalkthroughVideo
                      ? "aspect-video max-h-[620px]"
                      : "aspect-9/16 max-h-[680px]"
                  }`}
                  autoPlay
                  controls
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  poster={DEMO_SEED_VIDEO_THUMBNAIL || undefined}
                  src={heroVideoUrl}
                />
              </div>
              <div className="grid gap-3 border-t border-white/10 p-4 text-xs text-muted-foreground sm:grid-cols-3">
                <span>
                  {hasWalkthroughVideo ? "Product walkthrough" : "FFmpeg export"}
                </span>
                <span>
                  {hasWalkthroughVideo ? "60s landscape MP4" : "31s vertical MP4"}
                </span>
                <span>
                  {hasWalkthroughVideo
                    ? "Autoplay muted + controls"
                    : "Demo-ready sample"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
        <SectionEyebrow>Product story</SectionEyebrow>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {storySteps.map((step, index) => (
            <div
              key={step.label}
              className="surface-panel rounded-3xl p-5 transition hover:bg-white/3"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <step.icon size={20} />
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h3 className="text-lg font-semibold">{step.label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <SectionEyebrow>Customer ad results</SectionEyebrow>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight">
              5 generated ad plans customers can evaluate without reading JSON.
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            Each plan explains the creative angle, audience, message, CTA,
            score, render state, and read-only clip timeline for a buyer or
            store owner.
          </p>
        </div>
        <div className="mt-7 grid gap-4 xl:grid-cols-2">
          {customerAdPlans.map((plan) => (
            <AdPlanCard key={plan.angleName} plan={plan} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="surface-panel rounded-[2rem] p-6">
            <SectionEyebrow>AI reviewer output</SectionEyebrow>
            <div className="mt-5 flex items-end gap-4">
              <p className="text-6xl font-semibold text-primary">
                {aiReviewerOutput.overallScore}
              </p>
              <div className="pb-2">
                <p className="font-medium">Overall score</p>
                <p className="text-sm text-muted-foreground">
                  Plain-language review for customer decisions.
                </p>
              </div>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              <ReviewerList
                title="Strengths"
                items={aiReviewerOutput.strengths}
              />
              <ReviewerList
                title="Improvement suggestions"
                items={aiReviewerOutput.improvements}
              />
            </div>
          </div>

          <div className="surface-panel rounded-[2rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <SectionEyebrow>Scoring dimensions</SectionEyebrow>
                <h3 className="mt-3 text-2xl font-semibold">
                  Why the reviewer scored it this way.
                </h3>
              </div>
              <BarChart3 className="hidden text-primary sm:block" size={36} />
            </div>
            <div className="mt-5 space-y-3">
              {scoringDimensions.map(([label, detail, score]) => (
                <ScoreRow
                  key={label}
                  label={label}
                  detail={detail}
                  score={score}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="case-study"
        className="mx-auto grid max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10"
      >
        <div className="surface-panel rounded-[2rem] p-6">
          <SectionEyebrow>Before / after case study</SectionEyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            3 raw clips became a measurable creative loop.
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Demo 输入是 3 条真实宠物店素材。Aivora 将它们变成 5 条可测试广告计划、
            1 条可播放 MP4 和下一轮创意建议，重点展示“真实素材到创意学习循环”，
            不是通用 AI 视频模板。
          </p>
          <div className="mt-6 grid gap-3">
            <CaseStudyRow
              label="Raw footage input"
              value="3 clips: storefront, shelves, pet interaction. 24 indexed shots after preprocessing."
            />
            <CaseStudyRow
              label="Generated ad output"
              value="5 customer-readable ad plans with hook, audience, CTA, score, and clip timeline."
            />
            <CaseStudyRow
              label="Metrics recap"
              value="Demo import tracks views, 3s retention, completion rate, saves, shares, and comments."
            />
            <CaseStudyRow
              label="Next-round suggestion"
              value="Keep the pet reaction hook, add owner testimonial footage, and test a shorter CTA."
            />
          </div>
        </div>

        <div className="grid gap-4">
          <div className="overflow-hidden rounded-[2rem] border border-white/12 bg-card">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Rendered MP4
                </p>
                <p className="text-sm font-medium">
                  Pet-store proof sample, 31s vertical
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                Rendered
              </span>
            </div>
            <div className="bg-black">
              <video
                className="mx-auto aspect-9/16 max-h-[620px] w-full object-contain"
                controls
                playsInline
                preload="metadata"
                poster={DEMO_SEED_VIDEO_THUMBNAIL || undefined}
                src={DEMO_SEED_VIDEO_URL}
              />
            </div>
          </div>

          <div className="surface-panel rounded-[2rem] p-6">
            <SectionEyebrow>Learning loop</SectionEyebrow>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <LoopCard
                title="Metrics recap"
                body="24h CSV import: views, 3s retention, completion rate, saves, shares."
              />
              <LoopCard
                title="Distillation"
                body="Winner pattern: pet reaction hook + shelf proof + nearby CTA."
              />
              <LoopCard
                title="Next-round suggestion"
                body="Keep the pet reaction open, add owner testimonial footage, test shorter CTA."
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
        <div className="rounded-[2rem] border border-primary/25 bg-primary/8 p-6">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <SectionEyebrow>Proof dashboard</SectionEyebrow>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                Traction signals beyond the technical demo.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-muted-foreground">
              Lightweight manual dashboard for investor/customer proof while
              the team is still validating trials, upload willingness, and
              pricing signals.
            </p>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {proofDashboard.map(([label, value, detail]) => (
              <ProofSignal key={label} label={label} value={value} detail={detail} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionEyebrow>Customer value</SectionEyebrow>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              Faster creative testing without pretending the MVP has campaign
              lift data yet.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              The immediate value is operational: reduce first-round editing
              time, turn every upload into multiple testable variants, and make
              iteration repeatable from metrics instead of opinion.
            </p>
          </div>
          <div className="grid gap-3">
            {valueComparison.map((row) => (
              <div
                key={row.old}
                className="grid gap-3 rounded-3xl border border-white/10 bg-card/70 p-4 md:grid-cols-2"
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    Traditional manual editing
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {row.old}
                  </p>
                </div>
                <div className="rounded-2xl bg-primary/10 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
                    Aivora workflow
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {row.new}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-3 lg:px-10">
        {roadmap.map((item) => (
          <div key={item.phase} className="surface-panel rounded-[2rem] p-6">
            <h3 className="text-2xl font-semibold">{item.phase}</h3>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              {item.points.map((point) => (
                <li key={point} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 text-primary" size={16} />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[1fr_1fr] lg:px-10">
        <div className="surface-panel rounded-[2rem] p-6">
          <SectionEyebrow>MVP limitations</SectionEyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            Clear boundaries for customer and investor demos.
          </h2>
          <ul className="mt-6 space-y-3 text-sm leading-6 text-muted-foreground">
            {limitations.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div
          id="book-demo"
          className="rounded-[2rem] border border-primary/25 bg-primary/8 p-6"
        >
          <SectionEyebrow>Book demo / waitlist</SectionEyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            Bring your own messy footage.
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Tell us what you sell and how much video you make each month. We
            will use this to qualify the next demo cohort.
          </p>
          <RealFootageWaitlistForm />
        </div>
      </section>
    </main>
  );
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
      {children}
    </p>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/3 p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AdPlanCard({ plan }: { plan: CustomerAdPlan }) {
  return (
    <article className="surface-panel rounded-[2rem] p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            {plan.angleName}
          </p>
          <h3 className="mt-3 text-xl font-semibold leading-7">{plan.hook}</h3>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-white/[0.035] px-3 py-2">
          <Gauge size={16} className="text-primary" />
          <span className="font-mono text-lg text-primary">{plan.aiScore}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <PlanFact
          icon={<Users size={16} />}
          label="Target audience"
          value={plan.targetAudience}
        />
        <PlanFact label="Core message" value={plan.coreMessage} />
        <PlanFact label="CTA" value={plan.cta} />
        <PlanFact
          label="Render status"
          value={plan.renderStatus}
          tone={getRenderStatusTone(plan.renderStatus)}
        />
      </div>

      <div className="mt-5 rounded-3xl border border-white/10 bg-black/15 p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Clock3 size={16} className="text-primary" />
          Read-only timeline preview
        </div>
        <div className="space-y-3">
          {plan.timeline.map((clip) => (
            <TimelineClipRow key={`${plan.angleName}-${clip.time}`} clip={clip} />
          ))}
        </div>
      </div>
    </article>
  );
}

function PlanFact({
  icon,
  label,
  value,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  tone?: "success" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-300"
        : "text-foreground";

  return (
    <div className="rounded-2xl bg-white/[0.035] p-4">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`mt-2 text-sm leading-6 ${toneClass}`}>{value}</p>
    </div>
  );
}

function TimelineClipRow({ clip }: { clip: TimelineClip }) {
  return (
    <div className="grid gap-3 rounded-2xl bg-white/[0.035] p-3 sm:grid-cols-[76px_1fr]">
      <div
        className="flex h-24 items-end overflow-hidden rounded-xl bg-white/8 bg-cover bg-center p-2"
        style={
          clip.thumbnail ? { backgroundImage: `url(${clip.thumbnail})` } : undefined
        }
        aria-label={clip.thumbnail ? `${clip.clip} thumbnail` : undefined}
      >
        {!clip.thumbnail ? (
          <Film size={18} className="text-muted-foreground" />
        ) : null}
      </div>
      <div>
        <p className="font-mono text-xs text-primary">{clip.time}</p>
        <p className="mt-1 text-sm font-medium">{clip.clip}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {clip.overlay}
        </p>
      </div>
    </div>
  );
}

function ReviewerList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="rounded-3xl bg-white/[0.035] p-4">
      <p className="font-medium">{title}</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={16} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CaseStudyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.035] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{value}</p>
    </div>
  );
}

function ProofSignal({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl bg-background/45 p-4">
      <p className="text-3xl font-semibold text-primary">{value}</p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function getRenderStatusTone(
  status: CustomerAdPlan["renderStatus"],
): "success" | "warning" | "neutral" {
  if (status === "Rendered") {
    return "success";
  }

  if (status === "Needs footage") {
    return "warning";
  }

  return "neutral";
}

function ScoreRow({
  label,
  detail,
  score,
}: {
  label: string;
  detail: string;
  score: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="font-mono text-lg text-primary">{score}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Number(score) * 10}%` }}
        />
      </div>
    </div>
  );
}

function LoopCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.035] p-4">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
