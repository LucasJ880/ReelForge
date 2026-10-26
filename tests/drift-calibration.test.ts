/**
 * X-SCAF-7：漂移校准的纯函数——生产判据适配层、标签 CSV、召回/误杀与 Wilson 下界、
 * DINOv2 预处理与相似度、阈值扫描。不抽帧、不调 vision、不加载 onnx。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  confusion,
  confusionBySplit,
  cosineSimilarity,
  embeddingFromOutput,
  evenlySpacedTimestamps,
  neutralDriftUserPrompt,
  normalizeDriftDecision,
  parseDriftLabelsCsv,
  resolveProductionDriftJudge,
  rgb24ToNchw,
  thresholdSweep,
  videoSimilarityScore,
  wilsonLowerBound,
} from "../scripts/lib/drift-calibration";
import * as frameQa from "../src/lib/video-generation/frame-qa";

test("适配层：当前 frame-qa 还没有 P01-B 判据 → 明确报未合入，不兜底", () => {
  const resolution = resolveProductionDriftJudge("src/lib/video-generation/frame-qa.ts", frameQa as Record<string, unknown>);
  assert.equal(resolution.ok, false);
  if (!resolution.ok) assert.match(resolution.reason, /FRAME_DRIFT_SYSTEM \/ decideDriftVerdict（P01-B 未合入）/);
  assert.equal(resolveProductionDriftJudge("x", null).ok, false);
});

test("适配层：P01-B 合入后的导出形状被原样接上，可选 user 提示词构造器", () => {
  const decide = (findings: unknown[]) => ({ ok: findings.length === 0 });
  const resolution = resolveProductionDriftJudge("m", {
    FRAME_DRIFT_SYSTEM: "SYSTEM",
    decideDriftVerdict: decide,
  });
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.judge.system, "SYSTEM");
    assert.equal(resolution.judge.decide, decide);
    assert.equal(resolution.judge.buildUserPrompt, null);
  }
  const withPrompt = resolveProductionDriftJudge("m", {
    FRAME_DRIFT_SYSTEM: "S",
    decideDriftVerdict: decide,
    buildDriftUserPrompt: () => "p",
  });
  assert.equal(withPrompt.ok && withPrompt.judge.buildUserPrompt?.(1, 2), "p");
});

test("中性 user 提示词只讲图片顺序，不带判据词", () => {
  const prompt = neutralDriftUserPrompt(2, 6);
  assert.match(prompt, /first 2 image/);
  assert.match(prompt, /next 6 image/);
  assert.doesNotMatch(prompt, /drift|match|consistent|score/i);
});

test("判定归一：drifted / ok / 嵌套 drift 三种形状；不认识就抛错", () => {
  assert.equal(normalizeDriftDecision({ drifted: true }).drifted, true);
  assert.equal(normalizeDriftDecision({ ok: true }).drifted, false);
  assert.equal(normalizeDriftDecision({ ok: false }).drifted, true);
  assert.equal(normalizeDriftDecision({ drift: { drifted: false } }).drifted, false);
  assert.throws(() => normalizeDriftDecision({ verdict: "x" }), /补适配/);
  assert.throws(() => normalizeDriftDecision(null), /补适配/);
});

test("标签 CSV：BOM、可选列、多种真假写法、同 id 以最后一行为准；坏值报行号", () => {
  const labels = parseDriftLabelsCsv(
    "\uFEFFvideoId,drift,sku,split\r\na,1,bottle,train\nb,ok,watch,holdout\nc,漂移,,\na,0,bottle,holdout\n",
  );
  assert.deepEqual(labels, [
    { videoId: "a", drift: false, sku: "bottle", split: "holdout" },
    { videoId: "b", drift: false, sku: "watch", split: "holdout" },
    { videoId: "c", drift: true, sku: null, split: "train" },
  ]);
  assert.deepEqual(parseDriftLabelsCsv("videoId,drift\nx,yes"), [{ videoId: "x", drift: true, sku: null, split: "train" }]);
  assert.throws(() => parseDriftLabelsCsv("id,drift\nx,1"), /表头/);
  assert.throws(() => parseDriftLabelsCsv("videoId,drift\nx,maybe"), /第 2 行/);
  assert.throws(() => parseDriftLabelsCsv("videoId,drift,split\nx,1,test"), /train \/ holdout/);
  assert.deepEqual(parseDriftLabelsCsv(""), []);
});

test("召回 / 误杀：未预测的条目不计入；按 split 分开统计", () => {
  const labels = parseDriftLabelsCsv(
    "videoId,drift,split\np1,1,train\np2,1,holdout\np3,1,holdout\nn1,0,train\nn2,0,holdout\nn3,0,holdout\nskip,1,holdout",
  );
  const predictions = new Map([
    ["p1", true],
    ["p2", true],
    ["p3", false],
    ["n1", false],
    ["n2", true],
    ["n3", false],
  ]);
  const all = confusion(labels, predictions);
  assert.deepEqual([all.n, all.tp, all.fn, all.fp, all.tn], [6, 2, 1, 1, 2]);
  assert.equal(all.recall, 2 / 3);
  assert.equal(all.falseKillRate, 1 / 3);
  assert.equal(all.precision, 2 / 3);
  const split = confusionBySplit(labels, predictions);
  assert.equal(split.train.recall, 1);
  assert.equal(split.holdout.recall, 0.5);
  assert.equal(split.holdout.falseKillRate, 0.5);
  const empty = confusion([], predictions);
  assert.deepEqual([empty.recall, empty.recallCiLow, empty.falseKillRate], [null, null, null]);
});

test("Wilson 下界：§7 P0-1 的「召回 ≥0.8 且下界 ≥0.6」要靠样本量撑", () => {
  assert.equal(wilsonLowerBound(0, 0), null);
  const small = wilsonLowerBound(8, 10)!;
  const big = wilsonLowerBound(24, 30)!;
  assert.ok(small < 0.6, `10 个正例召回 0.8 的下界 ${small} 应 < 0.6`);
  assert.ok(big > 0.6 && big < 0.8, `30 个正例召回 0.8 的下界 ${big} 应落在 (0.6, 0.8)`);
  assert.equal(wilsonLowerBound(0, 5), 0);
});

test("相似度：余弦、onnx 输出取 CLS / pooler、视频分取最差帧", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /维度/);
  assert.deepEqual([...embeddingFromOutput([1, 2, 3], [1, 3])], [1, 2, 3]);
  assert.deepEqual([...embeddingFromOutput([9, 8, 1, 2, 3, 4], [1, 3, 2])], [9, 8]);
  assert.throws(() => embeddingFromOutput([1, 2], [2, 1]), /形状/);
  const { score, perFrame } = videoSimilarityScore(
    [[1, 0], [0.6, 0.8], [0, 1]],
    [[1, 0], [0.8, 0.6]],
  );
  assert.equal(perFrame.length, 3);
  assert.ok(Math.abs(perFrame[1] - 0.96) < 1e-9);
  assert.ok(Math.abs(score - 0.6) < 1e-9);
});

test("DINOv2 预处理：rgb24 HWC → ImageNet 归一化 NCHW；字节数不对就拒绝", () => {
  const out = rgb24ToNchw(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), 2);
  assert.equal(out.length, 12);
  assert.ok(Math.abs(out[0] - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(out[4 + 1] - (1 - 0.456) / 0.224) < 1e-5);
  assert.ok(Math.abs(out[8 + 2] - (1 - 0.406) / 0.225) < 1e-5);
  assert.throws(() => rgb24ToNchw(new Uint8Array(5), 2), /字节数/);
});

test("阈值扫描：score < 阈值判漂移，阈值越高召回越高、误杀越多", () => {
  const labels = parseDriftLabelsCsv("videoId,drift\np1,1\np2,1\nn1,0\nn2,0");
  const scores = new Map([
    ["p1", 0.4],
    ["p2", 0.6],
    ["n1", 0.7],
    ["n2", 0.9],
  ]);
  const table = thresholdSweep(labels, scores, [0.5, 0.65, 0.8]);
  assert.deepEqual(table.map((row) => row.all.recall), [0.5, 1, 1]);
  assert.deepEqual(table.map((row) => row.all.falseKillRate), [0, 0, 0.5]);
});

test("抽帧时刻：每段中点；非法输入给空", () => {
  assert.deepEqual(evenlySpacedTimestamps(12, 4), [1.5, 4.5, 7.5, 10.5]);
  assert.deepEqual(evenlySpacedTimestamps(0, 4), []);
  assert.deepEqual(evenlySpacedTimestamps(10, 0), []);
});
