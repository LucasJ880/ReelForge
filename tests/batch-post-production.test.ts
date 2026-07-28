/**
 * 批次级后期（口播 / BGM / 字幕）契约。
 *
 * 关键不变量：
 *  - 不选后期的批次请求体与历史完全一致（避免旧幂等键重放假冲突）
 *  - 选了后期必须能通过 PostProductionPlan 校验（封装侧读的就是这个 schema）
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { batchCreateRequestSchema } from "../src/lib/contracts/batch-request";
import {
  batchPostProductionSchema,
  postProductionPlanSchema,
} from "../src/lib/schemas/unified-input";

const baseRequest = {
  templateId: "tpl_1",
  templateVersion: 1,
  assetIds: ["asset_1"],
  requestedCount: 3,
};

test("batch request stays valid without post-production", () => {
  const parsed = batchCreateRequestSchema.safeParse(baseRequest);
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.postProduction, undefined);
});

test("batch wizard does not promise automatic BGM without executing packaging", async () => {
  const source = await readFile(
    "src/components/batch/batch-create-wizard.tsx",
    "utf8",
  );
  assert.doesNotMatch(source, /AUTO_BGM_TRACK|AUTO_BGM_VOLUME/);
  assert.doesNotMatch(
    source,
    /added automatically|自动铺授权背景音乐/,
    "批量创建只生成视频，未执行封装时不得承诺自动铺 BGM",
  );
});

test("batch request accepts captions + bgm without voiceover", () => {
  const parsed = batchCreateRequestSchema.safeParse({
    ...baseRequest,
    postProduction: {
      audio: {
        voiceover: { enabled: false, voiceId: "warm-confident", language: "en-US", script: "" },
        bgm: { trackId: "wholesome", volume: 0.18 },
      },
      captions: {
        enabled: true,
        style: "word_by_word",
        language: "en-US",
        position: "bottom",
        exportSrt: true,
      },
    },
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("enabled voiceover requires a shared script", () => {
  const withoutScript = batchCreateRequestSchema.safeParse({
    ...baseRequest,
    postProduction: {
      audio: {
        voiceover: { enabled: true, voiceId: "warm-confident", language: "en-US", script: "   " },
        bgm: { trackId: "none", volume: 0 },
      },
      captions: {
        enabled: false,
        style: "plain",
        language: "en-US",
        position: "bottom",
        exportSrt: false,
      },
    },
  });
  assert.equal(withoutScript.success, false);
});

test("bgm volume above the mix ceiling is rejected", () => {
  const tooLoud = batchPostProductionSchema.safeParse({
    audio: {
      voiceover: { enabled: false, voiceId: "warm-confident", language: "en-US", script: "" },
      bgm: { trackId: "wholesome", volume: 0.9 },
    },
    captions: {
      enabled: false,
      style: "plain",
      language: "en-US",
      position: "bottom",
      exportSrt: false,
    },
  });
  assert.equal(tooLoud.success, false);
});

test("batch settings survive the templateSnapshot round trip", async () => {
  /// 后期随模板快照写进每条 VideoJob（生产库 DDL 需 owner 权限，运行时角色没有）。
  /// 封装侧靠 readBatchPostProductionFromSnapshot 取回；两端必须严格互逆。
  const { buildBatchVideoRows, readBatchPostProductionFromSnapshot } =
    await import("../src/lib/services/batch-service");

  const settings = {
    audio: {
      voiceover: { enabled: false, voiceId: "warm-confident", language: "en-US", script: "" },
      bgm: { trackId: "wholesome" as const, volume: 0.18 },
    },
    captions: {
      enabled: true,
      style: "word_by_word" as const,
      language: "en-US",
      position: "bottom" as const,
      exportSrt: true,
    },
  };

  const template = {
    id: "tpl_1",
    slug: "commerce-value-proof",
    version: 1,
    name: "Value Proof",
    nameZh: "价值感证明",
    category: "电商带货",
    promptSkeleton: "skeleton {IMAGE_REFS} {PRODUCT_NAME}",
    negativePrompt: "neg",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "stable", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 1, max: 2 },
  };

  const rows = buildBatchVideoRows({
    batchId: "batch_1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    template: template as any,
    images: [{ id: "a1", url: "https://example.test/a.jpg" }],
    requestedCount: 2,
    productName: "Test product",
    provider: "SEEDANCE_I2V",
    postProduction: settings,
  });

  assert.equal(rows.length, 2);
  for (const row of rows) {
    const recovered = readBatchPostProductionFromSnapshot(row.templateSnapshot);
    assert.deepEqual(
      recovered,
      settings,
      "同批次每条 VideoJob 都应带上同一套后期设置",
    );
    assert.equal(postProductionPlanSchema.safeParse(recovered).success, true);
  }

  /// 不选后期时快照里不应出现该键，保持与历史批次完全一致的形状。
  const clean = buildBatchVideoRows({
    batchId: "batch_2",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    template: template as any,
    images: [{ id: "a1", url: "https://example.test/a.jpg" }],
    requestedCount: 1,
    productName: null,
    provider: "SEEDANCE_I2V",
  });
  assert.equal(readBatchPostProductionFromSnapshot(clean[0]!.templateSnapshot), null);
});

test("batch settings are readable by the packaging-side plan schema", () => {
  /// 封装侧用 postProductionPlanSchema 反序列化 BatchJob.postProduction；
  /// 两个 schema 必须保持同一形状，否则批次后期会被静默丢弃。
  const settings = {
    audio: {
      voiceover: {
        enabled: true,
        voiceId: "energetic-host",
        language: "en-US",
        script: "Upgrade your windows this week.",
      },
      bgm: { trackId: "wholesome", volume: 0.2 },
    },
    captions: {
      enabled: true,
      style: "karaoke",
      language: "en-US",
      position: "bottom",
      exportSrt: true,
    },
  };
  assert.equal(batchPostProductionSchema.safeParse(settings).success, true);
  assert.equal(postProductionPlanSchema.safeParse(settings).success, true);
});
