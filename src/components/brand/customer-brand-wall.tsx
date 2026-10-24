import { BrandLogo } from "@/components/brand/brand-logo";
import { SectionHead } from "@/components/exchange/section-head";

export type BrandWallEntry = {
  id: string;
  brandName: string;
  logoUrl: string;
  scope: "global" | "workspace";
  /** 非空表示这是一个真实交付客户（而非平台自有预设）。 */
  clientProfileId: string | null;
};

function safePublicLogoUrl(value: string): boolean {
  return (
    /^\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/i.test(value) ||
    /^https:\/\/[A-Za-z0-9.-]+\/[^?#]+\.(?:png|jpe?g|webp|svg)(?:[?#].*)?$/i.test(
      value,
    )
  );
}

/**
 * 展示墙只放「已服务客户」：
 *  - scope=global —— 平台审核过的公开资产，工作区私有 Logo 永不外泄
 *  - clientProfileId 非空 —— 真实交付客户；Aivora 自有预设（如 Aivora Clean）
 *    仍是可选用的全局品牌包，但不算客户，不进这面墙
 *  - logo 必须是公开静态路径，杜绝把签名 URL 渲染到对外展示位
 */
export function filterPublicBrandWallEntries(
  entries: BrandWallEntry[],
): BrandWallEntry[] {
  return entries.filter(
    (entry) =>
      entry.scope === "global" &&
      Boolean(entry.clientProfileId) &&
      safePublicLogoUrl(entry.logoUrl),
  );
}

export function CustomerBrandWall({
  entries,
  title,
  hint,
}: {
  entries: BrandWallEntry[];
  title: string;
  hint: string;
}) {
  const visible = filterPublicBrandWallEntries(entries);
  if (visible.length === 0) return null;
  /// 不加「已服务客户 / TRUSTED BY」眉题：区块抬头自己承重（DESIGN：眉题是被禁装置）。
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="approved-brand-wall">
      <SectionHead
        title={<span id="approved-brand-wall">{title}</span>}
        count={visible.length}
        hint={hint}
      />
      <ul className="x-wall grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((entry) => (
          <li key={entry.id} className="flex min-w-0 items-center gap-4 p-4">
            <BrandLogo
              src={entry.logoUrl}
              brandName={entry.brandName}
              className="size-12 shrink-0 rounded-(--radius-sm) bg-(--brand-tile)"
              imageClassName="p-1"
            />
            <span className="min-w-0 truncate text-subhead font-medium">
              {entry.brandName}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
