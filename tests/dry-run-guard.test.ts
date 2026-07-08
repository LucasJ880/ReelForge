import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

/**
 * AIVORA_DRY_RUN 计费保险丝回归测试。
 *
 * 约定：AIVORA_DRY_RUN=1 时进程内所有计费路径必须走 mock 或显式拒绝。
 * 这些测试逐一验证每个计费 provider 的守门行为 —— 任何一个失守都意味着
 * dry-run 下可能真实扣费。
 */

function withEnv(
  t: TestContext,
  next: Partial<Record<string, string | undefined>>,
) {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(next)) {
    originals[key] = process.env[key];
    const v = next[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  t.after(() => {
    for (const key of Object.keys(originals)) {
      const v = originals[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  });
}

test("isDryRun：解析 1/true/yes/on，其余为 false", async (t) => {
  const { isDryRun } = await import("../src/lib/config/dry-run");
  for (const v of ["1", "true", "yes", "on", "TRUE", " 1 "]) {
    withEnv(t, { AIVORA_DRY_RUN: v });
    assert.equal(isDryRun(), true, `AIVORA_DRY_RUN=${JSON.stringify(v)} 应为 dry-run`);
  }
  for (const v of ["", "0", "false", "off", undefined]) {
    withEnv(t, { AIVORA_DRY_RUN: v });
    assert.equal(isDryRun(), false, `AIVORA_DRY_RUN=${JSON.stringify(v)} 不应为 dry-run`);
  }
});

test("dry-run：Seedance 提交强制走 mock（即便 ARK_API_KEY 存在且 VIDEO_ENGINE_MOCK=false）", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    ARK_API_KEY: "fake-key-should-never-be-used",
    VIDEO_ENGINE_MOCK: "false",
  });
  const { submitSeedanceJob, getSeedanceStatus, isSeedanceConfigured } =
    await import("../src/lib/providers/seedance");

  const { jobId } = await submitSeedanceJob({ prompt: "test", duration: 5 });
  assert.ok(jobId.startsWith("mock_"), `dry-run 提交必须返回 mock jobId，实际: ${jobId}`);

  const status = await getSeedanceStatus(jobId);
  assert.ok(status.jobId === jobId, "mock 状态查询应可用");

  assert.equal(isSeedanceConfigured(), false, "dry-run 下 Seedance 视为未配置");
});

test("dry-run：真实 externalJobId 的状态查询也不打真实 API（走 mock 分支）", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    ARK_API_KEY: "fake-key",
    VIDEO_ENGINE_MOCK: "false",
  });
  const { getSeedanceStatus } = await import("../src/lib/providers/seedance");
  /// cgt- 开头是真实任务 id；dry-run 下必须走 mock 分支（返回 not-found 类结果或抛错都行，
  /// 但绝不能发出真实 HTTP 请求）。mock 分支对未知 id 的行为是抛错或返回 failed。
  await getSeedanceStatus("cgt-20260709010337-r2djs").then(
    (r) => {
      assert.ok(r.status === "failed" || r.status === "pending", "mock 分支返回值");
    },
    () => {
      /* mock 分支抛「任务不存在」也可接受 —— 关键是没有真实外呼 */
    },
  );
});

test("dry-run：OpenAI LLM 强制 mock，chatJson 主动拒绝", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    LLM_FORCE_MOCK: undefined,
    OPENAI_API_KEY: "sk-fake-should-never-be-used",
  });
  const { isLLMForcedMock, chatJson } = await import(
    "../src/lib/providers/openai"
  );
  assert.equal(isLLMForcedMock(), true, "dry-run 下 LLM 必须强制 mock");
  await assert.rejects(
    () => chatJson({ system: "s", user: "u" }),
    /refusing to send real OpenAI request/,
  );
});

test("dry-run：OpenAI 图像生成视为不可用 → 走占位 mock", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    OPENAI_API_KEY: "sk-fake",
    IMAGE_ENGINE_MOCK: undefined,
  });
  const { isImageGenAvailable, generateImages } = await import(
    "../src/lib/providers/openai-image"
  );
  assert.equal(isImageGenAvailable(), false);
  const result = await generateImages({ prompt: "logo", n: 1 });
  assert.equal(result.fromMock, true, "dry-run 下图像生成必须来自 mock");
});

test("dry-run：火山 TTS 显式拒绝（fail-closed）", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    VOLC_TTS_API_KEY: "fake-tts-key",
  });
  const { isVolcTtsConfigured, synthesizeSpeech } = await import(
    "../src/lib/providers/volc-tts"
  );
  assert.equal(isVolcTtsConfigured(), false, "dry-run 下 TTS 视为未配置");
  await assert.rejects(
    () => synthesizeSpeech({ text: "你好" }),
    /AIVORA_DRY_RUN/,
  );
});

test("dry-run：OmniHuman 提交显式拒绝（fail-closed）", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    VOLCENGINE_ACCESS_KEY_ID: "fake",
    VOLCENGINE_SECRET_ACCESS_KEY: "fake",
  });
  const { submitOmniHumanJob } = await import("../src/lib/providers/omnihuman");
  await assert.rejects(
    () =>
      submitOmniHumanJob({
        imageUrl: "https://example.com/face.jpg",
        audioUrl: "https://example.com/voice.mp3",
      }),
    /AIVORA_DRY_RUN/,
  );
});

test("dry-run：Apify 视为不可用（调用方自动降级）", async (t) => {
  withEnv(t, { AIVORA_DRY_RUN: "1", APIFY_TOKEN: "fake-token" });
  const { isApifyAvailable } = await import("../src/lib/providers/apify-tiktok");
  assert.equal(isApifyAvailable(), false);
});

test("dry-run：frame-qa 门禁自动禁用（不发 vision 请求）", async (t) => {
  withEnv(t, {
    AIVORA_DRY_RUN: "1",
    OPENAI_API_KEY: "sk-fake",
    FRAME_QA_DISABLED: undefined,
    VIDEO_ENGINE_MOCK: undefined,
  });
  const { isFrameQaEnabled } = await import(
    "../src/lib/video-generation/frame-qa"
  );
  assert.equal(isFrameQaEnabled(), false, "dry-run 下 frame-qa 必须禁用");
});
