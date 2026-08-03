"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Anchor, Loader2, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/useTranslation";
import type {
  LogoBoxInput,
  ProductAnchorView,
} from "@/lib/contracts/product-anchor-api";

type AssetView = {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/** 小于 2% 的框视为误触：与契约 logoBoxSchema 的下限一致。 */
const MIN_BOX_EDGE = 0.02;

function statusBadge(anchor: ProductAnchorView, english: boolean) {
  if (anchor.status === "READY") {
    return <Badge variant="success">{english ? "Ready" : "已就绪"}</Badge>;
  }
  if (anchor.status === "FAILED") {
    return <Badge variant="destructive">{english ? "Failed" : "抠图失败"}</Badge>;
  }
  return <Badge variant="warning">{english ? "Pending cutout" : "待抠图"}</Badge>;
}

/**
 * B1 · 产品锚点管理（PRD §5 / M5）：
 * 上传产品图 → 框选产品区域（= 校验 Gate 的 logoBox，也是 remove.bg 的 roi）
 * → 填 SKU → 提交锚定。一个 SKU 锚定一次，之后单条/批量内容全部复用。
 */
export function ProductAnchorManager({
  initialAnchors,
}: {
  initialAnchors: ProductAnchorView[];
}) {
  const { locale } = useTranslation();
  const english = locale === "en-US";

  const [anchors, setAnchors] = useState(initialAnchors);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [brandName, setBrandName] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceAsset, setSourceAsset] = useState<AssetView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /// 框选状态：拖拽中的两个归一化端点；完成后落成 logoBox。
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [logoBox, setLogoBox] = useState<LogoBoxInput | null>(null);
  const selectAreaRef = useRef<HTMLDivElement | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);
  const refreshTimersRef = useRef<number[]>([]);

  useEffect(() => {
    const timers = refreshTimersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      submitAbortRef.current?.abort();
    };
  }, []);

  async function refreshList() {
    try {
      const response = await fetch("/api/product-anchors", { cache: "no-store" });
      const data = (await response.json()) as { anchors?: ProductAnchorView[] };
      if (response.ok && data.anchors) setAnchors(data.anchors);
    } catch {
      // 列表刷新失败不打断商家；下一次进入页面仍是准的。
    }
  }

  /// 中断等待（不是中断服务端抠图）后，隔几拍把落库结果捞回列表。
  function scheduleRefreshes() {
    for (const delay of [5_000, 15_000, 35_000]) {
      refreshTimersRef.current.push(
        window.setTimeout(() => void refreshList(), delay),
      );
    }
  }

  function resetDraft() {
    setSku("");
    setBrandName("");
    setSourceFile(null);
    setSourceAsset(null);
    setLogoBox(null);
    setDragStart(null);
    setDragCurrent(null);
    setError(null);
  }

  function closeDialog() {
    if (submitting) {
      /// 铁律 #7（取消语义）：中断等待、保留已上传素材；无幂等键需要清
      /// （同 SKU upsert 天然幂等）。服务端抠图若已在跑，结果稍后回列表。
      submitAbortRef.current?.abort();
      scheduleRefreshes();
    }
    setDialogOpen(false);
    setSubmitting(false);
    resetDraft();
  }

  async function uploadSource(file: File | null) {
    setSourceFile(file);
    setSourceAsset(null);
    setLogoBox(null);
    setError(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError(english ? "Image must be under 20MB." : "产品图不能超过 20MB。");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("prefix", "product-anchors/sources");
      const response = await fetch("/api/upload/blob", { method: "POST", body: form });
      const data = (await response.json()) as { asset?: AssetView; error?: string };
      if (!response.ok || !data.asset) {
        throw new Error(data.error ?? (english ? "Upload failed." : "上传失败，请重试。"));
      }
      setSourceAsset(data.asset);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function normalizedPoint(event: React.PointerEvent<HTMLDivElement>) {
    const rect = selectAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = normalizedPoint(event);
    if (!point) return;
    try {
      /// 把后续 move/up 锁到框选区，拖出边界也不丢事件。
      /// 个别环境（如合成事件、已释放的指针）会抛 NotFoundError——
      /// 没有 capture 也能框选，只是拖出区域外时以最后位置为准。
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 见上：capture 只是增强，不是前提。
    }
    setDragStart(point);
    setDragCurrent(point);
    setLogoBox(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const point = normalizedPoint(event);
    if (point) setDragCurrent(point);
  }

  function handlePointerUp() {
    if (dragStart && dragCurrent) {
      const box = {
        x: Math.min(dragStart.x, dragCurrent.x),
        y: Math.min(dragStart.y, dragCurrent.y),
        width: Math.abs(dragCurrent.x - dragStart.x),
        height: Math.abs(dragCurrent.y - dragStart.y),
      };
      setLogoBox(box.width >= MIN_BOX_EDGE && box.height >= MIN_BOX_EDGE ? box : null);
    }
    setDragStart(null);
    setDragCurrent(null);
  }

  const previewBox =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : logoBox;

  const canSubmit =
    sku.trim().length > 0 && Boolean(sourceAsset) && Boolean(logoBox) &&
    !uploading && !submitting;

  async function submit() {
    if (!canSubmit || !sourceAsset || !logoBox) return;
    setSubmitting(true);
    setError(null);
    const controller = new AbortController();
    submitAbortRef.current = controller;
    try {
      const response = await fetch("/api/product-anchors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          sku: sku.trim(),
          brandName: brandName.trim() || undefined,
          sourceAssetId: sourceAsset.id,
          logoBox,
        }),
      });
      const data = (await response.json()) as {
        anchor?: ProductAnchorView;
        error?: string;
      };
      if (!response.ok || !data.anchor) {
        throw new Error(
          data.error ?? (english ? "Anchoring failed." : "锚定失败，请重试。"),
        );
      }
      setAnchors((current) => [
        data.anchor!,
        ...current.filter((anchor) => anchor.id !== data.anchor!.id),
      ]);
      setDialogOpen(false);
      resetDraft();
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setError((reason as Error).message);
      }
    } finally {
      setSubmitting(false);
      submitAbortRef.current = null;
    }
  }

  async function retryAnchor(anchor: ProductAnchorView) {
    setRetryingId(anchor.id);
    try {
      const response = await fetch(
        `/api/product-anchors/${encodeURIComponent(anchor.id)}/retry`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        anchor?: ProductAnchorView;
        error?: string;
      };
      if (response.ok && data.anchor) {
        setAnchors((current) =>
          current.map((item) => (item.id === data.anchor!.id ? data.anchor! : item)),
        );
      }
    } catch {
      // 状态没变，商家可再点；持久失败会带 failureReason 显示在卡片上。
    } finally {
      setRetryingId(null);
    }
  }

  const aspectRatioValue =
    sourceAsset?.width && sourceAsset.height
      ? sourceAsset.width / sourceAsset.height
      : 4 / 3;
  const aspectRatio =
    sourceAsset?.width && sourceAsset.height
      ? `${sourceAsset.width} / ${sourceAsset.height}`
      : "4 / 3";

  return (
    <Card data-testid="product-anchor-manager">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{english ? "Product anchors" : "产品锚点"}</CardTitle>
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)} data-testid="product-anchor-open">
            <Anchor aria-hidden />
            {english ? "Anchor a product" : "锚定新产品"}
          </Button>
        </div>
        <p className="max-w-3xl text-meta text-muted-foreground">
          {english
            ? "One anchor per SKU: we cut the exact product pixels once, then every generated scene reuses them untouched — no more repainted products."
            : "一个 SKU 锚定一次：先把真实产品像素抠出来，之后生成的所有场景原样复用这份切片，产品不再被模型重画。"}
        </p>
      </CardHeader>
      <CardContent>
        {anchors.length === 0 ? (
          <div className="glass-well rounded-(--radius-md) px-5 py-8 text-center">
            <p className="text-body text-muted-foreground">
              {english
                ? "No anchors yet. Upload a product photo, draw a box around the product, and name the SKU."
                : "还没有锚定的产品。上传产品图、框住产品、填上 SKU 名，就能开始。"}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="product-anchor-list">
            {anchors.map((anchor) => (
              <li
                key={anchor.id}
                className="flex min-w-0 gap-4 rounded-(--radius-md) border border-border bg-card p-4 transition-colors hover:border-border-strong"
              >
                <span className="glass-well relative size-20 shrink-0 overflow-hidden rounded-(--radius-sm)">
                  <Image
                    src={anchor.cutoutUrl ?? anchor.sourceImageUrl}
                    alt={anchor.sku}
                    fill
                    sizes="80px"
                    className="object-contain p-1"
                    unoptimized
                  />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate font-mono text-meta font-medium tabular-nums">{anchor.sku}</p>
                  {anchor.brandName ? (
                    <p className="truncate text-meta text-muted-foreground">{anchor.brandName}</p>
                  ) : null}
                  {statusBadge(anchor, english)}
                  {anchor.status !== "READY" && anchor.failureReason ? (
                    <p className="text-meta text-muted-foreground">{anchor.failureReason}</p>
                  ) : null}
                  {anchor.status !== "READY" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={retryingId === anchor.id}
                      onClick={() => void retryAnchor(anchor)}
                    >
                      {retryingId === anchor.id ? (
                        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <RefreshCw aria-hidden />
                      )}
                      {anchor.status === "FAILED"
                        ? english ? "Retry cutout" : "重试抠图"
                        : english ? "Resume cutout" : "继续抠图"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{english ? "Anchor this product" : "锚定这个产品"}</DialogTitle>
            <DialogDescription>
              {english
                ? "Upload the product photo, drag a box around the product itself, then name the SKU. The box tells the cutout exactly what the product is."
                : "上传产品图，在图上拖一个框住产品本体，再填 SKU 名。这个框决定抠图把什么当成产品，生活场景照尤其重要。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!sourceAsset ? (
              <label className="block cursor-pointer rounded-(--radius-md) border border-dashed border-border-strong bg-muted p-4 text-center hover:border-primary">
                <input
                  data-testid="product-anchor-source"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(event) => void uploadSource(event.target.files?.[0] ?? null)}
                />
                <span className="flex min-h-24 flex-col items-center justify-center gap-2">
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <Upload className="size-5 text-muted-foreground" aria-hidden />
                  )}
                  <span className="font-medium text-foreground">
                    {uploading
                      ? english ? "Uploading…" : "上传中…"
                      : english ? "Upload product photo" : "上传产品图"}
                  </span>
                  <span className="text-meta text-muted-foreground">
                    {english ? "PNG / JPG / WebP, up to 20MB" : "PNG / JPG / WebP，20MB 以内"}
                  </span>
                </span>
              </label>
            ) : (
              <div className="space-y-2">
                <div
                  ref={selectAreaRef}
                  data-testid="product-anchor-select-area"
                  className="glass-well relative mx-auto touch-none select-none overflow-hidden rounded-(--radius-md)"
                  /// 竖幅产品图不限高会把框选区撑出视口，没法一次框完整个产品
                  /// （0803 验收 390x790 蜂巢帘实测）。宽度按比例钳到 52vh 等效值。
                  style={{
                    aspectRatio,
                    cursor: "crosshair",
                    width: `min(100%, calc(52vh * ${aspectRatioValue}))`,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <Image
                    src={sourceAsset.url}
                    alt={sourceFile?.name ?? sku ?? "product"}
                    fill
                    sizes="(max-width: 640px) 100vw, 36rem"
                    className="pointer-events-none object-cover"
                    unoptimized
                  />
                  {previewBox ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute rounded-(--radius-sm) border-2 border-primary bg-accent-soft"
                      style={{
                        left: `${previewBox.x * 100}%`,
                        top: `${previewBox.y * 100}%`,
                        width: `${previewBox.width * 100}%`,
                        height: `${previewBox.height * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-meta text-muted-foreground">
                    {logoBox
                      ? english
                        ? "Box saved. Drag again to redo."
                        : "已框选，重新拖拽可调整。"
                      : english
                        ? "Drag on the image to box the product."
                        : "在图上拖拽，框住产品本体。"}
                  </p>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void uploadSource(null)}>
                    {english ? "Replace image" : "换一张图"}
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-meta font-medium text-muted-foreground">
                {english ? "SKU name" : "SKU 名称"}
                <Input
                  data-testid="product-anchor-sku"
                  value={sku}
                  maxLength={80}
                  onChange={(event) => setSku(event.target.value)}
                  className="mt-2"
                  placeholder={english ? "e.g. roman-shade-walnut" : "如：胡桃色罗马帘"}
                />
              </label>
              <label className="block text-meta font-medium text-muted-foreground">
                {english ? "Brand name (optional)" : "品牌名（选填）"}
                <Input
                  value={brandName}
                  maxLength={120}
                  onChange={(event) => setBrandName(event.target.value)}
                  className="mt-2"
                  placeholder={english ? "Used to verify logo text" : "用于校验产品上的品牌文字"}
                />
              </label>
            </div>

            {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>
              {english ? "Cancel" : "取消"}
            </Button>
            <Button
              type="button"
              data-testid="product-anchor-submit"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitting ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Anchor aria-hidden />
              )}
              {submitting
                ? english ? "Cutting out…" : "抠图中…"
                : english ? "Anchor product" : "开始锚定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
