import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const TOKENS_FILE = path.join(ROOT, "src/styles/tokens.css");
const STRICT = process.env.STRICT_EDITORIAL_SOURCE === "1";

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

  it("仅 tokens.css 可以声明十六进制颜色", () => {
    assert.deepEqual(violations(foundation, HEX_COLOR, [TOKENS_FILE]), []);
  });

  it("设计系统基础文件不包含反模式或 JSX emoji", () => {
    assert.deepEqual(violations(foundation, FORBIDDEN_VISUAL_PATTERN), []);
    assert.deepEqual(violations(foundation, JSX_EMOJI), []);
  });

  it(
    "严格门禁扫描整个 src",
    { skip: STRICT ? false : "迁移完成后以 STRICT_EDITORIAL_SOURCE=1 启用" },
    () => {
      const allSource = sourceFiles(path.join(ROOT, "src"));
      assert.deepEqual(violations(allSource, HEX_COLOR, [TOKENS_FILE]), []);
      assert.deepEqual(violations(allSource, FORBIDDEN_VISUAL_PATTERN), []);
      assert.deepEqual(violations(jsxSourceFiles(allSource), JSX_EMOJI), []);
    },
  );
});
