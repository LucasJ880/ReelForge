import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("brand manager separates reusable global and editable workspace packs", async () => {
  await access("src/app/(platform)/app/brands/page.tsx");
  const source = await readFile(
    "src/components/brand/brand-package-manager.tsx",
    "utf8",
  );
  assert.match(source, /全局品牌包/);
  assert.match(source, /工作区品牌包/);
  assert.match(source, /LogoGeneratorDialog/);
  assert.match(source, /canEdit/);
  assert.match(source, /scope === "global"/);
});

test("brand manager uploads owned assets before saving a package", async () => {
  const source = await readFile(
    "src/components/brand/brand-package-manager.tsx",
    "utf8",
  );
  assert.match(source, /uploadFilesToAssets/);
  assert.match(source, /forceRole:\s*target === "logo" \? "logo"/);
  assert.match(source, /\/api\/brand-packaging/);
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /logoAssetId/);
});
