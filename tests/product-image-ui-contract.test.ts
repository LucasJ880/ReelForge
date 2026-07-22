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

test("durable image tasks and every result-scoped handoff are wired", async () => {
  const [schema, service, ui, single, batch, upload] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("src/lib/services/product-image-service.ts", "utf8"),
    readFile("src/components/product-images/product-image-studio.tsx", "utf8"),
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/app/(platform)/app/batches/new/page.tsx", "utf8"),
    readFile("src/app/api/upload/blob/route.ts", "utf8"),
  ]);
  assert.match(schema, /model ProductImageProviderTask/);
  assert.match(schema, /submissionState\s+ProviderSubmissionState/);
  assert.match(schema, /leaseOwner\s+String\?/);
  assert.match(schema, /leaseExpiresAt\s+DateTime\?/);
  assert.match(service, /ACK_UNKNOWN/);
  assert.match(service, /leaseOwner/);
  assert.match(ui, /productImageResultId/);
  assert.match(single, /productImageResultId/);
  assert.match(batch, /productImageResultId/);
  assert.doesNotMatch(upload, /公开访问的素材 URL 登记/);
});
