import assert from "node:assert/strict";
import test from "node:test";
import { legacyPlatformRedirects } from "../next.config";

const expected = new Map([
  ["/design", "/app/create"],
  ["/batch-create", "/app/create"],
  /// 批量生产与模板库 2026-11-17 下线：旧批次链接落成品库（做好的批量成片仍在那里），模板库落创作页
  ["/batches/:id", "/app/library"],
  ["/personal", "/app/create"],
  ["/personal/agent", "/app/create"],
  ["/personal/create-video", "/app/create"],
  ["/personal/templates", "/app/create"],
  ["/personal/videos", "/app/library"],
  ["/personal/videos/:id", "/app/library/:id"],
  ["/personal/billing", "/app/create"],
  ["/business", "/app/create"],
  ["/business/create-ad-video", "/app/create"],
  ["/business/creative-studio", "/app/create"],
  ["/business/products", "/app/library"],
  ["/business/products/:id", "/app/library/:id"],
  /// 这两条原来落到投放赛马（/app/racing）；那一页 2026-11-16 删了，改落成品库
  ["/business/performance", "/app/library"],
  ["/business/recommendations", "/app/library"],
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
      { source: "/batches/:id", destination: "/app/library", permanent: true },
      { source: "/personal/videos/:id", destination: "/app/library/:id", permanent: true },
      { source: "/business/products/:id", destination: "/app/library/:id", permanent: true },
    ],
  );
});
