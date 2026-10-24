/**
 * 授权配乐署名（1025 A6 7.6）：CC BY 4.0 要求随作品署名。交付面只认后期快照里
 * 真的混进成片的曲目（曲目非 none 且音量 > 0），与 stitch-service 的 bgmEnabled 同口径。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BGM_ATTRIBUTIONS,
  bgmAttributionFor,
  bgmAttributionForTrack,
} from "../src/lib/video-generation/bgm-attribution";
import { BGM_TRACKS } from "../src/lib/video-generation/audio-post-production";

const WHOLESOME = BGM_ATTRIBUTIONS.wholesome!;

test("曲库里每首有音频文件的曲目都有署名，且署名写全标题 / 作者 / 来源 / 许可链接", () => {
  for (const track of BGM_TRACKS) {
    if (track.path === null) {
      assert.equal(bgmAttributionForTrack(track.id), null, track.id);
      continue;
    }
    const attribution = bgmAttributionForTrack(track.id);
    assert.ok(attribution, `${track.id} 缺署名`);
    assert.ok(attribution.includes(track.label), `${track.id} 署名缺曲名`);
    assert.ok(attribution.includes(track.author), `${track.id} 署名缺作者`);
    assert.ok(attribution.includes(track.license), `${track.id} 署名缺许可`);
  }
  assert.match(WHOLESOME, /^"Wholesome" by Kevin MacLeod \(incompetech\.com\)/);
  assert.match(WHOLESOME, /CC BY 4\.0: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/$/);
});

test("单条与批量的后期快照：混入了配乐才返回署名", () => {
  const snapshot = (trackId: unknown, volume: unknown) => ({
    audio: {
      voiceover: { enabled: true, voiceId: "warm-confident", language: "en-US", script: "Hi." },
      bgm: { trackId, volume },
    },
    captions: { enabled: true, style: "plain", language: "en-US", position: "bottom", exportSrt: true },
  });
  assert.equal(bgmAttributionFor(snapshot("wholesome", 0.2)), WHOLESOME);
  assert.equal(bgmAttributionFor(snapshot("wholesome", 0)), null);
  assert.equal(bgmAttributionFor(snapshot("none", 0.2)), null);
  assert.equal(bgmAttributionFor(snapshot("wholesome", "0.2")), null);
  assert.equal(bgmAttributionFor(snapshot("wholesome", Number.NaN)), null);
});

test("批量成片：从 VideoJob.templateSnapshot 取回的批次后期能直接算出署名", async () => {
  /// 交付面胶水：bgmAttributionFor(readBatchPostProductionFromSnapshot(job.templateSnapshot))
  const { buildBatchVideoRows, readBatchPostProductionFromSnapshot } =
    await import("../src/lib/services/batch-service");
  const template = {
    id: "tpl_1",
    slug: "commerce-value-proof",
    version: 3,
    name: "Value Proof",
    nameZh: "价值感证明",
    category: "电商带货",
    promptSkeleton: "skeleton {IMAGE_REFS} {PRODUCT_NAME}",
    negativePrompt: "neg",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "stable", stability: "high", humanInteraction: "none" },
    imagesPerVideo: { min: 1, max: 2 },
  };
  const rowsWith = (volume: number) =>
    buildBatchVideoRows({
      batchId: "batch_bgm",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      template: template as any,
      images: [{ id: "a1", url: "https://example.test/a.jpg" }],
      requestedCount: 1,
      productName: null,
      provider: "SEEDANCE_I2V",
      postProduction: {
        audio: {
          voiceover: { enabled: false, voiceId: "warm-confident", language: "en-US", script: "" },
          bgm: { trackId: "wholesome", volume },
        },
        captions: { enabled: false, style: "plain", language: "en-US", position: "bottom", exportSrt: false },
      },
    });
  const [mixed] = rowsWith(0.18);
  assert.equal(
    bgmAttributionFor(readBatchPostProductionFromSnapshot(mixed!.templateSnapshot)),
    WHOLESOME,
  );
  const [muted] = rowsWith(0);
  assert.equal(
    bgmAttributionFor(readBatchPostProductionFromSnapshot(muted!.templateSnapshot)),
    null,
  );
});

test("读不懂的快照一律不猜", () => {
  for (const value of [null, undefined, "wholesome", 1, [], {}, { audio: null }, { audio: { bgm: [] } }]) {
    assert.equal(bgmAttributionFor(value), null);
  }
  assert.equal(bgmAttributionFor({ audio: { bgm: { trackId: "constructor", volume: 0.2 } } }), null);
  assert.equal(bgmAttributionForTrack("toString"), null);
  assert.equal(bgmAttributionForTrack(null), null);
});
