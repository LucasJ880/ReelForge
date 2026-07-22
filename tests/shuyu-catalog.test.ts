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
