/**
 * scripts/ops/qa-first-pass.ts 纯计算部分：CSV 解析、首过判定、Cohen's kappa。不碰数据库。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cohensKappa,
  computeFirstPass,
  parseQaCsv,
  type JobFacts,
  type QaRatingRow,
} from "../scripts/ops/qa-first-pass";

const CSV = `﻿batchJobId,videoJobId,productScore,personScore,lipScore,rater
b1,v1,2,2,1,alice
b1,v1,2,1,,bob
b1,v2,1,0,1,alice
b1,v2,1,1,1,bob
b1,v3,2,2,2,alice
b1,v3,2,2,2,bob
b1,v4,1,1,0,alice
b1,v4,2,2,,bob
b1,v5,2,2,1,alice

b1,v6,1,1,1,alice
b1,v6,1,1,1,bob
b1,v9,2,2,2,alice
b1,v9,2,2,2,bob
b2,v7,0,0,0,alice
`;

test("CSV 解析：BOM、空行、空 lipScore、分值校验", () => {
  const rows = parseQaCsv(CSV);
  assert.equal(rows.length, 14);
  assert.deepEqual(rows[1], {
    batchJobId: "b1",
    videoJobId: "v1",
    productScore: 2,
    personScore: 1,
    lipScore: null,
    rater: "bob",
  } satisfies QaRatingRow);
  assert.throws(() => parseQaCsv("batchJobId,videoJobId,productScore,personScore,rater\nb,v,3,1,a"), /0–2/);
  assert.throws(() => parseQaCsv("batchJobId,videoJobId,productScore,rater\nb,v,1,a"), /缺少列 personScore/);
  assert.throws(() => parseQaCsv("batchJobId,videoJobId,productScore,personScore,rater\nb,,1,1,a"), /缺 videoJobId/);
  // 带引号的字段
  const quoted = parseQaCsv('batchJobId,videoJobId,productScore,personScore,rater\n"b, 1",v,1,1,"a ""x"""');
  assert.equal(quoted[0].batchJobId, "b, 1");
  assert.equal(quoted[0].rater, 'a "x"');
});

test("Cohen's kappa：完全一致 = 1、随机一致 ≈ 0、退化分布 = null", () => {
  assert.deepEqual(cohensKappa([]), { n: 0, po: null, pe: null, kappa: null });
  assert.equal(cohensKappa([[0, 0], [1, 1], [2, 2], [1, 1]]).kappa, 1);
  // 两边都只打 2 分：po = 1、pe = 1 → 公式退化
  assert.equal(cohensKappa([[2, 2], [2, 2]]).kappa, null);
  // 经典例子：A/B 各 50 条，20 同意 0、15 同意 1、其余不一致 → kappa = (0.7 - 0.5) / 0.5 = 0.4
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < 20; i += 1) pairs.push([0, 0]);
  for (let i = 0; i < 15; i += 1) pairs.push([1, 1]);
  for (let i = 0; i < 10; i += 1) pairs.push([0, 1]);
  for (let i = 0; i < 5; i += 1) pairs.push([1, 0]);
  const result = cohensKappa(pairs);
  assert.equal(result.n, 50);
  assert.equal(result.po, 0.7);
  assert.equal(result.pe, 0.5); // A: 30/50 打 0、20/50 打 1；B: 25/50、25/50 → 0.6×0.5 + 0.4×0.5
  assert.equal(result.kappa, 0.4);
  // 全不一致且边际反向 → 负 kappa
  assert.ok((cohensKappa([[0, 2], [2, 0], [0, 2], [2, 0]]).kappa ?? 0) < 0);
});

const JOBS: JobFacts[] = [
  { videoJobId: "v1", retryCount: 0, submitAttempts: 1, status: "SUCCEEDED" }, // 首过
  { videoJobId: "v2", retryCount: 0, submitAttempts: 1, status: "SUCCEEDED" }, // alice 人物 0 分
  { videoJobId: "v3", retryCount: 1, submitAttempts: 1, status: "SUCCEEDED" }, // 重抽过
  { videoJobId: "v4", retryCount: 0, submitAttempts: 2, status: "SUCCEEDED" }, // 重投过
  { videoJobId: "v5", retryCount: 0, submitAttempts: 1, status: "SUCCEEDED" }, // 只有 alice
  { videoJobId: "v6", retryCount: 0, submitAttempts: 0, status: "SUCCEEDED" }, // 首过（submitAttempts 0 也算首次）
  { videoJobId: "v8", retryCount: 0, submitAttempts: 1, status: "FAILED" }, // 没成片、没人评
];

test("首过判定：首次成片 × 两位 rater 商品/人物都 ≥1；分母是批次全部 VideoJob", () => {
  const rows = parseQaCsv(CSV);
  const report = computeFirstPass("b1", rows, JOBS);
  assert.equal(report.totalVideos, 7);
  assert.equal(report.ratedVideos, 6);
  assert.equal(report.unratedVideos, 1);
  assert.equal(report.singleRaterVideos, 1);
  assert.equal(report.notFirstAttempt, 2);
  assert.equal(report.firstPass, 2);
  assert.equal(report.firstPassRate, 0.2857);
  assert.deepEqual(report.raterPair, ["alice", "bob"]);
  // v9 在 CSV 里但不属于该批次的 VideoJob 列表；b2 的 v7 被 batchJobId 过滤掉
  assert.deepEqual(report.unknownVideoIds, ["v9"]);

  const byId = new Map(report.verdicts.map((v) => [v.videoJobId, v]));
  assert.equal(byId.get("v1")?.firstPass, true);
  assert.equal(byId.get("v6")?.firstPass, true);
  assert.equal(byId.get("v2")?.firstPass, false);
  assert.match(byId.get("v2")?.reasons.join(";") ?? "", /有 0 分.*alice/u);
  assert.match(byId.get("v3")?.reasons.join(";") ?? "", /非首次成片.*retryCount=1/u);
  assert.match(byId.get("v4")?.reasons.join(";") ?? "", /submitAttempts=2/u);
  assert.match(byId.get("v5")?.reasons.join(";") ?? "", /只有 1 位 rater/u);
  assert.deepEqual(byId.get("v8")?.reasons, ["未评分"]);

  // kappa 只在两位都评了的条上算：v1 v2 v3 v4 v6 → 5 对；lip 只有两边都有分的：v2 v3 v6 → 3 对
  assert.equal(report.kappa.product.n, 5);
  assert.equal(report.kappa.person.n, 5);
  assert.equal(report.kappa.lip.n, 3);
  // 商品分：alice [2,1,2,1,1] vs bob [2,1,2,2,1] → 4/5 一致
  assert.equal(report.kappa.product.po, 0.8);
  // 口型：v2 (1,1) v3 (2,2) v6 (1,1) → 全一致
  assert.equal(report.kappa.lip.po, 1);
});

test("首过判定：空批次与不足两位 rater 的退化情况", () => {
  const empty = computeFirstPass("b0", [], []);
  assert.equal(empty.totalVideos, 0);
  assert.equal(empty.firstPassRate, null);
  assert.equal(empty.raterPair, null);
  assert.equal(empty.kappa.product.kappa, null);

  const single = computeFirstPass(
    "b1",
    [{ batchJobId: "b1", videoJobId: "v1", productScore: 2, personScore: 2, lipScore: null, rater: "alice" }],
    [{ videoJobId: "v1", retryCount: 0, submitAttempts: 1, status: "SUCCEEDED" }],
  );
  assert.equal(single.raterPair, null);
  assert.equal(single.firstPass, 0);
  assert.equal(single.singleRaterVideos, 1);
});
