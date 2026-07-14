import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("创作首页以自有 Agent 对话为第一入口，同时保留真实生产表单", async () => {
  const [page, studio] = await Promise.all([
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/video-generation/agent-creative-studio.tsx", "utf8"),
  ]);
  assert.match(page, /AgentCreativeStudio/);
  assert.match(page, /buildAgentRecommendations/);
  assert.match(studio, /\/api\/personal\/agent-chat/);
  assert.match(studio, /UnifiedCreativeInput/);
  assert.match(studio, /userType="platform"/);
  assert.match(studio, /\/app\/templates/);
  assert.match(studio, /\/app\/batches\/new\?template=/);
  assert.match(studio, /uploadFilesToAssets/);
});

test("Agent 对话与推荐模板覆盖中英文，并为世界杯稀疏输入锁定赛事模板", async () => {
  const [studio, route, copy] = await Promise.all([
    readFile("src/components/video-generation/agent-creative-studio.tsx", "utf8"),
    readFile("src/app/api/personal/agent-chat/route.ts", "utf8"),
    readFile("src/i18n/platform-copy.ts", "utf8"),
  ]);
  assert.match(studio, /世界杯\|world\\s\*cup/);
  assert.match(studio, /tpl_event_watch_party/);
  assert.match(route, /locale:\s*z\.enum\(\["zh-CN", "en-US"\]\)/);
  assert.match(route, /SYSTEM_PROMPT_EN/);
  assert.match(copy, /先聊清楚，再开始生成/);
  assert.match(copy, /Talk it through, then generate/);
});

test("Agent 对话保持在有界滚动区，用户可回到最新消息且主生成入口不再被方案预览隐藏", async () => {
  const [studio, input, tokens] = await Promise.all([
    readFile("src/components/video-generation/agent-creative-studio.tsx", "utf8"),
    readFile("src/components/video-generation/unified-creative-input.tsx", "utf8"),
    readFile("src/styles/tokens.css", "utf8"),
  ]);

  assert.match(studio, /data-testid="agent-chat-scroll"/);
  assert.match(studio, /h-\[32rem\][\s\S]*?min-h-0[\s\S]*?xl:h-full/);
  assert.match(studio, /h-full min-h-0[\s\S]*?overflow-y-auto[\s\S]*?overscroll-contain/);
  assert.match(studio, /distanceFromBottom <= 48/);
  assert.match(studio, /!chatPinned[\s\S]*?jumpToLatest/);
  assert.match(studio, /shrink-0[\s\S]*?border-t[\s\S]*?promptLabel/);

  assert.match(input, /id="platform-primary-generate"/);
  assert.match(input, /onClick=\{\(\) => void handleGenerate\(null\)\}/);
  assert.match(input, /const canGenerate =\s*\n\s*rawPrompt\.trim\(\)\.length > 0/);
  assert.doesNotMatch(input, /\{plan && planRequestKey === requestFingerprint\(\) \? \(/);

  assert.match(tokens, /\.studio-theme[\s\S]*?--font-size-body: 13px/);
  assert.match(tokens, /\.studio-theme[\s\S]*?--control-height: 36px/);
  assert.match(tokens, /\.studio-theme[\s\S]*?--card-padding-x: 18px/);
});
