"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  Loader2,
  Sparkles,
  X,
  Zap,
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
import { Textarea } from "@/components/ui/textarea";
import { FileDropzone } from "@/components/ui/dropzone";
import { EditorialStepper } from "@/components/editorial/editorial-stepper";
import type {
  OwnedUnifiedVideoGenerationRequest,
  UploadedAsset,
  VideoGenerationPlan,
} from "@/types/video-generation";
import { toOwnedCreationRequest } from "@/types/video-generation";
import {
  consumeCreatePrefill,
  uploadFilesToAssets,
} from "@/components/personal/upload-assets";
import { getStyleTemplate } from "@/lib/video-generation/style-templates";
import type { CustomerVideoDispatchResponse } from "@/lib/api/customer-video-dispatch";
import {
  customerDirectDispatchMessage,
  shouldResetDispatchAttempt,
} from "@/lib/api/customer-video-dispatch-recovery";

type CreateMode = "fast" | "director";
type Duration = 15 | 30 | 60;
type Ratio = "9:16" | "16:9" | "1:1";

interface DispatchResult {
  nextUrl: string;
  batch: Array<{ briefId: string; deliveryOrderId: string }>;
}

export function EditorialCreateWorkflow({
  initialMode,
}: {
  initialMode: CreateMode;
}) {
  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [images, setImages] = useState<UploadedAsset[]>([]);
  const [refVideo, setRefVideo] = useState<UploadedAsset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<Duration>(15);
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [batchCount, setBatchCount] = useState(1);
  const [styleTemplateId, setStyleTemplateId] = useState<string | null>(null);
  const [lockIds, setLockIds] = useState<string[]>([]);
  const [language, setLanguage] = useState("zh-CN");

  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [plan, setPlan] = useState<VideoGenerationPlan | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DispatchResult | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const dispatchAttemptRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  const log = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((prev) => [...prev.slice(-120), `[${ts}] ${line}`]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  /// 从 Agent 页 / 提示词库带过来的预填
  useEffect(() => {
    const prefill = consumeCreatePrefill();
    if (!prefill) return;
    if (prefill.prompt) setPrompt(prefill.prompt);
    if (prefill.duration) setDuration(prefill.duration);
    if (prefill.mode) setMode(prefill.mode);
    if (prefill.styleTemplateId) setStyleTemplateId(prefill.styleTemplateId);
    if (prefill.consistencyLockIds?.length) setLockIds(prefill.consistencyLockIds);
    if (prefill.language) setLanguage(prefill.language);
    if (prefill.attachments?.length) {
      setImages(prefill.attachments.filter((a) => a.type === "IMAGE"));
      const video = prefill.attachments.find((a) => a.type === "VIDEO");
      if (video) setRefVideo(video);
    }
    log("已载入 Agent / 模板带来的创作需求");
  }, [log]);

  async function handleImageFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 10 - images.length);
    if (list.length === 0) return;
    setError(null);
    setUploadingImages(true);
    log(`上传 ${list.length} 张产品图…`);
    try {
      const assets = await uploadFilesToAssets(list, {
        forceRole: "product_image",
      });
      setImages((prev) => [...prev, ...assets].slice(0, 10));
      log(`产品图上传完成（共 ${Math.min(images.length + list.length, 10)} 张）`);
      toast.success(`已上传 ${assets.length} 张产品图`);
    } catch (e) {
      setError((e as Error).message);
      log(`产品图上传失败：${(e as Error).message}`);
      toast.error((e as Error).message);
    } finally {
      setUploadingImages(false);
    }
  }

  async function handleVideoFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("video/")) return;
    setError(null);
    setUploadingVideo(true);
    log("上传爆款参考视频…");
    try {
      /// 参考视频用 ad_clip 角色进 pipeline（供风格/节奏参考）
      const [asset] = await uploadFilesToAssets([file], {
        forceRole: "ad_clip",
      });
      setRefVideo(asset);
      log("参考视频上传完成");
    } catch (e) {
      setError((e as Error).message);
      log(`参考视频上传失败：${(e as Error).message}`);
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  function buildRequest(): OwnedUnifiedVideoGenerationRequest {
    const attachments: UploadedAsset[] = [...images];
    if (refVideo) attachments.push(refVideo);
    return toOwnedCreationRequest({
      userType: "personal" as const,
      rawPrompt: prompt.trim(),
      attachments,
      selectedDuration: duration,
      selectedAspectRatio: ratio,
      selectedBrandEndingMode: "none" as const,
      platform: "tiktok" as const,
      language,
      styleTemplateId,
      consistencyLockIds: lockIds.length > 0 ? lockIds : null,
    });
  }

  const canPlan = prompt.trim().length >= 4 && !planning && !dispatching;

  async function generateScript() {
    if (!canPlan) return;
    setError(null);
    setPlanning(true);
    setPlan(null);
    setEditedPrompts({});
    setDone(null);
    log(`第一步：AI 解析需求并生成${mode === "director" ? "分镜脚本" : "脚本"}…`);
    try {
      const res = await fetch("/api/video-generation/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequest()),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "脚本生成失败");
      const p = j.plan as VideoGenerationPlan;
      setPlan(p);
      const aiSegs = p.segments.filter((s) => s.type === "ai_generated_clip");
      log(`脚本已生成：${aiSegs.length} 个镜头 · 共 ${p.planPreview.breakdown.finalDurationSec}s`);
      if (!p.qualityReview.canDispatch) {
        log("描述还需补充细节才能出片，请查看下方提示");
      } else {
        log("请检查/编辑每个镜头的脚本，然后点「确认出片」");
      }
    } catch (e) {
      setError((e as Error).message);
      log(`脚本生成失败：${(e as Error).message}`);
    } finally {
      setPlanning(false);
    }
  }

  async function confirmAndDispatch() {
    if (!plan || dispatching) return;
    setError(null);
    setDispatching(true);
    log(`第二步：确认脚本，开始生成 ${batchCount} 支成片…`);
    try {
      const confirmedPrompts = Object.entries(editedPrompts).map(
        ([order, text]) => ({ segmentOrder: Number(order), prompt: text }),
      );
      const dispatchBody = {
        request: buildRequest(),
        confirmedPrompts,
        batchCount,
      };
      const dispatchFingerprint = JSON.stringify(dispatchBody);
      if (dispatchAttemptRef.current?.fingerprint !== dispatchFingerprint) {
        dispatchAttemptRef.current = {
          fingerprint: dispatchFingerprint,
          key: crypto.randomUUID(),
        };
      }
      const res = await fetch("/api/video-generation/dispatch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": dispatchAttemptRef.current.key,
        },
        body: JSON.stringify(dispatchBody),
      });
      const j = (await res.json()) as CustomerVideoDispatchResponse;
      if (!j.ok) {
        if (shouldResetDispatchAttempt(j)) dispatchAttemptRef.current = null;
        const message = customerDirectDispatchMessage(
          j,
          language.startsWith("zh") ? "zh-CN" : "en-US",
        );
        setError(message);
        log(`出片提交失败：${message}`);
        return;
      }
      if (!res.ok) {
        throw new Error("出片任务提交失败");
      }
      dispatchAttemptRef.current = null;
      log(`已提交 ${j.batch?.length ?? 1} 支成片任务，AI 正在逐镜头生成画面`);
      log("成片完成后可在「成片库」查看和下载（页面会自动刷新进度）");
      const safeBatch = (j.batch ?? []).filter(
        (
          item,
        ): item is { briefId: string; deliveryOrderId: string } =>
          typeof item.briefId === "string" &&
          typeof item.deliveryOrderId === "string",
      );
      setDone({ nextUrl: j.nextUrl ?? "/app/library", batch: safeBatch });
    } catch (e) {
      setError((e as Error).message);
      log(`出片提交失败：${(e as Error).message}`);
    } finally {
      setDispatching(false);
    }
  }

  const aiSegments = plan?.segments.filter((s) => s.type === "ai_generated_clip") ?? [];
  const appliedTemplate = getStyleTemplate(styleTemplateId);

  return (
    <div className="editorial-page-stack pb-16">
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => handleVideoFile(e.target.files)}
      />

      <header className="max-w-4xl space-y-4">
        <Badge variant="secondary">Creative Workflow</Badge>
        <h1 className="editorial-display">
          创作你的下一支<span className="editorial-display-latin"> video</span>
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          从素材、参考到脚本确认，按编辑台顺序完成每一步，所有生成设置保持可回看、可调整。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <EditorialStepper
            currentIndex={
              done ? 4 : plan ? 3 : images.length > 0 ? 1 : 0
            }
            steps={[
              { id: "images", title: "产品图片" },
              { id: "reference", title: "参考视频" },
              { id: "brief", title: "创作需求" },
              { id: "plan", title: "脚本确认" },
              { id: "dispatch", title: "提交生成" },
            ]}
          />
        </aside>

        <div className="space-y-8">
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge>01</Badge>
              <div>
                <CardTitle>选择产品图片</CardTitle>
                <CardDescription>建议上传正面、侧面与细节素材。</CardDescription>
              </div>
            </div>
            <Badge variant="secondary">JPG / PNG / WebP · 最多 10 张</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
        <FileDropzone
          title="拖拽或点击上传产品图片"
          description="建议上传 3-5 张，包含正面/侧面/细节"
          uploading={uploadingImages}
          disabled={images.length >= 10}
          onFiles={(files) => void handleImageFiles(files)}
        />
        {images.length > 0 ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-center gap-3">
                {images.map((img, idx) => (
                  <div key={img.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={`产品图片 ${idx + 1}`}
                      className="size-20 rounded-(--radius-md) border border-border object-cover"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-xs"
                      onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -right-2 -top-2 hidden group-hover:inline-flex group-focus-within:inline-flex"
                      aria-label={`移除产品图片 ${idx + 1}`}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
              {images.length < 10 && (
                <FileDropzone
                  title="继续上传产品图片"
                  description="还可添加更多角度与细节"
                  uploading={uploadingImages}
                  className="py-4"
                  onFiles={(files) => void handleImageFiles(files)}
                />
              )}
            </div>
        ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge>02</Badge>
              <div>
                <CardTitle>爆款参考视频</CardTitle>
                <CardDescription>可选，用于提供节奏与风格参考。</CardDescription>
              </div>
            </div>
            <Badge variant={refVideo ? "success" : "secondary"}>
              {refVideo ? "已选择" : "可选"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploadingVideo}
            onClick={() => videoInputRef.current?.click()}
          >
            {uploadingVideo ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Film />
            )}
            选择爆款视频
          </Button>
          {refVideo ? (
            <span className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
              <span className="max-w-full truncate">{refVideo.fileName}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setRefVideo(null)}
                aria-label="移除参考视频"
              >
                <X />
              </Button>
            </span>
          ) : (
            <span className="text-meta text-muted-foreground">
              未选择 — AI 将按你的描述自行设计节奏
            </span>
          )}
          </div>
          <p className="border-l-2 border-primary pl-4 text-meta text-muted-foreground">
            上传后，AI 会参考镜头结构与节奏，并将你的产品融入每一镜。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge>03</Badge>
              <div>
                <CardTitle>创作模式与需求</CardTitle>
                <CardDescription>快速成片适合直出，导演分镜适合逐镜打磨。</CardDescription>
              </div>
            </div>
            <Badge variant={mode === "fast" ? "success" : "secondary"}>
              {mode === "fast" ? "快速成片" : "导演分镜"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-2">

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => setMode("fast")}
            variant={mode === "fast" ? "default" : "outline"}
            aria-pressed={mode === "fast"}
          >
            <Zap />
            快速成片
          </Button>
          <Button
            type="button"
            onClick={() => setMode("director")}
            variant={mode === "director" ? "default" : "outline"}
            aria-pressed={mode === "director"}
          >
            <Clapperboard />
            导演分镜
          </Button>
          {appliedTemplate && (
            <span className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
              <span className="truncate">风格模版：{appliedTemplate.name}</span>
              {lockIds.length > 0 && ` · ${lockIds.length} 项一致性锁`}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setStyleTemplateId(null);
                  setLockIds([]);
                  log("已移除风格模版，回到自由创作");
                }}
                aria-label="移除风格模版"
              >
                <X />
              </Button>
            </span>
          )}
        </div>

        <label className="block space-y-2 text-meta font-medium">
          创意需求
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="例如：15 秒 UGC 口播，突出防摔卖点，美国市场，真人实拍感。"
            className="resize-none"
          />
        </label>

        <div className="grid gap-5 md:grid-cols-3">
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-meta font-medium">时长</legend>
            <div className="flex flex-wrap gap-2">
            {([15, 30, 60] as Duration[]).map((d) => (
              <Button
                key={d}
                type="button"
                size="xs"
                variant={duration === d ? "default" : "outline"}
                onClick={() => setDuration(d)}
                aria-pressed={duration === d}
              >
                {d}s
              </Button>
            ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-meta font-medium">画幅</legend>
            <div className="flex flex-wrap gap-2">
            {(["9:16", "16:9", "1:1"] as Ratio[]).map((r) => (
              <Button
                key={r}
                type="button"
                size="xs"
                variant={ratio === r ? "default" : "outline"}
                onClick={() => setRatio(r)}
                aria-pressed={ratio === r}
              >
                {r}
              </Button>
            ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-meta font-medium">出片数</legend>
            <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((n) => (
              <Button
                key={n}
                type="button"
                size="xs"
                variant={batchCount === n ? "default" : "outline"}
                onClick={() => setBatchCount(n)}
                aria-pressed={batchCount === n}
              >
                {n}支
              </Button>
            ))}
            </div>
          </fieldset>
        </div>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Badge>04</Badge>
                <div>
                  <CardTitle>镜头脚本</CardTitle>
                  <CardDescription>逐镜检查并编辑生成内容。</CardDescription>
                </div>
              </div>
              <Badge variant="secondary">
                {plan.planPreview.breakdown.finalDurationSec}s ·{" "}
                {plan.planPreview.breakdown.aspectRatio} · {aiSegments.length} 镜
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">

          <p className="text-body text-muted-foreground">{plan.planPreview.summary}</p>

          {!plan.qualityReview.canDispatch && (
            <div role="alert" className="border-l-2 border-warning pl-4 text-meta text-foreground">
              {plan.qualityReview.blockers.map((b) => (
                <p key={b.code}>{b.message}</p>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {aiSegments.map((seg, idx) => (
              <section key={seg.id} className="rounded-(--radius-md) border border-border bg-muted p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                  <span className="text-meta font-semibold">
                    镜头 {idx + 1} · {seg.durationSeconds}s
                  </span>
                  <span className="text-meta text-muted-foreground">
                    {seg.purpose}
                  </span>
                </div>
                <Textarea
                  aria-label={`镜头 ${idx + 1} 脚本`}
                  value={editedPrompts[seg.order] ?? seg.prompt ?? ""}
                  onChange={(e) =>
                    setEditedPrompts((prev) => ({
                      ...prev,
                      [seg.order]: e.target.value,
                    }))
                  }
                  rows={mode === "director" ? 4 : 2}
                  className="resize-y"
                />
              </section>
            ))}
          </div>
          </CardContent>
        </Card>
      )}

      {logs.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>创作记录</CardTitle>
            <CardDescription>当前页面的处理进度。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              ref={logRef}
              className="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-meta text-muted-foreground"
              aria-live="polite"
            >
              {logs.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="border-l-2 border-danger pl-4 text-meta text-danger">
          {error}
        </p>
      )}

      {done && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-md) bg-muted text-success">
                <Check className="size-4 stroke-[1.5]" aria-hidden />
              </span>
              <div>
                <CardTitle>{done.batch.length || 1} 支成片任务已开始生成</CardTitle>
                <CardDescription>
                  AI 正在逐镜头生成画面，完成后自动合成成片，可随时离开此页。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={done.nextUrl} />}>
              前往成片库查看进度
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="sticky bottom-16 z-10 md:bottom-4">
        <CardContent className="flex min-w-0 flex-col gap-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-meta text-muted-foreground" aria-live="polite">
            {dispatching
              ? "出片任务提交中…"
              : planning
                ? "脚本生成中…"
                : plan
                  ? "脚本已就绪 — 检查后确认出片"
                  : "就绪 — 填写需求后点「第一步：生成脚本」"}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {plan ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateScript}
                  disabled={planning || dispatching}
                >
                  {planning && <Loader2 className="animate-spin" />}
                  重新生成脚本
                </Button>
                <Button
                  type="button"
                  onClick={confirmAndDispatch}
                  disabled={dispatching || planning || !plan.qualityReview.canDispatch}
                >
                  {dispatching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Sparkles />
                  )}
                  确认出片（{batchCount} 支）
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={generateScript}
                disabled={!canPlan}
              >
                {planning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Clapperboard />
                )}
                第一步：生成脚本
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
        </div>
      </div>
    </div>
  );
}

/** @deprecated 使用 EditorialCreateWorkflow；保留旧导出避免调用方断裂。 */
export const GlassCreateWorkflow = EditorialCreateWorkflow;
