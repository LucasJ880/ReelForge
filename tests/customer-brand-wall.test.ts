import assert from "node:assert/strict";
import test from "node:test";
import {
  filterPublicBrandWallEntries,
  type BrandWallEntry,
} from "../src/components/brand/customer-brand-wall";

test("brand wall renders only explicitly global, safe logo assets", () => {
  const fixtures: BrandWallEntry[] = [
    {
      id: "public-active",
      brandName: "Aivora",
      logoUrl: "/demo/pet/aivora-logo-endcard.png",
      scope: "global",
    },
    {
      id: "private-workspace",
      brandName: "Private",
      logoUrl: "https://assets.example.test/private.png",
      scope: "workspace",
    },
    {
      id: "unsafe-url",
      brandName: "Unsafe",
      logoUrl: "javascript:alert(1)",
      scope: "global",
    },
  ];
  assert.deepEqual(
    filterPublicBrandWallEntries(fixtures).map((entry) => entry.id),
    ["public-active"],
  );
});
