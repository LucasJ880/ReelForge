import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { verifiedTemplateSample } from "../src/lib/video-generation/template-sample";

const root = process.cwd();
const library = readFileSync(
  path.join(root, "src/components/templates/template-library-grid.tsx"),
  "utf8",
);
const wizard = readFileSync(
  path.join(root, "src/components/batch/batch-create-wizard.tsx"),
  "utf8",
);
const service = readFileSync(
  path.join(root, "src/lib/services/style-template-service.ts"),
  "utf8",
);
const acceptanceConfig = readFileSync(
  path.join(root, "playwright.final-acceptance.config.ts"),
  "utf8",
);

test("模板样片只在封面属于当前模板时对客户展示", () => {
  assert.equal(
    verifiedTemplateSample("ugc-handheld-review", "/template-previews/ugc-handheld-review.jpg"),
    "/template-previews/ugc-handheld-review.jpg",
  );
  assert.equal(
    verifiedTemplateSample("another-template", "/template-previews/ugc-handheld-review.jpg"),
    null,
  );
  assert.equal(verifiedTemplateSample("another-template", "http://localhost:3100/file.svg"), null);
  assert.match(library, /template\.sampleImage \?/);
  assert.doesNotMatch(library, /backgroundImage.*coverImage/);
});

test("模板库向用户开放实际质量配方和负向约束", () => {
  assert.match(library, /TemplateRecipeDialog/);
  assert.match(library, /promptSkeleton=\{template\.promptSkeleton\}/);
  assert.match(library, /negativePrompt=\{template\.negativePrompt\}/);
  assert.match(library, /verified samples|个独立样片/);
});

test("批量风格步骤使用内部滚动紧凑列表并保留配方详情", () => {
  assert.match(wizard, /max-h-\[26rem\]/);
  assert.match(wizard, /visibleTemplates\.map/);
  assert.match(wizard, /templateQuery/);
  assert.match(wizard, /TemplateRecipeDialog/);
  assert.doesNotMatch(wizard, /className="h-32 bg-muted bg-cover bg-center"/);
});

test("自动化验收模板默认对客户隔离", () => {
  assert.match(service, /category:\s*\{\s*not:\s*"自动化验收"\s*\}/);
});

test("最终验收强制把 DATABASE_URL 指向显式演练分支", () => {
  assert.match(acceptanceConfig, /NEON_REHEARSAL_DATABASE_URL/);
  assert.match(acceptanceConfig, /process\.env\.DATABASE_URL = rehearsalDatabaseUrl/);
  assert.match(acceptanceConfig, /DATABASE_URL=\"\$NEON_REHEARSAL_DATABASE_URL\"/);
});
