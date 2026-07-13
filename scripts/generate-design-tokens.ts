import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "src/styles/tokens.css");
const OUTPUT = path.join(ROOT, "editorial-design-tokens.generated.json");
const COLOR_TOKEN =
  /^\s*--((?:brand-input|media)-[\w-]+)\s*:\s*(#[\da-f]{3,8})\s*;/gim;

function toCamelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

async function main(): Promise<void> {
  const css = await readFile(SOURCE, "utf8");
  const colors = Object.fromEntries(
    [...css.matchAll(COLOR_TOKEN)].map((match) => [
      toCamelCase(match[1]),
      match[2],
    ]),
  );

  if (Object.keys(colors).length === 0) {
    throw new Error("tokens.css 中未找到可派生的非 DOM 颜色令牌");
  }

  const generated = {
    $comment:
      "由 scripts/generate-design-tokens.ts 从 src/styles/tokens.css 生成；请勿手动编辑。",
    source: "src/styles/tokens.css",
    colors,
  };

  await writeFile(OUTPUT, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  console.log(
    `Generated ${path.relative(ROOT, OUTPUT)} (${Object.keys(colors).length} colors)`,
  );
}

void main();
