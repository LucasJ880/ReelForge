import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("Aivora Exchange：交易大厅 token 与字体角色完整落地（2026-10 取代 Glass）", async () => {
  const [tokens, layout] = await Promise.all([
    read("src/styles/tokens.css"),
    read("src/app/layout.tsx"),
  ]);
  for (const token of [
    "--bg: #04070e",
    "--surface: #08101d",
    "--border: rgb(110 160 230 / 0.13)",
    "--text-primary: #e8f0fc",
    "--accent: #22e0ff",
    "--success: #2fe39b",
    "--gold: #ffc542",
    "--danger: #ff5577",
    "--iris: #a08cff",
    // 信号青上用深字：主按钮前景必须是深色
    "--primary-foreground: #00161c",
  ]) assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // 登录门与工作区共用同一大厅，密度块只收紧密度。
  assert.match(
    tokens,
    /:root:has\(\.desk-theme\),\s*\n\.desk-theme,\s*\n:root:has\(\.gate-theme\),\s*\n\.gate-theme\s*{/,
  );
  assert.match(tokens, /--font-display-family:\s*var\(--font-archivo\),\s*var\(--font-noto-sans-sc\)/);
  assert.match(tokens, /--font-mono-family:\s*var\(--font-martian-mono\)/);
  assert.match(layout, /Archivo/);
  assert.match(layout, /Noto_Sans_SC/);
  assert.match(layout, /Martian_Mono/);
  assert.match(layout, /data-design-contract="aivora-abyss-exchange"/);
});

test("Aivora Exchange：壳层是行情终端——顶部行情条 + 实时成交带 + 编号导轨 + 状态栏", async () => {
  const [shell, authLayout, globals] = await Promise.all([
    read("src/components/platform/platform-shell.tsx"),
    read("src/app/(auth)/layout.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(shell, /className="desk-theme/);
  assert.match(shell, /<header className="x-pane sticky top-0/);
  assert.match(shell, /<aside className="x-pane/);
  assert.match(shell, /<Tape entries=\{tape\}/);
  assert.match(shell, /<footer className="x-pane/);
  assert.match(shell, /className="x-page x-enter min-h-full"/);
  // 实时点只给「正在发生」：生成中批次数决定市场状态
  assert.match(shell, /const live = activeBatches > 0/);
  assert.match(globals, /\.x-tape-track/);
  assert.match(globals, /\.x-live/);
  // 不做毛玻璃，不铺光晕
  assert.doesNotMatch(globals, /backdrop-filter|radial-gradient/);
  assert.match(authLayout, /className="gate-theme/);
});

test("成交梯：五态齐全且 reduced-motion 有静态降级", async () => {
  const [component, globals] = await Promise.all([
    read("src/components/batch/batch-film-strip.tsx"),
    read("src/app/globals.css"),
  ]);
  for (const state of ["completed", "generating", "queued", "failed", "cancelled"]) {
    assert.match(component, new RegExp(`\\b${state}\\b`));
  }
  assert.match(component, /role="img"/);
  assert.match(component, /data-cell-size/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.x-fill-cell\[data-state="generating"\][\s\S]*?animation:\s*none/);
});

test("工作区：导航计数与成交带都来自 owner-scoped 数据，顶栏结构保持精简", async () => {
  const [layout, shell] = await Promise.all([
    read("src/app/(platform)/app/layout.tsx"),
    read("src/components/platform/platform-shell.tsx"),
  ]);
  assert.match(layout, /userId:\s*session\.user\.id/);
  assert.match(layout, /activeBatches/);
  assert.match(layout, /failedJobs/);
  // 成交带：本人最近的批次，不放示例数据
  assert.match(layout, /db\.batchJob\.findMany\(\{\s*where:\s*\{\s*userId:\s*session\.user\.id\s*\}/);
  assert.match(shell, /shell\.platformShell\.switchWorkspace/);
  assert.match(shell, /type="search"/);
  assert.match(shell, /shell\.platformShell\.accountSignOut/);
});

test("工作区数据展示：批次、任务、成品 ID 与时间字段使用 mono", async () => {
  const sources = await Promise.all([
    read("src/app/(platform)/app/batches/page.tsx"),
    read("src/components/batch/batch-monitor.tsx"),
    read("src/app/(platform)/app/library/page.tsx"),
    read("src/app/(platform)/app/library/[id]/page.tsx"),
  ]);
  for (const source of sources) assert.match(source, /font-mono/);
});

test("工作区移动端：媒体网格与响应式表格均避免内容撑破 390px", async () => {
  const [batches, ...mediaGrids] = await Promise.all([
    read("src/app/(platform)/app/batches/page.tsx"),
    read("src/app/(platform)/app/library/page.tsx"),
    read("src/app/(platform)/app/templates/page.tsx"),
  ]);
  assert.match(batches, /min-w-0/);
  assert.match(batches, /className="block w-full table-fixed md:table"/);
  assert.match(batches, /className="group block[\s\S]*?md:table-row/);
  for (const source of mediaGrids) {
    assert.match(source, /grid-cols-1/);
    assert.match(source, /min-w-0/);
  }
});
