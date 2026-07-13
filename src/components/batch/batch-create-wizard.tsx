"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Images,
  Loader2,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
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

type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

interface UploadItem {
  localId: string;
  file: File;
  previewUrl: string;
  status: UploadStatus;
  assetId?: string;
  url?: string;
  error?: string;
}

interface StyleTemplateDto {
  id: string;
  version: number;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  lockedParams: {
    duration: number;
    aspectRatio: string;
    resolution: string;
    cameraStyle: string;
  };
  imagesPerVideo: { min: number; max: number };
}

const STEPS = ["上传素材", "选择风格", "生成数量", "确认提交"] as const;
const UPLOAD_CONCURRENCY = 4;

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `约 ${seconds} 秒`;
  return `约 ${Math.ceil(seconds / 60)} 分钟`;
}

export function BatchCreateWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [templates, setTemplates] = useState<StyleTemplateDto[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [count, setCount] = useState(100);
  const [productName, setProductName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/api/batch-style-templates")
      .then(async (response) => {
        if (!response.ok) throw new Error("风格模板加载失败");
        return response.json() as Promise<{ templates: StyleTemplateDto[] }>;
      })
      .then(({ templates: rows }) => {
        setTemplates(rows);
        if (rows[0]) setTemplateId(rows[0].id);
      })
      .catch((reason) => setError((reason as Error).message));
  }, []);

  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
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
    updateUpload(item.localId, {
      status: "uploading",
      error: undefined,
    });
    try {
      const form = new FormData();
      form.append("file", item.file);
      form.append("prefix", "batch-products");
      const response = await fetch("/api/upload/blob", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        pathname?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? `上传失败 (${response.status})`);
      }
      updateUpload(item.localId, {
        status: "uploaded",
        assetId: data.pathname ?? item.localId,
        url: data.url,
      });
    } catch (reason) {
      updateUpload(item.localId, {
        status: "failed",
        error: (reason as Error).message,
      });
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
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) {
      setError("批量生成仅支持 PNG、JPG、WEBP 产品图片");
    }
    const available = Math.max(0, 50 - uploads.length);
    const accepted = images.slice(0, available).map((file) => ({
      localId: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "queued" as const,
    }));
    if (images.length > available) setError("每个批次最多上传 50 张图片");
    setUploads((current) => [...current, ...accepted]);
    void startUploadQueue(accepted);
  }

  function removeUpload(localId: string) {
    setUploads((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  async function submit() {
    if (!selectedTemplate || uploaded.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          templateVersion: selectedTemplate.version,
          images: uploaded.map((item) => ({
            id: item.assetId,
            url: item.url,
          })),
          requestedCount: count,
          productName: productName.trim() || undefined,
        }),
      });
      const data = (await response.json()) as {
        batch?: { id: string };
        error?: string;
      };
      if (!response.ok || !data.batch) {
        throw new Error(data.error ?? "创建批次失败");
      }
      router.push(`/batches/${data.batch.id}`);
    } catch (reason) {
      setError((reason as Error).message);
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
          value={((step + 1) / STEPS.length) * 100}
          aria-label={`批量创建进度：第 ${step + 1} 步，共 ${STEPS.length} 步`}
        />
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label="批量创建步骤"
        >
          {STEPS.map((label, index) => {
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
                  <Badge className="ml-auto hidden sm:inline-flex">当前</Badge>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {error && (
        <Card size="sm" role="alert" className="border-danger">
          <CardContent className="text-meta text-danger">{error}</CardContent>
        </Card>
      )}

      <Card>
        {step === 0 && (
          <>
            <CardHeader>
              <CardTitle>添加产品素材</CardTitle>
              <CardDescription>
                支持 PNG、JPG、WEBP，最多 50 张，并发上传 4 张。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Card
                size="sm"
                className={
                  dragging ? "border-primary bg-accent-soft" : "border-dashed"
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    addFiles(Array.from(event.dataTransfer.files));
                  }}
                  className="h-auto w-full flex-col whitespace-normal px-6 py-10 text-center motion-reduce:transition-none"
                >
                  <UploadCloud
                    className="mb-1 size-7 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-body text-foreground">
                    拖入产品图片，或点击选择
                  </span>
                  <span className="text-meta font-normal text-muted-foreground">
                    文件会在选择后立即上传
                  </span>
                </Button>
              </Card>
              <input
                ref={inputRef}
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp"
                type="file"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-muted-foreground">
                <span>{uploads.length}/50 张</span>
                <span>
                  已完成 {uploaded.length} · 上传中{" "}
                  {
                    uploads.filter((item) => item.status === "uploading").length
                  }{" "}
                  · 失败{" "}
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
                      aria-label={item.file.name}
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url("${item.previewUrl}")` }}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-overlay px-1.5 py-1 text-[10px] text-primary-foreground">
                      {item.status === "queued" && <span>等待上传</span>}
                      {item.status === "uploading" && (
                        <span className="flex items-center gap-1">
                          <Loader2
                            className="size-3 animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                          上传中
                        </span>
                      )}
                      {item.status === "uploaded" && (
                        <span className="flex items-center gap-1">
                          <Check className="size-3" aria-hidden />
                          已上传
                        </span>
                      )}
                      {item.status === "failed" && (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          onClick={() => void uploadOne(item)}
                        >
                          <RefreshCw className="size-3" aria-hidden />
                          重传
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`删除 ${item.file.name}`}
                      onClick={() => removeUpload(item.localId)}
                      className="absolute right-1 top-1 rounded-(--radius-sm) bg-overlay p-1 text-primary-foreground opacity-100 transition-opacity duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </>
        )}

        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>选择统一风格</CardTitle>
              <CardDescription>
                一个批次锁定一个模板版本，确保输出视觉一致。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((template) => {
                  const isSelected = template.id === templateId;

                  return (
                    <Card
                      key={template.id}
                      size="sm"
                      className={
                        isSelected ? "border-primary bg-accent-soft" : ""
                      }
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setTemplateId(template.id)}
                        className="text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <div
                          role="img"
                          aria-label={`${template.nameZh}模板预览`}
                          className="h-32 bg-muted bg-cover bg-center"
                          style={{
                            backgroundImage: `url("${template.coverImage}")`,
                          }}
                        />
                        <div className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-heading text-subhead text-foreground">
                              {template.nameZh}
                            </span>
                            <Badge
                              variant={isSelected ? "default" : "secondary"}
                            >
                              v{template.version}
                            </Badge>
                          </div>
                          <p className="text-meta text-muted-foreground">
                            {template.category}
                          </p>
                          <p className="text-meta text-foreground">
                            每条 {template.imagesPerVideo.min}
                            {template.imagesPerVideo.max !==
                              template.imagesPerVideo.min &&
                              `-${template.imagesPerVideo.max}`}{" "}
                            张 · {template.lockedParams.duration}s ·{" "}
                            {template.lockedParams.aspectRatio}
                          </p>
                        </div>
                      </button>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>设定生产规模</CardTitle>
              <CardDescription>
                可选填产品名称，并确认本批次需要生成的视频数量。
              </CardDescription>
            </CardHeader>
            <CardContent className="mx-auto w-full max-w-2xl space-y-8">
              <label
                htmlFor="product-name"
                className="grid gap-2 text-meta font-medium text-foreground"
              >
                产品名称（可选）
                <Input
                  id="product-name"
                  value={productName}
                  maxLength={200}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="例如：Aivora 智能水杯"
                />
              </label>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label
                    htmlFor="batch-count"
                    className="text-meta font-medium text-foreground"
                  >
                    生成数量
                  </label>
                  <Input
                    aria-label="生成数量输入"
                    type="number"
                    min={1}
                    max={200}
                    value={count}
                    onChange={(event) =>
                      setCount(
                        Math.min(
                          200,
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
                  max={200}
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
                      {uploaded.length} 张图 × {count} 条视频
                    </p>
                    <p className="mt-1 text-meta text-muted-foreground">
                      每张图约使用 {perImage} 次 ·{" "}
                      {formatEstimate(estimateSeconds)}
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
              <CardTitle>确认批次</CardTitle>
              <CardDescription>
                提交前复核素材、模板与生产规模。
              </CardDescription>
            </CardHeader>
            <CardContent className="mx-auto w-full max-w-2xl space-y-5">
              <dl className="divide-y divide-border">
                {[
                  ["产品图片", `${uploaded.length} 张（已全部上传 CDN）`],
                  [
                    "风格模板",
                    `${selectedTemplate.nameZh} · v${selectedTemplate.version}`,
                  ],
                  ["生成数量", `${count} 条`],
                  ["平均覆盖", `每张图片约 ${perImage} 次`],
                  ["预计耗时", formatEstimate(estimateSeconds)],
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
                提交后素材分配、模板版本和 seed
                将被持久化。单条失败不会阻塞其他视频，可在监控页单独或批量重试。
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
          上一步
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() =>
              setStep((current) => Math.min(STEPS.length - 1, current + 1))
            }
          >
            下一步
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
            创建 {count} 条视频
          </Button>
        )}
      </div>
    </div>
  );
}
