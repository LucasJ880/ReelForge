import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSegmentSubmitInput,
  segmentReferenceImageLimit,
} from "../src/lib/services/video-service";
import {
  STORYBOARD_BEATS_SHORT,
  groundSegmentPromptInStoryboard,
  readStoryboardReferenceLayout,
} from "../src/lib/video-generation/storyboard-beats";
import { captureDispatchGrounding, plainDispatchMatrixDigest } from "./fixtures/dispatch-grounding-harness";
import { groundingMatrixDigest } from "./fixtures/grounding-golden-matrix";

/**
 * P02-F(v)：单条派发把切片 / 主播放进参考图后，提示词里的帧序号必须跳过它们；
 * 没有切片与主播时派发结果与改动前逐字节一致；重试 / 重做与首派用同一套张数。
 */

/// 改动前（P02-F(v) 之前）的代码跑出的摘要：变了就说明无切片 / 无主播的派发结果被改动了。
const GROUNDING_MATRIX_DIGEST_BEFORE = "a519bf8d93fc3bccaddb6a93ca8d258de8780b3f259aafe0bbfe6f3e0be91f9f";
const DISPATCH_MATRIX_DIGEST_BEFORE = "e33175e9161c5ab14115872ffc11c28fced0c0f52b8c49ae8c6e5f2337310027";

test("无切片与主播：grounding 48 组输出与改动前逐字节一致（anchorCount / personCount 缺省或 0）", () => {
  assert.equal(groundingMatrixDigest(), GROUNDING_MATRIX_DIGEST_BEFORE);
});

test("无切片与主播：派发写回的参考图与段提示词与改动前逐字节一致，且不查主播素材", async () => {
  assert.equal(await plainDispatchMatrixDigest(), DISPATCH_MATRIX_DIGEST_BEFORE);
  const capture = await captureDispatchGrounding(
    { inputImageUrls: ["https://a.test/real-0.jpg"], frameCount: 4, durationSec: 15 },
    [{ fromSec: 0, toSec: 15 }],
  );
  assert.equal(capture.personAssetQueries, 0);
  assert.deepEqual(capture.directorPlan?.referenceLayout, {
    productPhotoCount: 1,
    anchorCount: 0,
    personCount: 0,
    frameCount: 4,
    limit: 8,
  });
});

test("grounding：帧序号跳过切片与主播，角色说明按序写清", () => {
  const out = groundSegmentPromptInStoryboard("PRODUCT SHAPE LOCK: keep it.", {
    aspectRatio: "9:16",
    story: "金毛在公园奔跑",
    beats: STORYBOARD_BEATS_SHORT,
    productPhotoCount: 2,
    anchorCount: 1,
    personCount: 1,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
  });
  assert.match(
    out,
    /REFERENCE IMAGES: images 1-2 are real photos of the product — match it exactly\. Image 3 is a cut-out view of the same product — match it exactly\. Image 4 is the presenter reference photo — the on-camera person must be this exact person \(same face, hair, skin tone and build\)\. Images 5-8 are the approved storyboard keyframes in story order — match their people, location, wardrobe, light and framing\./,
  );
  assert.match(out, /^0-4s: recreate storyboard keyframe 1 \(reference image 5\)/m);
  assert.match(out, /^11-15s: recreate storyboard keyframe 4 \(reference image 8\)/m);

  const personOnly = groundSegmentPromptInStoryboard("PRODUCT SHAPE LOCK: keep it.", {
    aspectRatio: "9:16",
    story: "金毛在公园奔跑",
    beats: STORYBOARD_BEATS_SHORT,
    productPhotoCount: 0,
    personCount: 1,
    totalDurationSec: 15,
    fromSec: 0,
    toSec: 15,
  });
  assert.match(personOnly, /REFERENCE IMAGES: image 1 is the presenter reference photo/);
  assert.match(personOnly, /Images 2-5 are the approved storyboard keyframes in story order — match their people, location, wardrobe, light, framing and the product they show\./);
  assert.match(personOnly, /^0-4s: recreate storyboard keyframe 1 \(reference image 2\)/m);
});

test("派发：有主播图与切片时参考图 实拍 → 切片 → 主播 → 帧，段提示词里的帧序号对得上真实位置", async () => {
  const capture = await captureDispatchGrounding(
    {
      inputImageUrls: ["https://a.test/real-0.jpg", "https://a.test/real-1.jpg", "https://a.test/real-2.jpg"],
      anchorCutoutUrls: ["https://a.test/cutout-0.png"],
      personAssetIds: ["p1", "p2"],
      frameCount: 4,
      durationSec: 15,
    },
    [{ fromSec: 0, toSec: 15 }],
  );
  assert.equal(capture.personAssetQueries, 1);
  assert.deepEqual(capture.referenceImageUrls, [
    "https://a.test/real-0.jpg",
    "https://a.test/real-1.jpg",
    "https://a.test/cutout-0.png",
    "https://a.test/person-p1.jpg",
    "https://a.test/frame-0.png",
    "https://a.test/frame-1.png",
    "https://a.test/frame-2.png",
    "https://a.test/frame-3.png",
  ]);
  const layout = readStoryboardReferenceLayout(capture.directorPlan);
  assert.deepEqual(layout, { productPhotoCount: 2, anchorCount: 1, personCount: 1, frameCount: 4, limit: 8 });
  const [prompt] = capture.prompts;
  // 每一帧在提示词里的序号都指向参考图里那一帧
  for (let frame = 0; frame < 4; frame += 1) {
    const match = prompt.match(new RegExp(`keyframe ${frame + 1} \\(reference image (\\d+)\\)`));
    assert.ok(match, `keyframe ${frame + 1} 在提示词里`);
    assert.equal(capture.referenceImageUrls[Number(match[1]) - 1], `https://a.test/frame-${frame}.png`);
  }
  assert.match(prompt, /Image 4 is the presenter reference photo/);
});

test("重试 / 重做：与首派同一套参考图与提示词（帧序号不错位），上限取首派写回的 limit", async () => {
  const capture = await captureDispatchGrounding(
    {
      inputImageUrls: ["https://a.test/real-0.jpg", "https://a.test/real-1.jpg"],
      anchorCutoutUrls: ["https://a.test/cutout-0.png"],
      personAssetIds: ["p1"],
      frameCount: 5,
      durationSec: 30,
    },
    [{ fromSec: 0, toSec: 15 }, { fromSec: 15, toSec: 30 }],
  );
  const brief = {
    aspectRatio: "9:16",
    directorPlan: capture.directorPlan as never,
    referenceImageUrls: capture.referenceImageUrls,
    videoGenerationPlan: null,
  };
  for (const segmentIndex of [0, 1]) {
    const retry = buildSegmentSubmitInput({ briefId: "brief-1", brief, segmentIndex, providerRequestKey: "k", model: "m" });
    assert.deepEqual(retry.options.referenceImages?.map((image) => image.url), capture.referenceImageUrls);
    assert.equal(retry.options.prompt, capture.prompts[segmentIndex], "重试直接用首派写回的 grounded 提示词");
    const redo = buildSegmentSubmitInput({ briefId: "brief-1", brief, segmentIndex, providerRequestKey: "k", model: "m", redoNote: "慢一点" });
    assert.deepEqual(redo.options.referenceImages?.map((image) => image.url), capture.referenceImageUrls);
    assert.ok(redo.options.prompt.startsWith(capture.prompts[segmentIndex].split("\n")[0]));
  }

  // 首派上限 9（P02-F2 接线路值后）→ 重试也按 9 截，不再固定 8 把最后一帧丢掉
  const nine = Array.from({ length: 9 }, (_, i) => `https://a.test/ref-${i}.png`);
  const planWithNine = { ...(capture.directorPlan as Record<string, unknown>), referenceLayout: { productPhotoCount: 2, anchorCount: 1, personCount: 1, frameCount: 5, limit: 9 } };
  const wide = buildSegmentSubmitInput({
    briefId: "brief-1",
    brief: { ...brief, directorPlan: planWithNine as never, referenceImageUrls: nine },
    segmentIndex: 0,
    providerRequestKey: "k",
    model: "m",
  });
  assert.equal(wide.options.referenceImages?.length, 9);
});

test("张数上限：显式参数 > 首派写回的 limit > 默认 8；旧计划没有 referenceLayout 时与改动前一样截 8", () => {
  assert.equal(segmentReferenceImageLimit(null), 8);
  assert.equal(segmentReferenceImageLimit({ segmentPlan: [] }), 8);
  assert.equal(segmentReferenceImageLimit({ referenceLayout: { productPhotoCount: 1, anchorCount: 0, personCount: 0, frameCount: 4, limit: 6 } }), 6);
  assert.equal(segmentReferenceImageLimit({ referenceLayout: { productPhotoCount: 1, anchorCount: 0, personCount: 0, frameCount: 4, limit: 6 } }, 5), 5);
  assert.equal(segmentReferenceImageLimit({ referenceLayout: { productPhotoCount: -1, limit: 6 } }), 8, "坏数据不采信");
});

test("接线：首派与重试的截断都走 segmentReferenceImageLimit，不再硬编码 slice(0, 8)", async () => {
  const service = await readFile("src/lib/services/video-service.ts", "utf8");
  assert.doesNotMatch(service, /slice\(0,\s*8\)/);
  assert.match(service, /segmentReferenceImageLimit\(brief\.directorPlan, options\.referenceImageLimit\)/);
  assert.match(service, /segmentReferenceImageLimit\(args\.brief\.directorPlan, args\.referenceImageLimit\)/);
  assert.match(service, /anchorCount: storyboard\.anchorCount,\n\s*personCount: storyboard\.personCount,/);
});
