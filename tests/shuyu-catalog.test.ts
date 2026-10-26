import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShuyuCatalog,
  selectAuditedImage2Plan,
} from "../src/lib/providers/shuyu-catalog";

const priceFixture = {
  object: "list",
  data: [
    {
      plan_id: "image-plan-01",
      kind: "image",
      model: "gpt-image-2",
      resolution: "1K",
      sale_points: 24,
      display_name: "GPT Image 2 · 1K",
      status: "available",
    },
    {
      plan_id: "image-plan-02",
      kind: "image",
      model: "gpt-image-2",
      resolution: "2K",
      sale_points: 48,
      display_name: "GPT Image 2 · 2K",
      status: "available",
    },
    {
      plan_id: "image-plan-03",
      kind: "image",
      model: "gemini-2.5-pro-image",
      resolution: "2K",
      sale_points: 36,
      display_name: "Gemini Pro · 2K",
      status: "available",
    },
  ],
};

const geminiOnlyFixture = {
  object: "list",
  data: [
    {
      plan_id: "image-plan-03",
      kind: "image",
      model: "gemini-2.5-pro-image",
      resolution: "1K",
      sale_points: 24,
      display_name: "Gemini Pro · 1K",
      status: "available",
    },
  ],
};

test("selects only GPT Image 2 plans at the requested resolution", () => {
  const catalog = parseShuyuCatalog(priceFixture);
  assert.equal(selectAuditedImage2Plan(catalog, "2K").planId, "image-plan-02");
});

test("fails closed when Image 2 is absent", () => {
  assert.throws(
    () => selectAuditedImage2Plan(parseShuyuCatalog(geminiOnlyFixture), "1K"),
    /Image 2.*unavailable/i,
  );
});

test("P02-B：解析图像档 capabilities.input_images_max 为 inputImagesMax；缺省 / 非正整数回落 undefined", () => {
  const catalog = parseShuyuCatalog({
    object: "list",
    data: [
      { ...priceFixture.data[0], plan_id: "with-max", capabilities: { input_images_max: 6, aspect_ratios: ["9:16"] } },
      { ...priceFixture.data[1], plan_id: "no-caps" },
      { ...priceFixture.data[1], plan_id: "string-max", capabilities: { input_images_max: "6" } },
      { ...priceFixture.data[1], plan_id: "zero-max", capabilities: { input_images_max: 0 } },
    ],
  });
  const byId = new Map(catalog.imagePlans.map((plan) => [plan.planId, plan]));
  assert.equal(byId.get("with-max")?.inputImagesMax, 6);
  assert.equal(byId.get("no-caps")?.inputImagesMax, undefined);
  assert.ok(!("inputImagesMax" in byId.get("no-caps")!), "解析不到时不带这个键（计价快照 deepEqual 不受影响）");
  assert.equal(byId.get("string-max")?.inputImagesMax, undefined);
  assert.equal(byId.get("zero-max")?.inputImagesMax, undefined);
});
