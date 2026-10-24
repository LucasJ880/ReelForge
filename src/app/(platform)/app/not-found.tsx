import { NotFoundPanel } from "@/components/platform/not-found-panel";
import { getServerLocale } from "@/i18n/server";

/**
 * 工作区里的 404（1025 · B2.7）：坏的成片 / 批次编号调 notFound() 时留在壳层里——
 * 导轨、行情条、生产带都还在，商家不会被甩出工作区。
 */
export default async function WorkspaceNotFound() {
  const locale = await getServerLocale();
  return (
    <div className="x-stack min-w-0">
      <NotFoundPanel locale={locale} workspaceHref={null} />
    </div>
  );
}
