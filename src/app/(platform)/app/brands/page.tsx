import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BrandPackageDraftProvider,
  BrandPackageManager,
  NewBrandPackageButton,
} from "@/components/brand/brand-package-manager";
import { PRODUCT_ANCHOR_ENTRY_ENABLED } from "@/lib/create/entry-policy";
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
    /// 商品主体入口 A 级下线（2026-11-09 线路精简）：不展示就不查
    PRODUCT_ANCHOR_ENTRY_ENABLED ? listProductAnchorsForUser(session.user.id) : Promise.resolve([]),
    db.deliveryOrder.findFirst({
      where: { createdById: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    getServerLocale(),
  ]);
  const copy = getPlatformCopy(locale).brands;
  const readyAnchors = anchors.filter((anchor) => anchor.status === "READY").length;
  return (
    <BrandPackageDraftProvider>
      <WorkspacePage
        nav="brands"
        locale={locale}
        subtitle={copy.subtitle}
        primaryAction={<NewBrandPackageButton label={copy.newPackage} />}
        readingsLabel={copy.readingsLabel}
        readings={[
          ...(PRODUCT_ANCHOR_ENTRY_ENABLED
            ? [
                {
                  label: copy.anchorsReady,
                  value: readyAnchors,
                  tone: readyAnchors > 0 ? ("filled" as const) : ("neutral" as const),
                  caption: copy.anchorsCaption
                    .replace("{total}", String(anchors.length))
                    .replace("{pending}", String(anchors.length - readyAnchors)),
                },
              ]
            : []),
          /// 「品牌包 N / 全局预设 N」不是能接着做什么的数字（下面的列表自己带计数），2026-11-10 撤掉
        ]}
        scope={copy.scope}
      >
        {PRODUCT_ANCHOR_ENTRY_ENABLED ? (
          <ProductAnchorManager initialAnchors={anchors.map(productAnchorView)} />
        ) : null}
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
