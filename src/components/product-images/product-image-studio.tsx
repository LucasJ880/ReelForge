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
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

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

const PRESET_IDS = ["white_studio", "lifestyle", "luxury", "social", "macro"] as const;
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
export function ProductImageStudio({ initialJobs }: { initialJobs: ProductImageJobDto[] }) {
  const { locale } = useTranslation();
  const copy = getPlatformCopy(locale).images;
  const presets = PRESET_IDS.map((value) => [value, ...copy.presets[value]] as const);
  const qualities = [["low", copy.fast], ["medium", copy.standard], ["high", copy.detailed]] as const;
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

  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle>{copy.workbench}</CardTitle>
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
                  {value === "OPTIMIZE" ? copy.optimize : copy.generate}
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
                      setError(copy.sourceTooLarge);
                      return;
                    }
                    setSource(file);
                    setError(null);
                  }}
                />
                {sourcePreview ? (
                  <span className="grid grid-cols-[5rem_1fr] items-center gap-4 text-left">
                    <span className="relative aspect-square overflow-hidden rounded-(--radius-sm) bg-card">
                      <Image src={sourcePreview} alt={copy.optimize} fill sizes="80px" className="object-cover" unoptimized />
                    </span>
                    <span>
                      <span className="block truncate font-medium text-foreground">{source?.name}</span>
                      <span className="mt-1 block text-meta text-muted-foreground">{copy.replace}</span>
                    </span>
                  </span>
                ) : (
                  <span className="flex min-h-28 flex-col items-center justify-center gap-2">
                    <Upload className="size-5 text-muted-foreground" aria-hidden />
                    <span className="font-medium text-foreground">{copy.uploadTitle}</span>
                    <span className="text-meta text-muted-foreground">{copy.uploadHint}</span>
                  </span>
                )}
              </label>
            ) : null}

            <label className="block text-meta font-medium text-muted-foreground">
              {mode === "OPTIMIZE" ? copy.improveLabel : copy.describeLabel}
              <Textarea
                data-testid="product-image-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                maxLength={1200}
                className="mt-2"
                placeholder={mode === "OPTIMIZE"
                  ? copy.improvePlaceholder
                  : copy.describePlaceholder}
              />
              <span className="mt-1 block text-right font-mono">{prompt.length}/1200</span>
            </label>

            <fieldset>
              <legend className="studio-label text-muted-foreground">{copy.styleLock}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {presets.map(([value, label, description]) => (
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
                {copy.aspect}
                <select data-testid="product-image-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="studio-select mt-2">
                  {ASPECTS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-meta font-medium text-muted-foreground">
                {copy.outputQuality}
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="studio-select mt-2">
                  {qualities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
            <Button data-testid="product-image-submit" type="button" disabled={!canSubmit} onClick={() => void submit()} className="w-full sm:w-auto">
              {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {submitting ? copy.processing : mode === "OPTIMIZE" ? copy.optimizeCta : copy.generateCta}
            </Button>
            <p className="text-meta leading-5 text-muted-foreground">
              {copy.hardLockHint}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{copy.preview}</CardTitle>
          </CardHeader>
          <CardContent>
            {activeJob?.status === "SUCCEEDED" && activeJob.outputImageUrl ? (
              <div className="space-y-5" data-testid="product-image-result">
                <div className="relative aspect-square overflow-hidden rounded-(--radius-md) bg-muted">
                  <Image src={activeJob.outputImageUrl} alt={copy.generate} fill sizes="(max-width: 1280px) 100vw, 50vw" className="object-contain" unoptimized />
                  <span className="absolute bottom-3 left-3 rounded-(--radius-sm) bg-overlay px-2 py-1 text-meta text-foreground">AI Generated · Aivora</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 text-meta text-success"><CheckCircle2 className="size-4" aria-hidden />{copy.approved}</span>
                  <span className="font-mono text-meta text-muted-foreground">{activeJob.model}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href={`/app/create?productImageJobId=${encodeURIComponent(activeJob.id)}`}
                    className={buttonVariants()}
                  >
                    {copy.useSingle} <ArrowRight aria-hidden />
                  </Link>
                  <Link
                    href={`/app/batches/new?productImageJobId=${encodeURIComponent(activeJob.id)}`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    {copy.useBatch} <ArrowRight aria-hidden />
                  </Link>
                </div>
              </div>
            ) : activeJob?.status === "FAILED" ? (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <RefreshCw className="size-6 text-danger" aria-hidden />
                <p className="font-medium text-foreground">{copy.failed}</p>
                <p className="max-w-sm text-body text-muted-foreground">{activeJob.errorMessage}</p>
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center">
                <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
                <p className="font-medium text-foreground">{copy.emptyTitle}</p>
                <p className="max-w-sm text-body text-muted-foreground">{copy.emptyBody}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="product-image-history" className="space-y-4">
        <div>
          <p className="studio-label text-muted-foreground">{copy.historyKicker}</p>
          <h2 id="product-image-history" className="mt-2 font-heading text-title font-semibold text-foreground">{copy.historyTitle}</h2>
        </div>
        {jobs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {jobs.map((job) => (
              <button key={job.id} type="button" onClick={() => setActiveJob(job)} className="overflow-hidden rounded-(--radius-md) border border-border bg-card text-left hover:border-border-strong">
                <div className="relative aspect-square bg-muted">
                  {job.outputImageUrl ? <Image src={job.outputImageUrl} alt={copy.historyTitle} fill sizes="25vw" className="object-cover" unoptimized /> : <div className="grid h-full place-items-center"><ImageIcon className="size-5 text-muted-foreground" aria-hidden /></div>}
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-body font-medium text-foreground">{presets.find(([value]) => value === job.preset)?.[1] ?? job.preset}</p>
                  <p className="font-mono text-meta text-muted-foreground">{job.aspectRatio} · {job.createdAt.slice(0, 10)}</p>
                </div>
              </button>
            ))}
          </div>
        ) : <p className="text-body text-muted-foreground">{copy.historyEmpty}</p>}
      </section>
    </div>
  );
}
