"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LOCALES } from "@/lib/services/localization-service";

const PRODUCT_CATEGORIES = [
  { value: "pet_products", label: "宠物用品" },
  { value: "home_goods", label: "家居用品" },
  { value: "local_service", label: "本地服务" },
  { value: "cross_border_ecommerce", label: "跨境电商" },
  { value: "other_real_footage_ads", label: "其他真实素材广告" },
];

const TARGET_PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
];

interface UploadedAsset {
  assetId: string;
  url: string;
  type: "video" | "image" | "other";
  name: string;
}

export function NewOrderForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    productCategory: "pet_products",
    targetLocale: "en-US",
    targetPlatforms: ["tiktok"],
    productName: "",
    productUrl: "",
    priceRange: "",
    existingSellingPoints: "",
    targetAudience: "",
    brandStyle: "",
    competitorUrls: "",
    footageUrls: "",
    footageNotes: "",
    maxRounds: 3,
  });
  const [assets, setAssets] = useState<UploadedAsset[]>([]);

  function togglePlatform(platform: string) {
    setForm((current) => {
      const exists = current.targetPlatforms.includes(platform);
      const targetPlatforms = exists
        ? current.targetPlatforms.filter((p) => p !== platform)
        : [...current.targetPlatforms, platform];
      return {
        ...current,
        targetPlatforms: targetPlatforms.length > 0 ? targetPlatforms : ["tiktok"],
      };
    });
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: UploadedAsset[] = [];
      for (const file of Array.from(files)) {
        const data = new FormData();
        data.append("file", file);
        data.append("prefix", "footage");
        const res = await fetch("/api/upload/blob", {
          method: "POST",
          body: data,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `素材上传失败: ${file.name}`);
        }
        const body = (await res.json()) as {
          asset: { id: string; url: string };
        };
        uploaded.push({
          assetId: body.asset.id,
          url: body.asset.url,
          type: file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("image/")
              ? "image"
              : "other",
          name: file.name,
        });
      }
      setAssets((current) => [...current, ...uploaded]);
      toast.success(`已上传 ${uploaded.length} 个素材`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const locale =
        SUPPORTED_LOCALES.find((l) => l.code === form.targetLocale) ??
        SUPPORTED_LOCALES[0];

      const payload = {
        title: form.title,
        productCategory: form.productCategory,
        targetPlatform: form.targetPlatforms[0] ?? "tiktok",
        targetCountry: locale.country,
        targetLanguage: locale.language,
        targetRegionVariant: locale.code,
        maxRounds: Number(form.maxRounds) || 3,
        productInput: {
          product_name: form.productName || form.title,
          product_url: form.productUrl || undefined,
          price_range: form.priceRange || undefined,
          existing_selling_points: form.existingSellingPoints || undefined,
          target_audience: form.targetAudience || undefined,
          brand_style: form.brandStyle || undefined,
          target_platforms: form.targetPlatforms,
          competitor_urls: form.competitorUrls
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          footage_assets: [
            ...assets,
            ...form.footageUrls
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((url) => ({
                url,
                type: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? "video" : "image",
                name: url.split("/").pop() || url,
              })),
          ],
          footage_notes: form.footageNotes || undefined,
        },
      };

      const res = await fetch("/api/delivery-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
      const data = await res.json();
      toast.success("交付单已创建");
      router.push(`/orders/${data.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="交付单标题" required>
        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="例：宠物保暖毯 · TikTok 第一轮素材测试"
          className={INPUT}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="客户 / 产品类型" required>
          <select
            value={form.productCategory}
            onChange={(e) => setForm({ ...form, productCategory: e.target.value })}
            className={INPUT}
          >
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="目标市场 / 语言" required>
          <select
            value={form.targetLocale}
            onChange={(e) => setForm({ ...form, targetLocale: e.target.value })}
            className={INPUT}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-4 rounded-(--radius-lg) border border-border bg-secondary p-4">
        <h3 className="font-heading text-subhead">产品 / 服务信息</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="产品 / 服务名称" required>
            <input
              type="text"
              required
              value={form.productName}
              onChange={(e) => setForm({ ...form, productName: e.target.value })}
              placeholder="例：防掉毛宠物毯 / Toronto 宠物美容服务"
              className={INPUT}
            />
          </Field>
          <Field label="产品链接 / 官网 / 店铺链接">
            <input
              type="url"
              value={form.productUrl}
              onChange={(e) => setForm({ ...form, productUrl: e.target.value })}
              placeholder="https://…"
              className={INPUT}
            />
          </Field>
          <Field label="价格区间">
            <input
              type="text"
              value={form.priceRange}
              onChange={(e) => setForm({ ...form, priceRange: e.target.value })}
              placeholder="例：$29-$49 / $99 起"
              className={INPUT}
            />
          </Field>
          <Field label="目标客户">
            <input
              type="text"
              value={form.targetAudience}
              onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
              placeholder="例：北美养狗家庭 / 华人本地服务客户"
              className={INPUT}
            />
          </Field>
        </div>
        <Field label="已有卖点 / 客户备注">
          <textarea
            rows={3}
            value={form.existingSellingPoints}
            onChange={(e) => setForm({ ...form, existingSellingPoints: e.target.value })}
            className={INPUT}
            placeholder="例：防掉毛、保暖、可机洗、宠物愿意主动趴上去"
          />
        </Field>
        <Field label="品牌风格要求">
          <textarea
            rows={3}
            value={form.brandStyle}
            onChange={(e) => setForm({ ...form, brandStyle: e.target.value })}
            className={INPUT}
            placeholder="例：真实 UGC、温暖治愈、不要过度硬广、英文口吻自然"
          />
        </Field>
        <Field label="竞品 / 参考视频 URL" hint="多条用空格、逗号或换行分隔">
          <textarea
            rows={2}
            value={form.competitorUrls}
            onChange={(e) => setForm({ ...form, competitorUrls: e.target.value })}
            className={`${INPUT} font-mono text-meta`}
            placeholder="https://www.tiktok.com/…"
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-(--radius-lg) border border-border bg-secondary p-4">
        <div>
          <h3 className="font-heading text-subhead">真实素材</h3>
          <p className="mt-1 text-meta text-muted-foreground">
            上传客户真实产品、门店、人物、宠物互动、开箱、before/after 等素材；MVP 阶段会先把素材清单交给 AI 做脚本和分镜匹配。
          </p>
        </div>
        <div className="rounded-(--radius-lg) border border-dashed border-border bg-card p-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 text-center text-body focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            {uploading ? (
              <Loader2 className="animate-spin text-muted-foreground" strokeWidth={1.5} aria-hidden />
            ) : (
              <Upload className="text-muted-foreground" strokeWidth={1.5} aria-hidden />
            )}
            <span>{uploading ? "素材上传中…" : "点击上传视频 / 图片素材"}</span>
            <span className="text-meta text-muted-foreground">支持多文件，使用 Vercel Blob 存储</span>
            <input
              type="file"
              multiple
              accept="video/*,image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {assets.length > 0 && (
          <div className="space-y-2">
            {assets.map((asset) => (
              <div
                key={asset.url}
                className="flex min-w-0 items-center justify-between gap-3 rounded-(--radius-md) border border-border bg-card px-3 py-2 text-meta"
              >
                <div className="min-w-0">
                  <span className="mr-2 rounded-(--radius-sm) bg-secondary px-2 py-1 uppercase">
                    {asset.type}
                  </span>
                  <span className="break-all">{asset.name}</span>
                </div>
                <button
                  type="button"
                  className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-md) text-muted-foreground hover:bg-secondary hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={() => setAssets((current) => current.filter((a) => a.url !== asset.url))}
                  aria-label={`移除 ${asset.name}`}
                >
                  <X strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <Field label="素材 URL 补充" hint="如果素材已在网盘/CDN，可直接粘贴 URL">
          <textarea
            rows={3}
            value={form.footageUrls}
            onChange={(e) => setForm({ ...form, footageUrls: e.target.value })}
            className={`${INPUT} font-mono text-meta`}
            placeholder="https://…/dog-jumps-on-sofa.mp4"
          />
        </Field>
        <Field label="素材说明 / 拍摄限制">
          <textarea
            rows={3}
            value={form.footageNotes}
            onChange={(e) => setForm({ ...form, footageNotes: e.target.value })}
            className={INPUT}
            placeholder="例：有 3 条狗狗跳上沙发镜头，2 条产品特写；不要使用门店招牌以外的顾客脸部"
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-(--radius-lg) border border-border bg-secondary p-4">
        <h3 className="font-heading text-subhead">投放与赛马设置</h3>
        <Field label="目标平台" required>
          <div className="grid gap-2 sm:grid-cols-2">
            {TARGET_PLATFORMS.map((platform) => (
              <label
                key={platform.value}
                className="flex min-h-10 items-center gap-2 rounded-(--radius-md) border border-border bg-card px-3 py-2 text-body focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
              >
                <input
                  type="checkbox"
                  checked={form.targetPlatforms.includes(platform.value)}
                  onChange={() => togglePlatform(platform.value)}
                />
                {platform.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="最大赛马轮次" hint="默认 3 轮，可提前结算">
          <input
            type="number"
            min={1}
            max={6}
            value={form.maxRounds}
            onChange={(e) => setForm({ ...form, maxRounds: Number(e.target.value) })}
            className={INPUT}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />}
          创建交付单
        </Button>
      </div>
    </form>
  );
}

const INPUT =
  "min-h-10 w-full min-w-0 rounded-(--radius-md) border border-input bg-card px-3 py-2 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2 text-body">
      <span className="block text-meta font-medium text-muted-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="block text-meta text-muted-foreground">{hint}</span>}
    </label>
  );
}
