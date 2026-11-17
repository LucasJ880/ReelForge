import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BrandPackageDraftProvider,
  BrandPackageManager,
  NewBrandPackageButton,
} from "@/components/brand/brand-package-manager";
import {
  listGlobalBrandWallEntries,
  listWorkspaceBrandPackagesForUser,
} from "@/lib/services/workspace-brand-package-service";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";
import { CustomerBrandWall } from "@/components/brand/customer-brand-wall";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { workspaceNavTitle } from "@/components/exchange/workspace-page";

export const dynamic = "force-dynamic";

/**
 * 品牌（1025 · B2.4）：标题 = 导航名「品牌」，口号「可复用品牌包」进副标题。
 * 一页一枚实心主钮——页头的「新建品牌包」，表单打开时页头主钮退成描边。
 * 两块（工作区品牌包 / 全局品牌包）同一种区块抬头 + 同一个空态组件。
 * 第三块「商品主体」（抠图线路）入口 2026-11-09 撤掉，代码 2026-11-16 删除；ProductAnchor 表与已有行留着。
 */
/** 浏览器标签页的标题：跟导航名走（之前每一页都是同一句英文站名，开几个标签分不清） */
export async function generateMetadata() {
  return { title: `${workspaceNavTitle("brands", await getServerLocale())} · Aivora` };
}

export default async function PlatformBrandsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/brands");
  const [packages, wallEntries, latestOrder, locale] = await Promise.all([
    listWorkspaceBrandPackagesForUser(session.user.id),
    listGlobalBrandWallEntries(),
    db.deliveryOrder.findFirst({
      where: { createdById: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    getServerLocale(),
  ]);
  const copy = getPlatformCopy(locale).brands;
  return (
    <BrandPackageDraftProvider>
      <WorkspacePage
        nav="brands"
        locale={locale}
        subtitle={copy.subtitle}
        primaryAction={<NewBrandPackageButton label={copy.newPackage} />}
        readingsLabel={copy.readingsLabel}
        /// 「品牌包 N / 全局预设 N」不是能接着做什么的数字（下面的列表自己带计数），2026-11-10 撤掉
        readings={[]}
        scope={copy.scope}
      >
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
