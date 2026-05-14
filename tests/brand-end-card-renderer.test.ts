import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/video-generation/brand-end-card-renderer";
import type { BrandPackagingPlan } from "../src/types/video-generation";

const { buildSvg, computeCacheKey, resolveAspect, pickPaletteFromBriefId, wrapText, escapeXml } =
  __test__;

const samplePlan: BrandPackagingPlan = {
  mode: "auto_end_card",
  logoAssetId: null,
  endCardDurationSeconds: 3,
  cta: "Shop now",
  brandName: "Aivora",
  slogan: "AI video studio",
  website: "aivora.app",
  renderStrategy: "render_ffmpeg_overlay",
  warnings: [],
};

test("brand-end-card: aspect 9:16 → 720x1280", () => {
  const r = resolveAspect("9:16");
  assert.equal(r.width, 720);
  assert.equal(r.height, 1280);
  assert.equal(r.label, "9:16");
});

test("brand-end-card: aspect 16:9 → 1280x720", () => {
  const r = resolveAspect("16:9");
  assert.equal(r.width, 1280);
  assert.equal(r.height, 720);
});

test("brand-end-card: aspect 1:1 → 720x720", () => {
  const r = resolveAspect("1:1");
  assert.equal(r.width, 720);
  assert.equal(r.height, 720);
});

test("brand-end-card: SVG 包含 brandName / cta / website 字符串", () => {
  const svg = buildSvg({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: samplePlan,
  });
  assert.ok(svg.includes("Aivora"), "should contain brandName");
  assert.ok(svg.includes("Shop now"), "should contain CTA text");
  assert.ok(svg.includes("aivora.app"), "should contain website");
});

test("brand-end-card: SVG 转义 < & > 符号防止注入", () => {
  const evilPlan: BrandPackagingPlan = {
    ...samplePlan,
    brandName: "<script>alert(1)</script>",
    cta: 'Click "now" & save',
    website: null,
  };
  const svg = buildSvg({ briefId: "b1", aspectRatio: "9:16", plan: evilPlan });
  assert.ok(!svg.includes("<script>"), "原始 <script> 不能出现在 SVG 里");
  assert.ok(svg.includes("&lt;script&gt;"), "应该被转义为 &lt;");
  assert.ok(svg.includes("&amp;"), "& 应被转义");
  assert.ok(svg.includes("&quot;"), '" 应被转义');
});

test("brand-end-card: 没有 brandName/slogan/website 也能生成（CTA 兜底）", () => {
  const sparsePlan: BrandPackagingPlan = {
    mode: "auto_end_card",
    logoAssetId: null,
    endCardDurationSeconds: 3,
    cta: null,
    brandName: null,
    slogan: null,
    website: null,
    renderStrategy: "render_ffmpeg_overlay",
    warnings: [],
  };
  const svg = buildSvg({ briefId: "b1", aspectRatio: "9:16", plan: sparsePlan });
  assert.ok(svg.includes("<svg"), "应仍然产出有效 SVG");
  assert.ok(svg.includes("Learn more"), "应使用 'Learn more' 作为 CTA fallback");
});

test("brand-end-card: 不再渲染 aspect 调试角标（V2 移除）", () => {
  /// V2 投资人级品牌片不允许任何技术/调试标签出现在画面上；
  /// 这里覆盖 9:16 / 16:9 / 1:1 三种纵横比，确保 label 不再写入 SVG。
  for (const ratio of ["9:16", "16:9", "1:1"]) {
    const svg = buildSvg({ briefId: "b1", aspectRatio: ratio, plan: samplePlan });
    assert.equal(
      svg.includes(`>${ratio}</text>`),
      false,
      `aspect badge "${ratio}" 不应出现在 SVG 文本节点里`,
    );
    /// 兜底：opacity=0.6 的灰色调试文本是 dev 角标的特征，整体也不应再出现
    assert.equal(
      svg.includes('fill="#94a3b8" opacity="0.6"'),
      false,
      "aspect badge 的灰色 opacity 0.6 文本节点不应再出现",
    );
  }
});

test("brand-end-card: hideCta=true 时不渲染按钮形 CTA（投资人/品牌片高级感）", () => {
  const svg = buildSvg({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: { ...samplePlan, hideCta: true },
  });
  assert.equal(
    svg.includes("Shop now"),
    false,
    "hideCta=true 时 CTA 文本不应被绘制",
  );
  assert.equal(
    svg.includes("Learn more"),
    false,
    "hideCta=true 时 fallback CTA 文本也不应被绘制",
  );
  /// 圆角按钮的 fill="#fbbf24" 矩形（CTA 背景）也应消失
  /// 顶部 accent 条同样使用 #fbbf24，所以只验证 CTA 圆角矩形特征
  assert.equal(
    /<rect[^>]*rx="\d+"[^>]*fill="#fbbf24"/.test(svg),
    false,
    "hideCta=true 时 CTA 圆角按钮矩形不应出现",
  );
  /// brandName + slogan + website 都仍然存在
  assert.ok(svg.includes("Aivora"), "brandName 仍渲染");
  assert.ok(svg.includes("aivora.app"), "website 仍渲染");
});

test("brand-end-card: hideCta=false（或 undefined）保留旧 CTA 行为", () => {
  const svg = buildSvg({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: samplePlan,
  });
  assert.ok(svg.includes("Shop now"), "默认仍渲染 CTA 文案");
});

test("brand-end-card: cacheKey 稳定 + 随 brandName 变化", () => {
  const k1 = computeCacheKey({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: samplePlan,
  });
  const k2 = computeCacheKey({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: { ...samplePlan, brandName: "Other" },
  });
  assert.notEqual(k1, k2);
});

test("brand-end-card: cacheKey 随 logoUrl 变化", () => {
  const k1 = computeCacheKey({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: samplePlan,
  });
  const k2 = computeCacheKey({
    briefId: "b1",
    aspectRatio: "9:16",
    plan: samplePlan,
    logoUrl: "https://example.com/logo.png",
  });
  assert.notEqual(k1, k2);
});

test("brand-end-card: 调色盘按 briefId 哈希分散", () => {
  const palettes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const p = pickPaletteFromBriefId(`brief-${i}`);
    palettes.add(`${p.from}/${p.to}`);
  }
  assert.ok(palettes.size >= 2, "至少应分散到 2 种调色盘");
});

test("brand-end-card: wrapText 不会把单词切断（只换行）", () => {
  const lines = wrapText("Aivora is the AI-powered video studio for ads", 16);
  assert.ok(lines.length <= 2, "最多 2 行");
  for (const line of lines) {
    assert.ok(!line.includes("\n"), "行内不含 \\n");
  }
});

test("brand-end-card: escapeXml 处理常见 5 个字符", () => {
  assert.equal(escapeXml("<>&\"'"), "&lt;&gt;&amp;&quot;&apos;");
});
