import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/**
 * 2026-10-30 CEO 反馈「创意模板是白底的，看不到」。
 *
 * 创作页的胶囊下拉是透明的原生 <select> 叠在胶囊上，展开的选项面板由浏览器自己画：
 * select 透明底 + 字色继承页面浅色 → Windows 版 Chrome / Edge 与 Firefox 画成白底浅字。
 * 这个面板不在页面里，Playwright 截图拍不到、视觉基线也比不出来，只能把样式本身锁住。
 */
const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

test("原生下拉的选项面板钉死深底浅字，不依赖 select 自身背景", () => {
  assert.match(globals, /\n\s*select\s*\{\s*color-scheme:\s*dark;\s*\}/);
  assert.match(
    globals,
    /select option,\s*select optgroup\s*\{\s*background-color:\s*var\(--popover\);\s*color:\s*var\(--popover-foreground\);\s*\}/,
  );
});

test("选项面板用到的 token 在 :root 上有定义（否则回落成浏览器默认白底）", () => {
  const root = tokens.slice(tokens.indexOf(":root {"));
  assert.match(root, /--popover:\s*[^;]+;/);
  assert.match(root, /--popover-foreground:\s*[^;]+;/);
});
