import assert from "node:assert/strict";
import test from "node:test";

import { SHUYU_MAX_REFERENCE_IMAGES } from "../src/lib/providers/shuyu";
import { segmentReferenceImageLimit } from "../src/lib/services/video-service";
import {
  SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT,
  composeSingleVideoReferenceGroups,
  singleVideoReferenceImageLimitForAdapter,
} from "../src/lib/video-generation/storyboard-service";

/**
 * P02-F2 · 单条视频参考图上限按线路适配器取（D-2：只有 Shuyu 一条真实线路）。
 */

test("Shuyu 适配器给满 9 张（E1 视频档 input_images_max），其它适配器与历史行沿用 8", () => {
  assert.equal(SHUYU_MAX_REFERENCE_IMAGES, 9);
  assert.equal(singleVideoReferenceImageLimitForAdapter("shuyu"), 9);
  assert.equal(singleVideoReferenceImageLimitForAdapter("byteplus"), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
  assert.equal(singleVideoReferenceImageLimitForAdapter("mock"), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
  assert.equal(singleVideoReferenceImageLimitForAdapter(null), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
  assert.equal(singleVideoReferenceImageLimitForAdapter(undefined), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
});

test("首派写进 referenceLayout.limit=9 后，重试 / 重做读同一个数；没有 layout 的历史行仍是 8", () => {
  const plan = { referenceLayout: { productPhotoCount: 2, anchorCount: 0, personCount: 0, frameCount: 7, limit: 9 } };
  assert.equal(segmentReferenceImageLimit(plan), 9);
  assert.equal(segmentReferenceImageLimit(plan, 6), 6);
  assert.equal(segmentReferenceImageLimit(null), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
  assert.equal(segmentReferenceImageLimit({ segmentPlan: [] }), SINGLE_VIDEO_REFERENCE_IMAGE_LIMIT);
});

test("上限 9 时 2 张实拍 + 7 帧全部进参考图；上限 8 时帧受保护、第二张实拍被挤掉——这正是提到 9 的意义", () => {
  const productImageUrls = ["https://a.test/p0.jpg", "https://a.test/p1.jpg"];
  const storyboardFrameUrls = Array.from({ length: 7 }, (_, i) => `https://a.test/f${i}.jpg`);
  const nine = composeSingleVideoReferenceGroups({ productImageUrls, storyboardFrameUrls, limit: 9 });
  assert.deepEqual(nine.references, [...productImageUrls, ...storyboardFrameUrls]);
  assert.deepEqual([nine.productPhotoCount, nine.frameCount], [2, 7]);
  const eight = composeSingleVideoReferenceGroups({ productImageUrls, storyboardFrameUrls, limit: 8 });
  assert.deepEqual(eight.references, [productImageUrls[0], ...storyboardFrameUrls]);
  assert.deepEqual([eight.productPhotoCount, eight.frameCount], [1, 7]);
});
