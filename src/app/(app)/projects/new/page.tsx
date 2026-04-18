"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  ImagePlus,
  Star,
  Trash2,
  Lock,
  Info,
  Mic,
  Languages,
  Shield,
  Upload,
  X,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useIsPro } from "@/lib/hooks/use-role";
import { cn } from "@/lib/utils";

type Tone =
  | "auto"
  | "promo"
  | "narrative"
  | "educational"
  | "vlog"
  | "news"
  | "humor"
  | "cinematic"
  | "testimonial";

type Language = "auto" | "en" | "zh" | "ja" | "ko" | "es" | "fr" | "de";

const TONE_OPTIONS: { id: Tone; label: string; hint: string }[] = [
  { id: "auto", label: "AI 自选", hint: "让 AI 根据关键词挑最合适的语气" },
  { id: "promo", label: "带货广告", hint: "卖点驱动、快节奏、带 CTA" },
  { id: "narrative", label: "故事叙述", hint: "情感线、有起承转合" },
  { id: "educational", label: "教程科普", hint: "信息清晰、老师口吻、不煽情" },
  { id: "vlog", label: "Vlog 日常", hint: "第一人称、生活感、不推销" },
  { id: "news", label: "新闻口播", hint: "中立、专业、事实陈述" },
  { id: "humor", label: "搞笑段子", hint: "俏皮、包袱、自嘲或反差" },
  { id: "cinematic", label: "电影氛围", hint: "诗意、氛围优先、慢节奏" },
  { id: "testimonial", label: "测评开箱", hint: "第一人称评测、讲优缺点" },
];

const LANGUAGE_OPTIONS: { id: Language; label: string }[] = [
  { id: "auto", label: "AI 自选" },
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
];

type BrandLockTemplate =
  | "none"
  | "corner_watermark"
  | "intro_outro"
  | "full_package";

type BrandLockPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

const BRAND_LOCK_TEMPLATES: {
  id: BrandLockTemplate;
  label: string;
  hint: string;
}[] = [
  {
    id: "corner_watermark",
    label: "角标水印",
    hint: "画面角落持续小 logo，不打扰观感",
  },
  {
    id: "intro_outro",
    label: "片头片尾",
    hint: "开头 1.5s + 结尾 2s 全屏产品图",
  },
  {
    id: "full_package",
    label: "全包组合",
    hint: "角标 + 片头片尾 + 品牌文字",
  },
];

const POSITION_OPTIONS: { id: BrandLockPosition; label: string }[] = [
  { id: "bottom-right", label: "右下" },
  { id: "bottom-left", label: "左下" },
  { id: "top-right", label: "右上" },
  { id: "top-left", label: "左上" },
];

const DURATION_OPTIONS = [
  { id: 15, label: "15 秒", hint: "推荐 · 标准 TikTok 短视频" },
  { id: 30, label: "30 秒", hint: "分两段拼接，信息量更大" },
];

const suggestions = [
  "冬日居家好物",
  "办公室午睡神器",
  "宠物日常",
  "助眠推荐",
  "圣诞礼物清单",
  "测评对比",
  "情侣居家",
  "旅行打卡",
  "健身打卡",
  "美食探店",
];

export default function NewProjectPage() {
  const router = useRouter();
  const isPro = useIsPro();
  const [keyword, setKeyword] = useState("");
  const [brandDescription, setBrandDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "creating" | "generating">("input");
  const [tone, setTone] = useState<Tone>("auto");
  const [language, setLanguage] = useState<Language>("auto");
  const [duration, setDuration] = useState<number>(15);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandLockEnabled, setBrandLockEnabled] = useState(true);
  const [brandLockTemplate, setBrandLockTemplate] =
    useState<BrandLockTemplate>("corner_watermark");
  const [brandLockPosition, setBrandLockPosition] =
    useState<BrandLockPosition>("bottom-right");
  const [brandLockOpacity, setBrandLockOpacity] = useState(85);
  const [brandLockSlogan, setBrandLockSlogan] = useState("");
  const [showBrandLockAdvanced, setShowBrandLockAdvanced] = useState(false);

  const [uploadedImages, setUploadedImages] = useState<
    { url: string; filename: string }[]
  >([]);
  const [primaryImageUrl, setPrimaryImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    const fileArr = Array.from(files).slice(0, 5 - uploadedImages.length);
    if (fileArr.length === 0) {
      if (uploadedImages.length >= 5) toast.error("最多上传 5 张图片");
      return;
    }

    setUploading(true);
    const results: { url: string; filename: string }[] = [];
    for (const file of fileArr) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name}: 仅支持 JPEG/PNG/WebP`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: 超过 10MB`);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "上传失败");
        }
        const data = await res.json();
        results.push({ url: data.url, filename: data.filename });
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "上传失败"}`);
      }
    }

    if (results.length > 0) {
      const newList = [...uploadedImages, ...results];
      setUploadedImages(newList);
      if (!primaryImageUrl) setPrimaryImageUrl(results[0].url);
      toast.success(`已上传 ${results.length} 张图片`);
    }
    setUploading(false);
  }

  async function uploadLogo(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Logo 仅支持 PNG / JPEG / WebP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Logo 不能超过 10MB");
      return;
    }
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "上传失败");
      }
      const data = await res.json();
      setLogoUrl(data.url);
      toast.success("Logo 已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logo 上传失败");
    } finally {
      setLogoUploading(false);
    }
  }

  function removeImage(url: string) {
    const newList = uploadedImages.filter((img) => img.url !== url);
    setUploadedImages(newList);
    if (primaryImageUrl === url) {
      setPrimaryImageUrl(newList[0]?.url || null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || loading) return;

    setLoading(true);
    try {
      setStep("creating");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          brandDescription: brandDescription.trim() || null,
          tone,
          language,
          imageUrls: uploadedImages.map((img) => img.url),
          primaryImageUrl,
          logoUrl,
          brandLockEnabled,
          brandLockTemplate,
          brandLockPosition,
          brandLockOpacity,
          brandLockSlogan: brandLockSlogan.trim() || null,
        }),
      });
      if (!res.ok) {
        if (res.status === 402) {
          toast.error("订阅已过期，请续费或联系管理员");
          router.push("/pricing");
          return;
        }
        throw new Error("创建失败");
      }
      const project = await res.json();

      setStep("generating");

      const autoRes = await fetch(`/api/projects/${project.id}/auto-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration }),
      });
      if (!autoRes.ok) {
        const err = await autoRes.json().catch(() => ({}));
        toast.warning(err.error || "项目已创建，视频提交失败，可去详情页手动重试");
      } else {
        toast.success("一键生成已启动，视频正在合成");
      }

      router.push(`/projects/${project.id}`);
    } catch {
      toast.error("操作失败，请重试");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  if (!isPro) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-card border border-border">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-3">需要 Pro 订阅</h1>
        <p className="text-sm text-muted-foreground mb-6">
          视频生成由 Seedance 付费模型驱动，订阅 Pro 后即可解锁全部创作功能。
          免费账号可浏览和下载公开画廊里的已生成视频。
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            查看订阅方案
          </Link>
          <Link
            href="/gallery"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            浏览画廊
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pt-8 sm:pt-16">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2">
          新作品
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-white">
          输入关键词，一键生成完整短视频
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          填写关键词与品牌描述，AI 自动生成脚本、Seedance 合成视频，Brand Lock 兜底叠加 logo —— 一路到出片。
        </p>
      </div>

      {/* Step 1: Keyword */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <StepBox index={1} label="创意关键词" icon={<Sparkles className="h-3.5 w-3.5" />}>
          <div className="rounded-2xl border border-border bg-card p-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <input
              type="text"
              placeholder="如『冬日居家好物』『宠物日常』..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              disabled={loading}
              autoFocus
              className="w-full bg-transparent px-4 py-4 text-base text-white placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
            />
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {suggestions.slice(0, 6).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setKeyword(s)}
                  disabled={loading}
                  className="rounded-full bg-accent/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </StepBox>

        {/* Step 2: Brand description */}
        <StepBox
          index={2}
          label="品牌 / 产品 / 场景描述（可选）"
          icon={<Info className="h-3.5 w-3.5" />}
        >
          <textarea
            rows={3}
            value={brandDescription}
            onChange={(e) => setBrandDescription(e.target.value)}
            disabled={loading}
            placeholder="例：我的品牌叫 CozyNest，主打羊羔绒毛毯。/ 或者：我在做治愈系居家自媒体。"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-white placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all resize-none disabled:opacity-50"
          />
          <p className="text-[10px] text-muted-foreground/70 mt-1.5">
            空着也行。填上后 AI 会围绕你描述的品牌信息展开。
          </p>
        </StepBox>

        {/* Step 3: Reference images */}
        <StepBox
          index={3}
          label={`参考图 / 产品图（可选，已上传 ${uploadedImages.length}/5）`}
          icon={<ImagePlus className="h-3.5 w-3.5" />}
        >
          {uploadedImages.length > 0 && (
            <div className="grid grid-cols-5 gap-2 mb-2">
              {uploadedImages.map((img) => (
                <div
                  key={img.url}
                  className={`group relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    primaryImageUrl === img.url
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border hover:border-primary/40"
                  }`}
                  onClick={() => setPrimaryImageUrl(img.url)}
                >
                  <img
                    src={img.url}
                    alt=""
                    className="w-full aspect-square object-cover"
                  />
                  {primaryImageUrl === img.url && (
                    <div className="absolute top-1 left-1 rounded-full bg-primary p-0.5">
                      <Star className="h-2.5 w-2.5 text-white fill-white" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(img.url);
                    }}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                  >
                    <Trash2 className="h-2.5 w-2.5 text-white" />
                  </button>
                  {primaryImageUrl !== img.url && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/50 text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[8px] text-white">设为主图</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {uploadedImages.length < 5 && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              className={`relative rounded-xl border border-dashed px-4 py-4 text-center transition-all ${
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card/60 hover:border-primary/40"
              } ${uploading ? "pointer-events-none opacity-50" : ""}`}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={uploading || loading}
              />
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  上传中...
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <ImagePlus className="mx-auto h-5 w-5 mb-1 text-muted-foreground/70" />
                  拖拽或点击上传参考图
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    JPEG, PNG, WebP · 每张 ≤ 10MB
                  </p>
                </div>
              )}
            </div>
          )}

          {uploadedImages.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              <Star className="inline h-2.5 w-2.5 text-primary fill-primary -mt-0.5 mr-0.5" />
              带框的是主图，会传入 Seedance 做图生视频；所有图都会被 Vision 分析注入脚本和提示词。
            </p>
          )}
        </StepBox>

        {/* Step 4: Tone + Language + Duration */}
        <StepBox index={4} label="风格设置" icon={<Mic className="h-3.5 w-3.5" />}>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                语气
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map((opt) => {
                  const active = tone === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={loading}
                      onClick={() => setTone(opt.id)}
                      title={opt.hint}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11px] font-medium transition-all border disabled:opacity-50",
                        active
                          ? "border-primary/60 bg-primary/[0.12] text-primary"
                          : "border-border bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/80 leading-relaxed">
                {TONE_OPTIONS.find((o) => o.id === tone)?.hint}
              </p>
            </div>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                <Languages className="inline h-3 w-3 mr-1 -mt-0.5" />
                脚本语言
              </p>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGE_OPTIONS.map((opt) => {
                  const active = language === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={loading}
                      onClick={() => setLanguage(opt.id)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11px] font-medium transition-all border disabled:opacity-50",
                        active
                          ? "border-primary/60 bg-primary/[0.12] text-primary"
                          : "border-border bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                视频时长
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DURATION_OPTIONS.map((opt) => {
                  const active = duration === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={loading}
                      onClick={() => setDuration(opt.id)}
                      className={cn(
                        "rounded-lg border p-2.5 text-left transition-all disabled:opacity-50",
                        active
                          ? "border-primary/60 bg-primary/[0.10]"
                          : "border-border bg-card/60 hover:border-primary/30",
                      )}
                    >
                      <div
                        className={cn(
                          "text-[12px] font-medium mb-0.5",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {opt.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </StepBox>

        {/* Step 5: Brand Lock */}
        <StepBox
          index={5}
          label="Brand Lock · 品牌保真合成"
          icon={<Shield className="h-3.5 w-3.5" />}
          right={
            <label className="flex items-center gap-1.5 cursor-pointer ml-3 shrink-0">
              <input
                type="checkbox"
                checked={brandLockEnabled}
                onChange={(e) => setBrandLockEnabled(e.target.checked)}
                disabled={loading}
                className="rounded border-border"
              />
              <span className="text-[11px] text-muted-foreground">启用</span>
            </label>
          }
        >
          <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
            AI 生成后自动叠加你的 logo / 产品图，保证品牌 100% 清晰出现在视频里。AI 视频模型无法保证 logo 不变形 —— 我们用 FFmpeg 最后一步硬叠加兜底。
          </p>

          {brandLockEnabled && (
            <>
              <div className="mb-3">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                  品牌 Logo（推荐透明背景 PNG）
                </label>
                {logoUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                    <div className="h-12 w-12 rounded-md bg-zinc-900/40 bg-[linear-gradient(45deg,rgba(255,255,255,0.04)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.04)_75%),linear-gradient(45deg,rgba(255,255,255,0.04)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.04)_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px] flex items-center justify-center overflow-hidden">
                      <img
                        src={logoUrl}
                        alt="logo"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="flex-1 text-[11px] text-muted-foreground truncate">
                      Logo 已就绪
                    </div>
                    <button
                      type="button"
                      onClick={() => setLogoUrl(null)}
                      className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                      title="移除 Logo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative rounded-lg border border-dashed border-border bg-card/60 px-3 py-3 text-center hover:border-primary/40 transition-all">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) =>
                        e.target.files?.[0] && uploadLogo(e.target.files[0])
                      }
                      disabled={logoUploading || loading}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    {logoUploading ? (
                      <div className="flex items-center justify-center gap-2 text-[11px] text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        上传中...
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">
                        <Upload className="inline h-3 w-3 mr-1 -mt-0.5" />
                        点击上传 Logo（可选；不传会用主图当 logo 叠加）
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                  合成模板
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {BRAND_LOCK_TEMPLATES.map((t) => {
                    const active = brandLockTemplate === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={loading}
                        onClick={() => setBrandLockTemplate(t.id)}
                        title={t.hint}
                        className={cn(
                          "rounded-lg border p-2.5 text-left transition-all disabled:opacity-50",
                          active
                            ? "border-primary/60 bg-primary/[0.10]"
                            : "border-border bg-card/60 hover:border-primary/30",
                        )}
                      >
                        <div
                          className={cn(
                            "text-[11px] font-medium mb-0.5",
                            active ? "text-primary" : "text-foreground",
                          )}
                        >
                          {t.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-tight">
                          {t.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowBrandLockAdvanced((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showBrandLockAdvanced ? "收起" : "展开"}高级设置（位置 · 透明度 · Slogan）
              </button>

              {showBrandLockAdvanced && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1.5">
                      水印位置
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                      {POSITION_OPTIONS.map((p) => {
                        const active = brandLockPosition === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={loading}
                            onClick={() => setBrandLockPosition(p.id)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-[11px] transition-all",
                              active
                                ? "border-primary/60 bg-primary/[0.12] text-primary"
                                : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1.5">
                      不透明度：<span className="text-foreground">{brandLockOpacity}%</span>
                    </label>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      step={5}
                      value={brandLockOpacity}
                      onChange={(e) => setBrandLockOpacity(parseInt(e.target.value))}
                      disabled={loading}
                      className="w-full accent-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1.5">
                      Slogan 文字（可选，叠加到画面底部）
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={brandLockSlogan}
                      onChange={(e) => setBrandLockSlogan(e.target.value)}
                      disabled={loading}
                      placeholder="如：CozyNest · 冬日温暖伴你入眠"
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none"
                    />
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      仅在「全包组合」模板下生效
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </StepBox>

        {/* CTA */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={!keyword.trim() || loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-4 text-base font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {loading
              ? step === "creating"
                ? "创建项目..."
                : "提交视频任务..."
              : "开始生成"}
          </button>
          <p className="text-center text-[11px] text-muted-foreground mt-2">
            生成约耗时 1–2 分钟 · 完成后会自动进入项目详情页
          </p>
        </div>
      </form>

      {step === "generating" && (
        <div className="mt-6 flex items-center gap-3 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>为「{keyword}」生成文案并提交 Seedance 视频任务...</span>
        </div>
      )}
    </div>
  );
}

function StepBox({
  index,
  label,
  icon,
  right,
  children,
}: {
  index: number;
  label: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-4 sm:p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
            {index}
          </span>
          <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
            {icon}
            {label}
          </label>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
