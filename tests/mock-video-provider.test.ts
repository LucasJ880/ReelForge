import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { MockVideoProvider } from "../src/lib/video-generation/providers/mock-video-provider";

function mockEnv(t: TestContext, values: Record<string, string>) {
  const originals = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key]);
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of originals) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("MockProvider：100 条默认注入恰好 93 成功、5 失败、2 僵死", async (t) => {
  mockEnv(t, {
    MOCK_LATENCY_MS: "0",
    MOCK_LATENCY_JITTER: "0",
    MOCK_FAILURE_RATE: "0.05",
    MOCK_STALL_RATE: "0.02",
    MOCK_OUTPUT_VIDEO_URL:
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  });
  const provider = new MockVideoProvider();
  const statuses = [];
  for (let index = 0; index < 100; index++) {
    const created = await provider.createVideoJob({
      prompt: `template prompt ${index}`,
      seed: index + 1000,
      mockHints: {
        briefId: "batch_100",
        segmentIndex: index,
        segmentCount: 100,
        durationSec: 10,
        aspectRatio: "9:16",
      },
    });
    statuses.push(await provider.getVideoJobStatus(created.providerJobId));
  }

  assert.equal(
    statuses.filter((status) => status.normalizedStatus === "succeeded").length,
    93,
  );
  assert.equal(
    statuses.filter((status) => status.normalizedStatus === "failed").length,
    5,
  );
  const stalled = statuses.filter(
    (status) =>
      status.normalizedStatus === "processing" &&
      (
        status.rawProviderResponse as {
          mock_outcome?: string;
        }
      ).mock_outcome === "stall",
  );
  assert.equal(stalled.length, 2);
  for (const status of stalled) {
    const raw = status.rawProviderResponse as {
      created_at: number;
      updated_at: number;
    };
    assert.equal(raw.created_at, raw.updated_at, "僵死任务时间戳必须从未推进");
  }
});

test("MockProvider：external id 自包含，换实例后仍能恢复状态", async (t) => {
  mockEnv(t, {
    MOCK_LATENCY_MS: "0",
    MOCK_FAILURE_RATE: "0",
    MOCK_STALL_RATE: "0",
    MOCK_OUTPUT_VIDEO_URL: "https://cdn.test/mock.mp4",
  });
  const first = new MockVideoProvider();
  const created = await first.createVideoJob({
    prompt: "deterministic template prompt",
    seed: 42,
    mockHints: {
      briefId: "batch_restart",
      segmentIndex: 42,
      segmentCount: 100,
      durationSec: 10,
      aspectRatio: "9:16",
    },
  });
  const afterRestart = new MockVideoProvider();
  const result = await afterRestart.getVideoJobStatus(created.providerJobId);
  assert.equal(result.normalizedStatus, "succeeded");
  assert.equal(result.videoUrl, "https://cdn.test/mock.mp4");
});

test("MockProvider：processing 进度来自真实 elapsed/latency", async (t) => {
  mockEnv(t, {
    MOCK_LATENCY_MS: "10000",
    MOCK_LATENCY_JITTER: "0",
    MOCK_FAILURE_RATE: "0",
    MOCK_STALL_RATE: "0",
  });
  const provider = new MockVideoProvider();
  const created = await provider.createVideoJob({
    prompt: "template only",
    seed: 1,
    mockHints: {
      briefId: "batch_progress",
      segmentIndex: 99,
      segmentCount: 100,
      durationSec: 10,
      aspectRatio: "9:16",
    },
  });
  const result = await provider.getVideoJobStatus(created.providerJobId);
  assert.equal(result.normalizedStatus, "processing");
  assert.ok((result.progress ?? -1) >= 0);
  assert.ok((result.progress ?? 100) < 100);
});
