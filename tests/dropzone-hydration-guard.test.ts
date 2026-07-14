import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("file dropzone cannot accept a selection before React hydration", () => {
  const source = readFileSync("src/components/ui/dropzone.tsx", "utf8");
  assert.match(source, /useSyncExternalStore\(/);
  assert.match(source, /const interactive = hydrated && !disabled && !uploading/);
  assert.match(source, /\{hydrated \? \(\s*<input/);
  assert.match(source, /disabled=\{!interactive\}/g);
  assert.match(source, /if \(!fileList \|\| !interactive\) return/);
  assert.match(source, /data-hydrated=\{hydrated \? "true" : "false"\}/);
});
