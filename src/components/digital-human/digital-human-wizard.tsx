"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------- 类型 ------------------------------- */

interface Avatar {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  gender: string | null;
  style: string | null;
  description: string | null;
}
interface Voice {
  id: string;
  name: string;
  gender: string;
  description: string;
  sampleUrl: string | null;
}
interface StoreImage {
  id: string;
  url: string;
  fileName: string;
}
type JobStatus = "QUEUED" | "RENDERING" | "SUCCEEDED" | "FAILED";
interface JobDTO {
  id: string;
  status: JobStatus;
  outputVideoUrl: string | null;
  outputThumbnailUrl: string | null;
  userSafeError: string | null;
  attempts: number;
}

const STEPS = ["选择数字人", "选择音色", "上传店铺图", "填写需求", "生成"];
const DURATION_OPTIONS = [15, 20, 28, 35];

/* ------------------------------- 组件 ------------------------------- */

export function DigitalHumanWizard() {
  const [step, setStep] = useState(0);

  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [storeImages, setStoreImages] = useState<StoreImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [industry, setIndustry] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [cta, setCta] = useState("");
  const [brandName, setBrandName] = useState("");
  const [durationSec, setDurationSec] = useState(28);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDTO | null>(null);

  /* ---- 拉取数字人 / 音色目录 ---- */
  useEffect(() => {
    (async () => {
      try {
        const [aRes, vRes] = await Promise.all([
          fetch("/api/digital-human/avatars"),
          fetch("/api/digital-human/voices"),
        ]);
        if (!aRes.ok || !vRes.ok) throw new Error("目录加载失败");
        const aJson = (await aRes.json()) as { avatars: Avatar[] };
        const vJson = (await vRes.json()) as { voices: Voice[]; defaultVoiceId: string };
        setAvatars(aJson.avatars);
        setVoices(vJson.voices);
        if (aJson.avatars[0]) setAvatarId(aJson.avatars[0].id);
        setVoiceId(vJson.defaultVoiceId ?? vJson.voices[0]?.id ?? null);
      } catch (e) {
        setCatalogError((e as Error).message);
      }
    })();
  }, []);

  /* ---- 进度轮询（15s） ---- */
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/digital-human/jobs/${jobId}`);
        if (!res.ok) return;
        const { job: j } = (await res.json()) as { job: JobDTO };
        if (!cancelled) setJob(j);
      } catch {
        /* 忽略单次轮询错误 */
      }
    };
    poll();
    const timer = setInterval(() => {
      if (job && (job.status === "SUCCEEDED" || job.status === "FAILED")) return;
      poll();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.status]);

  /* ---- 上传店铺图 ---- */
  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setUploadError(null);
      setUploading(true);
      try {
        const added: StoreImage[] = [];
        for (const file of Array.from(files)) {
          if (storeImages.length + added.length >= 5) break;
          const form = new FormData();
          form.append("file", file);
          form.append("prefix", "digital-human-store");
          const res = await fetch("/api/upload/blob", { method: "POST", body: form });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error ?? `上传失败 (${res.status})`);
          }
          const { url } = (await res.json()) as { url: string };
          added.push({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            url,
            fileName: file.name,
          });
        }
        setStoreImages((prev) => [...prev, ...added].slice(0, 5));
      } catch (e) {
        setUploadError((e as Error).message);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [storeImages.length],
  );

  /* ---- 提交 ---- */
  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/digital-human/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          avatarId,
          voiceId,
          storeImageUrls: storeImages.map((s) => s.url),
          industry: industry.trim(),
          storeDescription: storeDescription.trim() || null,
          sellingPoints: sellingPoints
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          cta: cta.trim() || null,
          brandName: brandName.trim() || null,
          durationSec,
          aspectRatio: "9:16",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `提交失败 (${res.status})`);
      setJobId(j.jobId);
      setJob({
        id: j.jobId,
        status: "QUEUED",
        outputVideoUrl: null,
        outputThumbnailUrl: null,
        userSafeError: null,
        attempts: 0,
      });
      setStep(4);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForRetry() {
    setJobId(null);
    setJob(null);
    setSubmitError(null);
  }

  /* ---- 各步是否可继续 ---- */
  const canNext = [
    !!avatarId,
    !!voiceId,
    storeImages.length >= 1,
    industry.trim().length >= 1,
    true,
  ][step];

  return (
    <div className="space-y-8">
      <Stepper step={step} />

      {catalogError && (
        <p className="text-sm text-red-400">目录加载失败：{catalogError}</p>
      )}

      {/* Step 1 · 数字人 */}
      {step === 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {avatars.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAvatarId(a.id)}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-xl border bg-card/60 text-left transition-all",
                avatarId === a.id
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-white/10 hover:border-white/25",
              )}
            >
              <div className="flex aspect-3/4 items-center justify-center bg-linear-to-br from-white/5 to-white/0">
                {a.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnailUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-12 w-12 text-muted-foreground/50" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.name}</span>
                  {avatarId === a.id && <Check className="h-4 w-4 text-primary" />}
                </div>
                {a.style && (
                  <span className="text-[11px] text-muted-foreground">{a.style}</span>
                )}
              </div>
            </button>
          ))}
          {avatars.length === 0 && !catalogError && (
            <p className="col-span-full text-sm text-muted-foreground">加载中…</p>
          )}
        </div>
      )}

      {/* Step 2 · 音色 */}
      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {voices.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card/60 p-4 transition-colors",
                voiceId === v.id
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-white/10 hover:border-white/25",
              )}
            >
              <button
                type="button"
                onClick={() => setVoiceId(v.id)}
                className="flex flex-1 items-start gap-3 text-left"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    voiceId === v.id ? "border-primary bg-primary text-white" : "border-white/30",
                  )}
                >
                  {voiceId === v.id && <Check className="h-3 w-3" />}
                </span>
                <div>
                  <div className="text-sm font-medium">{v.name}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{v.description}</p>
                </div>
              </button>
              {v.sampleUrl && (
                <button
                  type="button"
                  onClick={() => new Audio(v.sampleUrl!).play()}
                  className="rounded-md border border-white/15 p-2 text-muted-foreground hover:text-foreground"
                  aria-label="试听"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step 3 · 店铺图 */}
      {step === 2 && (
        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={uploading || storeImages.length >= 5}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-card/60 px-3 py-2 text-sm hover:bg-card/90 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {uploading ? "上传中…" : "上传店铺实景图"}
            </button>
            <span className="text-xs text-muted-foreground">
              2–5 张更佳 · PNG / JPG / WebP（{storeImages.length}/5）
            </span>
          </div>
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {storeImages.map((img) => (
              <div
                key={img.id}
                className="group relative aspect-3/4 overflow-hidden rounded-lg border border-white/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.fileName} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setStoreImages((p) => p.filter((x) => x.id !== img.id))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 4 · 需求 */}
      {step === 3 && (
        <div className="grid max-w-2xl gap-5">
          <Field label="行业 / 店铺类型" required>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="如：宠物店 / 猫咪主题店、精品咖啡馆、美甲店"
              className="input"
            />
          </Field>
          <Field label="门店一句话描述">
            <textarea
              value={storeDescription}
              onChange={(e) => setStoreDescription(e.target.value)}
              rows={2}
              placeholder="风格、环境、特色，越具体文案越好。"
              className="input"
            />
          </Field>
          <Field label="主打卖点（每行一个）">
            <textarea
              value={sellingPoints}
              onChange={(e) => setSellingPoints(e.target.value)}
              rows={3}
              placeholder={"透明玻璃猫舍随时看主子\n店主精挑好物\n会员洗护打折"}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="行动号召 (CTA)">
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="地址放评论区，周末冲～"
                className="input"
              />
            </Field>
            <Field label="品牌名（可选）">
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Aivora"
                className="input"
              />
            </Field>
          </div>
          <Field label="时长">
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDurationSec(d)}
                  className={cn(
                    "rounded-md border px-4 py-2 text-sm",
                    durationSec === d
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-white/15 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}s
                </button>
              ))}
            </div>
          </Field>
          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>
      )}

      {/* Step 5 · 生成 */}
      {step === 4 && (
        <GenerationPanel job={job} onRetry={resetForRetry} />
      )}

      {/* 导航 */}
      <div className="flex items-center justify-between border-t border-white/10 pt-5">
        <button
          type="button"
          disabled={step === 0 || (step === 4 && (job?.status === "QUEUED" || job?.status === "RENDERING"))}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          上一步
        </button>

        {step < 3 && (
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            下一步
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            disabled={!canNext || submitting}
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            开始生成
          </button>
        )}
        {step === 4 && (job?.status === "SUCCEEDED" || job?.status === "FAILED") && (
          <button
            type="button"
            onClick={() => {
              resetForRetry();
              setStep(0);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-card/60"
          >
            再做一条
          </button>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.03);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        :global(.input:focus) {
          border-color: hsl(var(--primary));
        }
      `}</style>
    </div>
  );
}

/* ------------------------------ 子组件 ------------------------------ */

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-[11px]",
              i < step
                ? "border-primary bg-primary text-primary-foreground"
                : i === step
                  ? "border-primary text-primary"
                  : "border-white/20 text-muted-foreground",
            )}
          >
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn(i === step ? "text-foreground" : "text-muted-foreground")}>
            {label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/15" />}
        </li>
      ))}
    </ol>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function GenerationPanel({
  job,
  onRetry,
}: {
  job: JobDTO | null;
  onRetry: () => void;
}) {
  if (!job) return null;

  if (job.status === "SUCCEEDED" && job.outputVideoUrl) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Check className="h-4 w-4" /> 生成完成！
        </div>
        <div className="mx-auto max-w-[320px] overflow-hidden rounded-xl border border-white/10">
          <video
            src={job.outputVideoUrl}
            poster={job.outputThumbnailUrl ?? undefined}
            controls
            className="aspect-9/16 w-full bg-black"
          />
        </div>
        <div className="flex justify-center">
          <a
            href={job.outputVideoUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            下载视频
          </a>
        </div>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="space-y-4 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <p className="text-sm text-red-300">
          {job.userSafeError ?? "生成失败了，请稍后重试。"}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-card/60"
        >
          <RefreshCw className="h-4 w-4" />
          重新发起
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/10 bg-card/60 py-16">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="text-center">
        <p className="text-sm font-medium">
          {job.status === "QUEUED" ? "已排队，等待出片机器…" : "正在生成你的探店广告…"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          整个流程大约 5–8 分钟（分镜 → AI 画面 → 中文口播 → 字幕拼接），可以先去忙别的，完成后这里会自动刷新。
        </p>
      </div>
    </div>
  );
}
