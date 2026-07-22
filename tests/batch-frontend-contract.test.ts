import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

const root = process.cwd();
const monitor = readFileSync(
  path.join(root, "src/components/batch/batch-monitor.tsx"),
  "utf8",
);
const wizard = readFileSync(
  path.join(root, "src/components/batch/batch-create-wizard.tsx"),
  "utf8",
);
const limits = readFileSync(
  path.join(root, "src/lib/contracts/batch-limits.ts"),
  "utf8",
);

test("AC-B7：监控页只有一个 15s batch 聚合轮询器", () => {
  assert.equal(
    (monitor.match(/setInterval\(/g) ?? []).length,
    1,
    "整页只能创建一个轮询 interval",
  );
  assert.match(monitor, /15_000/);
  assert.match(monitor, /\/api\/batches\/\$\{initialBatch\.id\}\/status/);
  assert.match(monitor, /data-batch-poll-connections="1"/);
  assert.doesNotMatch(
    monitor,
    /jobs\.map\([\s\S]{0,600}fetch\(/,
    "单条卡片不得各自发起状态请求",
  );
});

test("AC-B7：250 卡片使用行虚拟化，仅渲染 virtualItems", () => {
  assert.match(monitor, /useVirtualizer\(\{/);
  assert.match(monitor, /virtualizer\.getVirtualItems\(\)\.map/);
  assert.match(monitor, /overscan:\s*2/);
  assert.match(monitor, /data-virtualized="true"/);
  assert.doesNotMatch(
    monitor,
    /batch\.videoJobs\.map\(/,
    "不得直接渲染全部 250 卡片",
  );
});

test("批量任务逐条展示 Image 2 故事板，成片预览受视口约束", () => {
  assert.match(monitor, /storyboard/);
  assert.match(monitor, /grid-cols-2/);
  assert.match(monitor, /object-contain/);
  assert.match(monitor, /历史成片/);
  assert.match(monitor, /max-h-\[min\(58vh,720px\)\]/);
  assert.doesNotMatch(
    monitor,
    /className="aspect-9\/12 w-full[^\"]*object-cover"/,
    "竖屏成片不能再按抽屉全宽错误放大",
  );
});

test("RF-027：批量向导与 API 共享 250 条商单认证上限", () => {
  assert.match(wizard, /const UPLOAD_CONCURRENCY = 4/);
  assert.match(wizard, /50 - uploads\.length/);
  assert.match(limits, /MAX_BATCH_IMAGE_COUNT = 50/);
  assert.match(limits, /MAX_BATCH_VIDEO_COUNT = 250/);
  assert.equal(
    (wizard.match(/max=\{MAX_BATCH_VIDEO_COUNT\}/g) ?? []).length,
    2,
    "number 与 range 两个输入都必须使用共享上限",
  );
  assert.match(wizard, /Math\.min\(\s*MAX_BATCH_VIDEO_COUNT/);
  assert.match(wizard, /上传素材.*选择风格.*生成数量.*确认提交/);
  assert.match(wizard, /\/api\/upload\/blob/);
  assert.match(wizard, /\/api\/batch-style-templates/);
  assert.match(wizard, /\/api\/batches/);
  assert.match(wizard, /BATCH_IMAGE_MIME_TYPES/);
  assert.match(wizard, /submissionIdentityRef/);
  assert.match(wizard, /const hasEnoughImages =/);
  assert.match(wizard, /missingImages/);
  assert.match(
    wizard,
    /submitting \|\|\s*!hasEnoughImages \|\|\s*selectedRouteAvailable !== true/,
    "final submission must also be blocked while the selected provider route is unavailable",
  );
  assert.doesNotMatch(
    wizard,
    /const requestBody = \{[\s\S]*?videoRouteId:[\s\S]*?\};/,
    "customer batch submissions must let the server lock the Shuyu route",
  );
  assert.match(
    wizard,
    /batchCreateErrorMessage\(data\.code, locale, data\.error\)/,
    "batch failures must select customer copy from the machine error code",
  );
  assert.match(wizard, /fingerprint:\s*string/);
  assert.match(
    wizard,
    /"idempotency-key": submissionIdentityRef\.current\.key/,
    "网络重试必须复用同一请求的 Idempotency-Key",
  );
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    assert.match(wizard, new RegExp(mime.replace("/", "\\/")));
  }
  assert.doesNotMatch(
    wizard,
    /file\.type\.startsWith\("image\/"\)/,
    "GIF/SVG 等未批准类型不得只凭 image/* 通过",
  );
});
