import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("S5 候选识别：只读、真实 provider、全段成功与前端来源四重门禁", async () => {
  const source = await readFile(
    "scripts/identify-ceo-storage-migration-candidates.ts",
    "utf8",
  );
  assert.match(source, /readOnly:\s*true/);
  assert.match(source, /segment\.status === "SUCCEEDED"/);
  assert.match(source, /SEEDANCE_T2V/);
  assert.match(source, /SEEDANCE_I2V/);
  assert.match(source, /!segment\.externalJobId\?\.startsWith\("mock_"\)/);
  assert.match(source, /requestOrigin === "web_app"/);
  assert.match(source, /ambiguous-origin/);
  assert.match(source, /human confirmation required; no migration writes allowed/);
  assert.doesNotMatch(source, /db\.\w+\.(?:update|updateMany|create|createMany|delete|deleteMany|upsert)\(/);
});

test("S5 新前端请求写入不可伪装的迁移来源标记", async () => {
  const source = await readFile(
    "src/app/api/video-generation/dispatch/route.ts",
    "utf8",
  );
  assert.match(source, /requestOrigin:\s*"web_app"/);
});
