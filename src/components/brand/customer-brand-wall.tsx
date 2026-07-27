import Image from "next/image";

export type BrandWallEntry = {
  id: string;
  brandName: string;
  logoUrl: string;
  scope: "global" | "workspace";
};

function safePublicLogoUrl(value: string): boolean {
  return (
    /^\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/i.test(value) ||
    /^https:\/\/[A-Za-z0-9.-]+\/[^?#]+\.(?:png|jpe?g|webp|svg)(?:[?#].*)?$/i.test(
      value,
    )
  );
}

export function filterPublicBrandWallEntries(
  entries: BrandWallEntry[],
): BrandWallEntry[] {
  return entries.filter(
    (entry) => entry.scope === "global" && safePublicLogoUrl(entry.logoUrl),
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
      <div className="max-w-2xl">
        <p className="studio-label text-muted-foreground">{english ? "APPROVED BRAND SYSTEMS" : "已审核品牌体系"}</p>
        <h2 id="approved-brand-wall" className="mt-2 font-heading text-title font-semibold">
          {english ? "Ready-to-use platform identity" : "可直接复用的平台品牌资产"}
        </h2>
        <p className="mt-2 text-body text-muted-foreground">
          {english
            ? "Only platform-approved public assets appear here; private workspace logos are never exposed."
            : "这里只展示平台明确审核并公开的资产，工作区私有 Logo 永远不会进入展示墙。"}
        </p>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((entry) => (
          <li key={entry.id} className="flex min-h-24 min-w-0 items-center justify-center rounded-(--radius-md) border border-border bg-card p-4">
            <div className="relative h-14 w-full max-w-40 opacity-75 grayscale transition duration-base hover:opacity-100 hover:grayscale-0 motion-reduce:transition-none">
              <Image
                src={entry.logoUrl}
                alt={entry.brandName}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
