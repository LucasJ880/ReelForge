import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/exchange/empty-state";
import { WorkspacePage } from "@/components/exchange/workspace-page";
import { NewProductButton, ProductLibrary, ProductLibraryProvider } from "@/components/products/product-library";
import { authOptions } from "@/lib/auth";
import { stripHookAngle } from "@/lib/create/hook-angles";
import { stripProductSize } from "@/lib/create/product-size";
import { loadProductLibrary } from "@/lib/services/product-profile-service";
import { getPlatformCopy } from "@/i18n/platform-copy";
import { getServerLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * 商品（2026-11-10）：常拍的商品存一次——名字、卖点、尺寸、商品图——以后点「拍一条」就带进创作页。
 * 标题 = 导航名「商品」；页头「新建商品」是这页唯一的实心主钮。没有能接着做什么的数字，所以不放读数。
 * 档案表还没建时如实说明，不装成「你还没有商品」。读取失败不吞（RF-012）：交给上层的错误页。
 */
export default async function PlatformProductsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?from=/app/products");
  const [library, locale] = await Promise.all([loadProductLibrary(session.user.id), getServerLocale()]);
  const copy = getPlatformCopy(locale).products;
  return (
    <ProductLibraryProvider>
      <WorkspacePage
        nav="products"
        locale={locale}
        subtitle={copy.subtitle}
        primaryAction={library.available ? <NewProductButton label={copy.newProduct} /> : null}
        readingsLabel={copy.readingsLabel}
        readings={[]}
        scope={copy.scope}
      >
        {library.available ? (
          <ProductLibrary
            locale={locale}
            initialProducts={library.products}
            suggestions={library.suggestions.map((source) => ({
              orderId: source.orderId,
              /// 标题 = 当时描述的第一行，去掉我们补的「开头方向」和「尺寸」那两行
              title: Array.from(stripProductSize(stripHookAngle(source.prompt)).split("\n")[0] ?? "").slice(0, 40).join(""),
              thumbnailUrl: source.thumbnailUrl,
              imageCount: source.imageCount,
            }))}
          />
        ) : (
          <EmptyState body={copy.unavailable} data-testid="product-unavailable" />
        )}
      </WorkspacePage>
    </ProductLibraryProvider>
  );
}
