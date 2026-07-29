import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STUDIO = readFileSync(
  resolve(process.cwd(), "src/components/video-generation/streamlined-video-studio.tsx"),
  "utf8",
);

/**
 * 2026-07-29：供应商（Shuyu）视频线路故障时，单条创作页只能反复重试 ——
 * `markStoryboardRunDismissed` 早就写好却没有任何调用点，用户被永久钉在失败的那一轮。
 * 任何任务都必须有「取消这一轮」的出口。
 */
test("单条创作页提供取消这一轮的出口", () => {
  assert.match(STUDIO, /const cancelCurrentRound = useCallback\(/);
  assert.match(STUDIO, /markStoryboardRunDismissed\(storyboard\.id\)/);
  assert.equal(
    STUDIO.split("onClick={cancelCurrentRound}").length - 1,
    2,
    "失败提示条与故事板面板都要能取消这一轮",
  );
});

test("取消这一轮会清掉幂等键，避免下一轮回放失败的旧提交", () => {
  const body = STUDIO.slice(
    STUDIO.indexOf("const invalidatePlan = useCallback("),
    STUDIO.indexOf("const updateAudioCaptionSettings"),
  );
  assert.match(body, /persistStoredAttempt\(STORYBOARD_ATTEMPT_STORAGE_KEY, null\)/);
  assert.match(body, /persistStoredAttempt\(DISPATCH_ATTEMPT_STORAGE_KEY, null\)/);
  assert.match(body, /invalidatePlan\(\)/, "cancelCurrentRound 必须复用 invalidatePlan 的清理");
});

test("取消后保留素材与创作描述（只清这一轮的运行态）", () => {
  const cancel = STUDIO.slice(
    STUDIO.indexOf("const cancelCurrentRound = useCallback("),
    STUDIO.indexOf("const updateAudioCaptionSettings"),
  );
  assert.doesNotMatch(cancel, /setProductAssets\(\[\]\)/);
  assert.doesNotMatch(cancel, /setRawPrompt\(""\)/);
});
