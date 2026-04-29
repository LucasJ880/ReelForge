import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Film,
  LineChart,
  Play,
  Sparkles,
  Upload,
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
                    Exported sample MP4
                  </p>
                  <p className="text-sm font-medium">9:16 real-footage result</p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
                  Rendered
                </span>
              </div>
              <div className="bg-black">
                <video
                  className="mx-auto aspect-9/16 max-h-[680px] w-full object-contain"
                  controls
                  playsInline
                  preload="metadata"
                  poster={DEMO_SEED_VIDEO_THUMBNAIL || undefined}
                  src={DEMO_SEED_VIDEO_URL}
                />
              </div>
              <div className="grid gap-3 border-t border-white/10 p-4 text-xs text-muted-foreground sm:grid-cols-3">
                <span>FFmpeg export</span>
                <span>31s vertical MP4</span>
                <span>Demo-ready sample</span>
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

      <section
        id="case-study"
        className="mx-auto grid max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10"
      >
        <div className="surface-panel rounded-[2rem] p-6">
          <SectionEyebrow>Case study</SectionEyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            3 raw clips became a measurable creative loop.
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Demo 输入是 3 条真实宠物店素材。Aivora 将它们索引成 24 个
            FootageShot，生成 5 条 AdEditPlan，完成 5 次 AI review，并导出
            1 条 9:16 MP4 用于客户演示。
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <ProofStat value="3" label="raw real-footage clips" />
            <ProofStat value="24" label="FootageShot records" />
            <ProofStat value="5" label="AdEditPlans + reviews" />
            <ProofStat value="1" label="exported 9:16 MP4" />
          </div>
        </div>

        <div className="grid gap-4">
          <div className="surface-panel rounded-[2rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <SectionEyebrow>AI review scorecard</SectionEyebrow>
                <h3 className="mt-3 text-2xl font-semibold">
                  Scoring dimensions customers can understand.
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

function ProofStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/4 p-4">
      <p className="text-3xl font-semibold text-primary">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{label}</p>
    </div>
  );
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
