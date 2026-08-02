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

test("approved theme topology: 全站单一深色玻璃世界，工作区块只收密度", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const root = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const studio = tokens.match(
    /:root:has\(\.studio-theme\),\s*\n\.studio-theme,\s*\n:root:has\(\.auth-studio-theme\),\s*\n\.auth-studio-theme\s*\{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  // 2026-08 决策：毛玻璃取代 Editorial 浅色 + 剪辑台，全站一块深色玻璃空气。
  assert.match(root, /--bg:\s*#0a0809/i);
  assert.match(root, /color-scheme:\s*dark/);
  // 工作区块不得再声明颜色——颜色全站统一，只允许密度差异。
  assert.doesNotMatch(studio, /--bg:|--surface:|--accent:/);
  assert.match(studio, /--control-height/);
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
  // 玻璃世界字体：Schibsted Grotesk（拉丁显示）+ Noto Sans SC（中文显示，
  // next/font 按 unicode-range 分片加载）+ Inter 正文 + JetBrains Mono 等宽。
  for (const font of ["Inter", "Schibsted_Grotesk", "Noto_Sans_SC", "JetBrains_Mono"]) {
    assert.match(layout, new RegExp(font));
  }
  assert.doesNotMatch(layout, /Instrument_Serif|Space_Grotesk\b/);
  for (const fallback of ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"]) {
    assert.match(tokens, new RegExp(fallback));
  }
  const motionValues = [...tokens.matchAll(/--motion-[\w-]+:\s*(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(motionValues.length >= 2);
  assert.ok(motionValues.every((duration) => duration <= 300));
  assert.match(readFileSync("src/app/globals.css", "utf8"), /prefers-reduced-motion:\s*reduce/);
});
