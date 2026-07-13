import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { PLATFORM_PRIMARY_NAV, platformPathAfterGeneration } from "../src/lib/platform-routes";

test("Phase1 unified journey：五个一级区只有一套 /app 路径", () => {
  assert.deepEqual(PLATFORM_PRIMARY_NAV.map(({ label, href }) => ({ label, href })), [
    { label: "创作", href: "/app/create" },
    { label: "批量生产", href: "/app/batches" },
    { label: "投放与赛马", href: "/app/racing" },
    { label: "成品库", href: "/app/library" },
    { label: "模板库", href: "/app/templates" },
  ]);
  assert.equal(platformPathAfterGeneration("order 1"), "/app/library?highlight=order%201");
});

test("Phase1 unified journey：五区页面与批次/成品详情均存在", async () => {
  for (const file of [
    "src/app/(platform)/app/create/page.tsx",
    "src/app/(platform)/app/batches/new/page.tsx",
    "src/app/(platform)/app/batches/page.tsx",
    "src/app/(platform)/app/batches/[id]/page.tsx",
    "src/app/(platform)/app/racing/page.tsx",
    "src/app/(platform)/app/library/page.tsx",
    "src/app/(platform)/app/library/[id]/page.tsx",
    "src/app/(platform)/app/templates/page.tsx",
  ]) await access(file);
});

test("Phase1 unified journey：批量创建完成后进入统一批次详情", async () => {
  const page = await readFile("src/app/(platform)/app/batches/new/page.tsx", "utf8");
  const wizard = await readFile("src/components/batch/batch-create-wizard.tsx", "utf8");
  assert.match(page, /batchDetailsBasePath="\/app\/batches"/);
  assert.match(wizard, /router\.push\(`\$\{batchDetailsBasePath\}\/\$\{data\.batch\.id\}`\)/);
});

test("Phase2 模板库选择可透传到批量向导并预选精确版本 ID", async () => {
  const templates = await readFile("src/app/(platform)/app/templates/page.tsx", "utf8");
  const page = await readFile("src/app/(platform)/app/batches/new/page.tsx", "utf8");
  const wizard = await readFile("src/components/batch/batch-create-wizard.tsx", "utf8");
  assert.match(templates, /\/app\/batches\/new\?template=/);
  assert.match(page, /initialTemplateId=\{initialTemplateId\}/);
  assert.match(wizard, /rows\.find\(\(template\) => template\.id === initialTemplateId\)/);
});

test("Phase1 unified journey：创作使用 account-neutral platform 请求并回统一成品库", async () => {
  const page = await readFile("src/app/(platform)/app/create/page.tsx", "utf8");
  const agent = await readFile("src/components/video-generation/agent-creative-studio.tsx", "utf8");
  const input = await readFile("src/components/video-generation/unified-creative-input.tsx", "utf8");
  const dispatch = await readFile("src/app/api/video-generation/dispatch/route.ts", "utf8");
  assert.match(page, /AgentCreativeStudio/);
  assert.match(agent, /userType="platform"/);
  assert.match(input, /userType === "platform"[\s\S]*?"\/app\/library"/);
  assert.match(dispatch, /request\.userType === "platform"[\s\S]*?\/app\/library/);
});

test("Phase1 unified journey：成品库按 owner 隔离，不再按 BUSINESS/PERSONAL persona 过滤", async () => {
  const source = await readFile("src/lib/services/unified-library-service.ts", "utf8");
  assert.match(source, /createdById:\s*userId/);
  assert.doesNotMatch(source, /persona\s*===|persona:\s*"BUSINESS"|persona:\s*"PERSONAL"/);
});

test("Phase1 unified journey：统一导航不暴露 digital human 或旧 B/C 路径", async () => {
  const source = await readFile("src/components/platform/platform-shell.tsx", "utf8");
  assert.doesNotMatch(source, /digital-human|\/business|\/personal/);
});
