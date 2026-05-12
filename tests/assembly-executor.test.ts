import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "../src/lib/video-generation/assembly-executor";

const { extractBrandKit } = __test__;

test("assembly-executor: extractBrandKit 处理 productInput=null", () => {
  assert.equal(extractBrandKit(null), null);
});

test("assembly-executor: extractBrandKit 处理 productInput 非 object", () => {
  assert.equal(extractBrandKit("not an object"), null);
  assert.equal(extractBrandKit(123), null);
  assert.equal(extractBrandKit(undefined), null);
});

test("assembly-executor: extractBrandKit 处理缺失 brandKit 字段", () => {
  assert.equal(
    extractBrandKit({ source: "unified_input" } as Record<string, unknown>),
    null,
  );
});

test("assembly-executor: extractBrandKit 提取 brandKit.logoUrl", () => {
  const r = extractBrandKit({
    source: "unified_input",
    brandKit: { brandName: "Aivora", logoUrl: "https://blob.com/logo.png" },
  });
  assert.deepEqual(r, { logoUrl: "https://blob.com/logo.png" });
});

test("assembly-executor: extractBrandKit logoUrl 非字符串 → null", () => {
  const r = extractBrandKit({
    brandKit: { logoUrl: 123 },
  });
  assert.deepEqual(r, { logoUrl: null });
});

test("assembly-executor: extractBrandKit brandKit 为空对象（无 logoUrl）", () => {
  const r = extractBrandKit({ brandKit: {} });
  assert.deepEqual(r, { logoUrl: null });
});
