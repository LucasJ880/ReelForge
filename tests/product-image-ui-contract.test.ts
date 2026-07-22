import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("active image UI is one Shuyu workbench with optional reference and compact settings", async () => {
  const source = await readFile(
    "src/components/product-images/product-image-studio.tsx",
    "utf8",
  );
  assert.doesNotMatch(source, /setMode|\[mode,/);
  assert.doesNotMatch(source, /GPT Image 2/);
  assert.match(source, /Shuyu Image 2/);
  assert.match(source, /sourceAssetId/);
  assert.match(source, /resolution/);
  assert.match(source, /resultCount/);
  assert.match(source, /<details/);
  assert.match(source, /download/);
  assert.match(source, /variation/i);
  assert.match(source, /edit/i);
  assert.match(source, /useSingle/);
  assert.match(source, /useBatch/);
});

test("public product-image service has no generic image provider path", async () => {
  const source = await readFile("src/lib/services/product-image-service.ts", "utf8");
  assert.doesNotMatch(source, /getAiProvider|generateImages|editImages/);
  assert.match(source, /submitShuyuImageTask/);
  assert.match(source, /pollShuyuImageTask/);
});
