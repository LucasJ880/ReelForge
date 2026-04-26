"use client";

import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  Radio,
  Sparkles,
  TrendingUp,
  WandSparkles,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

type Tone = "premium" | "friendly" | "expert" | "bold";

interface AnalysisResult {
  source: "apify+llm" | "llm-only" | "mock";
  reference: {
    url: string;
    author?: string;
    caption: string;
    hashtags: string[];
    music?: string;
    durationSec?: number;
    metrics: {
      plays: number;
      likes: number;
      comments: number;
      shares: number;
      engagementRate: number;
    };
    coverUrl?: string;
    downloadUrl?: string;
  };
  intelligence: {
    viralFormula: string;
    hook: string;
    retentionMechanics: string[];
    visualPattern: string[];
    audienceTriggers: string[];
    commentSignals: string[];
    riskNotes: string[];
  };
  clientVersion: {
    positioning: string;
    title: string;
    digitalHumanScript: string;
    scenePlan: {
      time: string;
      visual: string;
      narration: string;
      overlay: string;
    }[];
    captions: string[];
    brollPrompts: string[];
    cta: string;
  };
  providerPlan: {
    digitalHuman: "mock" | "heygen-ready";
    seedance: string[];
    nextKeys: string[];
  };
}

const DEFAULT_RESULT: AnalysisResult = {
  source: "mock",
  reference: {
    url: "https://www.tiktok.com/@reference/video/0000000000000000000",
    author: "reference.creator",
    caption:
      "POV: you found a smarter way to turn one client story into a full video campaign.",
    hashtags: ["aivideo", "digitalhuman", "clientgrowth"],
    music: "Original sound",
    durationSec: 28,
    metrics: {
      plays: 1240000,
      likes: 86400,
      comments: 2300,
      shares: 9800,
      engagementRate: 7.94,
    },
  },
  intelligence: {
    viralFormula:
      "用一个强情境开场制造代入感，再用快速反差和具体结果让观众愿意停留。",
    hook: "先抛出客户正在经历的痛点，再马上展示一个更轻松的解决方式。",
    retentionMechanics: [
      "3 秒内给出明确冲突",
      "每 4-5 秒切一次信息点",
      "用评论区疑问做转场",
    ],
    visualPattern: ["真实场景开头", "数字人叠加讲解", "关键字幕卡", "品牌化 CTA"],
    audienceTriggers: ["节省时间", "提高可信度", "减少真人反复出镜"],
    commentSignals: ["观众会追问具体做法", "真实案例更容易建立信任"],
    riskNotes: ["不要直接复制原脚本", "数字人必须保持专业可信"],
  },
  clientVersion: {
    positioning: "服务型客户的高信任 AI 视频获客样片",
    title: "把一次拍摄变成一套持续获客的视频资产",
    digitalHumanScript:
      "如果你的客户正在比较不同方案，第一眼看到的内容就决定了他们是否愿意继续了解。Aivora 会先分析一条已经验证过的爆款视频结构，再把它改写成适合客户业务的数字人讲解。",
    scenePlan: [
      {
        time: "0-3s",
        visual: "真实业务场景快速出现",
        narration: "客户为什么会停下来，往往发生在前三秒。",
        overlay: "3 秒决定是否继续看",
      },
      {
        time: "4-12s",
        visual: "客户数字人出现在画面侧边",
        narration: "我们不是复制爆款，而是拆解它背后的成交逻辑。",
        overlay: "Hook / Trust / CTA",
      },
      {
        time: "13-24s",
        visual: "服务流程和成果 B-roll",
        narration: "再把这套逻辑重建成适合客户自己的视频资产。",
        overlay: "一套素材，多条视频",
      },
    ],
    captions: [
      "不是复制爆款，是复制增长结构",
      "真实素材 + 数字人 + AI 脚本",
      "客户不用反复出镜",
      "一套素材生成多条内容",
    ],
    brollPrompts: [
      "高端服务顾问在现代办公室与客户沟通，竖屏，真实商业纪录片风格",
      "手机上播放专业短视频数据看板，柔和霓虹光，浅景深",
    ],
    cta: "把你喜欢的爆款链接发给我们，我们现场拆给你看。",
  },
  providerPlan: {
    digitalHuman: "mock",
    seedance: ["客户业务场景化 B-roll", "服务流程视觉补充镜头"],
    nextKeys: ["HEYGEN_API_KEY", "HEYGEN_AVATAR_ID", "HEYGEN_VOICE_ID"],
  },
};

export function AiVideoDemoClient() {
  const [tiktokUrl, setTiktokUrl] = useState(
    "https://www.tiktok.com/@reference/video/0000000000000000000",
  );
  const [clientIndustry, setClientIndustry] = useState("地产 / 顾问型服务");
  const [clientOffer, setClientOffer] = useState("客户专属 AI 数字人讲解视频");
  const [targetAudience, setTargetAudience] = useState(
    "正在比较服务方案、需要快速建立信任的潜在客户",
  );
  const [tone, setTone] = useState<Tone>("premium");
  const [result, setResult] = useState<AnalysisResult>(DEFAULT_RESULT);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generateDemo() {
    setIsGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/demo/ai-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiktokUrl,
          clientIndustry,
          clientOffer,
          targetAudience,
          tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#080b10] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(45,212,191,0.20),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.18),transparent_30%),linear-gradient(180deg,#080b10_0%,#111827_100%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-size-[56px_56px] opacity-30" />

      <div className="relative mx-auto min-h-screen w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Logo size={30} />
            <div>
              <div className="text-sm font-semibold tracking-tight">Aivora</div>
              <div className="text-[11px] text-white/45">
                Viral Intelligence Console
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Live Demo
          </div>
        </header>

        <section className="mb-8 grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
              <Radio className="h-3.5 w-3.5" />
              TikTok-first Viral Intelligence
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Clone the strategy.
              <span className="block bg-linear-to-r from-cyan-200 via-emerald-200 to-white bg-clip-text text-transparent">
                Rebuild it for your client.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/58">
              输入客户喜欢的 TikTok 爆款链接，Aivora 抓取真实数据和评论，
              拆解 hook、留存、信任机制，再生成客户专属数字人视频脚本。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric value={formatCompact(result.reference.metrics.plays)} label="参考播放" />
            <Metric value={`${result.reference.metrics.engagementRate}%`} label="互动率" />
            <Metric value={result.source === "apify+llm" ? "Live" : "Mock"} label="数据源" />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <ControlPanel
            tiktokUrl={tiktokUrl}
            setTiktokUrl={setTiktokUrl}
            clientIndustry={clientIndustry}
            setClientIndustry={setClientIndustry}
            clientOffer={clientOffer}
            setClientOffer={setClientOffer}
            targetAudience={targetAudience}
            setTargetAudience={setTargetAudience}
            tone={tone}
            setTone={setTone}
            isGenerating={isGenerating}
            error={error}
            onGenerate={generateDemo}
          />

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <ReferenceCard result={result} />
            <IntelligenceCard result={result} />
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <ClientPlanCard result={result} />
          <ProviderCard result={result} />
        </section>
      </div>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl shadow-black/20 backdrop-blur-xl">
      <div className="text-2xl font-semibold text-cyan-100">{value}</div>
      <div className="mt-1 text-xs text-white/45">{label}</div>
    </div>
  );
}

function ControlPanel(props: {
  tiktokUrl: string;
  setTiktokUrl: (value: string) => void;
  clientIndustry: string;
  setClientIndustry: (value: string) => void;
  clientOffer: string;
  setClientOffer: (value: string) => void;
  targetAudience: string;
  setTargetAudience: (value: string) => void;
  tone: Tone;
  setTone: (value: Tone) => void;
  isGenerating: boolean;
  error: string;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">
            Input
          </div>
          <h2 className="mt-1 text-xl font-semibold">Reference Video</h2>
        </div>
        <WandSparkles className="h-5 w-5 text-cyan-200" />
      </div>

      <div className="space-y-3">
        <Field label="TikTok 爆款链接">
          <input
            value={props.tiktokUrl}
            onChange={(e) => props.setTiktokUrl(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/50"
            placeholder="https://www.tiktok.com/@.../video/..."
          />
        </Field>
        <Field label="客户行业">
          <input
            value={props.clientIndustry}
            onChange={(e) => props.setClientIndustry(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/50"
          />
        </Field>
        <Field label="客户产品 / 服务">
          <textarea
            value={props.clientOffer}
            onChange={(e) => props.setClientOffer(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/50"
          />
        </Field>
        <Field label="目标客户">
          <textarea
            value={props.targetAudience}
            onChange={(e) => props.setTargetAudience(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/50"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          {(["premium", "expert", "friendly", "bold"] as Tone[]).map((tone) => (
            <button
              key={tone}
              type="button"
              onClick={() => props.setTone(tone)}
              className={`rounded-2xl border px-3 py-2 text-left text-xs capitalize transition ${
                props.tone === tone
                  ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
                  : "border-white/10 bg-white/5 text-white/55 hover:border-white/20"
              }`}
            >
              {tone}
            </button>
          ))}
        </div>

        {props.error ? (
          <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-100">
            {props.error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={props.onGenerate}
          disabled={props.isGenerating}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/15 transition hover:bg-white disabled:opacity-60"
        >
          {props.isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {props.isGenerating ? "Analyzing viral signal..." : "Analyze & Rebuild"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/38">
        {label}
      </span>
      {children}
    </label>
  );
}

function ReferenceCard({ result }: { result: AnalysisResult }) {
  const ref = result.reference;
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-emerald-200/70">
            Reference
          </div>
          <h2 className="mt-1 text-xl font-semibold">TikTok Intelligence</h2>
        </div>
        <a
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/10 bg-white/5 p-2 text-white/65 transition hover:text-white"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="mb-4 overflow-hidden rounded-3xl border border-white/10 bg-black/30">
        {ref.downloadUrl ? (
          <video
            src={ref.downloadUrl}
            controls
            playsInline
            className="aspect-9/16 w-full object-cover"
          />
        ) : (
          <div className="flex aspect-9/16 items-center justify-center p-8 text-center">
            <div>
              <TrendingUp className="mx-auto mb-4 h-10 w-10 text-cyan-200" />
              <div className="text-lg font-semibold">Viral structure, not raw copy.</div>
              <p className="mt-2 text-sm leading-6 text-white/45">
                Aivora 默认不下载原视频，优先抓取 metadata、评论和创意结构，降低版权和热链风险。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Plays" value={formatCompact(ref.metrics.plays)} />
        <MiniStat label="Likes" value={formatCompact(ref.metrics.likes)} />
        <MiniStat label="Comments" value={formatCompact(ref.metrics.comments)} />
        <MiniStat label="Shares" value={formatCompact(ref.metrics.shares)} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="text-xs text-white/35">@{ref.author || "unknown"}</div>
        <p className="mt-2 line-clamp-4 text-sm leading-6 text-white/72">
          {ref.caption}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ref.hashtags.slice(0, 8).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-cyan-100/80"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntelligenceCard({ result }: { result: AnalysisResult }) {
  const items = [
    ["Hook", result.intelligence.hook],
    ["Formula", result.intelligence.viralFormula],
    ["Audience", result.intelligence.audienceTriggers.join(" / ")],
    ["Signal", result.intelligence.commentSignals.join(" / ")],
  ];
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/8 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">
            Analysis
          </div>
          <h2 className="mt-1 text-xl font-semibold">Why It Works</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/45">
          {result.source}
        </div>
      </div>

      <div className="space-y-3">
        {items.map(([label, text]) => (
          <div key={label} className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-white/32">
              {label}
            </div>
            <p className="text-sm leading-6 text-white/78">{text}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PillList title="Retention" items={result.intelligence.retentionMechanics} />
        <PillList title="Visual" items={result.intelligence.visualPattern} />
      </div>
    </div>
  );
}

function ClientPlanCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-[2rem] border border-cyan-200/15 bg-cyan-200/8 p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur-2xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-100/70">
            Rebuilt For Client
          </div>
          <h2 className="mt-2 text-2xl font-semibold">{result.clientVersion.title}</h2>
          <p className="mt-2 text-sm leading-6 text-white/55">
            {result.clientVersion.positioning}
          </p>
        </div>
        <Bot className="h-7 w-7 shrink-0 text-cyan-200" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/35">
          <Copy className="h-3.5 w-3.5" />
          Digital-human script
        </div>
        <p className="text-base leading-8 text-white/84">
          {result.clientVersion.digitalHumanScript}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {result.clientVersion.scenePlan.slice(0, 3).map((scene) => (
          <div
            key={`${scene.time}-${scene.overlay}`}
            className="rounded-3xl border border-white/10 bg-white/5 p-4"
          >
            <div className="mb-3 text-xs text-cyan-100">{scene.time}</div>
            <div className="text-sm font-medium">{scene.visual}</div>
            <p className="mt-2 text-xs leading-5 text-white/48">{scene.narration}</p>
            <div className="mt-3 rounded-full bg-black/25 px-2.5 py-1 text-[11px] text-white/58">
              {scene.overlay}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.28em] text-emerald-200/70">
          Production Stack
        </div>
        <h2 className="mt-1 text-xl font-semibold">HeyGen-ready pipeline</h2>
      </div>

      <div className="space-y-3">
        <StackRow
          label="Digital Human"
          value={
            result.providerPlan.digitalHuman === "heygen-ready"
              ? "HeyGen selected"
              : "Mock now, HeyGen next"
          }
        />
        <StackRow label="Script" value="OpenAI strategy rewrite" />
        <StackRow label="B-roll" value="Seedance visual prompts" />
        <StackRow label="Output" value="Vertical client-ready video" />
      </div>

      <div className="mt-4">
        <PillList title="Seedance B-roll prompts" items={result.clientVersion.brollPrompts} />
      </div>

      <div className="mt-4 rounded-3xl border border-emerald-300/15 bg-emerald-300/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-100">
          <CheckCircle2 className="h-4 w-4" />
          Client CTA
        </div>
        <p className="text-sm leading-6 text-white/72">{result.clientVersion.cta}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/35">
        {label}
      </div>
    </div>
  );
}

function PillList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/15 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
        {title}
      </div>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((item) => (
          <div
            key={item}
            className="rounded-2xl bg-white/5 px-3 py-2 text-xs leading-5 text-white/64"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
      <span className="text-xs text-white/42">{label}</span>
      <span className="text-xs font-medium text-white/80">{value}</span>
    </div>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}
