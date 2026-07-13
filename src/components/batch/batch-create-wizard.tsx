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
    <div className="space-y-6">
      <ol className="grid grid-cols-4 gap-2" aria-label="批量创建步骤">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-xl border px-3 py-3 text-center text-xs ${
              index === step
                ? "border-violet-400/50 bg-violet-500/15 text-white"
                : index < step
                  ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : "border-white/10 bg-white/3 text-white/45"
            }`}
          >
            <span className="mr-1.5">{index < step ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </div>
      )}

      <section className="glass-card min-h-[480px] p-6">
        {step === 0 && (
          <div className="space-y-5">
            <button
              type="button"
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
              className={`flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 transition ${
                dragging
                  ? "border-violet-300 bg-violet-500/15"
                  : "border-white/20 bg-white/3 hover:bg-white/6"
              }`}
            >
              <UploadCloud className="mb-3 size-8 text-violet-300" />
              <span className="text-sm font-medium text-white">
                拖入产品图片，或点击选择
              </span>
              <span className="mt-1 text-xs text-white/45">
                PNG / JPG / WEBP，最多 50 张，并发上传 4 张
              </span>
            </button>
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
            <div className="flex items-center justify-between text-xs text-white/55">
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
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/30"
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url("${item.previewUrl}")` }}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 text-[10px] text-white">
                    {item.status === "uploading" && (
                      <span className="flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> 上传中
                      </span>
                    )}
                    {item.status === "uploaded" && (
                      <span className="flex items-center gap-1 text-emerald-300">
                        <Check className="size-3" /> 已上传
                      </span>
                    )}
                    {item.status === "failed" && (
                      <button
                        type="button"
                        className="flex items-center gap-1 text-red-300"
                        onClick={() => void uploadOne(item)}
                      >
                        <RefreshCw className="size-3" /> 重传
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`删除 ${item.file.name}`}
                    onClick={() => removeUpload(item.localId)}
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                onClick={() => setTemplateId(template.id)}
                className={`overflow-hidden rounded-2xl border text-left transition ${
                  template.id === templateId
                    ? "border-violet-400/60 bg-violet-500/15 ring-2 ring-violet-400/20"
                    : "border-white/10 bg-white/3 hover:border-white/25"
                }`}
              >
                <div
                  className="h-32 bg-cover bg-center"
                  style={{ backgroundImage: `url("${template.coverImage}")` }}
                />
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-white">
                      {template.nameZh}
                    </span>
                    <span className="text-[10px] text-white/40">
                      v{template.version}
                    </span>
                  </div>
                  <p className="text-xs text-white/50">{template.category}</p>
                  <p className="text-xs text-violet-200/80">
                    每条 {template.imagesPerVideo.min}
                    {template.imagesPerVideo.max !==
                      template.imagesPerVideo.min &&
                      `-${template.imagesPerVideo.max}`}{" "}
                    张 · {template.lockedParams.duration}s ·{" "}
                    {template.lockedParams.aspectRatio}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="mx-auto max-w-2xl space-y-8 py-10">
            <div>
              <label
                htmlFor="product-name"
                className="mb-2 block text-sm font-medium text-white"
              >
                产品名称（可选）
              </label>
              <input
                id="product-name"
                value={productName}
                maxLength={200}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="例如：Aivora 智能水杯"
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label htmlFor="batch-count" className="text-sm text-white">
                  生成数量
                </label>
                <input
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
                  className="w-24 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-right text-lg font-semibold text-white"
                />
              </div>
              <input
                id="batch-count"
                type="range"
                min={1}
                max={200}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-full accent-violet-500"
              />
            </div>
            <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-5">
              <div className="flex items-center gap-3">
                <Images className="size-6 text-violet-300" />
                <div>
                  <p className="font-medium text-white">
                    {uploaded.length} 张图 × {count} 条视频
                  </p>
                  <p className="mt-1 text-sm text-white/55">
                    每张图约使用 {perImage} 次 ·{" "}
                    {formatEstimate(estimateSeconds)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && selectedTemplate && (
          <div className="mx-auto max-w-2xl space-y-5 py-8">
            <h2 className="text-xl font-semibold text-white">确认批次</h2>
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
                className="flex items-center justify-between border-b border-white/10 py-3 text-sm"
              >
                <span className="text-white/50">{label}</span>
                <span className="font-medium text-white">{value}</span>
              </div>
            ))}
            <p className="rounded-xl bg-white/4 p-4 text-xs leading-6 text-white/45">
              提交后素材分配、模板版本和 seed 将被持久化。单条失败不会阻塞其他视频，可在监控页单独或批量重试。
            </p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 0 || submitting}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="glass-btn inline-flex items-center gap-1 text-xs disabled:opacity-40"
        >
          <ChevronLeft className="size-4" /> 上一步
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={!canContinue}
            onClick={() =>
              setStep((current) => Math.min(STEPS.length - 1, current + 1))
            }
            className="glass-btn-primary inline-flex items-center gap-1 text-xs disabled:opacity-40"
          >
            下一步 <ChevronRight className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="glass-btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            创建 {count} 条视频
          </button>
        )}
      </div>
    </div>
  );
}
