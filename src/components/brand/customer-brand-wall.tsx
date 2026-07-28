import Image from "next/image";

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
  english,
}: {
  entries: BrandWallEntry[];
  english: boolean;
}) {
  const visible = filterPublicBrandWallEntries(entries);
  if (visible.length === 0) return null;
  return (
    <section className="rounded-(--radius-lg) border border-border bg-muted/35 px-5 py-6" aria-labelledby="approved-brand-wall">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="studio-label text-muted-foreground">{english ? "TRUSTED BY" : "已服务客户"}</p>
          <h2 id="approved-brand-wall" className="mt-2 font-heading text-title font-semibold">
            {english ? "Brands shipping with Aivora" : "正在用 Aivora 出片的品牌"}
          </h2>
          <p className="mt-2 text-body text-muted-foreground">
            {english
              ? "Their brand package is ready to apply. Only platform-approved public assets appear here; private workspace logos are never exposed."
              : "他们的品牌包可直接套用。这里只展示平台审核并公开的资产，工作区私有 Logo 永远不会进入展示墙。"}
          </p>
        </div>
        <p className="font-mono text-meta tabular-nums text-muted-foreground">
          {visible.length} {english ? (visible.length === 1 ? "brand" : "brands") : "个品牌"}
        </p>
      </div>
      <ul className="mt-5 flex flex-wrap gap-3">
        {visible.map((entry) => (
          <li
            key={entry.id}
            className="group flex min-w-0 flex-1 basis-56 items-center gap-4 rounded-(--radius-md) border border-border bg-card p-4 transition-colors hover:border-border-strong sm:flex-none"
          >
            <div className="relative size-12 shrink-0 overflow-hidden rounded-(--radius-sm) bg-secondary">
              <Image
                src={entry.logoUrl}
                alt=""
                fill
                unoptimized
                className="object-contain p-1"
              />
            </div>
            <span className="min-w-0 truncate font-heading text-subhead font-semibold">
              {entry.brandName}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
