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

test("approved theme topology keeps Studio dark and auth/public/operations light", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const root = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const studio = tokens.match(/\.studio-theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const auth = tokens.match(/\.auth-studio-theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(root, /--bg:\s*#fafaf7/i);
  assert.match(studio, /--bg:\s*#17130f/i);
  assert.match(auth, /color-scheme:\s*light/);
  assert.doesNotMatch(auth, /--bg:\s*#17130f/i);
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
  for (const font of ["Inter", "Space_Grotesk", "JetBrains_Mono", "Noto_Sans_SC", "Noto_Serif_SC"]) {
    assert.match(layout, new RegExp(font));
  }
  const motionValues = [...tokens.matchAll(/--motion-[\w-]+:\s*(\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(motionValues.length >= 2);
  assert.ok(motionValues.every((duration) => duration <= 300));
  assert.match(readFileSync("src/app/globals.css", "utf8"), /prefers-reduced-motion:\s*reduce/);
});
