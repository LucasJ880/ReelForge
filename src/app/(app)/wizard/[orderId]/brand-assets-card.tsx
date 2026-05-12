"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoGeneratorDialog } from "@/components/wizard/logo-generator-dialog";
import { useTranslation } from "@/i18n/useTranslation";

export interface BrandAssetsCardProps {
  projectId: string;
  businessName: string;
  industry?: string | null;
  currentLogoUrl: string | null;
}

/**
 * Wizard 概览页的「品牌资产」卡片：
 * - 已有 Logo → 显示 + 提供「重新生成」入口
 * - 没有 Logo → 显示「Generate one with AI」CTA
 *
 * 选定后会通过 API 写回 clientBrief.brandAssets.logoUrl，
 * 这里仅做乐观本地更新；下次页面刷新由 SSR 拿到真实值。
 */
export function BrandAssetsCard({
  projectId,
  businessName,
  industry,
  currentLogoUrl,
}: BrandAssetsCardProps) {
  const { t } = useTranslation();
  const [logoUrl, setLogoUrl] = useState<string | null>(currentLogoUrl);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("brand.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("brand.subtitle")}</p>

        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/20">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Logo preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[10px] text-muted-foreground/70">
                {t("brand.logo")}
              </span>
            )}
          </div>
          <div className="flex-1 space-y-2">
            {logoUrl ? (
              <p className="text-xs text-emerald-300/80">
                {t("brand.logo")}: {t("common.yes")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("brand.noLogo")}
              </p>
            )}
            <LogoGeneratorDialog
              projectId={projectId}
              defaultBusinessName={businessName}
              triggerLabelKey={
                logoUrl ? "brand.regenerate" : "brand.aiGenerateCta"
              }
              triggerVariant={logoUrl ? "ghost" : "default"}
              onSelected={(url) => setLogoUrl(url)}
            />
            <input type="hidden" data-industry={industry ?? ""} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
