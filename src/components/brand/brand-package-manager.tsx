"use client";

import Image from "next/image";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, LockKeyhole, PackagePlus, Pencil, Upload } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { EmptyState } from "@/components/exchange/empty-state";
import { SectionHead } from "@/components/exchange/section-head";
import { LogoGeneratorDialog } from "@/components/wizard/logo-generator-dialog";
import { uploadFilesToAssets } from "@/components/personal/upload-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceBrandPackageView } from "@/lib/services/workspace-brand-package-service";
import { useTranslation } from "@/i18n/useTranslation";

type Draft = {
  id?: string;
  name: string;
  brandName: string;
  slogan: string;
  cta: string;
  contactLines: string;
  website: string;
  logoAssetId: string;
  logoUrl: string;
  endCardAssetId: string;
  endCardUrl: string;
  isDefault: boolean;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  brandName: "",
  slogan: "",
  cta: "",
  contactLines: "",
  website: "",
  logoAssetId: "",
  logoUrl: "",
  endCardAssetId: "",
  endCardUrl: "",
  isDefault: false,
};

/**
 * 页头的主行动「新建品牌包」与下方的编辑表单之间的一根线（1025 · B2.4）：
 * 品牌页只有一枚实心主钮，放在行情头；表单打开时它退成描边，表单里的「保存」接过实心。
 */
type DraftChannel = {
  /** 每点一次「新建」加一，表单据此打开一份空白草稿。 */
  newRequest: number;
  requestNew: () => void;
  draftOpen: boolean;
  setDraftOpen: (open: boolean) => void;
};

const BrandPackageDraftContext = createContext<DraftChannel | null>(null);

export function BrandPackageDraftProvider({ children }: { children: React.ReactNode }) {
  const [newRequest, setNewRequest] = useState(0);
  const [draftOpen, setDraftOpen] = useState(false);
  const requestNew = useCallback(() => setNewRequest((value) => value + 1), []);
  const value = useMemo(
    () => ({ newRequest, requestNew, draftOpen, setDraftOpen }),
    [draftOpen, newRequest, requestNew],
  );
  return <BrandPackageDraftContext.Provider value={value}>{children}</BrandPackageDraftContext.Provider>;
}

export function NewBrandPackageButton({ label }: { label: string }) {
  const channel = useContext(BrandPackageDraftContext);
  return (
    <Button
      type="button"
      variant={channel?.draftOpen ? "outline" : "default"}
      disabled={!channel}
      onClick={() => channel?.requestNew()}
      data-testid="brand-package-new"
    >
      <PackagePlus aria-hidden />
      {label}
    </Button>
  );
}

export function BrandPackageManager({
  initialPackages,
  logoProjectId,
}: {
  initialPackages: WorkspaceBrandPackageView[];
  logoProjectId: string | null;
}) {
  const { locale } = useTranslation();
  const english = locale === "en-US";
  const copy = english
    ? {
        global: "Global brand packages",
        workspace: "Workspace brand packages",
        globalHint: "Reusable platform presets. Apply them to a video, but only Aivora operations can edit them.",
        workspaceHint: "Keep your logo, end card, CTA, and contact details ready for every production.",
        add: "New brand package",
        edit: "Edit",
        readonly: "Read only",
        default: "Default",
        empty: "No workspace brand package yet. Add your logo, end card and contact details once, then every video can reuse them.",
        emptyGlobal: "No global brand package has been published yet.",
        save: "Save brand package",
        cancel: "Cancel",
        logo: "Logo",
        endCard: "End card (optional)",
        upload: "Upload",
        aiHint: "AI logo generation unlocks after your first video.",
        saved: "Brand package saved.",
        failed: "Brand package could not be saved.",
      }
    : {
        global: "全局品牌包",
        workspace: "工作区品牌包",
        globalHint: "平台维护的可复用预设，可以直接用于视频，但仅 Aivora 运营可编辑。",
        workspaceHint: "把 Logo、尾卡、行动指引和联系方式沉淀为每次创作都能复用的品牌资产。",
        add: "新建品牌包",
        edit: "编辑",
        readonly: "只读",
        default: "默认",
        empty: "还没有工作区品牌包。把 Logo、尾卡和联系方式整理一次，之后每条视频都能直接套用。",
        emptyGlobal: "平台还没有发布全局品牌包。",
        save: "保存品牌包",
        cancel: "取消",
        logo: "Logo",
        endCard: "尾卡（可选）",
        upload: "上传",
        aiHint: "做出第一条视频后，就能用 AI 生成 Logo。",
        saved: "品牌包已保存。",
        failed: "品牌包保存失败。",
      };
  const [packages, setPackages] = useState(initialPackages);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"logo" | "end-card" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const channel = useContext(BrandPackageDraftContext);
  const formRef = useRef<HTMLElement | null>(null);
  const handledRequest = useRef(channel?.newRequest ?? 0);
  const draftOpen = draft !== null;
  const newRequest = channel?.newRequest ?? 0;
  const setChannelDraftOpen = channel?.setDraftOpen;

  /// 页头「新建品牌包」→ 打开一份空白草稿
  useEffect(() => {
    if (newRequest === handledRequest.current) return;
    handledRequest.current = newRequest;
    setMessage(null);
    setDraft({ ...EMPTY_DRAFT });
  }, [newRequest]);

  /// 表单开合同步给页头主钮；打开时滚到表单
  useEffect(() => {
    setChannelDraftOpen?.(draftOpen);
    if (draftOpen) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draftOpen, setChannelDraftOpen]);

  function startNew() {
    setMessage(null);
    setDraft({ ...EMPTY_DRAFT });
  }
  const globalPackages = useMemo(
    () => packages.filter((item) => item.scope === "global"),
    [packages],
  );
  const workspacePackages = useMemo(
    () => packages.filter((item) => item.scope === "workspace"),
    [packages],
  );

  function editPackage(item: WorkspaceBrandPackageView) {
    if (!item.canEdit) return;
    setMessage(null);
    setDraft({
      id: item.id,
      name: item.name,
      brandName: item.brandName,
      slogan: item.slogan ?? "",
      cta: item.cta ?? "",
      contactLines: item.contactLines.join("\n"),
      website: item.website ?? "",
      logoAssetId: item.logoAsset.id,
      logoUrl: item.logoAsset.url,
      endCardAssetId: item.endCardAsset?.id ?? "",
      endCardUrl: item.endCardAsset?.url ?? "",
      isDefault: item.isDefault,
    });
  }

  async function uploadOwnedAsset(file: File, target: "logo" | "end-card") {
    setBusy(target);
    setMessage(null);
    try {
      const [asset] = await uploadFilesToAssets([file], {
        forceRole: target === "logo" ? "logo" : "outro_clip",
        skipAiClassification: true,
      });
      if (!asset) throw new Error("upload returned no asset");
      setDraft((current) =>
        current
          ? {
              ...current,
              ...(target === "logo"
                ? { logoAssetId: asset.assetId ?? asset.id, logoUrl: asset.url }
                : {
                    endCardAssetId: asset.assetId ?? asset.id,
                    endCardUrl: asset.url,
                  }),
            }
          : current,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.failed);
    } finally {
      setBusy(null);
    }
  }

  async function acceptGeneratedLogo(url: string) {
    setBusy("logo");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("generated logo download failed");
      const blob = await response.blob();
      const file = new File([blob], "generated-logo.png", {
        type: blob.type || "image/png",
      });
      await uploadOwnedAsset(file, "logo");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.failed);
      setBusy(null);
    }
  }

  async function save() {
    if (!draft?.name.trim() || !draft.brandName.trim() || !draft.logoAssetId) {
      setMessage(
        english
          ? "Package name, brand name, and logo are required."
          : "请填写品牌包名称、品牌名称并上传 Logo。",
      );
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/brand-packaging", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          name: draft.name.trim(),
          brandName: draft.brandName.trim(),
          slogan: draft.slogan.trim() || null,
          cta: draft.cta.trim() || null,
          contactLines: draft.contactLines
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 3),
          website: draft.website.trim() || null,
          logoAssetId: draft.logoAssetId,
          endCardAssetId: draft.endCardAssetId || null,
          isDefault: draft.isDefault,
        }),
      });
      const payload = (await response.json()) as {
        brandPackage?: WorkspaceBrandPackageView;
        error?: string;
      };
      if (!response.ok || !payload.brandPackage) {
        throw new Error(payload.error || copy.failed);
      }
      setPackages((current) => [
        ...current.filter((item) => item.id !== payload.brandPackage?.id),
        payload.brandPackage as WorkspaceBrandPackageView,
      ]);
      setDraft(null);
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0 space-y-10">
      <PackageSection
        id="workspace-brand-packages"
        title={copy.workspace}
        description={copy.workspaceHint}
        packages={workspacePackages}
        empty={copy.empty}
        emptyAction={draft ? null : { label: copy.add, onClick: startNew, icon: <PackagePlus aria-hidden /> }}
        readonlyLabel={copy.readonly}
        defaultLabel={copy.default}
        editLabel={copy.edit}
        onEdit={editPackage}
      />

      {draft ? (
        <section ref={formRef} className="x-panel scroll-mt-28 p-5" aria-label={copy.add}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={english ? "Package name" : "品牌包名称"}>
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={english ? "Brand name" : "品牌名称"}>
              <Input value={draft.brandName} onChange={(event) => setDraft({ ...draft, brandName: event.target.value })} />
            </Field>
            <Field label={english ? "Slogan" : "品牌口号"}>
              <Input value={draft.slogan} onChange={(event) => setDraft({ ...draft, slogan: event.target.value })} />
            </Field>
            <Field label={english ? "Call to action" : "行动指引"}>
              <Input value={draft.cta} onChange={(event) => setDraft({ ...draft, cta: event.target.value })} />
            </Field>
            <Field label={english ? "Contact lines (one per line)" : "联系方式（每行一项）"}>
              <Textarea rows={3} value={draft.contactLines} onChange={(event) => setDraft({ ...draft, contactLines: event.target.value })} />
            </Field>
            <Field label={english ? "Website" : "网站"}>
              <Input value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} />
            </Field>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <AssetPicker
              label={copy.logo}
              url={draft.logoUrl}
              busy={busy === "logo"}
              uploadLabel={copy.upload}
              onFile={(file) => void uploadOwnedAsset(file, "logo")}
            >
              <LogoGeneratorDialog
                projectId={logoProjectId ?? ""}
                defaultBusinessName={draft.brandName}
                onSelected={(url) => void acceptGeneratedLogo(url)}
                disabled={!logoProjectId || busy !== null}
              />
              {!logoProjectId ? <p className="text-meta text-muted-foreground">{copy.aiHint}</p> : null}
            </AssetPicker>
            <AssetPicker
              label={copy.endCard}
              url={draft.endCardUrl}
              busy={busy === "end-card"}
              uploadLabel={copy.upload}
              onFile={(file) => void uploadOwnedAsset(file, "end-card")}
            />
          </div>

          <label className="mt-5 flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
            />
            {english ? "Suggest this package by default" : "默认推荐此品牌包"}
          </label>
          {message ? <p role="status" className="mt-4 text-meta text-muted-foreground">{message}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={busy !== null}>{copy.cancel}</Button>
            <Button type="button" onClick={() => void save()} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {copy.save}
            </Button>
          </div>
        </section>
      ) : message ? <p role="status" className="text-meta text-muted-foreground">{message}</p> : null}

      <PackageSection
        id="global-brand-packages"
        title={copy.global}
        description={copy.globalHint}
        packages={globalPackages}
        empty={copy.emptyGlobal}
        emptyAction={null}
        readonlyLabel={copy.readonly}
        defaultLabel={copy.default}
        editLabel={copy.edit}
        onEdit={editPackage}
      />
    </div>
  );
}

/** 品牌页的一块：SectionHead（标题 + 计数 + 一句说明）+ 卡片网格或统一空态。 */
function PackageSection({
  id,
  title,
  description,
  packages,
  empty,
  emptyAction,
  readonlyLabel,
  defaultLabel,
  editLabel,
  onEdit,
}: {
  id: string;
  title: string;
  description: string;
  packages: WorkspaceBrandPackageView[];
  empty: string;
  emptyAction: { label: string; onClick: () => void; icon?: React.ReactNode } | null;
  readonlyLabel: string;
  defaultLabel: string;
  editLabel: string;
  onEdit: (item: WorkspaceBrandPackageView) => void;
}) {
  return (
    <section className="min-w-0 space-y-4" aria-labelledby={id}>
      <SectionHead title={<span id={id}>{title}</span>} count={packages.length} hint={description} />
      {packages.length === 0 ? (
        <EmptyState compact body={empty} action={emptyAction} />
      ) : (
        <PackageCards
          packages={packages}
          readonlyLabel={readonlyLabel}
          defaultLabel={defaultLabel}
          editLabel={editLabel}
          onEdit={onEdit}
        />
      )}
    </section>
  );
}

function PackageCards({
  packages,
  readonlyLabel,
  defaultLabel,
  editLabel,
  onEdit,
}: {
  packages: WorkspaceBrandPackageView[];
  readonlyLabel: string;
  defaultLabel: string;
  editLabel: string;
  onEdit: (item: WorkspaceBrandPackageView) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packages.map((item) => (
        <article key={item.id} className="x-panel min-w-0 p-4">
          <div className="flex items-start gap-3">
            <BrandLogo
              src={item.logoAsset.url}
              brandName={item.brandName}
              className="size-14 shrink-0 rounded-(--radius-md) border border-border bg-(--brand-tile)"
              imageClassName="p-1.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-subhead font-medium">{item.name}</h3>
                {item.isDefault ? <Badge variant="secondary">{defaultLabel}</Badge> : null}
              </div>
              <p className="mt-1 truncate text-meta text-muted-foreground">{item.brandName}</p>
            </div>
          </div>
          {item.slogan ? <p className="mt-4 line-clamp-2 text-body">{item.slogan}</p> : null}
          {item.cta ? <p className="mt-2 text-meta text-muted-foreground">{item.cta}</p> : null}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            {item.scope === "global" ? (
              <span className="inline-flex items-center gap-1 text-meta text-muted-foreground"><LockKeyhole className="size-3.5" aria-hidden />{readonlyLabel}</span>
            ) : <span />}
            {item.canEdit ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(item)}>
                <Pencil aria-hidden />{editLabel}
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetPicker({
  label,
  url,
  busy,
  uploadLabel,
  onFile,
  children,
}: {
  label: string;
  url: string;
  busy: boolean;
  uploadLabel: string;
  onFile: (file: File) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="x-well rounded-(--radius-md) p-3">
      <p className="text-meta font-medium">{label}</p>
      <div className="mt-3 flex min-w-0 items-center gap-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-(--radius-md) border border-border bg-(--brand-tile)">
          {url ? <Image src={url} alt="" fill unoptimized className="object-contain p-1.5" /> : null}
        </div>
        <div className="min-w-0 space-y-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-2 text-meta font-medium">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {uploadLabel}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} />
          </label>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-meta font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
