import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunwayTask,
  getRunwayTask,
  RUNWAY_API_VERSION,
  RunwayApiError,
  runwayCreditsToUsd,
  runwayRatio,
} from "../src/lib/providers/runway";
import {
  buildRunwayVideoRequest,
  normalizeRunwayStatus,
  RunwayVideoProvider,
} from "../src/lib/video-generation/providers/runway-video-provider";
import { isProviderSubmissionError } from "../src/lib/video-generation/providers/submission-error";

/**
 * Runway 适配器单测（2026-10-28，key 未到）。只验编排、头、状态归一与错误分级；
 * 真机验收等 key 到了跑 scripts/runway-bakeoff.ts，这里的假 fetch 不算验收。
 */

const ENV = { RUNWAYML_API_SECRET: "test-key" };

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    const text = next.body === undefined ? "" : typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    /// 204 等无体状态不能带响应体（undici 会直接抛）
    return new Response(next.status === 204 ? null : text, { status: next.status });
  }) as typeof fetch;
}

const photos = [
  { url: "https://blob.example/p1.png" },
  { url: "https://blob.example/p2.png" },
  { url: "https://blob.example/frame1.png" },
  { url: "https://blob.example/frame2.png" },
];

test("画幅：Seedance 2.5 竖屏 720p / 1080p，Kling O3 Pro 只有 1080 档，不认识的画幅返回 null", () => {
  assert.equal(runwayRatio("seedance2_5", "9:16", "720p"), "720:1280");
  assert.equal(runwayRatio("seedance2_5", "9:16", "1080p"), "1080:1920");
  assert.equal(runwayRatio("seedance2_5", "16:9", undefined), "1280:720");
  assert.equal(runwayRatio("klingO3_pro", "9:16", "720p"), "1080:1920");
  assert.equal(runwayRatio("klingO3_standard", "1:1", "1080p"), "960:960");
  assert.equal(runwayRatio("seedance2_5", "4:5", "720p"), null);
  assert.equal(runwayCreditsToUsd(300), 3);
});

test("Seedance 2.5 参考模式（故事板路径）：走 text_to_video，references 保持顺序并去重，负面并进提示词", () => {
  const request = buildRunwayVideoRequest(
    {
      prompt: "9:16 short video. REFERENCE IMAGES: images 1-2 are real photos of the product.",
      negativePrompt: "no subtitles",
      referenceImages: [...photos, { url: "https://blob.example/p1.png" }],
      durationSec: 15,
      aspectRatio: "9:16",
      resolution: "1080p",
      seed: 7,
    },
    "seedance2_5",
  );
  assert.equal(request.endpoint, "/v1/text_to_video");
  assert.equal(request.body.model, "seedance2_5");
  assert.deepEqual(
    "references" in request.body ? request.body.references?.map((ref) => ref.uri) : null,
    photos.map((photo) => photo.url),
  );
  assert.match(request.body.promptText ?? "", /\nNegative constraints: no subtitles$/);
  assert.equal("ratio" in request.body ? request.body.ratio : null, "1080:1920");
  assert.equal("duration" in request.body ? request.body.duration : null, 15);
  assert.equal("audio" in request.body ? request.body.audio : null, true);
  assert.equal(request.body.seed, 7);
});

test("Seedance 2.5 图生视频：只收首尾帧，多出来的图提交前拒绝（不静默丢弃）", () => {
  const request = buildRunwayVideoRequest(
    {
      prompt: "push in",
      referenceMode: "i2v",
      referenceImages: [{ url: "https://blob.example/first.png", role: "first_frame" }],
      durationSec: 5,
      aspectRatio: "9:16",
    },
    "seedance2_5",
  );
  assert.equal(request.endpoint, "/v1/image_to_video");
  assert.deepEqual("promptImage" in request.body ? request.body.promptImage : null, [
    { uri: "https://blob.example/first.png", position: "first" },
  ]);
  assert.throws(
    () =>
      buildRunwayVideoRequest(
        { prompt: "push in", referenceMode: "i2v", referenceImages: photos, durationSec: 5, aspectRatio: "9:16" },
        "seedance2_5",
      ),
    (error: unknown) => isProviderSubmissionError(error) && error.disposition === "definitely_not_created" && /只收首尾帧/.test(error.message),
  );
});

test("Kling O3：必须标首帧，其余图进 references（≤7），首尾帧不重复进参考", () => {
  const request = buildRunwayVideoRequest(
    {
      prompt: "hero shot",
      referenceImages: [
        { url: "https://blob.example/p1.png" },
        { url: "https://blob.example/frame1.png", role: "first_frame" },
        { url: "https://blob.example/p2.png" },
      ],
      durationSec: 10,
      aspectRatio: "9:16",
      generateAudio: false,
    },
    "klingO3_pro",
  );
  assert.equal(request.endpoint, "/v1/image_to_video");
  assert.deepEqual("promptImage" in request.body ? request.body.promptImage : null, [
    { uri: "https://blob.example/frame1.png", position: "first" },
  ]);
  assert.deepEqual(
    "references" in request.body ? request.body.references?.map((ref) => ref.uri) : null,
    ["https://blob.example/p1.png", "https://blob.example/p2.png"],
  );
  assert.equal("audio" in request.body ? request.body.audio : null, false);
  assert.throws(
    () => buildRunwayVideoRequest({ prompt: "x", referenceImages: photos, durationSec: 10, aspectRatio: "9:16" }, "klingO3_pro"),
    /first_frame/,
  );
});

test("Kling O3 故事板派发：标了 first_frame 的关键帧（排在实拍之后）当开场帧，其余按原顺序作参考；提示词超 2500 字在建任务前拒绝", () => {
  const url = (name: string) => `https://blob.example/${name}.png`;
  /// 统一派发的顺序是 实拍 → 帧；video-service 只把本段第一张关键帧标 first_frame
  const referenceImages = ["p1", "p2", "f1", "f2", "f3", "f4"].map((name) => ({
    url: url(name),
    role: name === "f1" ? ("first_frame" as const) : ("content" as const),
  }));
  const request = buildRunwayVideoRequest(
    { prompt: "storyboard video", referenceImages, referenceMode: "reference", durationSec: 15, aspectRatio: "9:16", generateAudio: true },
    "klingO3_pro",
  );
  assert.equal(request.endpoint, "/v1/image_to_video");
  assert.deepEqual("promptImage" in request.body ? request.body.promptImage : null, [{ uri: url("f1"), position: "first" }]);
  assert.deepEqual(
    "references" in request.body ? request.body.references?.map((ref) => ref.uri) : null,
    ["p1", "p2", "f2", "f3", "f4"].map(url),
  );
  assert.equal("ratio" in request.body ? request.body.ratio : null, "1080:1920");
  assert.equal("audio" in request.body ? request.body.audio : null, true);
  /// 没标开场帧：参考模式也不拿第一张（是实拍）顶替
  assert.throws(
    () => buildRunwayVideoRequest(
      { prompt: "x", referenceImages: referenceImages.map((image) => ({ ...image, role: "content" as const })), referenceMode: "reference", durationSec: 15, aspectRatio: "9:16" },
      "klingO3_pro",
    ),
    /first_frame/,
  );
  /// Runway 实测：Kling 提示词上限 2500（含负面约束）
  assert.throws(
    () => buildRunwayVideoRequest({ prompt: "x".repeat(2400), negativePrompt: "n".repeat(200), referenceImages, durationSec: 15, aspectRatio: "9:16" }, "klingO3_pro"),
    /最多 2500 字/,
  );
});

test("提交前校验：时长、画幅、空提示词、参考音视频都在建任务之前拒绝", () => {
  const base = { prompt: "x", durationSec: 5, aspectRatio: "9:16" };
  for (const options of [
    { ...base, durationSec: 31 },
    { ...base, durationSec: 7.5 },
    { ...base, aspectRatio: "4:5" },
    { ...base, prompt: "   " },
    { ...base, referenceAudios: [{ url: "https://blob.example/a.mp3" }] },
  ]) {
    assert.throws(
      () => buildRunwayVideoRequest(options, "seedance2_5"),
      (error: unknown) => isProviderSubmissionError(error) && error.stage === "preflight",
    );
  }
});

test("请求头：Bearer key + X-Runway-Version；创建返回任务 id 与预估额度", async () => {
  const calls: Call[] = [];
  const task = await createRunwayTask(
    { endpoint: "/v1/text_to_video", body: { model: "seedance2_5", promptText: "x", ratio: "720:1280", duration: 5, audio: true } },
    { env: ENV, fetchImpl: fakeFetch([{ status: 200, body: { id: "task_1", estimatedCost: { credits: 100 } } }], calls) },
  );
  assert.deepEqual(task, { id: "task_1", estimatedCredits: 100 });
  assert.equal(calls[0]?.url, "https://api.dev.runwayml.com/v1/text_to_video");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["X-Runway-Version"], RUNWAY_API_VERSION);
  assert.equal(calls[0]?.init.method, "POST");
});

test("提交失败分级：4xx 一定没建（只有 429 可重试），5xx / 断网 / 200 没 id 都按不确定处理", async () => {
  const submit = async (response: { status: number; body?: unknown } | "network") => {
    const fetchImpl =
      response === "network"
        ? ((async () => {
            throw new TypeError("fetch failed");
          }) as unknown as typeof fetch)
        : fakeFetch([response]);
    const provider = new RunwayVideoProvider("seedance2_5", { env: ENV, fetchImpl });
    try {
      await provider.createVideoJob({ prompt: "x", durationSec: 5, aspectRatio: "9:16" });
    } catch (error) {
      assert.ok(isProviderSubmissionError(error));
      return error;
    }
    throw new Error("expected failure");
  };
  const bad = await submit({ status: 400, body: { error: "Invalid ratio" } });
  assert.equal(bad.disposition, "definitely_not_created");
  assert.equal(bad.retryable, false);
  assert.match(bad.message, /Invalid ratio/);
  const limited = await submit({ status: 429, body: { error: "Too many requests" } });
  assert.equal(limited.disposition, "definitely_not_created");
  assert.equal(limited.retryable, true);
  const overloaded = await submit({ status: 503, body: { error: "shedding load" } });
  assert.equal(overloaded.disposition, "acknowledgement_unknown");
  assert.equal(overloaded.retryable, false);
  const network = await submit("network");
  assert.equal(network.disposition, "acknowledgement_unknown");
  const noId = await submit({ status: 200, body: { ok: true } });
  assert.equal(noId.disposition, "acknowledgement_unknown");
});

test("没配 key：isConfigured 为 false，提交在建任务之前拒绝", async () => {
  const provider = new RunwayVideoProvider("seedance2_5", { env: {}, fetchImpl: fakeFetch([]) });
  assert.equal(provider.isConfigured(), false);
  await assert.rejects(
    provider.createVideoJob({ prompt: "x", durationSec: 5, aspectRatio: "9:16" }),
    (error: unknown) => isProviderSubmissionError(error) && error.stage === "preflight",
  );
});

test("状态归一：THROTTLED 算排队，RUNNING 进度换成百分比，成功取第一个产出，失败带原因与代码", async () => {
  assert.equal(normalizeRunwayStatus("THROTTLED"), "queued");
  assert.equal(normalizeRunwayStatus("RUNNING"), "processing");
  assert.equal(normalizeRunwayStatus("CANCELLED"), "cancelled");
  const provider = (body: unknown) => new RunwayVideoProvider("seedance2_5", { env: ENV, fetchImpl: fakeFetch([{ status: 200, body }]) });
  const running = await provider({ id: "t", status: "RUNNING", progress: 0.42 }).getVideoJobStatus("t");
  assert.equal(running.normalizedStatus, "processing");
  assert.equal(running.progress, 42);
  const done = await provider({ id: "t", status: "SUCCEEDED", output: ["https://cdn.example/out.mp4"] }).getVideoJobStatus("t");
  assert.equal(done.normalizedStatus, "succeeded");
  assert.equal(done.videoUrl, "https://cdn.example/out.mp4");
  const empty = await provider({ id: "t", status: "SUCCEEDED", output: [] }).getVideoJobStatus("t");
  assert.equal(empty.normalizedStatus, "failed");
  const failed = await provider({ id: "t", status: "FAILED", failure: "Content moderated", failureCode: "SAFETY.INPUT.TEXT" }).getVideoJobStatus("t");
  assert.equal(failed.normalizedStatus, "failed");
  assert.equal(failed.errorMessage, "Content moderated（SAFETY.INPUT.TEXT）");
  await assert.rejects(getRunwayTask("t", { env: ENV, fetchImpl: fakeFetch([{ status: 200, body: { id: "t", status: "WEIRD" } }]) }), RunwayApiError);
});

test("取消：DELETE /v1/tasks/{id}；失败如实返回，不假装取消成功", async () => {
  const calls: Call[] = [];
  const ok = new RunwayVideoProvider("seedance2_5", { env: ENV, fetchImpl: fakeFetch([{ status: 204 }], calls) });
  assert.deepEqual(await ok.cancelVideoJob("task 1"), { supported: true, cancelled: true });
  assert.equal(calls[0]?.init.method, "DELETE");
  assert.equal(calls[0]?.url, "https://api.dev.runwayml.com/v1/tasks/task%201");
  const gone = new RunwayVideoProvider("seedance2_5", { env: ENV, fetchImpl: fakeFetch([{ status: 404, body: { error: "Not found" } }]) });
  const result = await gone.cancelVideoJob("task_2");
  assert.equal(result.cancelled, false);
  assert.match(result.error ?? "", /Not found/);
});
