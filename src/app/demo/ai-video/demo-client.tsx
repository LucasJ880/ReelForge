"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clapperboard,
  FileAudio,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

type DemoStyle = "real-estate" | "product-demo" | "founder-intro";

interface DemoResult {
  provider: "mock" | "heygen";
  status: "mock_ready" | "submitted";
  jobId: string;
  headline: string;
  script: string;
  timeline: {
    label: string;
    detail: string;
    status: "ready" | "queued" | "provider";
  }[];
  assets: {
    footage: string;
    voice: string;
    avatar: string;
  };
  previewVideoUrl?: string;
  providerDashboardUrl?: string;
  notes: string[];
}

const STYLE_OPTIONS: {
  id: DemoStyle;
  title: string;
  description: string;
}[] = [
  {
    id: "real-estate",
    title: "客户经纪讲解",
    description: "适合房产、移民、保险、贷款等顾问型服务。",
  },
  {
    id: "product-demo",
    title: "产品演示短片",
    description: "适合把复杂卖点讲成 30 秒竖屏视频。",
  },
  {
    id: "founder-intro",
    title: "创始人/团队介绍",
    description: "适合建立信任感和专业背书。",
  },
];

const DEFAULT_RESULT: DemoResult = {
  provider: "mock",
  status: "mock_ready",
  jobId: "demo_ready",
  headline: "Aivora turns one shoot into many client-ready videos.",
  script:
    "大家好，我是 Aivora 的 AI 数字人助手。我们会先分析实拍素材，再结合目标客户生成讲解脚本，最后把真实声音、数字人形象和竖屏视频合成为一条可以直接发给客户的视频。",
  assets: {
    footage: "等待上传实拍视频",
    voice: "等待上传经纪人声音",
    avatar: "等待上传数字人形象",
  },
  timeline: [
    {
      label: "素材理解",
      detail: "分析实拍画面里的空间、产品或服务亮点。",
      status: "ready",
    },
    {
      label: "脚本生成",
      detail: "自动生成短视频讲解词、镜头节奏和字幕。",
      status: "ready",
    },
    {
      label: "数字人口型",
      detail: "HeyGen API key 到位后切换为真实数字人生成。",
      status: "provider",
    },
  ],
  notes: [
    "当前页面为客户演示稳定流程，默认不消耗真实数字人额度。",
    "Seedance 可以继续生成背景、产品和氛围镜头。",
  ],
};

export function AiVideoDemoClient() {
  const [style, setStyle] = useState<DemoStyle>("real-estate");
  const [goal, setGoal] = useState(
    "把一段实拍素材变成经纪人可直接发给客户的竖屏介绍视频",
  );
  const [audience, setAudience] = useState("正在对比服务方案的潜在客户");
  const [footage, setFootage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [result, setResult] = useState<DemoResult>(DEFAULT_RESULT);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const footagePreview = useMemo(
    () => (footage ? URL.createObjectURL(footage) : ""),
    [footage],
  );
  const avatarPreview = useMemo(
    () => (avatar ? URL.createObjectURL(avatar) : ""),
    [avatar],
  );

  async function generateDemo() {
    setIsGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/demo/ai-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          audience,
          style,
          footageName: footage?.name,
          audioName: audio?.name,
          avatarName: avatar?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 ambient-glow opacity-70" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-card/70 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Logo size={30} />
            <div>
              <div className="text-sm font-semibold tracking-tight">Aivora</div>
              <div className="text-[11px] text-muted-foreground">
                AI Video Workflow Demo
              </div>
            </div>
          </div>
          <div className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">
            Client Demo
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                1 段实拍 + 1 段声音 + 1 个数字人形象
              </div>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                把客户现场素材变成
                <span className="text-primary"> AI 数字人视频</span>
              </h1>
              <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                Aivora 用脚本生成、Seedance 场景视频、HeyGen-ready
                数字人口型同步，把一次拍摄转成可复用、可规模化的视频生产流程。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Metric value="30s" label="演示生成流程" />
              <Metric value="3x" label="一套素材多版本" />
              <Metric value="0" label="真人重复到场" />
            </div>

            <div className="rounded-3xl border border-white/10 bg-card/80 p-4 shadow-2xl shadow-black/20">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Demo 输入</h2>
                  <p className="text-xs text-muted-foreground">
                    本地预览文件，不上传大文件；真实接入时走 Blob + provider。
                  </p>
                </div>
                <Wand2 className="h-5 w-5 text-primary" />
              </div>

              <div className="grid gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Demo 目标
                  </span>
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    目标客户
                  </span>
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3">
                  {STYLE_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStyle(item.id)}
                      className={`rounded-2xl border p-3 text-left transition ${
                        style === item.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {item.description}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <UploadCard
                    icon={<Clapperboard className="h-4 w-4" />}
                    label="实拍视频"
                    accept="video/*"
                    file={footage}
                    onChange={setFootage}
                  />
                  <UploadCard
                    icon={<FileAudio className="h-4 w-4" />}
                    label="经纪人声音"
                    accept="audio/*"
                    file={audio}
                    onChange={setAudio}
                  />
                  <UploadCard
                    icon={<Bot className="h-4 w-4" />}
                    label="数字人形象"
                    accept="image/*,video/*"
                    file={avatar}
                    onChange={setAvatar}
                  />
                </div>

                {error ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={generateDemo}
                  disabled={isGenerating}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isGenerating ? "生成演示中..." : "生成 Demo 流程"}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.75fr_1fr]">
            <div className="space-y-4">
              <PreviewPanel
                title="实拍素材"
                empty="上传视频后在这里预览"
                videoUrl={footagePreview}
              />
              <PreviewPanel
                title="数字人形象"
                empty="上传头像/人物视频后预览"
                imageUrl={avatarPreview}
              />
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-card/80 p-4 shadow-2xl shadow-black/30">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-primary">
                    Output
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {result.headline}
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-muted-foreground">
                  {result.provider === "heygen" ? "HeyGen" : "Mock"}
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
                {result.previewVideoUrl ? (
                  <video
                    src={result.previewVideoUrl}
                    controls
                    playsInline
                    className="aspect-[9/16] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center p-8 text-center text-sm text-muted-foreground">
                    HeyGen 任务已提交。生成完成后将在 provider dashboard 查看，下一步可接轮询回写。
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-background/50 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  自动生成讲解词
                </div>
                <p className="text-sm leading-6">{result.script}</p>
              </div>

              <div className="mt-4 space-y-2">
                {result.timeline.map((item) => (
                  <div
                    key={item.label}
                    className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                {result.notes.map((note) => (
                  <div key={note} className="flex gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-2xl font-semibold text-primary">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function UploadCard({
  icon,
  label,
  accept,
  file,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="group cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-primary/5">
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {file ? file.name : "点击选择素材"}
      </div>
    </label>
  );
}

function PreviewPanel({
  title,
  empty,
  videoUrl,
  imageUrl,
}: {
  title: string;
  empty: string;
  videoUrl?: string;
  imageUrl?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-card/70">
      <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
        {title}
      </div>
      <div className="flex aspect-[9/16] items-center justify-center bg-black/40">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            playsInline
            className="h-full w-full object-cover"
          />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="p-6 text-center text-xs leading-5 text-muted-foreground">
            {empty}
          </div>
        )}
      </div>
    </div>
  );
}
