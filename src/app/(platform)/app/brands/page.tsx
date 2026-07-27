import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BrandPackageManager } from "@/components/brand/brand-package-manager";
import { listWorkspaceBrandPackagesForUser } from "@/lib/services/workspace-brand-package-service";
import { getServerLocale } from "@/i18n/server";
import { CustomerBrandWall } from "@/components/brand/customer-brand-wall";

export const dynamic = "force-dynamic";

export default async function PlatformBrandsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/brands");
  const [packages, latestOrder, locale] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    db.deliveryOrder.findFirst({
      where: { createdById: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    getServerLocale(),
  ]);
  const english = locale === "en-US";
  return (
    <div className="editorial-page-stack min-w-0">
      <header className="studio-hero max-w-5xl space-y-3">
        <p className="studio-label text-muted-foreground">{english ? "BRAND SYSTEM" : "品牌系统"}</p>
        <h1 className="editorial-display">{english ? "Reusable brand packages" : "可复用品牌包"}</h1>
        <p className="max-w-3xl text-body text-muted-foreground">
          {english
            ? "Keep identity, CTA, contact details, and end-card assets consistent across single and batch production."
            : "统一管理 Logo、行动指引、联系方式和尾卡，让单条与批量生产保持同一套品牌表达。"}
        </p>
      </header>
      <CustomerBrandWall
        english={english}
        entries={packages.map((item) => ({
          id: item.id,
          brandName: item.brandName,
          logoUrl: item.logoAsset.url,
          scope: item.scope,
        }))}
      />
      <BrandPackageManager
        initialPackages={packages}
        logoProjectId={latestOrder?.id ?? null}
      />
    </div>
  );
}
