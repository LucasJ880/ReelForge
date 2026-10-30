"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Download,
  ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { AiGeneratedLabel } from "@/components/compliance/ai-generated-label";
import { StatusTick } from "@/components/exchange/status-tick";
import { productImageState } from "@/lib/exchange/state-vocab";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { uploadBlobWithProgress } from "@/lib/upload/blob-xhr";
import { useTranslation } from "@/i18n/useTranslation";
import { getPlatformCopy } from "@/i18n/platform-copy";

type ProductImageStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
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
  brandLogo: { packageId: string | null; url: string } | null;
  createdAt: string;
}

/** 印上品牌 Logo 的可选品牌包（server component 预载，见 create/images/page.tsx） */
export interface BrandPackageOption {
  id: string;
  name: string;
  brandName: string;
  logoUrl: string;
  scope: "global" | "workspace";
  isDefault: boolean;
}

/** 下载文件名：`aivora-product-image-<序号>.<扩展名>`，比对象存储的哈希名更可读 */
function outputFileName(output: ProductImageOutputDto, mimeType: string): string {
  const fromUrl = output.url.split("?")[0].split("#")[0].split(".").pop();
  const fromMime = mimeType.split("/")[1];
  const extension = (fromUrl && fromUrl.length <= 4 ? fromUrl : fromMime) || "png";
  return `aivora-product-image-${output.position + 1}.${extension}`;
}


const PRESET_IDS = ["white_studio", "lifestyle", "luxury", "social", "macro"] as const;
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
const RESOLUTIONS = ["1K", "2K", "4K"] as const;

export function ProductImageStudio({
  initialJobs,
  brandPackages,
}: {
  initialJobs: ProductImageJobDto[];
  brandPackages: BrandPackageOption[];
}) {
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
  /// 印上品牌 Logo：默认选自家（workspace）默认包，其次任一自家包，最后 global 包。
  const defaultBrandPackage = useMemo(
    () =>
      brandPackages.find((pkg) => pkg.scope === "workspace" && pkg.isDefault) ??
      brandPackages.find((pkg) => pkg.scope === "workspace") ??
      brandPackages[0] ??
      null,
    [brandPackages],
  );
  const [logoEnabled, setLogoEnabled] = useState(false);
  const [logoPackageId, setLogoPackageId] = useState<string | null>(null);
  const selectedBrandPackage =
    (logoPackageId ? brandPackages.find((pkg) => pkg.id === logoPackageId) : null) ??
    defaultBrandPackage;
  const [jobs, setJobs] = useState(initialJobs);
  const [activeJob, setActiveJob] = useState<ProductImageJobDto | null>(initialJobs[0] ?? null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
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

  const [cancelling, setCancelling] = useState(false);
  async function handleCancel() {
    if (!activeJob) return;
    setCancelling(true);
    try {
      const response = await fetch(
        `/api/product-images/${encodeURIComponent(activeJob.id)}/cancel`,
        { method: "POST" },
      );
      const data = (await response.json()) as { job?: ProductImageJobDto; error?: string };
      if (response.ok && data.job) {
        setJobs((current) => [data.job!, ...current.filter((job) => job.id !== data.job!.id)]);
        setActiveJob(data.job);
      } else {
        setError(data.error ?? copy.cancelFailed);
      }
    } catch {
      setError(copy.cancelFailed);
    } finally {
      setCancelling(false);
    }
  }

  const canSubmit =
    prompt.trim().length >= 8 &&
    !uploading &&
    !submitting &&
    (!source || Boolean(sourceAsset));

  async function uploadReference(file: File | null) {
    setSource(file);
    setSourceAsset(null);
    setError(null);
    /// 印 logo 依赖产品源图；源图被移除时同步关掉，不留「勾着但不会生效」的假状态。
    if (!file) {
      setLogoEnabled(false);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(copy.sourceTooLarge);
      return;
    }
    setUploading(true);
    try {
      const stored = await uploadBlobWithProgress({ file, prefix: "product-images/sources" });
      setSourceAsset({
        id: stored.assetId,
        url: stored.url,
        mimeType: stored.mimeType,
        width: stored.width,
        height: stored.height,
      });
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
          ...(logoEnabled && sourceAsset && selectedBrandPackage
            ? { brandPackageId: selectedBrandPackage.id }
            : {}),
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

  /**
   * 成品图托管在对象存储上（跨域），`<a download>` 的 download 属性会被浏览器
   * 忽略 —— 点击只会跳去打开图片，用户感知就是「下不了」。这里先取回字节再用
   * object URL 触发真正的下载；取不回时退回新标签页打开并提示。
   */
  async function downloadOutput(output: ProductImageOutputDto) {
    setDownloadingId(output.id);
    setError(null);
    try {
      const response = await fetch(output.url, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = outputFileName(output, blob.type);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      /// 立刻 revoke 会让部分浏览器拿不到字节，留一拍再回收
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch {
      window.open(output.url, "_blank", "noopener,noreferrer");
      setError(copy.downloadFailed);
    } finally {
      setDownloadingId(null);
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
  const running = activeJob?.status === "QUEUED" || activeJob?.status === "PROCESSING";
  const activePresetLabel = presets.find(([value]) => value === preset)?.[1] ?? preset;
  return (
    <div className="space-y-10">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)] xl:items-start">
        {/* 工作台：一面接缝墙，一行一个设置；只有真正的输入（上传区、文本框、下拉）是下沉井 */}
        <section aria-labelledby="product-image-workbench-title" className="x-wall min-w-0">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-4">
            <h2 id="product-image-workbench-title" className="text-subhead font-medium">{copy.workbench}</h2>
            <p className="flex items-baseline gap-2 text-meta text-muted-foreground">
              <span className="font-mono text-data text-foreground">{english ? "AI image" : "AI 出图"}</span>
              <span>{english ? "Reference image optional · your photo sets the product look" : "参考图可选 · 产品外观以你的照片为准"}</span>
            </p>
          </header>

          <div className="space-y-2.5 px-5 py-4">
            <p className="x-label">{english ? "Reference image · optional" : "参考图 · 可选"}</p>
            <label className="block cursor-pointer rounded-(--radius-md) border border-dashed border-border-strong bg-sunken p-4 text-center transition-colors duration-fast ease-out hover:border-(--accent-line) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring motion-reduce:transition-none">
              <input
                data-testid="product-image-source"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => void uploadReference(event.target.files?.[0] ?? null)}
              />
              {sourcePreview ? (
                <span className="grid grid-cols-[5rem_1fr] items-center gap-4 text-left">
                  <span className="relative aspect-square overflow-hidden rounded-(--radius-sm) border border-border bg-background">
                    <Image src={sourcePreview} alt={copy.optimize} fill sizes="80px" className="object-cover" unoptimized />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{source?.name ?? (english ? "Generated image" : "已生成图片")}</span>
                    <span className="mt-1 block text-meta text-muted-foreground">
                      {uploading ? copy.processing : sourceAsset ? (english ? "Uploaded · choose to replace" : "已上传 · 点击可替换") : copy.replace}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="flex min-h-28 flex-col items-center justify-center gap-2">
                  {uploading ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Upload className="size-5 text-muted-foreground" aria-hidden />}
                  <span className="font-medium text-foreground">{copy.uploadTitle}</span>
                  <span className="text-meta text-muted-foreground">{copy.uploadHint}</span>
                </span>
              )}
            </label>
          </div>

          <div className="px-5 py-4">
            {brandPackages.length > 0 && selectedBrandPackage ? (
              <div
                className={cn(
                  "rounded-(--radius-md) border px-3 py-3 transition-colors duration-fast ease-out motion-reduce:transition-none",
                  logoEnabled && sourceAsset ? "border-(--accent-line)" : "border-border",
                )}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    data-testid="product-image-brand-logo-toggle"
                    type="checkbox"
                    className="mt-1 accent-(--primary)"
                    checked={logoEnabled}
                    disabled={!sourceAsset || uploading}
                    onChange={(event) => setLogoEnabled(event.target.checked)}
                  />
                  <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-3">
                    <span className="min-w-0">
                      <span className={cn("block font-medium", logoEnabled && sourceAsset ? "text-accent" : "text-foreground")}>
                        {copy.brandLogoTitle}
                      </span>
                      <span className="mt-1 block text-meta text-muted-foreground">
                        {sourceAsset ? copy.brandLogoHint : copy.brandLogoNeedsSource}
                      </span>
                    </span>
                    <span className="relative size-12 overflow-hidden rounded-(--radius-sm) border border-border bg-sunken">
                      <Image
                        src={selectedBrandPackage.logoUrl}
                        alt={selectedBrandPackage.brandName}
                        fill
                        sizes="48px"
                        className="object-contain"
                        unoptimized
                      />
                    </span>
                  </span>
                </label>
                {logoEnabled && brandPackages.length > 1 ? (
                  <label className="mt-3 block">
                    <span className="x-label">{copy.brandLogoPackageLabel}</span>
                    <select
                      data-testid="product-image-brand-logo-package"
                      value={selectedBrandPackage.id}
                      onChange={(event) => setLogoPackageId(event.target.value)}
                      className="x-select mt-2"
                    >
                      {brandPackages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.brandName} · {pkg.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : (
              <p className="text-meta text-muted-foreground">
                {copy.brandLogoEmpty}{" "}
                <Link
                  href="/app/brands"
                  className="text-foreground underline underline-offset-4 hover:text-accent"
                >
                  {copy.brandLogoEmptyCta}
                </Link>
              </p>
            )}
          </div>

          <label className="block px-5 py-4">
            <span className="x-label">{copy.describeLabel}</span>
            <Textarea
              data-testid="product-image-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={1200}
              className="mt-2.5"
              placeholder={copy.describePlaceholder}
            />
            <span className="mt-1.5 block text-right font-mono text-data tabular-nums text-muted-foreground">{prompt.length}/1200</span>
          </label>

          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            <label className="block min-w-0">
              <span className="x-label">{copy.aspect}</span>
              <select data-testid="product-image-aspect" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)} className="x-select mt-2 tabular-nums">
                {ASPECTS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="x-label">{english ? "Resolution" : "分辨率"}</span>
              <select data-testid="product-image-resolution" value={resolution} onChange={(event) => setResolution(event.target.value as typeof resolution)} className="x-select mt-2 tabular-nums">
                {RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="x-label">{english ? "Results" : "结果数量"}</span>
              <select data-testid="product-image-result-count" value={resultCount} onChange={(event) => setResultCount(Number(event.target.value))} className="x-select mt-2 tabular-nums">
                {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="px-5 py-4">
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-(--radius-sm) text-meta text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                <span className="font-medium text-foreground">{english ? "Advanced styles" : "高级风格"}</span>
                <span aria-hidden>·</span>
                <span>{activePresetLabel}</span>
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {presets.map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    aria-pressed={preset === value}
                    onClick={() => setPreset(value)}
                    className={cn(
                      "rounded-(--radius-md) border px-3 py-2.5 text-left transition-colors duration-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                      preset === value
                        ? "border-(--accent-line) text-accent"
                        : "border-border text-foreground hover:border-border-strong",
                    )}
                  >
                    <span className="block text-body font-medium">{label}</span>
                    <span className="mt-0.5 block text-meta text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>

          <div className="space-y-3 px-5 py-4">
            {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-data tabular-nums text-muted-foreground">
                {aspectRatio} · {resolution} · {resultCount} {english ? (resultCount === 1 ? "image" : "images") : "张"}
              </p>
              <Button data-testid="product-image-submit" type="button" disabled={!canSubmit} onClick={() => void submit()}>
                {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                {submitting ? copy.processing : (english ? "Generate images" : "生成图片")}
              </Button>
            </div>
          </div>
        </section>

        {/* 成品预览：正在生成时，这一格带生成光束 */}
        <section
          aria-labelledby="product-image-preview-title"
          className={cn("x-panel min-w-0", running && "x-beam")}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 id="product-image-preview-title" className="text-subhead font-medium">{copy.preview}</h2>
            {activeJob ? (
              <StatusTick entity="image" state={productImageState(activeJob.status)} locale={locale} />
            ) : null}
          </header>
          <div className="p-5">
            {activeJob?.status === "SUCCEEDED" && results.length ? (
              <div className="space-y-5" data-testid="product-image-result">
                <div className={cn("grid gap-5", results.length > 1 && "sm:grid-cols-2")}>
                  {results.map((output) => (
                    <article key={output.id} className="min-w-0 space-y-3">
                      <div className="relative aspect-square overflow-hidden rounded-(--radius-md) border border-border bg-sunken">
                        <Image src={output.url} alt={english ? `Generated product image ${output.position + 1}` : `生成产品图 ${output.position + 1}`} fill sizes="(max-width: 640px) 100vw, 25vw" className="object-contain" unoptimized />
                        <AiGeneratedLabel className="absolute bottom-2 left-2" />
                      </div>
                      {/* 每个动作都带文字：早期版本是 5 个纯图标按钮（含 3 个箭头），
                          用户无法判断哪个是下载、哪个进单条 / 批量视频。
                          一页只留一枚实心主按钮（生成图片），带进视频用描边按钮。 */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          {output.handoffId ? (
                            <Link
                              href={`/app/create?productImageResultId=${encodeURIComponent(output.handoffId)}`}
                              className={buttonVariants({ variant: "outline", size: "sm", className: "justify-center" })}
                            >
                              <Clapperboard aria-hidden />{copy.useSingle}
                            </Link>
                          ) : (
                            <Button type="button" variant="outline" size="sm" disabled><Clapperboard aria-hidden />{copy.useSingle}</Button>
                          )}
                          {output.handoffId ? (
                            <Link
                              href={`/app/batches/new?productImageResultId=${encodeURIComponent(output.handoffId)}`}
                              className={buttonVariants({ variant: "outline", size: "sm", className: "justify-center" })}
                            >
                              <Layers aria-hidden />{copy.useBatch}
                            </Link>
                          ) : (
                            <Button type="button" variant="outline" size="sm" disabled><Layers aria-hidden />{copy.useBatch}</Button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={downloadingId === output.id}
                            onClick={() => void downloadOutput(output)}
                          >
                            {downloadingId === output.id ? (
                              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                            ) : (
                              <Download aria-hidden />
                            )}
                            {downloadingId === output.id ? copy.downloading : copy.download}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={!output.asset} onClick={() => continueWithOutput(output, true)}>
                            <RefreshCw aria-hidden />{copy.variation}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={!output.asset} onClick={() => continueWithOutput(output, false)}>
                            <Pencil aria-hidden />{copy.editAgain}
                          </Button>
                        </div>
                      </div>
                      {output.historical ? <p className="text-meta text-muted-foreground">{activeJob.historyNotice}</p> : null}
                    </article>
                  ))}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-meta text-muted-foreground">{copy.nextStepHint}</p>
                  <div className="flex flex-wrap items-center gap-3 text-meta">
                    <a href="#product-image-history" className="inline-flex items-center gap-2 text-success underline-offset-4 hover:underline">
                      <CheckCircle2 className="size-4" aria-hidden />{copy.approved}
                    </a>
                    <span className="font-mono text-data tabular-nums text-muted-foreground">{activeJob.planId} · {activeJob.resolutionSnapshot} · {activeJob.pointsSnapshot ?? "—"} pts{activeJob.brandLogo ? ` · ${copy.brandLogoBadge}` : ""}</span>
                  </div>
                </div>
              </div>
            ) : activeJob?.status === "FAILED" ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center sm:min-h-80">
                <AlertCircle className="size-6 text-danger" aria-hidden />
                <p className="font-medium">{copy.failed}</p>
                <p className="max-w-sm text-balance text-body text-muted-foreground">{activeJob.errorMessage}</p>
                {activeJob.retryableTasks.map((task) => (
                  <Button
                    key={task.id}
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => void retryRejectedTask(task.id)}
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                    {english ? `Retry result ${task.ordinal + 1}` : `重试结果 ${task.ordinal + 1}`}
                  </Button>
                ))}
              </div>
            ) : activeJob?.status === "CANCELLED" ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center sm:min-h-80">
                <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
                <p className="font-medium">{copy.cancelledTitle}</p>
                <p className="max-w-sm text-balance text-body text-muted-foreground">{copy.cancelledBody}</p>
              </div>
            ) : activeJob ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center sm:min-h-80" aria-live="polite">
                <span className="x-live" aria-hidden />
                <p className="font-medium">{copy.processing}</p>
                <p className="font-mono text-data text-muted-foreground">Aivora · {activeJob.resolutionSnapshot ?? resolution}</p>
                {/* 铁律 #7：运行中必须有「不再纠缠这一轮」的出口，且取消永远免费 */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelling}
                  onClick={() => void handleCancel()}
                >
                  {cancelling ? copy.cancelling : copy.cancelRound}
                </Button>
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center sm:min-h-80">
                <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
                <p className="font-medium">{copy.emptyTitle}</p>
                <p className="max-w-sm text-balance text-body text-muted-foreground">{copy.emptyBody}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section
        id="product-image-history"
        aria-labelledby="product-image-history-title"
        className="scroll-mt-24 space-y-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border pb-2">
          <h2 id="product-image-history-title" className="flex items-baseline gap-2.5 text-subhead font-medium">
            {copy.historyTitle}
            <span className="font-mono text-data tabular-nums text-muted-foreground">{jobs.length}</span>
          </h2>
          <p className="text-meta text-muted-foreground">{copy.historySubtitle}</p>
        </div>
        {jobs.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {jobs.map((job) => {
              const current = job.id === activeJob?.id;
              return (
                <li key={job.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={current}
                    onClick={() => setActiveJob(job)}
                    data-beam={job.status === "QUEUED" || job.status === "PROCESSING" ? "row" : undefined}
                    className={cn(
                      "x-panel x-panel-interactive block w-full overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      current && "border-(--accent-line)",
                    )}
                  >
                    <div className="relative aspect-square bg-sunken">
                      {job.outputs[0]?.url ? (
                        <Image src={job.outputs[0].url} alt={copy.historyTitle} fill sizes="25vw" className="object-cover" unoptimized />
                      ) : (
                        <div className="grid h-full place-items-center"><ImageIcon className="size-5 text-muted-foreground" aria-hidden /></div>
                      )}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <p className="truncate text-body font-medium">{presets.find(([value]) => value === job.preset)?.[1] ?? job.preset}</p>
                      <p className="flex items-center justify-between gap-2">
                        <StatusTick entity="image" state={productImageState(job.status)} locale={locale} />
                        <span className="font-mono text-data tabular-nums text-muted-foreground">{job.aspectRatio}</span>
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-body text-muted-foreground">{copy.historyEmpty}</p>}
      </section>
    </div>
  );
}
