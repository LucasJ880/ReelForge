import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { BrandPackageManager } from "@/components/brand/brand-package-manager";
import { ProductAnchorManager } from "@/components/brand/product-anchor-manager";
import {
  listGlobalBrandWallEntries,
  listWorkspaceBrandPackagesForUser,
} from "@/lib/services/workspace-brand-package-service";
import { listProductAnchorsForUser } from "@/lib/services/product-anchor-service";
import { productAnchorView } from "@/lib/contracts/product-anchor-api";
import { getServerLocale } from "@/i18n/server";
import { CustomerBrandWall } from "@/components/brand/customer-brand-wall";
import { QuoteHeader } from "@/components/exchange/quote-header";

export const dynamic = "force-dynamic";

export default async function PlatformBrandsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/brands");
  const [packages, wallEntries, anchors, latestOrder, locale] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    listGlobalBrandWallEntries(),
    listProductAnchorsForUser(session.user.id),
    db.deliveryOrder.findFirst({
      where: { createdById: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    getServerLocale(),
  ]);
  const english = locale === "en-US";
  const readyAnchors = anchors.filter((anchor) => anchor.status === "READY").length;
  const workspacePackages = packages.filter((item) => item.scope !== "global");
  const globalPackages = packages.length - workspacePackages.length;
  const defaultPackage = workspacePackages.find((item) => item.isDefault) ?? null;
  return (
    <div className="x-stack min-w-0">
      <QuoteHeader
        title={english ? "Reusable brand packages" : "可复用品牌包"}
        subtitle={
          english
            ? "Keep identity, CTA, contact details, and end-card assets consistent across single and batch production."
            : "统一管理 Logo、行动指引、联系方式和尾卡，让单条与批量生产保持同一套品牌表达。"
        }
        statsLabel={english ? "Brand readings" : "品牌读数"}
        stats={[
          {
            label: english ? "Product anchors ready" : "可用产品锚点",
            value: readyAnchors,
            tone: readyAnchors > 0 ? "filled" : "neutral",
            caption: english
              ? `${anchors.length} total · ${anchors.length - readyAnchors} not ready`
              : `共 ${anchors.length} 个 · ${anchors.length - readyAnchors} 个未就绪`,
          },
          {
            label: english ? "Workspace packages" : "工作区品牌包",
            value: workspacePackages.length,
            caption: defaultPackage
              ? `${english ? "Default" : "默认"}：${defaultPackage.name}`
              : english ? "No default yet" : "还没有默认包",
          },
          {
            label: english ? "Global presets" : "全局预设",
            value: globalPackages,
            caption: english ? "Read only · ready to apply" : "只读 · 可直接套用",
          },
        ]}
      />
      <ProductAnchorManager initialAnchors={anchors.map(productAnchorView)} />
      {/* 展示墙对所有人可见，但只读；能否套用全局包由 visibleBrandPackageScope 决定。 */}
      <CustomerBrandWall english={english} entries={wallEntries} />
      <BrandPackageManager
        initialPackages={packages}
        logoProjectId={latestOrder?.id ?? null}
      />
    </div>
  );
}
