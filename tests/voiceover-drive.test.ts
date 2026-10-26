import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { StyleTemplateStatus, type StyleTemplate } from "@prisma/client";
import { db } from "../src/lib/db";
import { __resetAppEnvForTests } from "../src/lib/config/env";
import { batchCreateRequestSchema } from "../src/lib/contracts/batch-request";
import {
  postProductionPlanSchema,
  voiceoverSettingsSchema,
  VOICEOVER_DRIVES,
} from "../src/lib/schemas/unified-input";
import { BatchProviderInputError, createBatchJob } from "../src/lib/services/batch-service";
import { evaluateVoiceoverDrive } from "../src/lib/services/voiceover-drive-service";
import { normalizePostProductionSettings } from "../src/lib/video-generation/generation-supervisor";
import { checkVoiceoverDrive, voiceoverDriveOf } from "../src/lib/video-generation/voiceover-drive";
import { createVideoRouteSnapshot, VIDEO_ROUTE_IDS } from "../src/lib/video-generation/video-route-registry";
import type { PublicCapabilities } from "../src/lib/capabilities/registry";
import type { UnifiedVideoGenerationRequest } from "../src/types/video-generation";

/**
 * P04-D · voiceover.drive：schema 可选（旧快照照常解析）、归一化只透传、能力闸在派发入口。
 */

const VOICEOVER = { enabled: true, voiceId: "warm-confident", language: "zh-CN", script: "先上门量尺寸，再报价。" };

const POST_PRODUCTION = {
  audio: { voiceover: VOICEOVER, bgm: { trackId: "none", volume: 0 } },
  captions: { enabled: false, style: "plain", language: "zh-CN", position: "bottom", exportSrt: false },
} as const;

test("schema：旧快照没有 drive 照常解析且不被补字段；合法枚举通过；未知值拒绝", () => {
  const legacy = postProductionPlanSchema.parse(POST_PRODUCTION);
  assert.equal("drive" in legacy.audio.voiceover, false, "缺省保持缺省，批量幂等哈希不变");
  assert.equal(voiceoverDriveOf(legacy.audio.voiceover), "native");

  for (const drive of VOICEOVER_DRIVES) {
    assert.equal(voiceoverSettingsSchema.parse({ ...VOICEOVER, drive }).drive, drive);
  }
  assert.equal(voiceoverSettingsSchema.safeParse({ ...VOICEOVER, drive: "lipsync_magic" }).success, false);
  assert.equal(
    batchCreateRequestSchema.safeParse({
      templateId: "tpl_1",
      templateVersion: 1,
      assetIds: ["asset_1"],
      requestedCount: 1,
      postProduction: { ...POST_PRODUCTION, audio: { ...POST_PRODUCTION.audio, voiceover: { ...VOICEOVER, drive: "tts_lipsync" } } },
    }).success,
    true,
  );
});

function request(drive?: (typeof VOICEOVER_DRIVES)[number]): UnifiedVideoGenerationRequest {
  const voiceover = voiceoverSettingsSchema.parse(drive ? { ...VOICEOVER, drive } : VOICEOVER);
  return { language: "zh-CN", audio: { voiceover } } as UnifiedVideoGenerationRequest;
}

test("归一化：drive 原样透传（含当前线路做不到的值），缺省补 native——不在这里做能力判断", () => {
  assert.equal(normalizePostProductionSettings(request()).audio.voiceover.drive, "native");
  assert.equal(normalizePostProductionSettings(request("tts_lipsync")).audio.voiceover.drive, "tts_lipsync");
  assert.equal(normalizePostProductionSettings(request("audio_reference")).audio.voiceover.drive, "audio_reference");
  const source = readFileSync("src/lib/video-generation/generation-supervisor.ts", "utf8");
  assert.doesNotMatch(source, /checkVoiceoverDrive|evaluateVoiceoverDrive|getCapabilities/);
});

test("能力闸（纯函数）：native 在每条线路都放行；非 native 目前没有线路做得到", () => {
  for (const routeId of VIDEO_ROUTE_IDS) {
    assert.deepEqual(checkVoiceoverDrive({ drive: "native", routeId, ttsUsable: false }), { ok: true, drive: "native" });
    for (const drive of ["tts_lipsync", "audio_reference"] as const) {
      const check = checkVoiceoverDrive({ drive, routeId, ttsUsable: true });
      assert.equal(check.ok, false, `${routeId} × ${drive}`);
      assert.equal(!check.ok && check.reason, "route_unsupported");
    }
  }
});

test("能力闸（服务）：native 与线路不支持时都不读能力表", async () => {
  let loads = 0;
  const loadCapabilities = async () => {
    loads += 1;
    return { items: [] } as unknown as PublicCapabilities;
  };
  const routeSnapshot = createVideoRouteSnapshot("buddy");
  assert.equal((await evaluateVoiceoverDrive({ voiceover: undefined, routeSnapshot, loadCapabilities })).ok, true);
  assert.equal((await evaluateVoiceoverDrive({ voiceover: { drive: "native" }, routeSnapshot, loadCapabilities })).ok, true);
  const rejected = await evaluateVoiceoverDrive({ voiceover: { drive: "tts_lipsync" }, routeSnapshot, loadCapabilities });
  assert.equal(rejected.ok, false);
  assert.match(!rejected.ok ? rejected.message : "", /暂不支持所选口播方式/);
  assert.equal(loads, 0);
});

test("dispatch：能力闸在幂等登记、扣额与供应商提交之前，返回契约内 422 VALIDATION_FAILED", () => {
  const source = readFileSync("src/app/api/video-generation/dispatch/route.ts", "utf8");
  const gate = source.indexOf("evaluateVoiceoverDrive({ voiceover, routeSnapshot: videoRouteSnapshot })");
  assert.ok(gate > 0);
  for (const later of ["claimVideoDispatchRequest({", "assertQuotaBatchForSession(", "dispatchVideoForBrief("]) {
    const at = source.indexOf(later);
    assert.ok(at > gate, `${later} 必须在能力闸之后`);
  }
  const window = source.slice(gate, gate + 400);
  assert.match(window, /dispatchErrorResponse\(422/);
  assert.match(window, /code: "VALIDATION_FAILED"/);
  /// 降级换线路后按新线路复核
  const failover = source.indexOf("if (routeResolution.failedOver)");
  const recheck = source.indexOf("evaluateVoiceoverDrive({ voiceover, routeSnapshot: videoRouteSnapshot })", failover);
  assert.ok(failover > 0 && recheck > failover);
});

/* ── createBatchJob：真跑到闸门，零提交、零事务 ─────────────────────────── */

const TEMPLATE: StyleTemplate = {
  id: "tpl_drive_gate",
  slug: "drive-gate",
  version: 1,
  name: "Drive Gate",
  nameZh: "口播驱动闸门",
  category: "测试",
  coverImage: "https://cdn.test/cover.jpg",
  promptSkeleton: "Use {IMAGE_REFS} to film {PRODUCT_NAME}.",
  negativePrompt: "label blur",
  lockedParams: { duration: 15, aspectRatio: "9:16" },
  imagesPerVideo: { min: 1, max: 4 },
  status: StyleTemplateStatus.ACTIVE,
  activatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function patch(t: TestContext, target: Record<string, unknown>, values: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = target[key];
    target[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) target[key] = value;
  });
}

function realBuddyEnv(t: TestContext) {
  const values: Record<string, string | undefined> = {
    VERCEL_ENV: "preview",
    VIDEO_PROVIDER: "byteplus",
    VIDEO_ENGINE_MOCK: "false",
    AIVORA_DRY_RUN: "false",
    SHUYU_API_KEY: "test-only",
  };
  const originals = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetAppEnvForTests();
  t.after(() => {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetAppEnvForTests();
  });
}

test("createBatchJob：请求了线路做不到的 drive → BatchProviderInputError(422)，不探价、不建批次、不提交", async (t) => {
  realBuddyEnv(t);
  const network: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    network.push(String(input));
    throw new Error("drive gate must reject before any network call");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let transactions = 0;
  patch(t, db.batchJob as unknown as Record<string, unknown>, { findUnique: async () => null });
  patch(t, db.styleTemplate as unknown as Record<string, unknown>, { findFirst: async () => TEMPLATE });
  patch(t, db as unknown as Record<string, unknown>, {
    $transaction: async () => {
      transactions += 1;
      throw new Error("must not create a batch");
    },
  });

  const postProduction = postProductionPlanSchema.parse({
    ...POST_PRODUCTION,
    audio: { ...POST_PRODUCTION.audio, voiceover: { ...VOICEOVER, drive: "audio_reference" } },
  });
  await assert.rejects(
    () =>
      createBatchJob({
        userId: "drive-gate-user",
        templateId: TEMPLATE.id,
        templateVersion: TEMPLATE.version,
        images: [{ id: "img-1", url: "https://cdn.example.test/product.jpg" }],
        requestedCount: 2,
        idempotencyKey: "drive-gate-key",
        videoRouteId: "buddy",
        postProduction,
      }),
    (error: unknown) =>
      error instanceof BatchProviderInputError &&
      error.httpStatus === 422 &&
      /暂不支持所选口播方式/.test(error.message),
  );
  assert.equal(transactions, 0, "不建批次");
  assert.deepEqual(network, [], "不探价、不提交");
});
