import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 2026-11-10：角标 `.x-frame` 从 10-28 起就不画任何东西（`content: none`），只剩三处用法挂着一个空类名。
 * 已从样式和用法里删掉；这里守住它不回流。`.x-wall`（现行的卡片网格）、`.x-beam`、`.x-hatch` 仍在用，不在此列。
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|css)$/u.test(name) ? [path] : [];
  });
}

test("角标 .x-frame 已退役：样式表不再定义它，组件不再挂它", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.doesNotMatch(css, /^\s*\.x-frame\b/mu);
  const users = files("src").filter((path) => /className=[^>]*\bx-frame\b/u.test(readFileSync(path, "utf8")));
  assert.deepEqual(users, []);
});

test(".x-wall 仍是现行的卡片网格：有间距、每格一张卡", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const wall = css.slice(css.indexOf("  .x-wall {"), css.indexOf("  .x-label {"));
  assert.match(wall, /display: grid;\s+gap: var\(--space-3\);/);
  assert.match(wall, /\.x-wall > \* \{[^}]*border-radius: var\(--radius-card\);[^}]*background-color: var\(--surface\);/u);
});
