import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MockVideoProvider,
  __test__,
} from "../src/lib/video-generation/providers/mock-video-provider";

test("Mock Provider：首次故障分布不变，重试尝试确定性恢复", async () => {
  const provider = new MockVideoProvider();
  const base = {
    prompt: "final acceptance retry",
    seed: 123,
    durationSec: 5,
    aspectRatio: "9:16",
    mockHints: {
      briefId: "retry-fixture",
      segmentIndex: 0,
      segmentCount: 1,
      durationSec: 5,
      aspectRatio: "9:16",
    },
  };

  const initial = await provider.createVideoJob(base);
  const retried = await provider.createVideoJob({
    ...base,
    mockHints: { ...base.mockHints, retryAttempt: 1 },
  });

  assert.equal(__test__.decodeJob(initial.providerJobId).o, "stall");
  assert.equal(__test__.decodeJob(retried.providerJobId).o, "success");
  assert.equal(__test__.decodeJob(retried.providerJobId).s, base.seed);
});
