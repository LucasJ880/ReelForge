import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

test("approved theme topology: 全站单一深海交易大厅，工作区与登录门只收密度", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const root = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const desk = tokens.match(
    /:root:has\(\.desk-theme\),\s*\n\.desk-theme,\s*\n:root:has\(\.gate-theme\),\s*\n\.gate-theme\s*\{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  // 2026-10-24 决策：Aivora Exchange 取代 Aivora Glass，整站一块冷蓝近黑的交易大厅。
  assert.match(root, /--bg:\s*#04070e/i);
  assert.match(root, /color-scheme:\s*dark/);
  // 密度块不得再声明颜色——颜色全站统一，只允许密度差异。
  assert.ok(desk.length > 0);
  assert.doesNotMatch(desk, /--bg:|--surface:|--accent:/);
  assert.match(desk, /--control-height/);
  assert.doesNotMatch(tokens, /color-scheme:\s*light/);
});

test("literal DOM colors stay in the single token source", () => {
  const offenders = walk("src")
    .filter((file) => /\.(?:css|tsx?)$/.test(file))
    .filter((file) => file !== "src/styles/tokens.css")
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /#[\da-f]{3,8}\b|(?:rgb|hsl|oklch)a?\(/i.test(source) ? [file] : [];
    });
  assert.deepEqual(offenders, []);
});

test("font and motion roles are tokenized and motion is capped at 300ms", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  for (const token of ["--font-body-family", "--font-display-family", "--font-mono-family", "--motion-fast", "--motion-base", "--ease-out"]) {
    assert.match(tokens, new RegExp(token));
  }
  // 交易大厅字体：Archivo（可变字宽，拉丁标题与读数）+ Noto Sans SC（中文）+ Martian Mono（代码、时间、计数）。
  for (const font of ["Archivo", "Noto_Sans_SC", "Martian_Mono"]) {
    assert.match(layout, new RegExp(font));
  }
  assert.doesNotMatch(layout, /Schibsted_Grotesk|JetBrains_Mono|Instrument_Serif|Space_Grotesk\b|\bInter\b/);
  for (const fallback of ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"]) {
    assert.match(tokens, new RegExp(fallback));
  }
  const motionValues = [...tokens.matchAll(/--motion-[\w-]+:\s*(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(motionValues.length >= 2);
  assert.ok(motionValues.every((duration) => duration <= 300));
  assert.match(readFileSync("src/app/globals.css", "utf8"), /prefers-reduced-motion:\s*reduce/);
});

/// 2026-10-28 首页展厅（学 Seedance 2.5 官网）：毛玻璃只允许出现在 globals.css 里 `.on-media` 开头的规则中
/// （压在全屏视频上的胶囊）。把这些规则体剔掉后，全站不得再出现 backdrop 模糊。
function withoutOnMediaRules(source: string): string {
  return source.replace(/(^|\n)\s*\.on-media[^{]*\{[^}]*\}/g, "$1");
}

test("旧玻璃世界零残留：没有品牌橙、没有毛玻璃（视频之上的 .on-media 例外）、没有 glass/editorial 材质名", () => {
  const sources = walk("src").filter((file) => /\.(?:css|tsx?)$/.test(file));
  const offenders = sources.flatMap((file) => {
    const raw = readFileSync(file, "utf8");
    const source = file === "src/app/globals.css" ? withoutOnMediaRules(raw) : raw;
    const hits = [
      /ff4d00/i.test(source) ? "brand orange #ff4d00" : "",
      /backdrop-filter|backdrop-blur/.test(source) ? "backdrop blur" : "",
      /\bglass-(?:pane|well|sheen|edge|card)|editorial-(?:card|page|display)|studio-(?:theme|canvas|panel|label)\b|--ambient-/.test(source)
        ? "glass/editorial material name"
        : "",
    ].filter(Boolean);
    return hits.map((hit) => `${file}: ${hit}`);
  });
  assert.deepEqual(offenders, []);
  // 例外是真的被用上了，而且只在视频之上
  assert.match(readFileSync("src/app/globals.css", "utf8"), /\.on-media \.show-glass \{[^}]*backdrop-filter/);
  // 品牌标记不再是胶片 / 场记板意象
  assert.doesNotMatch(readFileSync("src/components/ui/logo.tsx", "utf8"), /Clapperboard/);
});

test("客户面不用 ✨ 图标：主行动用说清动作的图标（研究禁用项）", () => {
  // (internal) 旧代运营中台按 CLAUDE.md #8 A→B→C 下线中，不在客户面，跳过。
  const offenders = walk("src")
    .filter((file) => /\.tsx$/.test(file))
    .filter((file) => !file.includes("(internal)") && !file.endsWith("internal-sidebar.tsx"))
    .filter((file) => /\b(?:Sparkles|WandSparkles)\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("状态记号是一套自绘 SVG，不用字体回退的 ▲●◐▼‖× 字符", () => {
  const tick = readFileSync("src/components/exchange/status-tick.tsx", "utf8");
  const tape = readFileSync("src/components/exchange/exchange-tape.tsx", "utf8");
  assert.match(tick, /export function TickGlyph/);
  assert.match(tick, /<svg viewBox="0 0 12 12"/);
  for (const source of [tick, tape, readFileSync("src/components/platform/platform-shell.tsx", "utf8")]) {
    assert.doesNotMatch(source, /glyph:\s*"[▲●◐▼‖×]"/);
  }
});
