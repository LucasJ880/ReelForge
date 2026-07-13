import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(absolute)
        : Promise.resolve(/\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : []);
    }),
  );
  return nested.flat();
}

test("Phase1 活动 LLM 调用只通过 AI provider 抽象", async () => {
  const root = process.cwd();
  const files = await sourceFiles(path.join(root, "src"));
  const allowed = new Set([
    path.join(root, "src/lib/ai/providers/openai-provider.ts"),
    // Feature is sealed at both service and route layers; replacement is backlog-only.
    path.join(root, "src/lib/video-generation/digital-human/store-ad-director.ts"),
  ]);
  const offenders: string[] = [];
  for (const file of files) {
    if (allowed.has(file)) continue;
    const source = await readFile(file, "utf8");
    if (/from "@\/lib\/providers\/openai(?:-image)?"/.test(source)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("Phase1 provider default remains North-American OpenAI", async () => {
  const source = await readFile("src/lib/config/env.ts", "utf8");
  assert.match(source, /const aiDefault: AiProviderId = "openai"/);
  assert.doesNotMatch(source, /const aiDefault: AiProviderId = "volcengine"/);
});
