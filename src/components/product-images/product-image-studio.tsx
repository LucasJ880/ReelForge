"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ProductImageMode = "GENERATE" | "OPTIMIZE";
type ProductImageStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";

export interface ProductImageJobDto {
  id: string;
  mode: ProductImageMode;
  status: ProductImageStatus;
  prompt: string;
  preset: string;
  aspectRatio: string;
  quality: string;
  model: string;
  sourceImageUrl: string | null;
  outputImageUrl: string | null;
  fromMock: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const PRESETS = [
  ["white_studio", "白底棚拍", "电商主图、目录页"],
  ["lifestyle", "生活方式", "真实使用情境"],
  ["luxury", "高端质感", "材质与精致光影"],
  ["social", "社媒广告", "留出安全文案区"],
  ["macro", "材质特写", "结构与细节放大"],
] as const;
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
const QUALITIES = [
  ["low", "快速"],
  ["medium", "标准"],
  ["high", "精细"],
] as const;

export function ProductImageStudio({ initialJobs }: { initialJobs: ProductImageJobDto[] }) {
  const [mode, setMode] = useState<ProductImageMode>("OPTIMIZE");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState("white_studio");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [quality, setQuality] = useState("medium");
  const [source, setSource] = useState<File | null>(null);
  const [jobs, setJobs] = useState(initialJobs);
  const [activeJob, setActiveJob] = useState<ProductImageJobDto | null>(initialJobs[0] ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourcePreview = useMemo(() => (source ? URL.createObjectURL(source) : null), [source]);
  useEffect(() => () => {
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
  }, [sourcePreview]);

  const canSubmit = prompt.trim().length >= 8 && (!submitting) && (mode === "GENERATE" || !!source);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.set("mode", mode);
    form.set("prompt", prompt.trim());
    form.set("preset", preset);
    form.set("aspectRatio", aspectRatio);
    form.set("quality", quality);
    if (source) form.set("sourceImage", source);
    try {
      const response = await fetch("/api/product-images", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      });
      const data = (await response.json()) as {
        ok?: boolean;
        job?: ProductImageJobDto;
        error?: string;
      };
      if (!response.ok || !data.job) throw new Error(data.error ?? "产品图处理失败，请稍后重试。");
      setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setActiveJob(data.job);
      if (data.job.status === "FAILED") setError(data.job.errorMessage ?? "本次处理未完成，请调整后重试。");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>产品图工作台</CardTitle>
              <span className="studio-label text-muted-foreground">GPT Image 2</span>
            </div>
            <div className="grid grid-cols-2 rounded-(--radius-md) border border-border bg-muted p-1">
              {(["OPTIMIZE", "GENERATE"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => { setMode(value); setError(null); }}
                  className={cn(
                    "min-h-10 rounded-(--radius-sm) px-3 text-body font-medium transition-colors",
                    mode === value ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "OPTIMIZE" ? "优化实拍图" : "生成产品图"}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {mode === "OPTIMIZE" ? (
              <label className="block cursor-pointer rounded-(--radius-md) border border-dashed border-border-strong bg-muted p-4 text-center hover:border-primary">
                <input
                  data-testid="product-image-source"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 20 * 1024 * 1024) {
                      setError("原图不能超过 20MB。");
                      return;
                    }
                    setSource(file);
                    setError(null);
                  }}
                />
                {sourcePreview ? (
                  <span className="grid grid-cols-[5rem_1fr] items-center gap-4 text-left">
                    <span className="relative aspect-square overflow-hidden rounded-(--radius-sm) bg-card">
                      <Image src={sourcePreview} alt="待优化原图预览" fill sizes="80px" className="object-cover" unoptimized />
                    </span>
                    <span>
                      <span className="block truncate font-medium text-foreground">{source?.name}</span>
                      <span className="mt-1 block text-meta text-muted-foreground">点击替换 · 最多 20MB</span>
                    </span>
                  </span>
                ) : (
                  <span className="flex min-h-28 flex-col items-center justify-center gap-2">
                    <Upload className="size-5 text-muted-foreground" aria-hidden />
                    <span className="font-medium text-foreground">上传原始产品照片</span>
                    <span className="text-meta text-muted-foreground">PNG / JPG / WebP · 保留产品身份与包装细节</span>
                  </span>
                )}
              </label>
            ) : null}

            <label className="block text-meta font-medium text-muted-foreground">
              {mode === "OPTIMIZE" ? "希望改善什么" : "描述要生成的产品"}
              <Textarea
                data-testid="product-image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                maxLength={1200}
                className="mt-2"
                placeholder={mode === "OPTIMIZE"
                  ? "例如：保持瓶身、标签与颜色完全一致，清理背景，改成柔和白底棚拍，阴影真实。"
                  : "例如：一只无品牌的哑光黑色保温杯，旋盖与金属杯口清晰，白底电商棚拍。"}
              />
              <span className="mt-1 block text-right font-mono">{prompt.length}/1200</span>
            </label>

            <fieldset>
              <legend className="studio-label text-muted-foreground">风格锁定</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PRESETS.map(([value, label, description]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setPreset(value)}
                    className={cn(
                      "rounded-(--radius-md) border p-3 text-left transition-colors",
                      preset === value ? "border-primary bg-accent-soft" : "border-border bg-card hover:border-border-strong",
                    )}
                  >
                    <span className="block text-body font-medium text-foreground">{label}</span>
                    <span className="mt-1 block text-meta text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-meta font-medium text-muted-foreground">
                画幅
                <select data-testid="product-image-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="studio-select mt-2">
                  {ASPECTS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-meta font-medium text-muted-foreground">
                输出质量
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="studio-select mt-2">
                  {QUALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
            <Button data-testid="product-image-submit" type="button" disabled={!canSubmit} onClick={() => void submit()} className="w-full sm:w-auto">
              {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {submitting ? "正在处理并做安全检查…" : mode === "OPTIMIZE" ? "优化产品图" : "生成产品图"}
            </Button>
            <p className="text-meta leading-5 text-muted-foreground">
              优化模式只允许调整光线、背景、阴影和构图；产品结构、颜色、包装与标识会作为一致性硬约束。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>成品预览</CardTitle>
          </CardHeader>
          <CardContent>
            {activeJob?.status === "SUCCEEDED" && activeJob.outputImageUrl ? (
              <div className="space-y-5" data-testid="product-image-result">
                <div className="relative aspect-square overflow-hidden rounded-(--radius-md) bg-muted">
                  <Image src={activeJob.outputImageUrl} alt="AI 生成产品图" fill sizes="(max-width: 1280px) 100vw, 50vw" className="object-contain" unoptimized />
                  <span className="absolute bottom-3 left-3 rounded-(--radius-sm) bg-overlay px-2 py-1 text-meta text-foreground">AI Generated · Aivora</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-meta text-success"><CheckCircle2 className="size-4" aria-hidden />已通过安全检查并进入素材库</span>
                  <span className="font-mono text-meta text-muted-foreground">{activeJob.model}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href={`/app/create?productImageJobId=${encodeURIComponent(activeJob.id)}`}
                    className={buttonVariants()}
                  >
                    用于单条视频 <ArrowRight aria-hidden />
                  </Link>
                  <Link
                    href={`/app/batches/new?productImageJobId=${encodeURIComponent(activeJob.id)}`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    用于批量视频 <ArrowRight aria-hidden />
                  </Link>
                </div>
              </div>
            ) : activeJob?.status === "FAILED" ? (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <RefreshCw className="size-6 text-danger" aria-hidden />
                <p className="font-medium text-foreground">本次处理未完成</p>
                <p className="max-w-sm text-body text-muted-foreground">{activeJob.errorMessage}</p>
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
                <p className="font-medium text-foreground">还没有产品图</p>
                <p className="max-w-sm text-body text-muted-foreground">选择优化实拍图或生成产品图，成品可直接进入单条与批量视频流程。</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="product-image-history" className="space-y-4">
        <div>
          <p className="studio-label text-muted-foreground">Asset History</p>
          <h2 id="product-image-history" className="mt-2 font-heading text-title font-semibold text-foreground">最近产品图</h2>
        </div>
        {jobs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {jobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setActiveJob(job)} className="overflow-hidden rounded-(--radius-md) border border-border bg-card text-left hover:border-border-strong">
                <div className="relative aspect-square bg-muted">
                  {job.outputImageUrl ? <Image src={job.outputImageUrl} alt="历史产品图" fill sizes="25vw" className="object-cover" unoptimized /> : <div className="grid h-full place-items-center"><ImageIcon className="size-5 text-muted-foreground" aria-hidden /></div>}
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-body font-medium text-foreground">{PRESETS.find(([value]) => value === job.preset)?.[1] ?? job.preset}</p>
                  <p className="font-mono text-meta text-muted-foreground">{job.aspectRatio} · {job.createdAt.slice(0, 10)}</p>
                </div>
              </button>
            ))}
          </div>
        ) : <p className="text-body text-muted-foreground">完成第一张产品图后，会在这里形成可复用的素材历史。</p>}
      </section>
    </div>
  );
}
