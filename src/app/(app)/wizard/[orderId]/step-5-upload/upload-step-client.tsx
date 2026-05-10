"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  Link as LinkIcon,
  Loader2,
  Plus,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WizardMockBanner } from "@/components/wizard/wizard-mock-banner";
import type { MissingShotReport } from "@/lib/schemas/asset-qa";

const ACCEPT_DIRECT = "video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp";
const MAX_DIRECT_BYTES = 100 * 1024 * 1024;

type AssetRow = {
  id: string;
  name: string;
  url: string;
  type: string;
  qaStatus: string;
  qaResult: unknown;
  matchedShotId: string | null;
  matchedShot?: { sceneIndex: number; visualIntent: string } | null;
  assetRole?: string | null;
};

type ShotChoice = {
  id: string;
  label: string;
  matched: boolean;
  required: boolean;
};

const STATUS_BADGE: Record<
  string,
  { className: string; label: string }
> = {
  USABLE: {
    className:
      "bg-emerald-500/15 border border-emerald-400/30 text-emerald-200",
    label: "USABLE",
  },
  BARELY_USABLE: {
    className:
      "bg-amber-500/15 border border-amber-400/30 text-amber-200",
    label: "BARELY USABLE",
  },
  RETAKE_RECOMMENDED: {
    className: "bg-rose-500/15 border border-rose-400/30 text-rose-200",
    label: "RETAKE RECOMMENDED",
  },
  PENDING: {
    className: "bg-white/5 border border-white/10 text-muted-foreground",
    label: "PENDING",
  },
  MISSING_SHOT: {
    className: "bg-rose-500/15 border border-rose-400/30 text-rose-200",
    label: "MISSING",
  },
};

export function UploadStepClient({
  orderId,
  initialAssets,
  initialMissingReport,
  shotChoices,
  blobReady,
}: {
  orderId: string;
  initialAssets: AssetRow[];
  initialMissingReport: MissingShotReport;
  shotChoices: ShotChoice[];
  blobReady: boolean;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [report, setReport] = useState<MissingShotReport>(initialMissingReport);
  const [adding, startAdd] = useTransition();
  const [matching, startMatch] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /// 默认 tab：blob 可用走直传，否则 URL
  const [tab, setTab] = useState<"upload" | "url">(blobReady ? "upload" : "url");

  /// 直传状态
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadName, setUploadName] = useState<string | null>(null);

  /// 新建表单（URL mode 用，direct upload 也复用 type/matchedShotId 等元数据）
  const [form, setForm] = useState({
    type: "VIDEO" as "VIDEO" | "IMAGE" | "AUDIO",
    url: "",
    name: "",
    durationMs: "",
    width: "",
    height: "",
    fileSizeBytes: "",
    matchedShotId: "" as string,
  });

  const refresh = async () => {
    const res = await fetch(`/api/wizard/projects/${orderId}/assets`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      assets: AssetRow[];
      missingReport: MissingShotReport;
    };
    setAssets(data.assets);
    setReport(data.missingReport);
  };

  /**
   * 注册一条素材（公共逻辑：URL 直填 / 直传成功后都走这里）。
   */
  const registerAsset = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/wizard/projects/${orderId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message ?? `注册失败 (${res.status})`);
    }
    await refresh();
  };

  const resetForm = () =>
    setForm({
      type: "VIDEO",
      url: "",
      name: "",
      durationMs: "",
      width: "",
      height: "",
      fileSizeBytes: "",
      matchedShotId: "",
    });

  /// URL mode 提交
  const submitAdd = () => {
    setError(null);
    if (!form.url.trim() || !form.name.trim()) {
      setError("请填写素材名称和公网 URL。");
      return;
    }
    startAdd(async () => {
      const payload: Record<string, unknown> = {
        type: form.type,
        url: form.url.trim(),
        name: form.name.trim(),
      };
      if (form.durationMs) payload.durationMs = Number(form.durationMs);
      if (form.width) payload.width = Number(form.width);
      if (form.height) payload.height = Number(form.height);
      if (form.fileSizeBytes)
        payload.fileSizeBytes = Number(form.fileSizeBytes);
      if (form.matchedShotId)
        payload.matchedShotId = form.matchedShotId;

      try {
        await registerAsset(payload);
        resetForm();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  /**
   * 直传 mode：上传到 /api/upload/blob → 拿 URL → 注册。
   * 失败时自动 fallback 到 URL tab，提示用户改用公网 URL，绝不阻塞 wizard。
   */
  const submitDirectUpload = async (
    file: File,
    inputEl: HTMLInputElement | null,
  ) => {
    setError(null);
    if (file.size > MAX_DIRECT_BYTES) {
      setError(
        `文件超过 100MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）。请压缩或裁剪后重试，或切换到「公网 URL」模式自带 URL 注册。`,
      );
      if (inputEl) inputEl.value = "";
      return;
    }
    setUploading(true);
    setUploadProgress(5);
    setUploadName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prefix", `wizard-uploads/${orderId}`);

      setUploadProgress(35);
      const upRes = await fetch("/api/upload/blob", {
        method: "POST",
        body: fd,
      });
      if (!upRes.ok) {
        const data = await upRes.json().catch(() => ({}));
        const reason = data.error ?? `直传服务返回 ${upRes.status}`;
        setTab("url");
        setError(
          `直接上传不可用：${reason}。已自动切到「公网 URL」模式——你可以把素材上传到自己的 S3 / Drive / Cloudinary，再粘贴 URL。`,
        );
        return;
      }
      const { url } = (await upRes.json()) as { url: string };
      setUploadProgress(75);

      const inferredType: "VIDEO" | "IMAGE" =
        file.type.startsWith("image/") ? "IMAGE" : "VIDEO";

      await registerAsset({
        type: inferredType,
        url,
        name: file.name,
        mimeType: file.type || undefined,
        fileSizeBytes: file.size,
        matchedShotId: form.matchedShotId || undefined,
      });
      setUploadProgress(100);
    } catch (e) {
      setTab("url");
      setError(
        `直接上传失败：${(e as Error).message}。已切到「公网 URL」模式作为 fallback。`,
      );
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setUploadName(null);
      }, 400);
      if (inputEl) inputEl.value = "";
    }
  };

  const matchAsset = (assetId: string, matchedShotId: string | null) => {
    setError(null);
    startMatch(async () => {
      const res = await fetch(
        `/api/wizard/projects/${orderId}/assets/${assetId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchedShotId }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `请求失败 (${res.status})`);
        return;
      }
      await refresh();
    });
  };

  /// 允许 0 素材也进入 Step 6 —— Step 6 会生成 MOCK render job，
  /// 这样客户即便没素材也能看到完整流程的输出（满足 wizard 不被卡住）
  const allShotsCovered = report.missingRequired === 0 && assets.length > 0;
  const advanceLabel = allShotsCovered
    ? "前往 Step 6 · 生成 Draft"
    : assets.length === 0
      ? "前往 Step 6 · 生成 Mock 预览"
      : "跳过缺镜头去试 Draft";

  return (
    <div className="space-y-5">
      <WizardMockBanner
        level="info"
        message={
          blobReady
            ? "支持直接上传 ≤100MB 的视频/图片，或粘贴公网 URL。任一方式失败会自动切换到另一种，不会阻塞 wizard。"
            : "服务器暂未配置 Vercel Blob (BLOB_READ_WRITE_TOKEN)，当前仅支持公网 URL 注册。配置后会自动启用直接上传。"
        }
      />

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" /> 添加新素材
          </CardTitle>
          <div className="inline-flex rounded-md border border-white/10 bg-card/40 p-0.5 w-fit text-xs">
            <button
              type="button"
              onClick={() => setTab("upload")}
              disabled={!blobReady}
              className={
                "flex items-center gap-1.5 px-3 py-1 rounded-sm transition-colors " +
                (tab === "upload"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground") +
                (!blobReady ? " opacity-50 cursor-not-allowed" : "")
              }
              title={!blobReady ? "服务器未配置 BLOB_READ_WRITE_TOKEN" : undefined}
            >
              <CloudUpload className="h-3.5 w-3.5" /> 直接上传
            </button>
            <button
              type="button"
              onClick={() => setTab("url")}
              className={
                "flex items-center gap-1.5 px-3 py-1 rounded-sm transition-colors " +
                (tab === "url"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <LinkIcon className="h-3.5 w-3.5" /> 公网 URL
            </button>
          </div>
        </CardHeader>

        {tab === "upload" ? (
          <CardContent className="space-y-3 text-xs">
            <p className="text-muted-foreground">
              支持 mp4 / mov / webm / png / jpg / webp，单文件 ≤ 100MB。上传成功后立即注册并跑 AI QA。
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="绑定 Storyboard 镜头（可选）">
                <Select
                  value={form.matchedShotId || "none"}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      matchedShotId: !v || v === "none" ? "" : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="未绑定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未绑定</SelectItem>
                    {shotChoices.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="选择文件">
                <Input
                  type="file"
                  accept={ACCEPT_DIRECT}
                  disabled={uploading || !blobReady}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void submitDirectUpload(f, e.currentTarget);
                  }}
                />
              </Field>
            </div>
            {uploading && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>正在上传 {uploadName}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}
          </CardContent>
        ) : (
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-xs">
            <Field label="类型">
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, type: v as typeof form.type }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIDEO">VIDEO</SelectItem>
                  <SelectItem value="IMAGE">IMAGE</SelectItem>
                  <SelectItem value="AUDIO">AUDIO</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="公网 URL（必填）">
              <Input
                value={form.url}
                placeholder="https://cdn.example.com/clip.mp4"
                onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))}
              />
            </Field>
            <Field label="素材名称">
              <Input
                value={form.name}
                placeholder="storefront.mp4"
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              />
            </Field>
            <Field label="时长 (ms, 可选)">
              <Input
                type="number"
                value={form.durationMs}
                onChange={(e) =>
                  setForm((s) => ({ ...s, durationMs: e.target.value }))
                }
              />
            </Field>
            <Field label="宽 (px, 可选)">
              <Input
                type="number"
                value={form.width}
                onChange={(e) =>
                  setForm((s) => ({ ...s, width: e.target.value }))
                }
              />
            </Field>
            <Field label="高 (px, 可选)">
              <Input
                type="number"
                value={form.height}
                onChange={(e) =>
                  setForm((s) => ({ ...s, height: e.target.value }))
                }
              />
            </Field>
            <Field label="绑定 Storyboard 镜头（可选）">
              <Select
                value={form.matchedShotId || "none"}
                onValueChange={(v) =>
                  setForm((s) => ({
                    ...s,
                    matchedShotId: !v || v === "none" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="未绑定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未绑定</SelectItem>
                  {shotChoices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button onClick={submitAdd} disabled={adding} size="sm">
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-2" />
                )}
                添加并跑 QA
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            素材列表（{assets.length}）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {assets.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有任何素材。</p>
          ) : (
            assets.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                shotChoices={shotChoices}
                onMatch={(shotId) => matchAsset(a.id, shotId)}
                disabled={matching}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            缺镜头报告 · 共 {report.total} · 已匹配 {report.matched} · 必拍缺{" "}
            {report.missingRequired}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.shots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有 storyboard，无法报缺。
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {report.shots.map((s) => (
                <li
                  key={s.scenePlanId}
                  className="flex items-start gap-2"
                >
                  {s.matched ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300 mt-0.5 shrink-0" />
                  ) : s.required ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-300 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-300 mt-0.5 shrink-0" />
                  )}
                  <span>
                    Shot {s.sceneIndex} ·{" "}
                    <span className="text-muted-foreground">
                      {s.visualIntent}
                    </span>
                    {!s.matched && s.reason && (
                      <span className="text-muted-foreground/70 italic">
                        {" "}
                        — {s.reason}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={`/wizard/${orderId}/step-4-storyboard`}>
          <Button variant="outline">返回 Step 4</Button>
        </Link>
        <Button
          onClick={() => router.push(`/wizard/${orderId}/step-6-render`)}
        >
          {advanceLabel}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  shotChoices,
  onMatch,
  disabled,
}: {
  asset: AssetRow;
  shotChoices: ShotChoice[];
  onMatch: (matchedShotId: string | null) => void;
  disabled: boolean;
}) {
  const status = STATUS_BADGE[asset.qaStatus] ?? STATUS_BADGE.PENDING;
  const qa = (asset.qaResult ?? {}) as {
    score?: number;
    reasons?: string[];
    retakeSuggestions?: string[];
  };
  return (
    <div className="rounded-md border border-white/10 bg-card/40 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge className="bg-white/5 border border-white/10 text-[10px]">
            {asset.type}
          </Badge>
          <span className="font-medium">{asset.name}</span>
          {status && (
            <Badge className={`${status.className} text-[10px]`}>
              {status.label}
            </Badge>
          )}
          {qa.score !== undefined && (
            <span className="text-muted-foreground">QA 分 {qa.score}</span>
          )}
        </div>
        <a
          href={asset.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[10px] text-sky-300 hover:underline truncate max-w-[40ch]"
        >
          {asset.url}
        </a>
      </div>
      {qa.reasons && qa.reasons.length > 0 && (
        <ul className="text-rose-200/85 list-disc list-inside">
          {qa.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {qa.retakeSuggestions && qa.retakeSuggestions.length > 0 && (
        <ul className="text-amber-200/85 list-disc list-inside">
          {qa.retakeSuggestions.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">绑定镜头：</span>
        <Select
          value={asset.matchedShotId ?? "none"}
          onValueChange={(v) => onMatch(v === "none" ? null : v)}
          disabled={disabled || shotChoices.length === 0}
        >
          <SelectTrigger className="h-7 text-xs w-[260px]">
            <SelectValue placeholder="未绑定" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未绑定</SelectItem>
            {shotChoices.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label} {s.required ? "· 必拍" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
