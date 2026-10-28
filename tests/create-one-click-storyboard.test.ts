import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 2026-10-28 闭环轮修复（真机 E2E #6 / #7 + 每轮可取消）：
 * - 一键出故事板：快速、高级模式都不再单独「核对规格」，方案在「生成 AI 故事板」里一并出（学 LibTV 一键出分镜）；
 * - 刷新恢复的故事板只按故事板状态走：派发时服务端会重出方案并把关，本页不再先等一遍方案；
 * - 出方案（40–60 秒）期间可以取消；出方案里「创意简报」和「看图分析」并行跑。
 */

const STUDIO = "src/components/video-generation/streamlined-video-studio.tsx";

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\n  async function ", start + 10);
  const nextSync = source.indexOf("\n  function ", start + 10);
  const end = [next, nextSync].filter((index) => index > 0).sort((a, b) => a - b)[0] ?? source.length;
  return source.slice(start, end);
}

test("一键出故事板：没有单独的「核对规格」一步，主按钮直接「生成 AI 故事板」", async () => {
  const studio = await readFile(STUDIO, "utf8");
  assert.doesNotMatch(studio, /quickNeedsReview|reviewSpecs/);
  assert.match(studio, /const needsStoryboard = !storyboard && !planBlocksDispatch;/);
  /// 方案在建故事板之前一并出，期间主按钮写「正在规划镜头…」
  const createStoryboard = functionBody(studio, "handleCreateStoryboard");
  assert.match(createStoryboard, /setPlanningShots\(true\)/);
  assert.match(createStoryboard, /fetchPlan\(request, controller\.signal\)/);
  assert.match(studio, /planningShots: "正在规划镜头…",/);
});

test("刷新恢复的故事板：确认后就能生成，派发前不再等本页方案（服务端会重出并把关）", async () => {
  const studio = await readFile(STUDIO, "utf8");
  const generate = functionBody(studio, "handleGenerate");
  assert.doesNotMatch(generate, /fetchPlan\(/);
  assert.match(generate, /plan && planRequestKey === JSON\.stringify\(request\) && !plan\.qualityReview\.canDispatch/);
  assert.match(studio, /const canGenerate = Boolean\(\s*canReview\s*&& !planBlocksDispatch\s*&& storyboard\?\.status === "APPROVED",\s*\);/);
  /// 恢复请求扛得住一次重编译 / 冷启动：五次退避，约 15 秒
  assert.match(studio, /const RESUME_BACKOFF_MS = \[0, 800, 2_000, 4_000, 8_000\];/);
  const dispatchRoute = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(dispatchRoute, /plan = await buildPlan\(request\)/);
  assert.match(dispatchRoute, /if \(!plan\.qualityReview\.canDispatch\)/);
});

test("出方案期间可以取消：请求带 AbortSignal，取消后提示素材与描述都在，不报错", async () => {
  const studio = await readFile(STUDIO, "utf8");
  assert.match(studio, /async function fetchPlan\(\s*request: OwnedUnifiedVideoGenerationRequest,\s*signal\?: AbortSignal,/);
  assert.match(studio, /data-testid="cancel-planning"/);
  assert.match(studio, /busy === "preview" \|\| planningShots \?/);
  assert.match(studio, /planningCancelled: "已取消，素材和描述都保留着。",/);
  const preview = functionBody(studio, "handlePreview");
  assert.match(preview, /if \(controller\.signal\.aborted\) toast\.success\(copy\.planningCancelled\);/);
});

test("出方案提速：创意简报与看图分析并行（两者都自带兜底，互不拖垮）", async () => {
  const supervisor = await readFile("src/lib/video-generation/generation-supervisor.ts", "utf8");
  assert.match(supervisor, /const \[creativeBrief, visualRefs\] = await Promise\.all\(\[/);
  assert.equal((supervisor.match(/analyzeVisualReferences\(/g) ?? []).length, 1);
});
