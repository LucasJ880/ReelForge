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

test("approved theme topology keeps Studio and auth dark, public/operations light", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const root = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const studio = tokens.match(
    /:root:has\(\.studio-theme\),\s*\n\.studio-theme,\s*\n:root:has\(\.auth-studio-theme\),\s*\n\.auth-studio-theme\s*\{([\s\S]*?)\n\}/,
  )?.[1] ?? "";
  assert.match(root, /--bg:\s*#fafaf7/i);
  // 0721 决策：登录面与 /app Studio 共用同一深色块，避免登录 → 工作台明暗跳变。
  assert.match(studio, /--bg:\s*#101015/i);
  assert.match(tokens, /\.auth-studio-theme\s*\{\s*color-scheme:\s*dark;\s*\}/);
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
  for (const font of ["Inter", "Instrument_Serif", "Space_Grotesk", "JetBrains_Mono"]) {
    assert.match(layout, new RegExp(font));
  }
  assert.doesNotMatch(layout, /Noto_Sans_SC|Noto_Serif_SC/);
  for (const fallback of ["PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Songti SC", "Noto Serif CJK SC"]) {
    assert.match(tokens, new RegExp(fallback));
  }
  const motionValues = [...tokens.matchAll(/--motion-[\w-]+:\s*(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(motionValues.length >= 2);
  assert.ok(motionValues.every((duration) => duration <= 300));
  assert.match(readFileSync("src/app/globals.css", "utf8"), /prefers-reduced-motion:\s*reduce/);
});
