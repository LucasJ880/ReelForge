import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BrandPackageDraftProvider,
  BrandPackageManager,
  NewBrandPackageButton,
} from "@/components/brand/brand-package-manager";
import { ProductAnchorManager } from "@/components/brand/product-anchor-manager";
import {
  listGlobalBrandWallEntries,
  listWorkspaceBrandPackagesForUser,
} from "@/lib/services/workspace-brand-package-service";
import { listProductAnchorsForUser } from "@/lib/services/product-anchor-service";
import { productAnchorView } from "@/lib/contracts/product-anchor-api";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { CustomerBrandWall } from "@/components/brand/customer-brand-wall";
import { WorkspacePage } from "@/components/exchange/workspace-page";

export const dynamic = "force-dynamic";

/**
 * 品牌（1025 · B2.4）：标题 = 导航名「品牌」，口号「可复用品牌包」进副标题。
 * 一页一枚实心主钮——页头的「新建品牌包」；锚定新产品是描边，表单打开时页头主钮退成描边。
 * 三块（产品锚点 / 工作区品牌包 / 全局品牌包）同一种区块抬头 + 同一个空态组件。
 */
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
  const copy = getPlatformCopy(locale).brands;
  const readyAnchors = anchors.filter((anchor) => anchor.status === "READY").length;
  const workspacePackages = packages.filter((item) => item.scope !== "global");
  const globalPackages = packages.length - workspacePackages.length;
  const defaultPackage = workspacePackages.find((item) => item.isDefault) ?? null;
  return (
    <BrandPackageDraftProvider>
      <WorkspacePage
        nav="brands"
        locale={locale}
        subtitle={copy.subtitle}
        primaryAction={<NewBrandPackageButton label={copy.newPackage} />}
        readingsLabel={copy.readingsLabel}
        readings={[
          {
            label: copy.anchorsReady,
            value: readyAnchors,
            tone: readyAnchors > 0 ? "filled" : "neutral",
            caption: copy.anchorsCaption
              .replace("{total}", String(anchors.length))
              .replace("{pending}", String(anchors.length - readyAnchors)),
          },
          {
            label: copy.packages,
            value: workspacePackages.length,
            caption: defaultPackage ? copy.defaultPackage.replace("{name}", defaultPackage.name) : copy.noDefault,
          },
          {
            label: copy.presets,
            value: globalPackages,
            caption: copy.presetsCaption,
          },
        ]}
        scope={copy.scope}
      >
        <ProductAnchorManager initialAnchors={anchors.map(productAnchorView)} />
        <BrandPackageManager
          initialPackages={packages}
          logoProjectId={latestOrder?.id ?? null}
        />
        {/* 展示墙对所有人可见，但只读；能否套用全局包由 visibleBrandPackageScope 决定。 */}
        <CustomerBrandWall title={copy.wallTitle} hint={copy.wallHint} entries={wallEntries} />
      </WorkspacePage>
    </BrandPackageDraftProvider>
  );
}
