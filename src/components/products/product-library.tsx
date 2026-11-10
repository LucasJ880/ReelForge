"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Clapperboard, ImagePlus, Loader2, PackagePlus, Pencil, X } from "lucide-react";
import { EmptyState } from "@/components/exchange/empty-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCT_IMAGES_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_SELLING_POINTS_MAX,
  type ProductProfileImage,
  type ProductProfileView,
} from "@/lib/contracts/product-profile";
import { PRODUCT_SIZE_MAX } from "@/lib/create/product-size";
import { uploadBlobWithProgress } from "@/lib/upload/blob-xhr";
import type { Locale } from "@/i18n/config";
import { getPlatformCopy } from "@/i18n/platform-copy";

/**
 * 「商品」页（2026-11-10）：常拍的商品存一次——名字、卖点、尺寸、商品图——以后点「拍一条」就带进创作页。
 *
 * 页头那枚「新建商品」是这页唯一的实心主钮；它在页头（服务端渲染的 WorkspacePage 里），编辑框在这里，
 * 所以用一个很小的 context 把「请打开新建」递过来（同品牌页的做法）。
 * 归档不是删除：记录保留，只是不再出现在这里和创作页。
 */

export type ProductSuggestion = { orderId: string; title: string; thumbnailUrl: string; imageCount: number };

type Copy = ReturnType<typeof getPlatformCopy>["products"];
type Channel = { requestNew: () => void; register: (open: () => void) => () => void };

const ProductLibraryContext = createContext<Channel | null>(null);

export function ProductLibraryProvider({ children }: { children: React.ReactNode }) {
  const opener = useRef<(() => void) | null>(null);
  const value = useMemo<Channel>(
    () => ({
      requestNew: () => opener.current?.(),
      register: (open) => {
        opener.current = open;
        return () => {
          if (opener.current === open) opener.current = null;
        };
      },
    }),
    [],
  );
  return <ProductLibraryContext.Provider value={value}>{children}</ProductLibraryContext.Provider>;
}

export function NewProductButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const channel = useContext(ProductLibraryContext);
  return (
    <Button type="button" disabled={disabled || !channel} onClick={() => channel?.requestNew()} data-testid="product-new">
      <PackagePlus aria-hidden />
      {label}
    </Button>
  );
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string | null };

async function sendProduct<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | ({ ok: true } & T)
      | { ok: false; error?: string }
      | null;
    if (response.ok && payload?.ok) return { ok: true, data: payload };
    return { ok: false, error: payload && !payload.ok && payload.error ? payload.error : null };
  } catch {
    return { ok: false, error: null };
  }
}

export function ProductLibrary({
  locale,
  initialProducts,
  suggestions,
}: {
  locale: Locale;
  initialProducts: ProductProfileView[];
  suggestions: ProductSuggestion[];
}) {
  const copy = getPlatformCopy(locale).products;
  const router = useRouter();
  const channel = useContext(ProductLibraryContext);
  const [products, setProducts] = useState(initialProducts);
  const [editor, setEditor] = useState<{ product: ProductProfileView | null } | null>(null);
  const [archiving, setArchiving] = useState<ProductProfileView | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [savedOrderIds, setSavedOrderIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function openNew() {
    setNotice(null);
    setEditor({ product: null });
  }
  /// 页头的「新建商品」通过 context 叫到这里
  useEffect(
    () =>
      channel?.register(() => {
        setNotice(null);
        setEditor({ product: null });
      }),
    [channel],
  );

  function upsert(product: ProductProfileView) {
    setProducts((current) => [product, ...current.filter((item) => item.id !== product.id)]);
  }

  async function archive(product: ProductProfileView) {
    setArchiveBusy(true);
    const result = await sendProduct<{ product: null }>(`/api/products/${encodeURIComponent(product.id)}`, "PATCH", { archived: true });
    setArchiveBusy(false);
    setArchiveOpen(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error ?? copy.saveFailed });
      return;
    }
    setProducts((current) => current.filter((item) => item.id !== product.id));
    setNotice({ tone: "ok", text: copy.archived });
    router.refresh();
  }

  async function saveSuggestion(orderId: string) {
    setImportingId(orderId);
    setNotice(null);
    const result = await sendProduct<{ product: ProductProfileView }>("/api/products", "POST", { fromOrderId: orderId });
    setImportingId(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error ?? copy.saveFailed });
      return;
    }
    upsert(result.data.product);
    setSavedOrderIds((current) => [...current, orderId]);
    setNotice({ tone: "ok", text: copy.saved });
    router.refresh();
  }

  const openSuggestions = suggestions.filter((item) => !savedOrderIds.includes(item.orderId));

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="product-library">
      {notice ? (
        <p role="status" className={notice.tone === "error" ? "text-meta text-danger" : "text-meta text-muted-foreground"}>
          {notice.text}
        </p>
      ) : null}

      {products.length === 0 ? (
        <EmptyState
          title={copy.emptyTitle}
          body={copy.emptyBody}
          action={{ label: copy.newProduct, onClick: openNew, icon: <PackagePlus aria-hidden /> }}
          data-testid="product-empty"
        />
      ) : (
        <section aria-label={copy.listTitle} className="min-w-0">
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <li key={product.id} className="x-panel flex min-w-0 flex-col gap-4 p-4" data-testid="product-card">
                <div className="flex min-w-0 gap-3">
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0].url}
                      alt=""
                      loading="lazy"
                      className="size-20 shrink-0 rounded-(--radius-md) bg-(--brand-tile) object-cover"
                    />
                  ) : (
                    <span className="size-20 shrink-0 rounded-(--radius-md) border border-border bg-secondary" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-subhead font-medium text-foreground">{product.name}</h3>
                    <p className="mt-0.5 text-data tabular-nums text-tertiary">
                      {product.images.length > 0
                        ? copy.imageCount.replace("{count}", String(product.images.length))
                        : copy.noImages}
                      {product.size ? ` · ${copy.sizeLabel} ${product.size}` : ""}
                    </p>
                    {product.sellingPoints ? (
                      <p className="mt-1.5 line-clamp-2 text-meta text-muted-foreground">{product.sellingPoints}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {product.images.length > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/app/create?product=${encodeURIComponent(product.id)}`} prefetch={false} />}
                      data-testid="product-shoot"
                    >
                      <Clapperboard aria-hidden />
                      {copy.shoot}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNotice(null);
                      setEditor({ product });
                    }}
                  >
                    <Pencil aria-hidden />
                    {copy.edit}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`${copy.archive} · ${product.name}`}
                    title={copy.archive}
                    onClick={() => {
                      setArchiving(product);
                      setArchiveOpen(true);
                    }}
                  >
                    <Archive aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openSuggestions.length > 0 ? (
        <section aria-label={copy.suggestionsTitle} className="min-w-0 space-y-3" data-testid="product-suggestions">
          <div>
            <h2 className="text-subhead font-medium text-foreground">{copy.suggestionsTitle}</h2>
            <p className="mt-1 text-meta text-muted-foreground">{copy.suggestionsHint}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {openSuggestions.map((item) => (
              <li
                key={item.orderId}
                className="flex min-w-0 items-center gap-3 rounded-(--radius-lg) border border-border bg-surface p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="size-12 shrink-0 rounded-(--radius-md) bg-(--brand-tile) object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-meta font-medium text-foreground">{item.title}</span>
                  <span className="block text-data tabular-nums text-tertiary">
                    {copy.imageCount.replace("{count}", String(item.imageCount))}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={importingId !== null}
                  onClick={() => void saveSuggestion(item.orderId)}
                >
                  {importingId === item.orderId ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                  {importingId === item.orderId ? copy.savingSuggestion : copy.saveSuggestion}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editor ? (
        <ProductEditor
          key={editor.product?.id ?? "new"}
          copy={copy}
          product={editor.product}
          onClose={() => setEditor(null)}
          onSaved={(product) => {
            upsert(product);
            setEditor(null);
            setNotice({ tone: "ok", text: copy.saved });
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        testId="product-archive-confirm"
        busy={archiveBusy}
        title={copy.archiveTitle.replace("{name}", archiving?.name ?? "")}
        description={copy.archiveBody}
        confirmLabel={copy.archive}
        cancelLabel={copy.cancel}
        onConfirm={() => {
          if (archiving) void archive(archiving);
        }}
      />
    </div>
  );
}

function ProductEditor({
  copy,
  product,
  onClose,
  onSaved,
}: {
  copy: Copy;
  product: ProductProfileView | null;
  onClose: () => void;
  onSaved: (product: ProductProfileView) => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [points, setPoints] = useState(product?.sellingPoints ?? "");
  const [size, setSize] = useState(product?.size ?? "");
  const [images, setImages] = useState<ProductProfileImage[]>(product?.images ?? []);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef<AbortController | null>(null);

  /// 关掉编辑框 = 取消还在路上的上传（已经传完的图留在素材里，不会丢，也不会挂到任何商品上）
  useEffect(() => () => uploads.current?.abort(), []);

  async function addFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    if (fileInput.current) fileInput.current.value = "";
    if (files.length === 0) return;
    const room = PRODUCT_IMAGES_MAX - images.length;
    const accepted = files.slice(0, Math.max(0, room));
    setError(files.length > accepted.length ? copy.tooManyImages.replace("{max}", String(PRODUCT_IMAGES_MAX)) : null);
    if (accepted.length === 0) return;
    const controller = new AbortController();
    uploads.current = controller;
    setUploading({ done: 0, total: accepted.length });
    let failed = false;
    for (const [index, file] of accepted.entries()) {
      try {
        const asset = await uploadBlobWithProgress({ file, signal: controller.signal });
        if (controller.signal.aborted) return;
        setImages((current) =>
          current.length >= PRODUCT_IMAGES_MAX || current.some((image) => image.assetId === asset.assetId)
            ? current
            : [...current, { assetId: asset.assetId, url: asset.url }],
        );
      } catch {
        if (controller.signal.aborted) return;
        failed = true;
      }
      setUploading({ done: index + 1, total: accepted.length });
    }
    setUploading(null);
    if (failed) setError(copy.uploadFailed);
  }

  async function save() {
    if (!name.trim()) {
      setError(copy.nameRequired);
      return;
    }
    if (images.length === 0) {
      setError(copy.imageRequired);
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      sellingPoints: points.trim(),
      size: size.trim(),
      imageAssetIds: images.map((image) => image.assetId),
    };
    const result = product
      ? await sendProduct<{ product: ProductProfileView }>(`/api/products/${encodeURIComponent(product.id)}`, "PATCH", body)
      : await sendProduct<{ product: ProductProfileView }>("/api/products", "POST", body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? copy.saveFailed);
      return;
    }
    onSaved(result.data.product);
  }

  const busy = saving || uploading !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[min(90vh,46rem)] overflow-y-auto sm:max-w-lg" data-testid="product-editor">
        <DialogHeader>
          <DialogTitle className="leading-snug">{product ? copy.dialogEdit : copy.dialogNew}</DialogTitle>
          <DialogDescription>{copy.dialogHint}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-meta text-muted-foreground">
            <span>{copy.fieldName}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={PRODUCT_NAME_MAX}
              placeholder={copy.fieldNamePlaceholder}
              disabled={saving}
              data-testid="product-name"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-meta text-muted-foreground">
            <span>{copy.fieldPoints}</span>
            <Textarea
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              maxLength={PRODUCT_SELLING_POINTS_MAX}
              rows={3}
              placeholder={copy.fieldPointsPlaceholder}
              disabled={saving}
              data-testid="product-points"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-meta text-muted-foreground">
            <span>{copy.fieldSize}</span>
            <Input
              value={size}
              onChange={(event) => setSize(event.target.value)}
              maxLength={PRODUCT_SIZE_MAX}
              placeholder={copy.fieldSizePlaceholder}
              disabled={saving}
              data-testid="product-size"
            />
            <span className="text-tertiary">{copy.fieldSizeHint}</span>
          </label>

          <div className="flex flex-col gap-2">
            <p className="text-meta text-muted-foreground">
              {copy.fieldImages}
              <span className="ml-2 tabular-nums text-tertiary">
                {images.length} / {PRODUCT_IMAGES_MAX}
              </span>
            </p>
            {images.length > 0 ? (
              <ul className="flex flex-wrap gap-2" data-testid="product-images">
                {images.map((image) => (
                  <li key={image.assetId} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt=""
                      className="size-16 rounded-(--radius-md) border border-border bg-(--brand-tile) object-cover"
                    />
                    <button
                      type="button"
                      aria-label={copy.removeImage}
                      title={copy.removeImage}
                      disabled={saving}
                      onClick={() => setImages((current) => current.filter((item) => item.assetId !== image.assetId))}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border-strong bg-popover text-foreground hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(event) => void addFiles(event.target.files)}
              data-testid="product-file-input"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || images.length >= PRODUCT_IMAGES_MAX}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus aria-hidden />}
                {uploading
                  ? copy.uploading.replace("{done}", String(uploading.done)).replace("{total}", String(uploading.total))
                  : copy.addImages}
              </Button>
              <span className="min-w-0 flex-1 text-meta text-tertiary">
                {copy.fieldImagesHint.replace("{max}", String(PRODUCT_IMAGES_MAX))}
              </span>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()} data-testid="product-save">
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {saving ? copy.saving : copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
