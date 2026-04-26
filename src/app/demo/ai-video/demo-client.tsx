"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Play,
  RefreshCcw,
  Sparkles,
  Upload,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import {
  DEMO_SEED_INPUT,
  DEMO_SEED_RESULT,
  DEMO_SEED_VIDEO_DURATION_SEC,
  DEMO_SEED_VIDEO_THUMBNAIL,
  DEMO_SEED_VIDEO_URL,
} from "@/lib/data/demo-seed";
import type { DemoVideoAnalysisResult } from "@/lib/services/demo-video-analysis-service";

type Tone = DemoVideoAnalysisResult extends never
  ? never
  : "premium" | "friendly" | "expert" | "bold";

type AnalysisResult = DemoVideoAnalysisResult;

interface ProofStatus {
  provider: "heygen";
  jobId: string;
  status: "waiting" | "processing" | "completed" | "failed" | "unknown";
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string | null;
}

interface UploadedFile {
  url: string;
  name: string;
  mime: string;
  size: number;
}

interface FinalVideoState {
  source: "seed" | "client";
  videoUrl: string;
  thumbnailUrl?: string;
  durationSec?: number;
  jobId?: string;
  status: ProofStatus["status"] | "ready";
}

const SEED_FINAL_VIDEO: FinalVideoState | null = DEMO_SEED_VIDEO_URL
  ? {
      source: "seed",
      videoUrl: DEMO_SEED_VIDEO_URL,
      thumbnailUrl: DEMO_SEED_VIDEO_THUMBNAIL || undefined,
      durationSec: DEMO_SEED_VIDEO_DURATION_SEC || undefined,
      status: "ready",
    }
  : null;

export function AiVideoDemoClient() {
  const [tiktokUrl, setTiktokUrl] = useState(DEMO_SEED_INPUT.tiktokUrl);
  const [clientIndustry, setClientIndustry] = useState(
    DEMO_SEED_INPUT.clientIndustry,
  );
  const [clientOffer, setClientOffer] = useState(DEMO_SEED_INPUT.clientOffer);
  const [targetAudience, setTargetAudience] = useState(
    DEMO_SEED_INPUT.targetAudience,
  );
  const [tone, setTone] = useState<Tone>(DEMO_SEED_INPUT.tone);
  const [result, setResult] = useState<AnalysisResult>(DEMO_SEED_RESULT);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showInputs, setShowInputs] = useState(false);

  const [portrait, setPortrait] = useState<UploadedFile | null>(null);
  const [brolls, setBrolls] = useState<UploadedFile[]>([]);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const [uploadingBroll, setUploadingBroll] = useState(false);

  const [finalVideo, setFinalVideo] = useState<FinalVideoState | null>(
    SEED_FINAL_VIDEO,
  );
  const [proofJobId, setProofJobId] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    if (!proofJobId) return;
    if (
      finalVideo?.source === "client" &&
      (finalVideo.status === "completed" ||
        finalVideo.status === "ready" ||
        finalVideo.status === "failed")
    ) {
      return;
    }
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/demo/ai-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "render-status", videoId: proofJobId }),
        });
        const data = (await res.json()) as ProofStatus & { error?: string };
        if (!res.ok) throw new Error(data.error || "读取生成状态失败");
        if (cancelled) return;
        setFinalVideo({
          source: "client",
          videoUrl: data.videoUrl ?? "",
          thumbnailUrl: data.thumbnailUrl,
          durationSec: data.duration,
          jobId: data.jobId,
          status: data.status,
        });
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      }
    }
    void tick();
    const interval = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [proofJobId, finalVideo?.source, finalVideo?.status]);

  const reanalyze = useCallback(async () => {
    setIsAnalyzing(true);
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
      setIsAnalyzing(false);
    }
  }, [tiktokUrl, clientIndustry, clientOffer, targetAudience, tone]);

  const uploadFile = useCallback(
    async (kind: "portrait" | "broll", file: File): Promise<UploadedFile> => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch("/api/demo/ai-video", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      return {
        url: data.url,
        name: data.name || file.name,
        mime: data.mime || file.type,
        size: data.size || file.size,
      };
    },
    [],
  );

  const onPickPortrait = useCallback(
    async (file: File) => {
      setUploadingPortrait(true);
      setError("");
      try {
        const uploaded = await uploadFile("portrait", file);
        setPortrait(uploaded);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploadingPortrait(false);
      }
    },
    [uploadFile],
  );

  const onPickBroll = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).slice(0, 3 - brolls.length);
      if (arr.length === 0) return;
      setUploadingBroll(true);
      setError("");
      try {
        const uploaded = await Promise.all(
          arr.map((f) => uploadFile("broll", f)),
        );
        setBrolls((prev) => [...prev, ...uploaded].slice(0, 3));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploadingBroll(false);
      }
    },
    [brolls.length, uploadFile],
  );

  const renderClientVideo = useCallback(async () => {
    setIsRendering(true);
    setError("");
    try {
      const res = await fetch("/api/demo/ai-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "render-proof",
          title: result.clientVersion.title,
          script: result.clientVersion.digitalHumanScript,
          talkingPhotoUrl: portrait?.url,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "数字人生成提交失败");
      setProofJobId(data.jobId);
      setFinalVideo({
        source: "client",
        videoUrl: "",
        jobId: data.jobId,
        status: "processing",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsRendering(false);
    }
  }, [
    portrait?.url,
    result.clientVersion.digitalHumanScript,
    result.clientVersion.title,
  ]);

  const sourceText = useMemo(() => sourceLabel(result.source), [result.source]);
  const hasClientVideo =
    finalVideo?.source === "client" &&
    !!finalVideo.videoUrl &&
    finalVideo.status === "completed";
  const showPreviewReel = brolls.length > 0 && !!finalVideo?.videoUrl;

  return (
    <main className="min-h-screen bg-[#070b12] text-white">
      <BackgroundDecor />
      <div className="relative mx-auto w-full max-w-[1180px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <TopBar
          sourceText={sourceText}
          onToggleInputs={() => setShowInputs((v) => !v)}
          showInputs={showInputs}
          isAnalyzing={isAnalyzing}
        />

        {showInputs ? (
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
            isAnalyzing={isAnalyzing}
            onAnalyze={reanalyze}
          />
        ) : null}

        <Hero result={result} />

        {error ? (
          <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <Step
          index="01"
          title="我们抓到了这条爆款"
          subtitle="Aivora 通过 Apify 实时抓取 TikTok 视频与高赞评论，作为这次拆解的真实素材。"
        >
          <ReferenceVideoPanel result={result} sourceText={sourceText} />
        </Step>

        <Step
          index="02"
          title="我们看出来它为什么火"
          subtitle="OpenAI 基于真实评论与播放数据，提炼出可迁移到你业务的爆款结构。"
        >
          <IntelligencePanel result={result} />
        </Step>

        <Step
          index="03"
          title="我们为你重写了这个脚本"
          subtitle="结构保留爆款逻辑，文案完全为你的客户业务量身改写——不是搬运，不是抄袭。"
        >
          <RewriteScriptPanel result={result} />
        </Step>

        <Step
          index="04"
          title="数字人成片"
          subtitle={
            hasClientVideo
              ? "这是用你上传的人像 + 上面这段脚本生成的数字人讲解视频。"
              : "这是 Aivora 用上面这段脚本生成的真实数字人讲解视频，30 秒可发布。"
          }
        >
          <DigitalHumanPanel
            finalVideo={finalVideo}
            portrait={portrait}
            brolls={brolls}
            isRendering={isRendering}
            uploadingPortrait={uploadingPortrait}
            uploadingBroll={uploadingBroll}
            onPickPortrait={onPickPortrait}
            onPickBroll={onPickBroll}
            onRemovePortrait={() => setPortrait(null)}
            onRemoveBroll={(idx) =>
              setBrolls((prev) => prev.filter((_, i) => i !== idx))
            }
            onRender={renderClientVideo}
          />
        </Step>

        {showPreviewReel ? (
          <Step
            index="05"
            title="成片预演"
            subtitle="客户实拍 → 数字人讲解 → 客户实拍：这就是你发到主页的视频体验。"
          >
            <PreviewReel
              brolls={brolls}
              digitalHumanUrl={finalVideo?.videoUrl ?? ""}
            />
          </Step>
        ) : null}

        <FooterCTA cta={result.clientVersion.cta} onAnalyze={() => setShowInputs(true)} />
      </div>
    </main>
  );
}

function BackgroundDecor() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_-5%,rgba(45,212,191,0.18),transparent_30%),radial-gradient(circle_at_85%_8%,rgba(99,102,241,0.16),transparent_32%),linear-gradient(180deg,#070b12_0%,#0e1320_100%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[64px_64px] opacity-25" />
    </>
  );
}

function TopBar({
  sourceText,
  onToggleInputs,
  showInputs,
  isAnalyzing,
}: {
  sourceText: string;
  onToggleInputs: () => void;
  showInputs: boolean;
  isAnalyzing: boolean;
}) {
  return (
    <header className="relative flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Logo size={30} />
        <div>
          <div className="text-sm font-semibold tracking-tight">Aivora</div>
          <div className="text-[11px] text-white/45">
            爆款拆解 · 数字人成片 · 客户专属
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          {sourceText}
        </span>
        <button
          type="button"
          onClick={onToggleInputs}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/85 transition hover:border-white/30 hover:bg-white/15"
        >
          {isAnalyzing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
          {showInputs ? "收起参数" : "换一条 TikTok 链接"}
        </button>
      </div>
    </header>
  );
}

function Hero({ result }: { result: AnalysisResult }) {
  return (
    <section className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/10 bg-white/4 p-6 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-10">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="relative">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
          <Sparkles className="h-3.5 w-3.5" />
          地产经纪 · AI 视频获客闭环演示
        </div>
        <h1 className="max-w-3xl text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[3.2rem]">
          把别人的爆款，
          <span className="block bg-linear-to-r from-cyan-200 via-emerald-200 to-white bg-clip-text text-transparent">
            变成你团队 7 天可发的客户视频
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-white/64">
          Aivora 抓取一条 TikTok 爆款 → 用 OpenAI 拆解它为什么火 → 为你的经纪业务重写脚本
          → 用 HeyGen 数字人直接出片。下面这一整页就是真实闭环，往下滑你能直接看到数字人成片。
        </p>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPI value={formatCompact(result.reference.metrics.plays)} label="参考播放" />
          <KPI value={formatCompact(result.reference.metrics.likes)} label="参考点赞" />
          <KPI
            value={`${result.reference.metrics.engagementRate}%`}
            label="参考互动率"
          />
          <KPI
            value={DEMO_SEED_VIDEO_URL ? "已生成" : "可生成"}
            label="数字人成片"
          />
        </div>
      </div>
    </section>
  );
}

function KPI({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3.5">
      <div className="text-2xl font-semibold text-white sm:text-3xl">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/45">
        {label}
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  subtitle,
  children,
}: {
  index: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end gap-4">
        <div className="font-mono text-sm text-cyan-200/70">STEP {index}</div>
        <div className="h-px flex-1 bg-linear-to-r from-cyan-200/30 via-white/10 to-transparent" />
      </div>
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
        {subtitle}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ReferenceVideoPanel({
  result,
  sourceText,
}: {
  result: AnalysisResult;
  sourceText: string;
}) {
  const ref = result.reference;
  const playable = ref.downloadUrl;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40">
        {playable ? (
          <video
            src={playable}
            poster={ref.coverUrl}
            controls
            playsInline
            className="aspect-9/16 w-full bg-black object-cover"
          />
        ) : ref.coverUrl ? (
          <div
            className="aspect-9/16 w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${ref.coverUrl})` }}
          />
        ) : (
          <div className="flex aspect-9/16 w-full flex-col items-center justify-center bg-linear-to-br from-cyan-500/10 via-transparent to-emerald-500/10 p-6 text-center">
            <Video className="mb-3 h-10 w-10 text-cyan-200" />
            <div className="text-base font-medium">原片在 TikTok</div>
            <p className="mt-1 text-xs leading-5 text-white/50">
              我们默认不下载原片，避免版权与热链问题；点击下方链接打开原视频。
            </p>
          </div>
        )}
        <a
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between border-t border-white/10 bg-black/40 px-4 py-3 text-xs text-white/65 transition hover:bg-black/60 hover:text-white"
        >
          <span>在 TikTok 打开原片</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] text-emerald-100">
            数据来源 · {sourceText}
          </span>
          {ref.author ? (
            <span className="text-xs text-white/45">@{ref.author}</span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="播放" value={formatCompact(ref.metrics.plays)} />
          <Metric label="点赞" value={formatCompact(ref.metrics.likes)} />
          <Metric label="评论" value={formatCompact(ref.metrics.comments)} />
          <Metric label="分享" value={formatCompact(ref.metrics.shares)} />
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
            原视频文案
          </div>
          <p className="mt-2 text-sm leading-6 text-white/82">
            {ref.caption || "（无文案）"}
          </p>
          {ref.hashtags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ref.hashtags.slice(0, 10).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-cyan-100/80"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-cyan-200/15 bg-cyan-300/8 p-4 text-xs leading-5 text-cyan-50/85">
          这一切都是真实抓取与真实模型分析的结果。下一步，AI 会告诉你它到底为什么有效。
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-xl font-semibold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
        {label}
      </div>
    </div>
  );
}

function IntelligencePanel({ result }: { result: AnalysisResult }) {
  const items: { title: string; body: string; tone?: "highlight" }[] = [
    {
      title: "前 3 秒 hook",
      body: result.intelligence.hook,
      tone: "highlight",
    },
    { title: "爆款公式", body: result.intelligence.viralFormula },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.title}
            className={`rounded-2xl border p-5 ${
              it.tone === "highlight"
                ? "border-cyan-200/30 bg-cyan-300/8"
                : "border-white/10 bg-white/5"
            }`}
          >
            <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-white/40">
              {it.title}
            </div>
            <p className="text-sm leading-6 text-white/85">{it.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <PillList
          title="留存机制"
          icon="dot"
          items={result.intelligence.retentionMechanics}
        />
        <PillList
          title="视觉模式"
          icon="dot"
          items={result.intelligence.visualPattern}
        />
        <PillList
          title="观众心理触发"
          icon="dot"
          items={result.intelligence.audienceTriggers}
        />
        <PillList
          title="评论信号"
          icon="dot"
          items={result.intelligence.commentSignals}
        />
      </div>

      {result.intelligence.riskNotes.length > 0 ? (
        <div className="rounded-2xl border border-amber-300/25 bg-amber-300/8 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-amber-100/80">
            复刻时要规避
          </div>
          <ul className="space-y-1.5 text-sm leading-6 text-amber-50/85">
            {result.intelligence.riskNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-200/80" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PillList({
  title,
  items,
}: {
  title: string;
  icon?: "dot";
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-white/40">
        {title}
      </div>
      <ul className="space-y-2">
        {items.slice(0, 6).map((item) => (
          <li
            key={item}
            className="flex gap-2.5 rounded-xl bg-black/15 px-3 py-2 text-sm leading-5 text-white/76"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200/80" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RewriteScriptPanel({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-cyan-200/20 bg-cyan-200/8 p-6 shadow-2xl shadow-cyan-950/15">
        <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/80">
          客户视频定位
        </div>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white">
          {result.clientVersion.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-white/65">
          {result.clientVersion.positioning}
        </p>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/40">
            <Bot className="h-3.5 w-3.5" />
            数字人完整口播脚本
          </div>
          <p className="whitespace-pre-line text-base leading-8 text-white/90">
            {result.clientVersion.digitalHumanScript}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-white/40">
          镜头方案
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {result.clientVersion.scenePlan.map((scene) => (
            <div
              key={`${scene.time}-${scene.overlay}`}
              className="rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <div className="font-mono text-xs text-cyan-200">{scene.time}</div>
              <div className="mt-2 text-sm font-medium leading-6 text-white">
                {scene.visual}
              </div>
              <p className="mt-2 text-xs leading-5 text-white/50">
                {scene.narration}
              </p>
              <div className="mt-3 inline-block rounded-full bg-black/30 px-2.5 py-1 text-[11px] text-white/60">
                {scene.overlay}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <PillList title="字幕建议" items={result.clientVersion.captions} />
        <PillList
          title="补充镜头方向 (Seedance B-roll)"
          items={result.clientVersion.brollPrompts}
        />
      </div>
    </div>
  );
}

function DigitalHumanPanel({
  finalVideo,
  portrait,
  brolls,
  isRendering,
  uploadingPortrait,
  uploadingBroll,
  onPickPortrait,
  onPickBroll,
  onRemovePortrait,
  onRemoveBroll,
  onRender,
}: {
  finalVideo: FinalVideoState | null;
  portrait: UploadedFile | null;
  brolls: UploadedFile[];
  isRendering: boolean;
  uploadingPortrait: boolean;
  uploadingBroll: boolean;
  onPickPortrait: (file: File) => void;
  onPickBroll: (files: FileList | File[]) => void;
  onRemovePortrait: () => void;
  onRemoveBroll: (idx: number) => void;
  onRender: () => void;
}) {
  const showVideo =
    !!finalVideo?.videoUrl &&
    (finalVideo.status === "completed" || finalVideo.status === "ready");
  const isClientProcessing =
    finalVideo?.source === "client" &&
    (finalVideo.status === "processing" ||
      finalVideo.status === "waiting" ||
      finalVideo.status === "unknown");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(320px,420px)]">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/45 shadow-2xl shadow-black/40">
        {showVideo ? (
          <video
            key={finalVideo!.videoUrl}
            src={finalVideo!.videoUrl}
            poster={finalVideo!.thumbnailUrl}
            controls
            playsInline
            className="aspect-9/16 w-full bg-black object-contain"
          />
        ) : isClientProcessing ? (
          <div className="flex aspect-9/16 w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-cyan-500/10 to-emerald-500/5 p-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-200" />
            <div className="text-base font-medium">数字人正在生成中</div>
            <p className="max-w-xs text-xs leading-5 text-white/55">
              通常 1-3 分钟出片。期间页面会自动刷新状态，你可以继续往下看。
            </p>
            <div className="text-[11px] text-white/40 font-mono">
              video_id: {finalVideo?.jobId}
            </div>
          </div>
        ) : (
          <div className="flex aspect-9/16 w-full flex-col items-center justify-center gap-3 bg-linear-to-br from-slate-900/60 to-black/30 p-8 text-center">
            <Film className="h-10 w-10 text-white/40" />
            <div className="text-base font-medium">尚未生成数字人成片</div>
            <p className="max-w-xs text-xs leading-5 text-white/55">
              上传客户人像后点右侧「用我的素材生成」即可开始 HeyGen 真实生成。
            </p>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/40 px-4 py-3 text-xs">
          <span className="text-white/55">
            {finalVideo?.source === "seed"
              ? "Aivora 预生成的真实样片（HeyGen + 默认 avatar）"
              : finalVideo?.source === "client"
              ? finalVideo.status === "completed"
                ? "你的客户专属数字人成片"
                : "你的客户专属生成任务"
              : "尚未生成"}
          </span>
          {finalVideo?.durationSec ? (
            <span className="text-white/45">
              {finalVideo.durationSec.toFixed(1)}s
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
            用你自己的素材重做
          </div>
          <h3 className="mt-1.5 text-lg font-semibold">
            上传客户人像 + 你拍的实景
          </h3>
          <p className="mt-1.5 text-xs leading-5 text-white/50">
            人像决定数字人的脸；实拍片段会出现在数字人前后的镜头里。
          </p>

          <div className="mt-4 space-y-3">
            <PortraitDrop
              file={portrait}
              isUploading={uploadingPortrait}
              onPick={onPickPortrait}
              onRemove={onRemovePortrait}
            />
            <BrollDrop
              files={brolls}
              isUploading={uploadingBroll}
              onPick={onPickBroll}
              onRemove={onRemoveBroll}
            />
          </div>

          <button
            type="button"
            onClick={onRender}
            disabled={isRendering || !portrait}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRendering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {isRendering
              ? "正在提交到 HeyGen..."
              : portrait
              ? "用我的人像生成数字人"
              : "请先上传客户人像"}
          </button>
          <p className="mt-2 text-[11px] leading-5 text-white/40">
            生成会消耗一次 HeyGen 额度（约 0.5 美元）。生成时长 1-3 分钟。
          </p>
        </div>
      </div>
    </div>
  );
}

function PortraitDrop({
  file,
  isUploading,
  onPick,
  onRemove,
}: {
  file: UploadedFile | null;
  isUploading: boolean;
  onPick: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/40">
        <ImageIcon className="h-3.5 w-3.5" />
        客户人像（jpg/png）
      </div>
      {file ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.name}
            className="h-12 w-12 rounded-xl object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white/90">{file.name}</div>
            <div className="text-[11px] text-white/45">
              {formatBytes(file.size)} · 已上传
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full p-1 text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-black/15 px-3 py-3 text-left text-sm text-white/65 transition hover:border-cyan-300/50 hover:bg-cyan-300/5 hover:text-white disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
          ) : (
            <Upload className="h-4 w-4 text-cyan-200" />
          )}
          <span>{isUploading ? "正在上传人像..." : "点击或拖入人像照片"}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function BrollDrop({
  files,
  isUploading,
  onPick,
  onRemove,
}: {
  files: UploadedFile[];
  isUploading: boolean;
  onPick: (files: FileList) => void;
  onRemove: (idx: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = files.length < 3;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/40">
        <Film className="h-3.5 w-3.5" />
        实拍片段（mp4，最多 3 段，可选）
      </div>
      {files.length > 0 ? (
        <div className="space-y-2">
          {files.map((f, idx) => (
            <div
              key={f.url}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
            >
              <Video className="h-4 w-4 text-cyan-200" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate text-white/90">{f.name}</div>
                <div className="text-[11px] text-white/45">
                  {formatBytes(f.size)} · 段 {idx + 1}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="rounded-full p-1 text-white/55 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {canAdd ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-black/15 px-3 py-2.5 text-left text-sm text-white/55 transition hover:border-cyan-300/40 hover:text-white disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
          ) : (
            <Upload className="h-4 w-4 text-cyan-200" />
          )}
          <span>
            {isUploading
              ? "正在上传实拍片段..."
              : `点击添加实拍片段（已选 ${files.length}/3）`}
          </span>
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PreviewReel({
  brolls,
  digitalHumanUrl,
}: {
  brolls: UploadedFile[];
  digitalHumanUrl: string;
}) {
  const sequence = useMemo(() => {
    const head = brolls[0]?.url;
    const middle = digitalHumanUrl;
    const tail = brolls.slice(1).map((b) => b.url);
    return [head, middle, ...tail].filter(Boolean) as string[];
  }, [brolls, digitalHumanUrl]);

  const [activeIdx, setActiveIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setActiveIdx(0);
  }, [sequence.length]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(280px,360px)]">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/45 shadow-2xl shadow-black/40">
        {sequence[activeIdx] ? (
          <video
            key={`${sequence[activeIdx]}-${activeIdx}`}
            ref={videoRef}
            src={sequence[activeIdx]}
            controls
            autoPlay
            playsInline
            onEnded={() =>
              setActiveIdx((idx) =>
                idx + 1 < sequence.length ? idx + 1 : 0,
              )
            }
            className="aspect-9/16 w-full bg-black object-contain"
          />
        ) : (
          <div className="flex aspect-9/16 items-center justify-center text-sm text-white/45">
            等待数字人成片完成后自动播放预演
          </div>
        )}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/40 px-4 py-3 text-xs">
          <span className="text-white/55">
            正在预演第 {activeIdx + 1} / {sequence.length} 段
          </span>
          <span className="text-white/35">
            导出阶段会合成单一 mp4 文件
          </span>
        </div>
      </div>

      <ol className="space-y-2">
        {sequence.map((url, idx) => {
          const isClientFootage = idx !== 1;
          return (
            <li
              key={`${url}-${idx}`}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                idx === activeIdx
                  ? "border-cyan-300/50 bg-cyan-300/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="font-mono text-xs text-cyan-200/80">
                #{idx + 1}
              </div>
              <div className="flex-1 text-sm">
                <div className="font-medium text-white">
                  {idx === 1 && url === digitalHumanUrl
                    ? "数字人讲解"
                    : isClientFootage
                    ? `客户实拍片段 ${
                        idx > 1 ? idx - 1 : idx + 1
                      }`
                    : `镜头 ${idx + 1}`}
                </div>
                <div className="text-[11px] text-white/45">
                  {idx === 1 && url === digitalHumanUrl
                    ? "HeyGen 数字人成片"
                    : "Vercel Blob"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveIdx(idx)}
                className="rounded-full bg-black/30 p-1.5 text-white/70 transition hover:bg-black/50 hover:text-white"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ControlPanel(props: {
  tiktokUrl: string;
  setTiktokUrl: (v: string) => void;
  clientIndustry: string;
  setClientIndustry: (v: string) => void;
  clientOffer: string;
  setClientOffer: (v: string) => void;
  targetAudience: string;
  setTargetAudience: (v: string) => void;
  tone: Tone;
  setTone: (v: Tone) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">
            参数
          </div>
          <h3 className="mt-1 text-lg font-semibold">
            参考视频 + 客户业务输入
          </h3>
        </div>
        <RefreshCcw className="h-5 w-5 text-cyan-200" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="TikTok 爆款链接" full>
          <input
            value={props.tiktokUrl}
            onChange={(e) => props.setTiktokUrl(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50"
          />
        </Field>
        <Field label="客户行业">
          <input
            value={props.clientIndustry}
            onChange={(e) => props.setClientIndustry(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50"
          />
        </Field>
        <Field label="客户产品 / 服务">
          <input
            value={props.clientOffer}
            onChange={(e) => props.setClientOffer(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50"
          />
        </Field>
        <Field label="目标客户" full>
          <input
            value={props.targetAudience}
            onChange={(e) => props.setTargetAudience(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50"
          />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(["premium", "expert", "friendly", "bold"] as Tone[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => props.setTone(t)}
            className={`rounded-xl border px-3 py-2 text-xs transition ${
              props.tone === t
                ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-white/5 text-white/55 hover:border-white/20"
            }`}
          >
            {toneLabel(t)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={props.onAnalyze}
        disabled={props.isAnalyzing}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:opacity-60"
      >
        {props.isAnalyzing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {props.isAnalyzing ? "正在拆解爆款结构..." : "重新分析这条 TikTok"}
      </button>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`space-y-1.5 ${full ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/38">
        {label}
      </span>
      {children}
    </label>
  );
}

function FooterCTA({
  cta,
  onAnalyze,
}: {
  cta: string;
  onAnalyze: () => void;
}) {
  return (
    <section className="mt-16 rounded-[2rem] border border-emerald-300/20 bg-emerald-300/8 p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3 text-emerald-100">
        <CheckCircle2 className="h-5 w-5" />
        <div className="text-sm font-semibold tracking-wide">
          这套闭环每条链路都是真实运行的
        </div>
      </div>
      <h3 className="mt-3 max-w-2xl text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
        {cta}
      </h3>
      <button
        type="button"
        onClick={onAnalyze}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
      >
        <Play className="h-4 w-4" />
        换一条链接，再拆一次给我看
      </button>
    </section>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function toneLabel(tone: Tone) {
  return (
    {
      premium: "高级克制",
      expert: "专家可信",
      friendly: "亲和自然",
      bold: "强势吸睛",
    } as Record<Tone, string>
  )[tone];
}

function sourceLabel(source: AnalysisResult["source"]) {
  return (
    {
      "apify+llm": "真实抓取 + AI 拆解",
      "llm-only": "AI 拆解",
      mock: "演示数据",
    } as Record<AnalysisResult["source"], string>
  )[source];
}
