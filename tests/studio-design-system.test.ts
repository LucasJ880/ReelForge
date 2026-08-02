import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("Aivora Glass：玻璃世界 token 与字体角色完整落地（2026-08 取代剪辑台）", async () => {
  const [tokens, layout] = await Promise.all([
    read("src/styles/tokens.css"),
    read("src/app/layout.tsx"),
  ]);
  for (const token of [
    "--bg: #0a0809",
    "--glass-pane-bg: rgb(24 20 21 / 0.78)",
    "--glass-well-bg: rgb(0 0 0 / 0.28)",
    "--border: rgb(255 255 255 / 0.1)",
    "--text-primary: #f7f4f2",
    "--accent: #ff4d00",
    "--success: #58c08a",
    "--warning: #e9b658",
    "--danger: #ff6f5b",
    // #ff4d00 上禁白字：主按钮前景必须是深色
    "--primary-foreground: #140801",
  ]) assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // 登录面与 Studio 共用同一玻璃世界，工作区块只收紧密度。
  assert.match(
    tokens,
    /:root:has\(\.studio-theme\),\s*\n\.studio-theme,\s*\n:root:has\(\.auth-studio-theme\),\s*\n\.auth-studio-theme\s*{/,
  );
  assert.match(tokens, /--font-display-family:\s*var\(--font-schibsted-grotesk\),\s*var\(--font-noto-sans-sc\)/);
  assert.match(tokens, /--font-mono-family:\s*var\(--font-jetbrains-mono\)/);
  assert.match(layout, /Schibsted_Grotesk/);
  assert.match(layout, /Noto_Sans_SC/);
  assert.match(layout, /JetBrains_Mono/);
});

test("Aivora Glass：壳层结构面用 glass-pane，内容区不再叠不透明底盖住环境光", async () => {
  const [shell, authLayout, globals] = await Promise.all([
    read("src/components/platform/platform-shell.tsx"),
    read("src/app/(auth)/layout.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(shell, /className="studio-theme/);
  assert.match(shell, /aside className="glass-pane/);
  assert.match(shell, /header className="glass-pane/);
  // 环境光场必须能透进内容区（曾被 bg-background 盖死）
  assert.match(shell, /<main className="min-w-0 flex-1">/);
  assert.match(shell, /className="studio-page editorial-page-enter min-h-full"/);
  // 光随进行中的生成任务抬升（STORY 表达点）
  assert.match(shell, /--ambient-glow/);
  assert.match(globals, /--ambient-glow/);
  assert.match(authLayout, /className="auth-studio-theme/);
});

test("胶片计数条：五态齐全且 reduced-motion 有静态降级", async () => {
  const [component, globals] = await Promise.all([
    read("src/components/batch/batch-film-strip.tsx"),
    read("src/app/globals.css"),
  ]);
  for (const state of ["completed", "generating", "queued", "failed", "cancelled"]) {
    assert.match(component, new RegExp(`\\b${state}\\b`));
  }
  assert.match(component, /role="img"/);
  assert.match(component, /data-cell-size/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.batch-film-cell\[data-state="generating"\][\s\S]*?animation:\s*none/);
});

test("工作区：导航计数来自 owner-scoped 数据，顶栏结构保持精简", async () => {
  const [layout, shell] = await Promise.all([
    read("src/app/(platform)/app/layout.tsx"),
    read("src/components/platform/platform-shell.tsx"),
  ]);
  assert.match(layout, /userId:\s*session\.user\.id/);
  assert.match(layout, /activeBatches/);
  assert.match(layout, /failedJobs/);
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
