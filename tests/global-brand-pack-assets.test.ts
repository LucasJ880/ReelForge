import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  GLOBAL_BRAND_PACKS,
  globalBrandAssetSpecs,
} from "../src/lib/brand/global-brand-packs";

/// 测试统一从仓库根执行（package.json scripts / `node --import tsx --test`）
const ROOT = process.cwd();

function isGitIgnored(relPath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", relPath], { cwd: ROOT });
  /// git check-ignore: 0 = 被忽略, 1 = 未被忽略
  return result.status === 0;
}

test("每个全局品牌资产的源文件都存在", () => {
  for (const spec of globalBrandAssetSpecs()) {
    assert.ok(
      existsSync(resolve(ROOT, spec.file)),
      `${spec.key} 的源文件缺失：${spec.file}`,
    );
  }
});

/**
 * 回归防线：`public/brand/` 被 .gitignore 排除，静态 URL 在生产必然 404
 * （2026-07-29 展示墙 SunnyShutter Logo 裂图的根因）。
 * 不进仓库的资产只能走 blob 投递。
 */
test("gitignore 掉的资产不允许用 /public 静态 URL 投递", () => {
  for (const spec of globalBrandAssetSpecs()) {
    if (spec.delivery !== "static") continue;
    assert.equal(
      isGitIgnored(spec.file),
      false,
      `${spec.key} 声明 delivery=static，但 ${spec.file} 被 .gitignore 排除，线上会 404；请改成 delivery="blob"`,
    );
    assert.match(
      spec.publicUrl ?? "",
      /^\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|svg)$/i,
      `${spec.key} 的 publicUrl 不是合法公开静态路径`,
    );
  }
});

test("blob 投递的资产不预置 publicUrl（URL 由上传结果决定）", () => {
  for (const spec of globalBrandAssetSpecs()) {
    if (spec.delivery !== "blob") continue;
    assert.equal(spec.publicUrl, null, `${spec.key} 不应预置 publicUrl`);
  }
});

test("storageKey 唯一，保证 upsert 幂等", () => {
  const keys = globalBrandAssetSpecs().map((spec) => spec.key);
  assert.equal(new Set(keys).size, keys.length, "storageKey 重复会互相覆盖");
});

test("进展示墙的品牌包必须带 clientProfileId", () => {
  const wallBrands = GLOBAL_BRAND_PACKS.filter((pack) => pack.clientProfileId);
  assert.ok(wallBrands.length > 0, "至少要有一个真实客户品牌包");
  for (const pack of wallBrands) {
    assert.ok(pack.contactLines.length > 0 || pack.website, `${pack.name} 缺联系方式`);
  }
});
