import assert from "node:assert/strict";
import test from "node:test";
import { legacyPlatformRedirects } from "../next.config";

const expected = new Map([
  ["/design", "/app/create"],
  ["/batch-create", "/app/batches/new"],
  ["/batches/:id", "/app/batches/:id"],
  ["/personal", "/app/create"],
  ["/personal/agent", "/app/create"],
  ["/personal/create-video", "/app/create"],
  ["/personal/templates", "/app/templates"],
  ["/personal/videos", "/app/library"],
  ["/personal/videos/:id", "/app/library/:id"],
  ["/personal/billing", "/app/create"],
  ["/business", "/app/create"],
  ["/business/create-ad-video", "/app/create"],
  ["/business/creative-studio", "/app/create"],
  ["/business/products", "/app/library"],
  ["/business/products/:id", "/app/library/:id"],
  ["/business/performance", "/app/racing"],
  ["/business/recommendations", "/app/racing"],
  ["/business/billing", "/app/create"],
  ["/business/integrations", "/app/create"],
  ["/business/digital-human-store-ad", "/app/create"],
]);

test("Phase1 legacy 页面全部由 Next permanent redirect 映射到统一 /app", () => {
  assert.equal(legacyPlatformRedirects.length, expected.size);
  for (const redirect of legacyPlatformRedirects) {
    assert.equal(redirect.permanent, true, `${redirect.source} 必须是 308 permanent redirect`);
    assert.equal(redirect.destination, expected.get(redirect.source), `${redirect.source} 目标错误`);
  }
});

test("Phase1 动态详情 ID 原样透传", () => {
  assert.deepEqual(
    legacyPlatformRedirects.filter((redirect) => redirect.source.includes(":id")),
    [
      { source: "/batches/:id", destination: "/app/batches/:id", permanent: true },
      { source: "/personal/videos/:id", destination: "/app/library/:id", permanent: true },
      { source: "/business/products/:id", destination: "/app/library/:id", permanent: true },
    ],
  );
});
