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
