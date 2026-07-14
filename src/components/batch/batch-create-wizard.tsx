"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Images,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { FileDropzone } from "@/components/ui/dropzone";
import { TemplateRecipeDialog } from "@/components/templates/template-recipe-dialog";
import {
  BlobUploadHttpError,
  uploadBlobWithProgress,
} from "@/lib/upload/blob-xhr";
import { useTranslation } from "@/i18n";
import { MAX_BATCH_VIDEO_COUNT } from "@/lib/contracts/batch-limits";
import type { CustomerRecoveryAction } from "@/lib/contracts/customer-api";
import { dispatchRecoveryHint } from "@/lib/api/customer-video-dispatch-recovery";

type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

interface UploadItem {
  localId: string;
  file: File | null;
  fileName: string;
  previewUrl: string;
  status: UploadStatus;
  progress?: number;
  assetId?: string;
  url?: string;
  error?: string;
  recoveryAction?: CustomerRecoveryAction;
}

interface StyleTemplateDto {
  id: string;
  version: number;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  sampleImage: string | null;
  promptSkeleton: string;
  negativePrompt: string;
  lockedParams: {
    duration: number;
    aspectRatio: string;
    resolution: string;
    cameraStyle: string;
    stability?: "high" | "balanced";
    humanInteraction?: "none" | "controlled";
  };
  imagesPerVideo: { min: number; max: number };
}

const UPLOAD_CONCURRENCY = 4;
const BATCH_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function formatEstimate(seconds: number, english: boolean): string {
  if (seconds < 60) return english ? `About ${seconds}s` : `约 ${seconds} 秒`;
  return english
    ? `About ${Math.ceil(seconds / 60)} min`
    : `约 ${Math.ceil(seconds / 60)} 分钟`;
}

export function BatchCreateWizard({
  batchDetailsBasePath = "/batches",
  initialTemplateId,
  initialImages = [],
}: {
  batchDetailsBasePath?: string;
  initialTemplateId?: string;
  initialImages?: Array<{ id: string; url: string; fileName: string }>;
} = {}) {
  const router = useRouter();
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const steps = english
    ? ["Upload assets", "Choose style", "Set quantity", "Review"]
    : ["上传素材", "选择风格", "生成数量", "确认提交"];
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const submissionIdentityRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>(() =>
    initialImages.map((image) => ({
      localId: `existing-${image.id}`,
      file: null,
      fileName: image.fileName,
      previewUrl: image.url,
      status: "uploaded",
      progress: 100,
      assetId: image.id,
      url: image.url,
    })),
  );
  const [templates, setTemplates] = useState<StyleTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateCategory, setTemplateCategory] = useState("__all__");
  const [count, setCount] = useState(100);
  const [productName, setProductName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] =
    useState<CustomerRecoveryAction | null>(null);
  const [errorSource, setErrorSource] = useState<
    "templates" | "batch" | null
  >(null);
  const [templateReloadToken, setTemplateReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setRecoveryAction(null);
    void fetch("/api/batch-style-templates")
      .then(async (response) => {
        const payload = (await response.json()) as {
          templates?: StyleTemplateDto[];
          error?: string;
          action?: CustomerRecoveryAction;
        };
        if (!response.ok || !payload.templates) {
          setRecoveryAction(payload.action ?? "retry");
          setErrorSource("templates");
          throw new Error(
            payload.error ??
              (english ? "Failed to load style templates" : "风格模板加载失败"),
          );
        }
        return { templates: payload.templates };
      })
      .then(({ templates: rows }) => {
        setTemplates(rows);
        setErrorSource(null);
        const requested = rows.find((template) => template.id === initialTemplateId);
        if (requested) setTemplateId(requested.id);
        else if (rows[0]) setTemplateId(rows[0].id);
      })
      .catch((reason) => {
        setErrorSource("templates");
        setRecoveryAction((current) => current ?? "retry");
        setError((reason as Error).message);
      });
  }, [english, initialTemplateId, templateReloadToken]);

  useEffect(
    () => () => {
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
    },
    [],
  );

  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  const templateCategories = useMemo(
    () => ["__all__", ...Array.from(new Set(templates.map((template) => template.category)))],
    [templates],
  );
  const visibleTemplates = useMemo(() => {
    const normalized = templateQuery.trim().toLocaleLowerCase();
    return templates.filter((template) =>
      (templateCategory === "__all__" || template.category === templateCategory) &&
      (!normalized || `${template.name} ${template.nameZh} ${template.category}`.toLocaleLowerCase().includes(normalized)),
    );
  }, [templateCategory, templateQuery, templates]);
  const uploaded = uploads.filter((item) => item.status === "uploaded");
  const hasPendingUploads = uploads.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const totalSlots = useMemo(() => {
    if (!selectedTemplate) return count;
    const { min, max } = selectedTemplate.imagesPerVideo;
    const range = max - min + 1;
    return Array.from({ length: count }, (_, index) => min + (index % range))
      .reduce((sum, value) => sum + value, 0);
  }, [count, selectedTemplate]);
  const perImage =
    uploaded.length > 0 ? (totalSlots / uploaded.length).toFixed(1) : "0";
  const estimateSeconds =
    Math.ceil(count / 10) * (selectedTemplate?.lockedParams.duration ?? 10);

  function updateUpload(localId: string, patch: Partial<UploadItem>) {
    setUploads((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      ),
    );
  }

  async function uploadOne(item: UploadItem) {
    if (!item.file) return;
    uploadControllersRef.current.get(item.localId)?.abort();
    const controller = new AbortController();
    uploadControllersRef.current.set(item.localId, controller);
    updateUpload(item.localId, {
      status: "uploading",
      progress: 0,
      error: undefined,
      recoveryAction: undefined,
    });
    try {
      const data = await uploadBlobWithProgress({
        file: item.file,
        endpoint: "/api/upload/blob",
        prefix: "batch-products",
        signal: controller.signal,
        onProgress: (progress) =>
          updateUpload(item.localId, { progress }),
      });
      updateUpload(item.localId, {
        status: "uploaded",
        progress: 100,
        assetId: data.pathname ?? item.localId,
        url: data.url,
      });
    } catch (reason) {
      const uploadError =
        reason instanceof BlobUploadHttpError ? reason : null;
      updateUpload(item.localId, {
        status: "failed",
        error: (reason as Error).message,
        recoveryAction: uploadError?.details.action,
      });
    } finally {
      if (uploadControllersRef.current.get(item.localId) === controller) {
        uploadControllersRef.current.delete(item.localId);
      }
    }
  }

  async function startUploadQueue(items: UploadItem[]) {
    let cursor = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, items.length) },
        async () => {
          while (cursor < items.length) {
            const index = cursor++;
            await uploadOne(items[index]);
          }
        },
      ),
    );
  }

  function addFiles(files: File[]) {
    setError(null);
    setRecoveryAction(null);
    setErrorSource(null);
    const images = files.filter((file) =>
      BATCH_IMAGE_MIME_TYPES.has(file.type),
    );
    if (images.length !== files.length) {
      setError(english ? "Batch generation supports PNG, JPG, and WebP product images only" : "批量生成仅支持 PNG、JPG、WEBP 产品图片");
    }
    const available = Math.max(0, 50 - uploads.length);
    const accepted = images.slice(0, available).map((file) => ({
      localId: crypto.randomUUID(),
      file,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "queued" as const,
    }));
    if (images.length > available) setError(english ? "Each batch accepts up to 50 images" : "每个批次最多上传 50 张图片");
    setUploads((current) => [...current, ...accepted]);
    void startUploadQueue(accepted);
  }

  function removeUpload(localId: string) {
    uploadControllersRef.current.get(localId)?.abort();
    uploadControllersRef.current.delete(localId);
    setUploads((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  async function submit() {
    if (!selectedTemplate || uploaded.length === 0) return;
    setSubmitting(true);
    setError(null);
    setRecoveryAction(null);
    setErrorSource("batch");
    try {
      const requestBody = {
        templateId: selectedTemplate.id,
        templateVersion: selectedTemplate.version,
        images: uploaded.map((item) => ({
          id: item.assetId,
          url: item.url,
        })),
        requestedCount: count,
        productName: productName.trim() || undefined,
      };
      const fingerprint = JSON.stringify(requestBody);
      if (submissionIdentityRef.current?.fingerprint !== fingerprint) {
        submissionIdentityRef.current = {
          fingerprint,
          key: crypto.randomUUID(),
        };
      }
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": submissionIdentityRef.current.key,
        },
        body: fingerprint,
      });
      const data = (await response.json()) as {
        batch?: { id: string };
        error?: string;
        action?: CustomerRecoveryAction;
      };
      if (!response.ok || !data.batch) {
        setRecoveryAction(data.action ?? "retry");
        throw new Error(data.error ?? (english ? "Failed to create batch" : "创建批次失败"));
      }
      router.push(`${batchDetailsBasePath}/${data.batch.id}`);
      toast.success(english ? "Batch created. Opening monitor…" : "批次已创建，正在跳转监控页");
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  const canContinue =
    step === 0
      ? uploaded.length > 0 && !hasPendingUploads
      : step === 1
        ? Boolean(selectedTemplate)
        : true;

  return (
    <div className="space-y-8 [&_svg]:stroke-[1.5]">
      <div className="space-y-4">
        <Progress
          value={((step + 1) / steps.length) * 100}
          aria-label={english ? `Batch setup: step ${step + 1} of ${steps.length}` : `批量创建进度：第 ${step + 1} 步，共 ${steps.length} 步`}
        />
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label={english ? "Batch setup steps" : "批量创建步骤"}
        >
          {steps.map((label, index) => {
            const isCurrent = index === step;
            const isComplete = index < step;

            return (
              <li
                key={label}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-w-0 items-center gap-2 rounded-(--radius-md) border px-3 py-3 text-meta transition-colors duration-fast motion-reduce:transition-none ${
                  isCurrent
                    ? "border-primary bg-accent-soft text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {isComplete ? (
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <span className="w-4 shrink-0 text-center tabular-nums">
                    {index + 1}
                  </span>
                )}
                <span className="truncate">{label}</span>
                {isCurrent && (
                  <Badge className="ml-auto hidden sm:inline-flex">{english ? "Current" : "当前"}</Badge>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {error && (
        <Card size="sm" role="alert" className="border-danger">
          <CardContent className="space-y-2 text-meta text-danger">
            <p>{error}</p>
            {recoveryAction ? (
              <p className="text-foreground">
                {dispatchRecoveryHint(
                  recoveryAction,
                  english ? "en-US" : "zh-CN",
                )}
              </p>
            ) : null}
            {errorSource === "templates" && recoveryAction === "retry" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTemplateReloadToken((value) => value + 1)}
              >
                <RefreshCw aria-hidden />
                {english ? "Reload templates" : "重新加载模板"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        {step === 0 && (
          <>
            <CardHeader>
              <CardTitle>{english ? "Add product assets" : "添加产品素材"}</CardTitle>
              <CardDescription>
                {english ? "PNG, JPG, or WebP. Up to 50 images with four concurrent uploads." : "支持 PNG、JPG、WEBP，最多 50 张，并发上传 4 张。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FileDropzone
                title={english ? "Drop product images here, or choose files" : "拖入产品图片，或点击选择"}
                description={english ? "Files upload immediately after selection, up to 50" : "文件会在选择后立即上传，最多 50 张"}
                uploading={hasPendingUploads}
                disabled={uploads.length >= 50}
                onFiles={addFiles}
                onRejected={() =>
                  setError(english ? "Batch generation supports PNG, JPG, and WebP product images only" : "批量生成仅支持 PNG、JPG、WEBP 产品图片")
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-muted-foreground">
                <span>{uploads.length}/50 {english ? "images" : "张"}</span>
                <span>
                  {english ? "Complete" : "已完成"} {uploaded.length} · {english ? "Uploading" : "上传中"}{" "}
                  {
                    uploads.filter((item) => item.status === "uploading").length
                  }{" "}
                  · {english ? "Failed" : "失败"}{" "}
                  {uploads.filter((item) => item.status === "failed").length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
                {uploads.map((item) => (
                  <div
                    key={item.localId}
                    className="group relative aspect-square overflow-hidden rounded-(--radius-md) border border-border bg-muted"
                  >
                    <div
                      role="img"
                      aria-label={item.fileName}
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url("${item.previewUrl}")` }}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-overlay px-1.5 py-1 text-[10px] text-primary-foreground">
                      {item.status === "queued" && <span>{english ? "Waiting" : "等待上传"}</span>}
                      {item.status === "uploading" && (
                        <span className="flex flex-col gap-1">
                          <span className="flex items-center gap-1">
                            <Loader2
                              className="size-3 animate-spin motion-reduce:animate-none"
                              aria-hidden
                            />
                            {english ? "Uploading" : "上传中"} {item.progress ?? 0}%
                          </span>
                          <Progress value={item.progress ?? 0} className="h-0.5" />
                        </span>
                      )}
                      {item.status === "uploaded" && (
                        <span className="flex items-center gap-1">
                          <Check className="size-3" aria-hidden />
                          {english ? "Uploaded" : "已上传"}
                        </span>
                      )}
                      {item.status === "failed" && (
                        (item.recoveryAction ?? "retry") === "retry" ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            onClick={() => void uploadOne(item)}
                          >
                            <RefreshCw className="size-3" aria-hidden />
                            {english ? "Retry" : "重传"}
                          </button>
                        ) : item.recoveryAction === "replace_asset" ? (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            onClick={() => removeUpload(item.localId)}
                          >
                            <X className="size-3" aria-hidden />
                            {english ? "Replace" : "更换"}
                          </button>
                        ) : (
                          <span>{english ? "See guidance" : "查看说明"}</span>
                        )
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={english ? `Remove ${item.fileName}` : `删除 ${item.fileName}`}
                      onClick={() => removeUpload(item.localId)}
                      className="absolute right-1 top-1 rounded-(--radius-sm) bg-overlay p-1 text-primary-foreground opacity-100 transition-opacity duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              {uploads.some((item) => item.status === "failed") ? (
                <ul className="space-y-2" aria-label={english ? "Upload failures" : "上传失败明细"}>
                  {uploads
                    .filter((item) => item.status === "failed")
                    .map((item) => (
                      <li
                        key={`${item.localId}-failure`}
                        className="rounded-(--radius-sm) border border-danger px-3 py-2 text-meta"
                      >
                        <p className="font-medium text-danger">
                          {item.fileName}: {item.error ?? (english ? "Upload failed" : "上传失败")}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {dispatchRecoveryHint(
                            item.recoveryAction ?? "retry",
                            english ? "en-US" : "zh-CN",
                          )}
                        </p>
                      </li>
                    ))}
                </ul>
              ) : null}
            </CardContent>
          </>
        )}

        {step === 1 && (
          <>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>{english ? "Choose one consistent style" : "选择统一风格"}</CardTitle>
                <CardDescription>
                  {english
                    ? "Search every quality-locked recipe in this step without scrolling through oversized cards."
                    : "在当前步骤内搜索全部质量锁定模板，不必滚动浏览大尺寸卡片。"}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="shrink-0 font-mono">
                {templates.length} {english ? "recipes" : "个配方"}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 space-y-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      value={templateQuery}
                      onChange={(event) => setTemplateQuery(event.target.value)}
                      placeholder={english ? "Search style or scenario" : "搜索风格或使用场景"}
                      className="pl-9"
                      aria-label={english ? "Search style templates" : "搜索风格模板"}
                    />
                  </label>
                  <select
                    value={templateCategory}
                    onChange={(event) => setTemplateCategory(event.target.value)}
                    className="h-9 rounded-(--radius-sm) border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={english ? "Filter by category" : "按分类筛选"}
                  >
                    {templateCategories.map((category) => (
                      <option key={category} value={category}>
                        {category === "__all__" ? (english ? "All categories" : "全部分类") : category}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                  {visibleTemplates.map((template) => {
                    const isSelected = template.id === templateId;
                    const displayName = english ? template.name : template.nameZh;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setTemplateId(template.id)}
                        className={`grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-(--radius-md) border p-2 text-left transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${
                          isSelected ? "border-primary bg-accent-soft" : "border-border bg-card hover:bg-muted"
                        }`}
                      >
                        {template.sampleImage ? (
                          <span
                            role="img"
                            aria-label={`${displayName}${english ? " sample" : "样片"}`}
                            className="block aspect-video rounded-(--radius-sm) bg-muted bg-cover bg-center"
                            style={{ backgroundImage: `url("${template.sampleImage}")` }}
                          />
                        ) : (
                          <span className="grid aspect-video place-items-center rounded-(--radius-sm) border border-border bg-muted text-muted-foreground">
                            <Film className="size-4" aria-hidden />
                            <span className="sr-only">{english ? "No dedicated sample" : "暂无独立样片"}</span>
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-heading text-sm font-semibold text-foreground">{displayName}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">v{template.version}</span>
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {template.category} · {english ? "uses" : "每条"} {template.imagesPerVideo.min}
                            {template.imagesPerVideo.max !== template.imagesPerVideo.min && `-${template.imagesPerVideo.max}`} {english ? "images" : "张"}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="hidden text-right font-mono text-[11px] text-muted-foreground sm:block">
                            {template.lockedParams.duration}s<br />{template.lockedParams.aspectRatio}
                          </span>
                          {isSelected && <Check className="size-4 text-primary" aria-hidden />}
                        </span>
                      </button>
                    );
                  })}
                  {visibleTemplates.length === 0 && (
                    <div className="rounded-(--radius-md) border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      {english ? "No recipes match this search." : "没有匹配当前搜索的风格配方。"}
                    </div>
                  )}
                </div>
              </div>

              {selectedTemplate && (
                <aside className="h-fit space-y-4 rounded-(--radius-md) border border-border bg-muted p-4 lg:sticky lg:top-4">
                  {selectedTemplate.sampleImage && (
                    <div
                      role="img"
                      aria-label={`${english ? selectedTemplate.name : selectedTemplate.nameZh}${english ? " sample" : "样片"}`}
                      className="aspect-video rounded-(--radius-sm) bg-background bg-cover bg-center"
                      style={{ backgroundImage: `url("${selectedTemplate.sampleImage}")` }}
                    />
                  )}
                  <div>
                    <p className="font-heading text-base font-semibold text-foreground">{english ? selectedTemplate.name : selectedTemplate.nameZh}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedTemplate.category} · v{selectedTemplate.version}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{english ? "Format" : "画面"}</dt>
                      <dd className="mt-1 font-mono text-foreground">{selectedTemplate.lockedParams.duration}s · {selectedTemplate.lockedParams.aspectRatio}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{english ? "Images" : "素材数"}</dt>
                      <dd className="mt-1 font-mono text-foreground">
                        {selectedTemplate.imagesPerVideo.min}
                        {selectedTemplate.imagesPerVideo.max !== selectedTemplate.imagesPerVideo.min && `-${selectedTemplate.imagesPerVideo.max}`}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selectedTemplate.sampleImage
                      ? (english ? "Dedicated Aivora sample available." : "已有独立 Aivora 样片。")
                      : (english
                        ? "No dedicated sample yet. The recipe is available, but Aivora will not reuse another template's image as a preview."
                        : "暂无独立样片；配方仍可使用，但不会拿其他模板画面冒充预览。")}
                  </p>
                  <TemplateRecipeDialog
                    name={english ? selectedTemplate.name : selectedTemplate.nameZh}
                    version={selectedTemplate.version}
                    promptSkeleton={selectedTemplate.promptSkeleton}
                    negativePrompt={selectedTemplate.negativePrompt}
                    english={english}
                    triggerVariant="outline"
                  />
                </aside>
              )}
            </CardContent>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>{english ? "Set production scale" : "设定生产规模"}</CardTitle>
              <CardDescription>
                {english ? "Optionally name the product, then confirm how many videos to generate." : "可选填产品名称，并确认本批次需要生成的视频数量。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="mx-auto w-full max-w-2xl space-y-8">
              <label
                htmlFor="product-name"
                className="grid gap-2 text-meta font-medium text-foreground"
              >
                {english ? "Product name (optional)" : "产品名称（可选）"}
                <Input
                  id="product-name"
                  value={productName}
                  maxLength={200}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder={english ? "e.g. Aivora smart bottle" : "例如：Aivora 智能水杯"}
                />
              </label>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label
                    htmlFor="batch-count"
                    className="text-meta font-medium text-foreground"
                  >
                    {english ? "Video quantity" : "生成数量"}
                  </label>
                  <Input
                    aria-label={english ? "Video quantity" : "生成数量输入"}
                    type="number"
                    min={1}
                    max={MAX_BATCH_VIDEO_COUNT}
                    value={count}
                    onChange={(event) =>
                      setCount(
                        Math.min(
                          MAX_BATCH_VIDEO_COUNT,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      )
                    }
                    className="w-24 text-right tabular-nums"
                  />
                </div>
                <input
                  id="batch-count"
                  type="range"
                  min={1}
                  max={MAX_BATCH_VIDEO_COUNT}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="w-full accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </div>
              <Card size="sm">
                <CardContent className="flex items-start gap-3">
                  <Images
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div>
                    <p className="font-medium text-foreground">
                      {uploaded.length} {english ? "images" : "张图"} × {count} {english ? "videos" : "条视频"}
                    </p>
                    <p className="mt-1 text-meta text-muted-foreground">
                      {english ? `Each image appears about ${perImage} times` : `每张图约使用 ${perImage} 次`} ·{" "}
                      {formatEstimate(estimateSeconds, english)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </>
        )}

        {step === 3 && selectedTemplate && (
          <>
            <CardHeader>
              <CardTitle>{english ? "Review batch" : "确认批次"}</CardTitle>
              <CardDescription>
                {english ? "Check assets, template, and scale before submitting." : "提交前复核素材、模板与生产规模。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="mx-auto w-full max-w-2xl space-y-5">
              <dl className="divide-y divide-border">
                {[
                  [english ? "Product images" : "产品图片", english ? `${uploaded.length} uploaded to CDN` : `${uploaded.length} 张（已全部上传 CDN）`],
                  [
                    english ? "Style template" : "风格模板",
                    `${english ? selectedTemplate.name : selectedTemplate.nameZh} · v${selectedTemplate.version}`,
                  ],
                  [english ? "Video quantity" : "生成数量", english ? `${count} videos` : `${count} 条`],
                  [english ? "Average coverage" : "平均覆盖", english ? `Each image about ${perImage} times` : `每张图片约 ${perImage} 次`],
                  [english ? "Estimated time" : "预计耗时", formatEstimate(estimateSeconds, english)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid gap-1 py-3 text-meta sm:grid-cols-[8rem_1fr] sm:items-center"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium text-foreground sm:text-right">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-(--radius-md) bg-muted p-4 text-meta leading-6 text-muted-foreground">
                {english
                  ? "Asset assignment, template version, and seed are persisted after submission. One failed video never blocks the rest; retry it individually or in bulk from the monitor."
                  : "提交后素材分配、模板版本和 seed 将被持久化。单条失败不会阻塞其他视频，可在监控页单独或批量重试。"}
              </p>
            </CardContent>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || submitting}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          <ChevronLeft aria-hidden />
          {english ? "Back" : "上一步"}
        </Button>
        {step < steps.length - 1 ? (
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() =>
              setStep((current) => Math.min(steps.length - 1, current + 1))
            }
          >
            {english ? "Continue" : "下一步"}
            <ChevronRight aria-hidden />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting && (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            )}
            {english ? `Create ${count} videos` : `创建 ${count} 条视频`}
          </Button>
        )}
      </div>
    </div>
  );
}
