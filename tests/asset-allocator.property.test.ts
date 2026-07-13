import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateAssets,
  countAssetUsage,
  type AllocatableAsset,
} from "../src/lib/video-generation/asset-allocator";

function images(count: number): AllocatableAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `img_${index}`,
    url: `https://cdn.test/products/${index}.jpg`,
  }));
}

function assertBalanced(counts: Map<string, number>, expectedImages: number) {
  const values = Array.from({ length: expectedImages }, (_, index) =>
    counts.get(`img_${index}`) ?? 0,
  );
  assert.ok(
    Math.max(...values) - Math.min(...values) <= 1,
    `素材使用不均衡: min=${Math.min(...values)}, max=${Math.max(...values)}`,
  );
}

test("AC-B1：属性测试 500 组随机输入均满足均衡、去重、确定性", () => {
  // 固定种子的 LCG：测试本身可复现，同时覆盖图数 1-50、N 1-200。
  let state = 0x5eed1234;
  const random = (maxExclusive: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maxExclusive;
  };

  for (let caseIndex = 0; caseIndex < 500; caseIndex++) {
    const imageCount = 1 + random(50);
    const count = 1 + random(200);
    const min = 1 + random(Math.min(imageCount, 3));
    const max = min + random(Math.min(imageCount - min + 1, 4));
    const input = {
      batchId: `batch_property_${caseIndex}`,
      images: images(imageCount),
      count,
      templateId: `template_${caseIndex % 10}@1`,
      imagesPerVideo: { min, max },
    };

    const first = allocateAssets(input);
    const second = allocateAssets(input);

    assert.deepEqual(first, second, `case ${caseIndex}: 同输入必须完全可复现`);
    assert.equal(first.length, count);
    assertBalanced(countAssetUsage(first), imageCount);
    assert.equal(
      new Set(first.map((assignment) => assignment.dedupeKey)).size,
      count,
      `case ${caseIndex}: 组合空间耗尽后 seed 变体仍必须唯一`,
    );
    for (const assignment of first) {
      assert.ok(assignment.assets.length >= min);
      assert.ok(assignment.assets.length <= max);
      assert.equal(
        new Set(assignment.assets.map((asset) => asset.id)).size,
        assignment.assets.length,
        "单条 assignment 内不得重复同一素材",
      );
    }
  }
});

test("INV-B2：50 图 × 100 视频、k=2 时每张图恰好使用 4 次", () => {
  const assignments = allocateAssets({
    batchId: "batch_50x100",
    images: images(50),
    count: 100,
    templateId: "slow-360-orbit@1",
    imagesPerVideo: { min: 2, max: 2 },
  });
  const counts = countAssetUsage(assignments);
  assert.equal(counts.size, 50);
  for (const count of counts.values()) assert.equal(count, 4);
});

test("Phase5a：底层引擎可确定性分配单批 500 条，且不改变素材均衡", () => {
  const assignments = allocateAssets({
    batchId: "batch_capacity_500",
    images: images(50),
    count: 500,
    templateId: "capacity-proof@1",
    imagesPerVideo: { min: 1, max: 3 },
  });
  assert.equal(assignments.length, 500);
  assert.equal(new Set(assignments.map((item) => item.dedupeKey)).size, 500);
  assertBalanced(countAssetUsage(assignments), 50);
});

test("AC-B2 分配前置：20 图 × 100 视频、k=1 时每张图恰好使用 5 次", () => {
  const assignments = allocateAssets({
    batchId: "batch_20x100",
    images: images(20),
    count: 100,
    templateId: "e2e-single-image@1",
    imagesPerVideo: { min: 1, max: 1 },
  });
  const counts = countAssetUsage(assignments);
  assert.equal(counts.size, 20);
  for (const count of counts.values()) assert.equal(count, 5);
});

test("INV-B2：k 在模板范围内按视频序号轮转", () => {
  const assignments = allocateAssets({
    batchId: "batch_rotate",
    images: images(8),
    count: 8,
    templateId: "macro@1",
    imagesPerVideo: { min: 2, max: 4 },
  });
  assert.deepEqual(
    assignments.map((assignment) => assignment.assets.length),
    [2, 3, 4, 2, 3, 4, 2, 3],
  );
  assertBalanced(countAssetUsage(assignments), 8);
});

test("INV-B2：组合重复时派生不同 seed，首图顺序和结果均可审计", () => {
  const assignments = allocateAssets({
    batchId: "batch_exhausted",
    images: images(2),
    count: 20,
    templateId: "tiny-space@1",
    imagesPerVideo: { min: 2, max: 2 },
  });
  assert.equal(new Set(assignments.map((item) => item.dedupeKey)).size, 20);
  const repeated = assignments.filter((item) => item.variantIndex > 0);
  assert.ok(repeated.length > 0, "必须覆盖组合空间耗尽分支");
  assert.equal(new Set(assignments.map((item) => item.seed)).size, 20);
});

test("分配器拒绝素材不足、重复 id、非 CDN URL 和越界 N", () => {
  assert.throws(() =>
    allocateAssets({
      batchId: "batch",
      images: images(1),
      count: 1,
      templateId: "tpl",
      imagesPerVideo: { min: 2, max: 2 },
    }),
  );
  assert.throws(() =>
    allocateAssets({
      batchId: "batch",
      images: [images(1)[0], images(1)[0]],
      count: 1,
      templateId: "tpl",
      imagesPerVideo: { min: 1, max: 1 },
    }),
  );
  assert.throws(() =>
    allocateAssets({
      batchId: "batch",
      images: [{ id: "local", url: "/local.jpg" }],
      count: 1,
      templateId: "tpl",
      imagesPerVideo: { min: 1, max: 1 },
    }),
  );
  assert.throws(() =>
    allocateAssets({
      batchId: "batch",
      images: images(1),
      count: 501,
      templateId: "tpl",
      imagesPerVideo: { min: 1, max: 1 },
    }),
  );
});
