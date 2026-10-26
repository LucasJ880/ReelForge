import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_API_BASE,
  SYNC_DEFAULT_LIPSYNC_MODEL,
  SYNC_DEFAULT_SYNC_MODE,
  SyncLipsyncError,
  createSyncLipsyncGeneration,
  estimateSyncLipsyncCostUsd,
  getSyncLipsyncGeneration,
  isSyncConfigured,
  mapSyncGenerationStatus,
  resolveSyncLipsyncModel,
  resolveSyncLipsyncSyncMode,
} from "../src/lib/providers/sync-labs";

/**
 * P04-F 适配器层 · Sync Labs 客户端契约。全部走注入的 fetch / env，不出网、不读真实 key。
 * 真机（E8′ 口型分、模型档与 sync_mode 选择）等 SYNC_API_KEY 到位后在验收文档里记。
 */

const ENV = { SYNC_API_KEY: "sync-test-not-real" };
const VIDEO = "https://blob.example.test/segment-0.mp4";
const AUDIO = "https://blob.example.test/tts-0.mp3";

type Captured = { url: string; init: RequestInit };

function recordingFetch(status: number, body: BodyInit, captured: Captured[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

test("配置与缺省：只看 SYNC_API_KEY；模型缺省 sync-3、sync_mode 缺省 silence，未知值回落缺省", () => {
  assert.equal(isSyncConfigured(ENV), true);
  assert.equal(isSyncConfigured({ SYNC_API_KEY: "  " }), false);
  assert.equal(resolveSyncLipsyncModel({}), SYNC_DEFAULT_LIPSYNC_MODEL);
  assert.equal(resolveSyncLipsyncModel({ SYNC_LIPSYNC_MODEL: "lipsync-2" }), "lipsync-2");
  assert.equal(resolveSyncLipsyncModel({ SYNC_LIPSYNC_MODEL: "gpt-lips" }), SYNC_DEFAULT_LIPSYNC_MODEL);
  assert.equal(resolveSyncLipsyncSyncMode({}), SYNC_DEFAULT_SYNC_MODE);
  assert.equal(resolveSyncLipsyncSyncMode({ SYNC_LIPSYNC_SYNC_MODE: "cut_off" }), "cut_off");
  assert.equal(resolveSyncLipsyncSyncMode({ SYNC_LIPSYNC_SYNC_MODE: "nope" }), SYNC_DEFAULT_SYNC_MODE);
});

test("成本估算按上界、按秒向上取整；env 可覆盖单价", () => {
  assert.equal(estimateSyncLipsyncCostUsd(15, {}), 1.995);
  assert.equal(estimateSyncLipsyncCostUsd(14.2, {}), 1.995);
  assert.equal(estimateSyncLipsyncCostUsd(10, { SYNC_LIPSYNC_USD_PER_SECOND: "0.107" }), 1.07);
  assert.equal(estimateSyncLipsyncCostUsd(0, {}), 0);
});

test("状态映射：PENDING/PROCESSING 在途、COMPLETED 成功、FAILED 可重试、REJECTED 不可重试", () => {
  assert.deepEqual(mapSyncGenerationStatus("PENDING"), { state: "queued", retryable: true });
  assert.deepEqual(mapSyncGenerationStatus("PROCESSING"), { state: "processing", retryable: true });
  assert.deepEqual(mapSyncGenerationStatus("COMPLETED"), { state: "succeeded", retryable: false });
  assert.deepEqual(mapSyncGenerationStatus("FAILED"), { state: "failed", retryable: true });
  assert.deepEqual(mapSyncGenerationStatus("REJECTED"), { state: "failed", retryable: false });
});

test("创建：POST /v2/generate、x-api-key 与 Idempotency-Key 头、video+audio 输入、sync_mode", async () => {
  const captured: Captured[] = [];
  const generation = await createSyncLipsyncGeneration({
    videoUrl: VIDEO,
    audioUrl: AUDIO,
    idempotencyKey: "job_abc.lipsync-1",
    outputFileName: "brief-1-seg-0",
    env: ENV,
    fetchImpl: recordingFetch(201, JSON.stringify({ id: "gen_1", status: "PENDING", createdAt: "2026-10-26T00:00:00Z" }), captured),
  });
  assert.deepEqual(generation, { id: "gen_1", status: "PENDING", outputUrl: null, outputDurationSec: null, error: null, errorCode: null });
  assert.equal(captured[0]!.url, `${SYNC_API_BASE}/v2/generate`);
  const headers = captured[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], ENV.SYNC_API_KEY);
  assert.equal(headers["Idempotency-Key"], "job_abc.lipsync-1");
  assert.deepEqual(JSON.parse(String(captured[0]!.init.body)), {
    model: "sync-3",
    input: [
      { type: "video", url: VIDEO },
      { type: "audio", url: AUDIO },
    ],
    options: { sync_mode: "silence" },
    outputFileName: "brief-1-seg-0",
  });
});

test("创建前置校验：非 HTTPS 素材、带凭据的 URL、非法幂等键、无 key 一律不出网", async () => {
  const captured: Captured[] = [];
  const fetchImpl = recordingFetch(201, "{}", captured);
  await assert.rejects(
    createSyncLipsyncGeneration({ videoUrl: "http://x.test/a.mp4", audioUrl: AUDIO, env: ENV, fetchImpl }),
    (e: unknown) => e instanceof SyncLipsyncError && e.stage === "preflight" && !e.retryable,
  );
  await assert.rejects(
    createSyncLipsyncGeneration({ videoUrl: VIDEO, audioUrl: "https://u:p@x.test/a.mp3", env: ENV, fetchImpl }),
    /HTTPS/,
  );
  await assert.rejects(
    createSyncLipsyncGeneration({ videoUrl: VIDEO, audioUrl: AUDIO, idempotencyKey: "has space", env: ENV, fetchImpl }),
    /Idempotency-Key/,
  );
  await assert.rejects(
    createSyncLipsyncGeneration({ videoUrl: VIDEO, audioUrl: AUDIO, env: {}, fetchImpl }),
    /SYNC_API_KEY/,
  );
  assert.equal(captured.length, 0);
});

test("查询：GET /v2/generate/{id}；COMPLETED 带 outputUrl 与时长；FAILED 带 error；COMPLETED 无 outputUrl 视为可重试异常", async () => {
  const captured: Captured[] = [];
  const done = await getSyncLipsyncGeneration("gen_1", {
    env: ENV,
    fetchImpl: recordingFetch(200, JSON.stringify({ id: "gen_1", status: "COMPLETED", outputUrl: "https://cdn.sync.test/out.mp4", outputDuration: 14.8 }), captured),
  });
  assert.equal(captured[0]!.url, `${SYNC_API_BASE}/v2/generate/gen_1`);
  assert.equal(captured[0]!.init.method, "GET");
  assert.deepEqual([done.status, done.outputUrl, done.outputDurationSec], ["COMPLETED", "https://cdn.sync.test/out.mp4", 14.8]);

  const failed = await getSyncLipsyncGeneration("gen_2", {
    env: ENV,
    fetchImpl: recordingFetch(200, JSON.stringify({ id: "gen_2", status: "FAILED", error: "no face detected", errorCode: "NO_FACE" })),
  });
  assert.deepEqual([failed.status, failed.error, failed.errorCode], ["FAILED", "no face detected", "NO_FACE"]);

  await assert.rejects(
    getSyncLipsyncGeneration("gen_3", { env: ENV, fetchImpl: recordingFetch(200, JSON.stringify({ id: "gen_3", status: "COMPLETED" })) }),
    (e: unknown) => e instanceof SyncLipsyncError && e.stage === "poll" && e.retryable,
  );
});

test("HTTP 错误分类：401/400 不可重试、429/5xx 可重试；错误信息不含 key；未知 status 可重试", async () => {
  for (const [status, retryable] of [[400, false], [401, false], [429, true], [502, true]] as const) {
    await assert.rejects(
      getSyncLipsyncGeneration("gen_x", { env: ENV, fetchImpl: recordingFetch(status, "boom") }),
      (e: unknown) => {
        assert.ok(e instanceof SyncLipsyncError);
        assert.equal(e.status, status);
        assert.equal(e.retryable, retryable);
        assert.doesNotMatch(e.message, /sync-test-not-real/);
        return true;
      },
    );
  }
  await assert.rejects(
    getSyncLipsyncGeneration("gen_y", { env: ENV, fetchImpl: recordingFetch(200, JSON.stringify({ id: "gen_y", status: "WEIRD" })) }),
    (e: unknown) => e instanceof SyncLipsyncError && e.retryable,
  );
});
