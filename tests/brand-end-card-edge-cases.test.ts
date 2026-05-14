import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/video-generation/brand-end-card-renderer";
import type { BrandPackagingPlan } from "../src/types/video-generation";

const { buildSvg, wrapText } = __test__;

const baseplan: BrandPackagingPlan = {
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

test("brand-end-card edge: 极长无空格品牌名被强制断行（不溢出）", () => {
  const longBrand = "A".repeat(60); /// 60 个无空格字符
  const lines = wrapText(longBrand, 18);
  assert.ok(lines.length <= 2, `应裁剪到 ≤ 2 行，实得 ${lines.length}`);
  for (const l of lines) {
    /// ellipsis 占 1 字符位，所以最严格 ≤ maxChars
    assert.ok(l.length <= 18 + 1, `单行不应超过 maxChars: "${l}"`);
  }
});

test("brand-end-card edge: 含空格的极长品牌名超过 2 行时第二行带省略号", () => {
  const lines = wrapText("alpha beta gamma delta epsilon zeta eta theta iota", 8);
  assert.ok(lines.length === 2, `应严格 2 行，实得 ${lines.length}`);
  assert.ok(
    lines[1].endsWith("…"),
    `第 2 行超出时应带省略号: "${lines[1]}"`,
  );
});

test("brand-end-card edge: 全空字段（极简 plan）仍能产出有效 SVG", () => {
  const empty: BrandPackagingPlan = {
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
  const svg = buildSvg({ briefId: "edge", aspectRatio: "9:16", plan: empty });
  assert.ok(svg.includes("<svg"), "应仍是合法 SVG");
  /// 至少要有 CTA 兜底「Learn more」可见，避免画面纯背景
  assert.ok(svg.includes("Learn more"), "极简 plan 应仍然显示 CTA 兜底");
});

test("brand-end-card edge: 未知 aspect ratio 不抛异常（兜底 9:16）", () => {
  const svg = buildSvg({
    briefId: "x",
    aspectRatio: "21:9", /// 故意传未知值
    plan: baseplan,
  });
  assert.ok(svg.includes("<svg"), "未知 aspect 应仍能产出 SVG");
  /// V2 移除了 aspect 调试角标，所以改用 9:16 的真实画布尺寸 (720x1280) 来验证兜底
  assert.ok(svg.includes('width="720"'), "应兜底到 9:16 的宽度 720");
  assert.ok(svg.includes('height="1280"'), "应兜底到 9:16 的高度 1280");
});

test("brand-end-card edge: brandName 含 emoji / 中文 不破坏 SVG", () => {
  const svg = buildSvg({
    briefId: "x",
    aspectRatio: "9:16",
    plan: { ...baseplan, brandName: "果味奇遇 🍓" },
  });
  assert.ok(svg.includes("<svg"), "应仍是合法 SVG");
  assert.ok(svg.includes("果味奇遇"), "中文应保留");
});

test("brand-end-card edge: HTML 注入字段不会破坏 SVG 结构", () => {
  /// 双重保险：除了已知 <script>，再试 onload= / SVG injection
  const evil: BrandPackagingPlan = {
    ...baseplan,
    brandName: '"><image href="x" onload="alert(1)"/>',
    cta: "</text><script>",
    website: "<a>",
  };
  const svg = buildSvg({ briefId: "x", aspectRatio: "9:16", plan: evil });
  assert.ok(!svg.includes("<image href="), "原始 <image> 不能进入 SVG");
  assert.ok(!svg.includes("</text><script>"), "未转义 </text><script> 不能存在");
  assert.ok(svg.includes("&lt;"), "应有转义后的 &lt;");
});

test("brand-end-card edge: wrapText 空字符串返回空数组", () => {
  assert.deepEqual(wrapText("", 18), []);
  assert.deepEqual(wrapText("   ", 18), []);
});
