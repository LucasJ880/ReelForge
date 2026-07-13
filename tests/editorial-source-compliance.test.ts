import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const TOKENS_FILE = path.join(ROOT, "src/styles/tokens.css");
const GLOBALS_FILE = path.join(ROOT, "src/app/globals.css");
const UI_DIR = path.join(ROOT, "src/components/ui");

const FOUNDATION_FILES = [
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/(personal)/design/page.tsx",
  "src/components/ui/badge.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/dialog.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/progress.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/sheet.tsx",
  "src/components/ui/sonner.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/tooltip.tsx",
];

const HEX_COLOR = /#[\da-f]{3,8}\b/gi;
const JSX_EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const FORBIDDEN_VISUAL_PATTERN =
  /\b(?:dark:|backdrop-blur|bg-gradient|from-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-|to-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-|shadow-(?:sm|md|lg|xl|2xl|inner)|rounded-(?:none|xs|sm|md|lg|xl|2xl|3xl))\b/g;
const DEFAULT_PALETTE_IN_UI =
  /\b(?:text|bg|border|ring|from|to|via|fill|stroke)-(?:zinc|slate|neutral)-/g;
const CJK_IN_ITALIC =
  /(?:<em[^>]*>[^<]*[\u3400-\u9fff\uf900-\ufaff][^<]*<\/em>|className="[^"]*italic[^"]*"[^>]*>[^<]*[\u3400-\u9fff\uf900-\ufaff])/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:css|tsx?|jsx?)$/.test(entry) ? [absolute] : [];
  });
}

function jsxSourceFiles(files: string[]): string[] {
  return files.filter((file) => /\.(?:tsx|jsx)$/.test(file));
}

function violations(
  files: string[],
  pattern: RegExp,
  exclude: string[] = [],
): string[] {
  return files.flatMap((file) => {
    if (exclude.includes(file)) return [];
    const source = readFileSync(file, "utf8");
    const matches = [...source.matchAll(pattern)];
    return matches.map(
      (match) =>
        `${path.relative(ROOT, file)}:${source.slice(0, match.index).split("\n").length} ${match[0]}`,
    );
  });
}

describe("Editorial Studio 源码合规", () => {
  const foundation = FOUNDATION_FILES.map((file) => path.join(ROOT, file));
  const allSource = sourceFiles(path.join(ROOT, "src"));
  const uiFiles = sourceFiles(UI_DIR);

  it("仅 tokens.css 可以声明十六进制颜色", () => {
    assert.deepEqual(violations(foundation, HEX_COLOR, [TOKENS_FILE]), []);
    assert.deepEqual(violations(allSource, HEX_COLOR, [TOKENS_FILE]), []);
  });

  it("设计系统基础文件不包含反模式或 JSX emoji", () => {
    assert.deepEqual(violations(foundation, FORBIDDEN_VISUAL_PATTERN), []);
    assert.deepEqual(violations(foundation, JSX_EMOJI), []);
  });

  it("components/ui 禁止使用 zinc/slate/neutral 默认色", () => {
    assert.deepEqual(violations(uiFiles, DEFAULT_PALETTE_IN_UI), []);
  });

  it("全站 JSX 禁止中文斜体", () => {
    assert.deepEqual(violations(jsxSourceFiles(allSource), CJK_IN_ITALIC), []);
  });

  it("editorial-page 容器使用 1200px token", () => {
    const globals = readFileSync(GLOBALS_FILE, "utf8");
    assert.match(globals, /var\(--content-max-width\)/);
    assert.doesNotMatch(globals, /88rem/);
  });

  it("严格门禁扫描整个 src", () => {
    assert.deepEqual(violations(allSource, FORBIDDEN_VISUAL_PATTERN), []);
    assert.deepEqual(violations(jsxSourceFiles(allSource), JSX_EMOJI), []);
  });
});
