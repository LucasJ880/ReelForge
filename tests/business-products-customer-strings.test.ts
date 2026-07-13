import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

test("studio/starter 共用 owner-scoped 成品库，不按历史 persona 分流", async () => {
  const service = await readFile(path.join(ROOT, "src/lib/services/unified-library-service.ts"), "utf8");
  assert.match(service, /createdById:\s*userId/);
  assert.doesNotMatch(service, /persona\s*===|persona:\s*"(?:BUSINESS|PERSONAL)"/);
});

test("统一成品列表只展示安全 URL，失败态提供重试和支持", async () => {
  const page = await readFile(path.join(ROOT, "src/app/(platform)/app/library/page.tsx"), "utf8");
  const service = await readFile(path.join(ROOT, "src/lib/services/unified-library-service.ts"), "utf8");
  assert.match(service, /customerSafeFinalVideoUrl/);
  assert.match(page, /row\.videoUrl \?/);
  assert.match(page, /row\.status === "failed"/);
  assert.match(page, /重新生成/);
  assert.match(page, /联系支持/);
});

test("统一详情按 session owner 查询，历史 persona 不触发跨路由重定向", async () => {
  const page = await readFile(path.join(ROOT, "src/app/(platform)/app/library/[id]/page.tsx"), "utf8");
  assert.match(page, /getUnifiedLibraryItem\(session\.user\.id, id\)/);
  assert.doesNotMatch(page, /\/personal|\/business|persona\s*===/);
});

test("统一 VideoActions 保留刷新与失败片段重试契约", async () => {
  const actions = await readFile(path.join(ROOT, "src/components/library/video-actions.tsx"), "utf8");
  const zh = await readFile(path.join(ROOT, "src/i18n/dictionaries/zh-CN.ts"), "utf8");
  assert.match(actions, /render-status/);
  assert.match(actions, /render-retry/);
  assert.match(actions, /all:\s*true/);
  assert.match(zh, /刷新进度/);
  assert.match(zh, /重试失败片段/);
});
