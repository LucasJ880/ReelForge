import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("Studio theme：批准的暖色 token 与字体角色完整落地", async () => {
  const [tokens, layout] = await Promise.all([
    read("src/styles/tokens.css"),
    read("src/app/layout.tsx"),
  ]);
  for (const token of [
    "--bg: #17130f",
    "--surface: #201a14",
    "--surface-raised: #2a221a",
    "--border: #372d22",
    "--text-primary: #f2eae1",
    "--text-secondary: #a89a8a",
    "--accent: #ff4d00",
    "--success: #4caf7d",
    "--warning: #e8b84b",
    "--danger: #e0574f",
  ]) assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(tokens, /\.studio-theme\s*{/);
  assert.match(tokens, /--font-display-family:\s*var\(--font-space-grotesk\)/);
  assert.match(tokens, /--font-mono-family:\s*var\(--font-jetbrains-mono\)/);
  assert.match(layout, /Space_Grotesk/);
  assert.match(layout, /JetBrains_Mono/);
});

test("Studio theme：只作用于统一工作区，公开面保持 Editorial", async () => {
  const [shell, authLayout] = await Promise.all([
    read("src/components/platform/platform-shell.tsx"),
    read("src/app/(auth)/layout.tsx"),
  ]);
  assert.match(shell, /className="studio-theme/);
  assert.doesNotMatch(authLayout, /studio-theme/);
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

test("工作区移动端：媒体网格显式使用零最小宽度列，避免素材固有宽度撑破 390px", async () => {
  const sources = await Promise.all([
    read("src/app/(platform)/app/batches/page.tsx"),
    read("src/app/(platform)/app/library/page.tsx"),
    read("src/app/(platform)/app/templates/page.tsx"),
  ]);
  for (const source of sources) {
    assert.match(source, /grid-cols-1/);
    assert.match(source, /min-w-0/);
  }
});
