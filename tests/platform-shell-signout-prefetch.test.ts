import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RF-036: protected platform navigation cannot prefetch after sign-out clears auth", async () => {
  const source = await readFile(
    "src/components/platform/platform-shell.tsx",
    "utf8",
  );
  /// 2026-10-28 侧栏分组（学 LibTV）：桌面分组与移动底栏共用 Nav 里同一个 link 构造器。
  const navStart = source.indexOf("function Nav(");
  const navEnd = source.indexOf("function AccountMenu", navStart);

  assert.ok(navStart >= 0 && navEnd > navStart, "platform nav must exist");
  const navSource = source.slice(navStart, navEnd);
  assert.match(navSource, /<Link[\s\S]*?href=\{item\.href\}[\s\S]*?prefetch=\{false\}/);
  assert.match(navSource, /PLATFORM_PRIMARY_NAV\.map\(\(item\) => link\(item\.id\)\)/);
  assert.match(navSource, /group\.items\.map\(\(id\) => link\(id\)\)/);
  assert.doesNotMatch(
    navSource,
    /prefetch=\{(?:true|signingOut\s*\?\s*true)/,
    "protected links must never restart prefetch after auth is cleared",
  );
});
