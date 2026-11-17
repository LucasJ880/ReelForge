import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public product-image service has no generic image provider path", async () => {
  const source = await readFile("src/lib/services/product-image-service.ts", "utf8");
  assert.doesNotMatch(source, /getAiProvider|generateImages|editImages/);
  assert.match(source, /submitShuyuImageTask/);
  assert.match(source, /pollShuyuImageTask/);
});

test("durable image tasks stay wired; the studio UI and its video handoff are gone", async () => {
  const [schema, service, single, batch, upload] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("src/lib/services/product-image-service.ts", "utf8"),
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
  /// 产品图工作台（页面、接口、组件）2026-11-16 删除：表与在途任务的收尾（poll-videos 里的轮询）留着，
  /// 「用这张图做视频」的带入参数只有工作台会发，创作页和新建批次页不再认它。
  assert.doesNotMatch(single, /productImageResultId|findProductImageResultForUser/);
  assert.doesNotMatch(batch, /productImageResultId|findProductImageResultForUser/);
  assert.doesNotMatch(upload, /公开访问的素材 URL 登记/);
});
