/**
 * Frame QA Gate 单元测试 — 抽帧文字检测门禁的判定逻辑与开关行为。
 *
 * 不打真实 OpenAI / ffmpeg：只测纯逻辑（decideVerdict / isFrameQaEnabled /
 * fail-open 路径），vision 调用与抽帧由集成环境覆盖。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  FRAME_QA_ERROR_PREFIX,
  decideVerdict,
  isFrameQaEnabled,
  runFrameTextQa,
  __test__,
} from "../src/lib/video-generation/frame-qa";

const ENV_KEYS = [
  "FRAME_QA_DISABLED",
  "VIDEO_ENGINE_MOCK",
  "LLM_FORCE_MOCK",
  "OPENAI_API_KEY",
] as const;
let envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  envBackup = {};
  for (const k of ENV_KEYS) envBackup[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

test("[frame-qa] 无文字帧 → 通过", () => {
  const v = decideVerdict(
    [
      { index: 0, hasOverlayText: false, malformedText: false, textContent: "" },
      { index: 1, hasOverlayText: false, malformedText: false, textContent: "" },
    ],
    2,
  );
  assert.equal(v.ok, true);
  assert.equal(v.checked, true);
  assert.equal(v.issues.length, 0);
  assert.match(v.summary, /通过/);
});

test("[frame-qa] 任一帧检出叠加字幕 → 拦截并给出帧号与文字内容", () => {
  const v = decideVerdict(
    [
      { index: 0, hasOverlayText: false, malformedText: false },
      { index: 3, hasOverlayText: true, malformedText: false, textContent: "又被曬醒了" },
    ],
    6,
  );
  assert.equal(v.ok, false);
  assert.equal(v.issues.length, 1);
  assert.equal(v.issues[0].frameIndex, 3);
  assert.match(v.issues[0].detail, /叠加文字/);
  assert.match(v.summary, /第4帧/);
  assert.match(v.summary, /又被曬醒了/);
});

test("[frame-qa] 畸形/错误字形（错字）单独也拦截", () => {
  const v = decideVerdict(
    [{ index: 2, hasOverlayText: false, malformedText: true, textContent: "窗簾" }],
    6,
  );
  assert.equal(v.ok, false);
  assert.match(v.issues[0].detail, /畸形|错误字形/);
});

test("[frame-qa] FRAME_QA_DISABLED / mock 引擎 / 无 API key 时门禁关闭", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.FRAME_QA_DISABLED;
  delete process.env.VIDEO_ENGINE_MOCK;
  delete process.env.LLM_FORCE_MOCK;
  assert.equal(isFrameQaEnabled(), true);

  process.env.FRAME_QA_DISABLED = "true";
  assert.equal(isFrameQaEnabled(), false);
  delete process.env.FRAME_QA_DISABLED;

  process.env.VIDEO_ENGINE_MOCK = "1";
  assert.equal(isFrameQaEnabled(), false);
  delete process.env.VIDEO_ENGINE_MOCK;

  process.env.LLM_FORCE_MOCK = "true";
  assert.equal(isFrameQaEnabled(), false);
  delete process.env.LLM_FORCE_MOCK;

  delete process.env.OPENAI_API_KEY;
  assert.equal(isFrameQaEnabled(), false);
});

test("[frame-qa] 门禁关闭时 runFrameTextQa fail-open（ok=true, checked=false）", async () => {
  process.env.FRAME_QA_DISABLED = "true";
  const v = await runFrameTextQa("https://example.com/video.mp4");
  assert.equal(v.ok, true);
  assert.equal(v.checked, false);
  assert.ok(v.skipReason);
});

test("[frame-qa] 非法输入（既不是 URL 也不是本地文件）fail-open 而不是 throw", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.FRAME_QA_DISABLED;
  delete process.env.VIDEO_ENGINE_MOCK;
  delete process.env.LLM_FORCE_MOCK;
  const v = await runFrameTextQa("/no/such/file/anywhere.mp4");
  assert.equal(v.ok, true);
  assert.equal(v.checked, false);
});

test("[frame-qa] 拦截错误前缀稳定（video-service 重试逻辑依赖它识别废段）", () => {
  assert.equal(FRAME_QA_ERROR_PREFIX, "[frame-qa]");
  const summary = decideVerdict(
    [{ index: 0, hasOverlayText: true, textContent: "水印" }],
    1,
  ).summary;
  const errorMessage = `${FRAME_QA_ERROR_PREFIX} ${summary}`;
  assert.ok(errorMessage.startsWith(FRAME_QA_ERROR_PREFIX));
});

test("[frame-qa] system prompt 守住平台零文字策略关键词", () => {
  assert.match(__test__.FRAME_QA_SYSTEM, /ZERO burned-in text/);
  assert.match(__test__.FRAME_QA_SYSTEM, /hasOverlayText/);
  assert.match(__test__.FRAME_QA_SYSTEM, /malformedText/);
});
