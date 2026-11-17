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
  /// 2026-11-17：出方案预览那一步随老线路删了——点一下直接建故事板（AI 导演在那一步写好镜头脚本）
  assert.match(studio, /const needsStoryboard = !storyboard;/);
  const createStoryboard = functionBody(studio, "handleCreateStoryboard");
  assert.match(createStoryboard, /fetch\("\/api\/video-generation\/storyboards", \{/);
  assert.doesNotMatch(createStoryboard, /fetchPlan|\/api\/video-generation\/plan|voiceover-draft/);
});

test("刷新恢复的故事板：确认后就能生成，派发前不再等本页方案（服务端会重出并把关）", async () => {
  const studio = await readFile(STUDIO, "utf8");
  const generate = functionBody(studio, "handleGenerate");
  assert.doesNotMatch(generate, /fetchPlan\(/);
  /// 恢复请求扛得住一次重编译 / 冷启动：五次退避，约 15 秒
  assert.match(studio, /const RESUME_BACKOFF_MS = \[0, 800, 2_000, 4_000, 8_000\];/);
  const dispatchRoute = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(dispatchRoute, /plan = await buildPlan\(request[,)]/);
  assert.match(dispatchRoute, /if \(!plan\.qualityReview\.canDispatch\)/);
});

