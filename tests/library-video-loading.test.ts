import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("library and batch cards do not preload historical video URLs", async () => {
  const [libraryPreview, batchMonitor] = await Promise.all([
    readFile(new URL("../src/components/library/hover-preview-video.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/batch/batch-monitor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(libraryPreview, /preload="none"/);
  assert.doesNotMatch(libraryPreview, /preload="metadata"/);
  assert.match(batchMonitor, /preload="none"/);
});
