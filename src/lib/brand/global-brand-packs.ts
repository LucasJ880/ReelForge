/**
 * 全局品牌包的资产清单（单一事实来源）。
 *
 * 背景：`public/brand/` 被 .gitignore 排除（真实客户 Logo 不进仓库），因此
 * 任何指向 `/brand/**` 的静态 URL 在生产环境一定 404 —— 展示墙与品牌包卡片
 * 会渲染成裂图。带 `delivery: "blob"` 的资产由 seed 脚本上传到对象存储，
 * 数据库里存绝对 https URL；只有确实提交进仓库的文件才允许 `delivery: "static"`。
 *
 * 新增全局品牌资产时：文件没提交进 git → 必须用 "blob"。
 * tests/global-brand-pack-assets.test.ts 会守住这条规则。
 */

export type BrandAssetDelivery = "static" | "blob";

export type GlobalBrandAssetSpec = {
  /** 仓库内的源文件路径（相对项目根） */
  file: string;
  /** MediaAsset.storageKey —— 幂等 upsert 键，同时用作 blob 对象键 */
  key: string;
  /**
   * static：文件已提交，直接用 publicUrl 提供
   * blob：文件不进仓库，seed 时上传对象存储并改写为绝对 URL
   */
  delivery: BrandAssetDelivery;
  /** delivery=static 时使用的 public 路径；blob 资产为 null */
  publicUrl: string | null;
  width: number;
  height: number;
};

export type GlobalBrandPackSpec = {
  /** WorkspaceBrandPackage.name —— 与 workspaceId 组成唯一键 */
  name: string;
  brandName: string;
  slogan: string | null;
  cta: string | null;
  website: string | null;
  contactLines: string[];
  /** 非空 = 真实交付客户，会进「已服务客户展示墙」 */
  clientProfileId: string | null;
  logo: GlobalBrandAssetSpec;
  endCard: GlobalBrandAssetSpec | null;
};

export const GLOBAL_BRAND_PACKS: GlobalBrandPackSpec[] = [
  {
    name: "Aivora Clean",
    brandName: "Aivora",
    slogan: "From one idea to reliable delivery.",
    cta: "Create your next product story",
    website: "aivora.app",
    contactLines: [],
    clientProfileId: null,
    logo: {
      file: "public/demo/pet/aivora-logo-endcard.png",
      key: "seed/global-brand/aivora-logo-endcard.png",
      delivery: "static",
      publicUrl: "/demo/pet/aivora-logo-endcard.png",
      width: 1536,
      height: 1024,
    },
    endCard: null,
  },
  {
    /// 客户展示墙首位：真实交付客户，尾卡电话/地址由 end-card renderer 烧录。
    name: "SunnyShutter",
    brandName: "SUNNY Shutters",
    slogan: "Custom plantation shutters, measured and installed.",
    cta: "Book your free in-home quote",
    website: null,
    contactLines: ["Call/Text 647-857-8669", "690 Progress Ave Unit 7&8, Scarborough"],
    clientProfileId: "sunnyshutter",
    logo: {
      file: "public/brand/sunny-logo.png",
      key: "seed/global-brand/sunnyshutter-logo.png",
      delivery: "blob",
      publicUrl: null,
      width: 1316,
      height: 1316,
    },
    endCard: {
      file: "public/brand/sunnyshutter-end-card-9x16.png",
      key: "seed/global-brand/sunnyshutter-end-card-9x16.png",
      delivery: "blob",
      publicUrl: null,
      width: 1536,
      height: 2752,
    },
  },
];

export function globalBrandAssetSpecs(): GlobalBrandAssetSpec[] {
  return GLOBAL_BRAND_PACKS.flatMap((pack) =>
    pack.endCard ? [pack.logo, pack.endCard] : [pack.logo],
  );
}
