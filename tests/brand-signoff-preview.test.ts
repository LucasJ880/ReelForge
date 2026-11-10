import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SignoffPreview } from "../src/components/brand/signoff-preview";
import { SIGNOFF_BRAND_MAX, signoffGeometry } from "../src/lib/video-generation/brand-signoff";

/**
 * 2026-11-10：品牌页原来只有两列输入框，填完不知道成片上长什么样。
 * 预览按合成器同一套版式画（同一个 signoffGeometry），并如实标注哪些字段会进视频。
 */
const copy = { title: "片尾落款预览", hint: "示意", scene: "最后一个镜头", captions: "字幕", empty: "先填品牌名", trimmed: "会被截掉" };
const render = (props: { brandName: string; cta: string; logoUrl: string }) =>
  renderToStaticMarkup(createElement(SignoffPreview, { ...props, copy }));

test("预览跟着品牌名、行动指引、Logo 变；没填品牌名就不画落款", () => {
  const empty = render({ brandName: "  ", cta: "免费上门量尺", logoUrl: "" });
  assert.match(empty, /先填品牌名/);
  assert.doesNotMatch(empty, /免费上门量尺/, "没有品牌名时成片不落款，预览也不画");

  const full = render({ brandName: "NORDA 窗饰", cta: "免费上门量尺", logoUrl: "https://example.test/logo.png" });
  assert.match(full, /NORDA 窗饰/);
  assert.match(full, /免费上门量尺/);
  assert.match(full, /src="https:\/\/example\.test\/logo\.png"/);
  assert.match(full, /示意/);

  const noCta = render({ brandName: "NORDA", cta: "", logoUrl: "" });
  assert.match(noCta, /NORDA/);
  assert.doesNotMatch(noCta, /<img/);
});

test("位置和字号用合成器同一套版式，不另起一套数字", () => {
  const html = render({ brandName: "NORDA", cta: "", logoUrl: "" });
  const geometry = signoffGeometry({ width: 1080, height: 1920, captionPosition: "bottom" });
  assert.ok(html.includes(`bottom:${((1 - geometry.y / 1920) * 100).toFixed(2)}%`), "落款底边按 signoffGeometry 的 y");
  assert.ok(html.includes(`font-size:${((geometry.brandFontSize / 1080) * 100).toFixed(2)}cqw`), "字号按 signoffGeometry 的 brandFontSize");
  const source = readFileSync("src/components/brand/signoff-preview.tsx", "utf8");
  assert.match(source, /signoffGeometry\(\{ \.\.\.FRAME, captionPosition: "bottom" \}\)/);
  assert.match(source, /signoffLogoGeometry\(/);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgb\(/, "颜色只用 token");
});

test("超过落款字数上限：预览和成片一样截掉，并写明", () => {
  const long = "超".repeat(SIGNOFF_BRAND_MAX + 6);
  const html = render({ brandName: long, cta: "", logoUrl: "" });
  assert.ok(html.includes("超".repeat(SIGNOFF_BRAND_MAX)));
  assert.ok(!html.includes("超".repeat(SIGNOFF_BRAND_MAX + 1)));
  assert.match(html, /会被截掉/);
});

test("品牌表单：预览吃的是正在填的草稿；如实写明哪些字段会进视频", () => {
  const manager = readFileSync("src/components/brand/brand-package-manager.tsx", "utf8");
  assert.match(manager, /<SignoffPreview brandName=\{draft\.brandName\} cta=\{draft\.cta\} logoUrl=\{draft\.logoUrl\} copy=\{copy\.preview\} \/>/);
  assert.match(manager, /data-testid="brand-fields-usage"/);
  assert.match(manager, /口号、联系方式、网站和尾卡目前只存档/);
  assert.doesNotMatch(manager, /每条视频都能直接套用/);
});
