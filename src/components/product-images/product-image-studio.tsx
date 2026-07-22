"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

type ProductImageStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
type AssetView = {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};
type ProductImageOutputDto = {
  id: string;
  handoffId: string | null;
  position: number;
  url: string;
  asset: AssetView | null;
  historical: boolean;
};

export interface ProductImageJobDto {
  id: string;
  status: ProductImageStatus;
  prompt: string;
  preset: string;
  aspectRatio: string;
  model: string;
  modelSnapshot: string | null;
  planId: string | null;
  resolutionSnapshot: string | null;
  pointsSnapshot: number | null;
  resultCount: number;
  sourceAsset: AssetView | null;
  outputs: ProductImageOutputDto[];
  retryableTasks: Array<{ id: string; ordinal: number; errorMessage: string | null }>;
  outputImageUrl: string | null;
  outputAssetId: string | null;
  errorMessage: string | null;
  historyNotice: string | null;
  createdAt: string;
}

const PRESET_IDS = ["white_studio", "lifestyle", "luxury", "social", "macro"] as const;
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
const RESOLUTIONS = ["1K", "2K", "4K"] as const;

export function ProductImageStudio({ initialJobs }: { initialJobs: ProductImageJobDto[] }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).images;
  const english = locale === "en-US";
  const presets = PRESET_IDS.map((value) => [value, ...copy.presets[value]] as const);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<(typeof PRESET_IDS)[number]>("white_studio");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECTS)[number]>("1:1");
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>("1K");
  const [resultCount, setResultCount] = useState(1);
  const [source, setSource] = useState<File | null>(null);
  const [sourceAsset, setSourceAsset] = useState<AssetView | null>(null);
  const [jobs, setJobs] = useState(initialJobs);
  const [activeJob, setActiveJob] = useState<ProductImageJobDto | null>(initialJobs[0] ?? null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const sourcePreview = useMemo(
    () => sourceAsset?.url ?? (source ? URL.createObjectURL(source) : null),
    [source, sourceAsset],
  );
  useEffect(() => () => {
    if (source && sourcePreview?.startsWith("blob:")) URL.revokeObjectURL(sourcePreview);
  }, [source, sourcePreview]);

  useEffect(() => {
    if (!activeJob || !["QUEUED", "PROCESSING"].includes(activeJob.status)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/product-images/${encodeURIComponent(activeJob.id)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as { job?: ProductImageJobDto };
        if (cancelled || !response.ok || !data.job) return;
        setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
        setActiveJob(data.job);
        if (data.job.status === "FAILED") setError(data.job.errorMessage ?? copy.jobFailed);
      } catch {
        // The durable job remains pollable after a transient browser/network failure.
      }
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeJob, copy.jobFailed]);

  const canSubmit =
    prompt.trim().length >= 8 &&
    !uploading &&
    !submitting &&
    (!source || Boolean(sourceAsset));

  async function uploadReference(file: File | null) {
    setSource(file);
    setSourceAsset(null);
    setError(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError(copy.sourceTooLarge);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("prefix", "product-images/sources");
      const response = await fetch("/api/upload/blob", { method: "POST", body: form });
      const data = (await response.json()) as { asset?: AssetView; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error ?? copy.requestFailed);
      setSourceAsset(data.asset);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/product-images", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestKey,
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          preset,
          aspectRatio,
          resolution,
          resultCount,
          sourceAssetId: sourceAsset?.id,
        }),
      });
      const data = (await response.json()) as { job?: ProductImageJobDto; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? copy.requestFailed);
      setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setActiveJob(data.job);
      setRequestKey(crypto.randomUUID());
      if (data.job.status === "FAILED") setError(data.job.errorMessage ?? copy.jobFailed);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function retryRejectedTask(taskId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/product-images/tasks/${encodeURIComponent(taskId)}/retry`,
        { method: "POST" },
      );
      const data = (await response.json()) as { job?: ProductImageJobDto; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? copy.requestFailed);
      setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
      setActiveJob(data.job);
      if (data.job.status === "FAILED") setError(data.job.errorMessage ?? copy.jobFailed);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function continueWithOutput(output: ProductImageOutputDto, variation: boolean) {
    if (!output.asset) return;
    setSource(null);
    setSourceAsset(output.asset);
    if (variation) {
      setPrompt(english ? "Create a distinct variation while preserving the exact product." : "在严格保留产品外观的前提下生成一个不同构图的变体。");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const results = activeJob?.outputs ?? [];
  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>{copy.workbench}</CardTitle>
              <span className="studio-label text-muted-foreground">Shuyu Image 2</span>
            </div>
            <p className="text-meta text-muted-foreground">
              {english ? "Reference image optional · audited Shuyu route" : "参考图可选 · 已审计 Shuyu 线路"}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <label className="block cursor-pointer rounded-(--radius-md) border border-dashed border-border-strong bg-muted p-4 text-center hover:border-primary">
              <input
                data-testid="product-image-source"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => void uploadReference(event.target.files?.[0] ?? null)}
              />
              {sourcePreview ? (
                <span className="grid grid-cols-[5rem_1fr] items-center gap-4 text-left">
                  <span className="relative aspect-square overflow-hidden rounded-(--radius-sm) bg-card">
                    <Image src={sourcePreview} alt={copy.optimize} fill sizes="80px" className="object-cover" unoptimized />
                  </span>
                  <span>
                    <span className="block truncate font-medium text-foreground">{source?.name ?? (english ? "Generated image" : "已生成图片")}</span>
                    <span className="mt-1 block text-meta text-muted-foreground">
                      {uploading ? copy.processing : sourceAsset ? (english ? "Uploaded · choose to replace" : "已上传 · 点击可替换") : copy.replace}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="flex min-h-28 flex-col items-center justify-center gap-2">
                  {uploading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Upload className="size-5 text-muted-foreground" aria-hidden />}
                  <span className="font-medium text-foreground">{copy.uploadTitle}</span>
                  <span className="text-meta text-muted-foreground">{copy.uploadHint}</span>
                </span>
              )}
            </label>

            <label className="block text-meta font-medium text-muted-foreground">
              {copy.describeLabel}
              <Textarea
                data-testid="product-image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                maxLength={1200}
                className="mt-2"
                placeholder={copy.describePlaceholder}
              />
              <span className="mt-1 block text-right font-mono">{prompt.length}/1200</span>
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-meta font-medium text-muted-foreground">
                {copy.aspect}
                <select data-testid="product-image-aspect" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)} className="studio-select mt-2">
                  {ASPECTS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-meta font-medium text-muted-foreground">
                {english ? "Resolution" : "分辨率"}
                <select data-testid="product-image-resolution" value={resolution} onChange={(event) => setResolution(event.target.value as typeof resolution)} className="studio-select mt-2">
                  {RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-meta font-medium text-muted-foreground">
                {english ? "Results" : "结果数量"}
                <select data-testid="product-image-result-count" value={resultCount} onChange={(event) => setResultCount(Number(event.target.value))} className="studio-select mt-2">
                  {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>

            <details className="rounded-(--radius-md) border border-border p-4">
              <summary className="cursor-pointer font-medium text-foreground">{english ? "Advanced styles" : "高级风格"}</summary>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {presets.map(([value, label, description]) => (
                  <button key={value} type="button" onClick={() => setPreset(value)} className={cn("rounded-(--radius-md) border p-3 text-left", preset === value ? "border-primary bg-accent-soft" : "border-border bg-card")}>
                    <span className="block text-body font-medium">{label}</span>
                    <span className="mt-1 block text-meta text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>
            </details>

            {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
            <Button data-testid="product-image-submit" type="button" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {submitting ? copy.processing : (english ? "Generate images" : "生成图片")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{copy.preview}</CardTitle></CardHeader>
          <CardContent>
            {activeJob?.status === "SUCCEEDED" && results.length ? (
              <div className="space-y-5" data-testid="product-image-result">
                <div className="grid gap-4 sm:grid-cols-2">
                  {results.map((output) => (
                    <article key={output.id} className="space-y-3 rounded-(--radius-md) border border-border p-3">
                      <div className="relative aspect-square overflow-hidden rounded-(--radius-sm) bg-muted">
                        <Image src={output.url} alt={english ? `Generated product image ${output.position + 1}` : `生成产品图 ${output.position + 1}`} fill sizes="(max-width: 640px) 100vw, 25vw" className="object-contain" unoptimized />
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <a href={output.url} download className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="download"><Download aria-hidden /></a>
                        <Button type="button" variant="outline" size="sm" aria-label="variation" disabled={!output.asset} onClick={() => continueWithOutput(output, true)}><RefreshCw aria-hidden /></Button>
                        <Button type="button" variant="outline" size="sm" aria-label="edit" disabled={!output.asset} onClick={() => continueWithOutput(output, false)}><Pencil aria-hidden /></Button>
                        {output.handoffId ? (
                          <Link href={`/app/create?productImageResultId=${encodeURIComponent(output.handoffId)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="single-video"><ArrowRight aria-hidden /><span className="sr-only">{copy.useSingle}</span></Link>
                        ) : <Button type="button" variant="outline" size="sm" aria-label="single-video" disabled><ArrowRight aria-hidden /></Button>}
                        {output.handoffId ? (
                          <Link href={`/app/batches/new?productImageResultId=${encodeURIComponent(output.handoffId)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="batch-video"><ArrowRight aria-hidden /><span className="sr-only">{copy.useBatch}</span></Link>
                        ) : <Button type="button" variant="outline" size="sm" aria-label="batch-video" disabled><ArrowRight aria-hidden /></Button>}
                      </div>
                      {output.historical ? <p className="text-meta text-muted-foreground">{activeJob.historyNotice}</p> : null}
                    </article>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-meta">
                  <span className="inline-flex items-center gap-2 text-success"><CheckCircle2 className="size-4" aria-hidden />{copy.approved}</span>
                  <span className="font-mono text-muted-foreground">{activeJob.planId} · {activeJob.resolutionSnapshot} · {activeJob.pointsSnapshot ?? "—"} pts</span>
                </div>
              </div>
            ) : activeJob?.status === "FAILED" ? (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <RefreshCw className="size-6 text-danger" aria-hidden /><p className="font-medium">{copy.failed}</p><p className="max-w-sm text-body text-muted-foreground">{activeJob.errorMessage}</p>
                {activeJob.retryableTasks.map((task) => (
                  <Button
                    key={task.id}
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => void retryRejectedTask(task.id)}
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                    {english ? `Retry result ${task.ordinal + 1}` : `重试结果 ${task.ordinal + 1}`}
                  </Button>
                ))}
              </div>
            ) : activeJob ? (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center" aria-live="polite">
                <Loader2 className="size-7 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /><p className="font-medium">{copy.processing}</p><p className="text-meta text-muted-foreground">Shuyu · {activeJob.resolutionSnapshot ?? resolution}</p>
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center"><ImageIcon className="size-7 text-muted-foreground" aria-hidden /><p className="font-medium">{copy.emptyTitle}</p><p className="max-w-sm text-body text-muted-foreground">{copy.emptyBody}</p></div>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="product-image-history" className="space-y-4">
        <div><p className="studio-label text-muted-foreground">{copy.historyKicker}</p><h2 id="product-image-history" className="mt-2 font-heading text-title font-semibold">{copy.historyTitle}</h2></div>
        {jobs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {jobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setActiveJob(job)} className="overflow-hidden rounded-(--radius-md) border border-border bg-card text-left hover:border-border-strong">
                <div className="relative aspect-square bg-muted">{job.outputs[0]?.url ? <Image src={job.outputs[0].url} alt={copy.historyTitle} fill sizes="25vw" className="object-cover" unoptimized /> : <div className="grid h-full place-items-center"><ImageIcon className="size-5 text-muted-foreground" aria-hidden /></div>}</div>
                <div className="space-y-1 p-3"><p className="truncate text-body font-medium">{presets.find(([value]) => value === job.preset)?.[1] ?? job.preset}</p><p className="font-mono text-meta text-muted-foreground">{job.aspectRatio} · {job.status}</p></div>
              </button>
            ))}
          </div>
        ) : <p className="text-body text-muted-foreground">{copy.historyEmpty}</p>}
      </section>
    </div>
  );
}
