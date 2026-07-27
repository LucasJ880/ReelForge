"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Check, Loader2, LockKeyhole, PackagePlus, Pencil, Upload } from "lucide-react";
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
        empty: "No workspace brand package yet.",
        save: "Save brand package",
        cancel: "Cancel",
        logo: "Logo",
        endCard: "End card (optional)",
        upload: "Upload",
        aiHint: "AI logo generation becomes available after your first project is created.",
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
        empty: "还没有工作区品牌包。",
        save: "保存品牌包",
        cancel: "取消",
        logo: "Logo",
        endCard: "尾卡（可选）",
        upload: "上传",
        aiHint: "创建第一个项目后即可使用 AI Logo 生成。",
        saved: "品牌包已保存。",
        failed: "品牌包保存失败。",
      };
  const [packages, setPackages] = useState(initialPackages);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"logo" | "end-card" | "save" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
    <div className="min-w-0 space-y-8">
      <PackageSection
        title={copy.global}
        description={copy.globalHint}
        packages={globalPackages}
        empty={copy.empty}
        readonlyLabel={copy.readonly}
        defaultLabel={copy.default}
        editLabel={copy.edit}
        onEdit={editPackage}
      />

      <section className="min-w-0 space-y-4" aria-labelledby="workspace-brand-packages">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="workspace-brand-packages" className="font-heading text-title font-semibold">{copy.workspace}</h2>
            <p className="mt-1 max-w-2xl text-body text-muted-foreground">{copy.workspaceHint}</p>
          </div>
          <Button type="button" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setMessage(null); }}>
            <PackagePlus aria-hidden />{copy.add}
          </Button>
        </div>
        <PackageCards
          packages={workspacePackages}
          empty={copy.empty}
          readonlyLabel={copy.readonly}
          defaultLabel={copy.default}
          editLabel={copy.edit}
          onEdit={editPackage}
        />
      </section>

      {draft ? (
        <section className="rounded-(--radius-lg) border border-border bg-card p-5" aria-label={copy.add}>
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
    </div>
  );
}

function PackageSection(props: {
  title: string;
  description: string;
  packages: WorkspaceBrandPackageView[];
  empty: string;
  readonlyLabel: string;
  defaultLabel: string;
  editLabel: string;
  onEdit: (item: WorkspaceBrandPackageView) => void;
}) {
  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h2 className="font-heading text-title font-semibold">{props.title}</h2>
        <p className="mt-1 max-w-2xl text-body text-muted-foreground">{props.description}</p>
      </div>
      <PackageCards {...props} />
    </section>
  );
}

function PackageCards({
  packages,
  empty,
  readonlyLabel,
  defaultLabel,
  editLabel,
  onEdit,
}: {
  packages: WorkspaceBrandPackageView[];
  empty: string;
  readonlyLabel: string;
  defaultLabel: string;
  editLabel: string;
  onEdit: (item: WorkspaceBrandPackageView) => void;
}) {
  if (packages.length === 0) {
    return <div className="rounded-(--radius-lg) border border-dashed border-border px-5 py-8 text-body text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packages.map((item) => (
        <article key={item.id} className="min-w-0 rounded-(--radius-lg) border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="relative size-14 shrink-0 overflow-hidden rounded-(--radius-md) border border-border bg-white">
              <Image src={item.logoAsset.url} alt="" fill unoptimized className="object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-heading text-subhead font-semibold">{item.name}</h3>
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
    <div className="rounded-(--radius-md) border border-border bg-muted p-3">
      <p className="text-meta font-medium">{label}</p>
      <div className="mt-3 flex min-w-0 items-center gap-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-(--radius-md) border border-border bg-white">
          {url ? <Image src={url} alt="" fill unoptimized className="object-contain" /> : null}
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
