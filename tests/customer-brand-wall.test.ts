import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPublicBrandWallEntries,
  type BrandWallEntry,
} from "../src/components/brand/customer-brand-wall";

/**
 * 展示墙对外证明「我们服务过哪些客户」，因此三条同时成立才渲染：
 * 全局作用域 + 真实客户（clientProfileId 非空）+ 公开静态 logo 路径。
 */
test("brand wall renders only global, customer-owned, safe logo assets", () => {
  const fixtures: BrandWallEntry[] = [
    {
      id: "customer-global",
      brandName: "SUNNY Shutters",
      logoUrl: "/brand/sunny-logo.png",
      scope: "global",
      clientProfileId: "sunnyshutter",
    },
    {
      /// 平台自有预设：可选用的全局品牌包，但不是客户，不进展示墙
      id: "platform-preset",
      brandName: "Aivora",
      logoUrl: "/demo/pet/aivora-logo-endcard.png",
      scope: "global",
      clientProfileId: null,
    },
    {
      /// 工作区私有资产绝不外泄，即使挂了客户 id
      id: "private-workspace",
      brandName: "Private",
      logoUrl: "https://assets.example.test/private.png",
      scope: "workspace",
      clientProfileId: "private-co",
    },
    {
      id: "unsafe-url",
      brandName: "Unsafe",
      logoUrl: "javascript:alert(1)",
      scope: "global",
      clientProfileId: "unsafe-co",
    },
  ];
  assert.deepEqual(
    filterPublicBrandWallEntries(fixtures).map((entry) => entry.id),
    ["customer-global"],
  );
});
