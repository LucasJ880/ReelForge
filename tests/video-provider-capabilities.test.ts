import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SHUYU_MAX_REFERENCE_IMAGES } from "../src/lib/providers/shuyu";
import { BytePlusVideoProvider } from "../src/lib/video-generation/providers/byteplus-video-provider";
import { MockVideoProvider } from "../src/lib/video-generation/providers/mock-video-provider";
import { ShuyuVideoProvider } from "../src/lib/video-generation/providers/shuyu-video-provider";
import type { VideoProvider } from "../src/lib/video-generation/providers/types";

/**
 * P03-D0 · 能力位只描述已接 wire 的能力。本轮没有任何适配器接了参考音频
 * （D-2：Shuyu 是唯一视频通道，P03-D″ 才按 E2″ 实证接字段）。
 */
const ADAPTERS: VideoProvider[] = [
  new ShuyuVideoProvider("studio-video", { env: {} }),
  new BytePlusVideoProvider(),
  new MockVideoProvider(),
];

test("所有现有适配器显式声明能力位;未接 wire 的参考音频一律为 false", () => {
  for (const adapter of ADAPTERS) {
    assert.equal(adapter.supportsReferenceAudio, false, adapter.id);
    assert.ok(Number.isInteger(adapter.maxReferenceImages), adapter.id);
    assert.ok(adapter.maxReferenceImages > 0, adapter.id);
  }
});

test("参考图硬顶与各自 wire 层一致", () => {
  const byId = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));
  assert.equal(byId.get("shuyu")?.maxReferenceImages, SHUYU_MAX_REFERENCE_IMAGES);
  /// seedance.ts 的 Omni-Reference 分支按 9 张截断
  assert.equal(byId.get("byteplus")?.maxReferenceImages, 9);
  assert.equal(byId.get("mock")?.maxReferenceImages, SHUYU_MAX_REFERENCE_IMAGES);
});

test("本轮不启用 fal / 阿里线路 id(D-2 / D-8)", async () => {
  const source = await readFile(
    "src/lib/video-generation/providers/types.ts",
    "utf8",
  );
  assert.match(source, /readonly id: "byteplus" \| "shuyu" \| "mock";/);
  assert.doesNotMatch(source, /alibaba_wan|"fal"/);
});
