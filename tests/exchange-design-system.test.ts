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

test("Aivora Exchange：壳层是行情终端——顶部行情条 + 实时生产带 + 编号导轨 + 状态栏", async () => {
  const [shell, authLayout, globals] = await Promise.all([
    read("src/components/platform/platform-shell.tsx"),
    read("src/app/(auth)/layout.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(shell, /className="desk-theme/);
  assert.match(shell, /<header className="x-pane sticky top-0 z-30 h-\(--shell-top\)/);
  /// 导轨在文档流里 sticky，与顶栏共用 --shell-top（不再 fixed top-20 与 81px 顶栏差 1px），矮屏内部滚动
  assert.match(shell, /<aside className="x-pane sticky top-\(--shell-top\)[^"]*overflow-y-auto/);
  assert.doesNotMatch(shell, /fixed bottom-7 left-0 top-20|md:ml-56/);
  assert.match(shell, /<Tape entries=\{pulse\.tape\}/);
  assert.match(shell, /<footer className="x-pane/);
  assert.match(shell, /className="x-page x-enter min-h-full"/);
  // 实时点只给「正在发生」：真在生成的视频条数决定市场状态（排队、暂停不算）
  assert.match(shell, /const live = pulse\.generating > 0/);
  assert.match(globals, /\.x-tape-track/);
  assert.match(globals, /:root:has\(\.desk-theme\)\s*\{\s*overscroll-behavior-y:\s*none/);
  assert.match(globals, /--shell-top:\s*calc\(var\(--shell-bar\) \+ var\(--shell-tape\) \+ 1px\)/);
  assert.match(globals, /\.x-live/);
  // 不铺光晕；毛玻璃只给首页展厅压在视频上的控件（.on-media，2026-10-28 学 Seedance 2.5 官网）
  assert.doesNotMatch(globals, /radial-gradient/);
  assert.doesNotMatch(globals.replace(/(^|\n)\s*\.on-media[^{]*\{[^}]*\}/g, "$1"), /backdrop-filter/);
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

test("工作区：导航计数与生产带都来自 owner-scoped 脉搏，顶栏结构保持精简", async () => {
  const [layout, shell, readings] = await Promise.all([
    read("src/app/(platform)/app/layout.tsx"),
    read("src/components/platform/platform-shell.tsx"),
    read("src/lib/services/exchange-readings.ts"),
  ]);
  // 首屏脉搏与 /api/exchange/pulse 同一个函数，只读本人
  assert.match(layout, /loadPulse\(userId, \{ locale \}\)/);
  assert.match(layout, /const userId = session\.user\.id/);
  assert.doesNotMatch(layout, /failedJobs|status:\s*\{\s*in:\s*\["EXPANDING", "RUNNING", "PAUSED"\]/);
  // 生产带：本人最近的批次，不放示例数据
  assert.match(readings, /db\.batchJob\.findMany\(\{\s*where:\s*\{\s*userId\s*\}/);
  // 工作区芯片只有一个工作区：不是按钮、不画假下拉箭头
  assert.doesNotMatch(shell, /ChevronsUpDown|shell\.platformShell\.switchWorkspace/);
  assert.match(shell, /data-testid="workspace-chip"/);
  assert.match(shell, /type="search"/);
  // 头像打开账户菜单，不再一点就退出
  assert.match(shell, /shell\.platformShell\.accountSignOut/);
  assert.match(shell, /<DropdownMenuTrigger[\s\S]*?data-testid="account-menu-trigger"/);
  const trigger = shell.slice(shell.indexOf("<DropdownMenuTrigger"), shell.indexOf("</DropdownMenuTrigger>"));
  assert.doesNotMatch(trigger, /signOut/);
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
