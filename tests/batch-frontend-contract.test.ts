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

test("AC-B7：200 卡片使用行虚拟化，仅渲染 virtualItems", () => {
  assert.match(monitor, /useVirtualizer\(\{/);
  assert.match(monitor, /virtualizer\.getVirtualItems\(\)\.map/);
  assert.match(monitor, /overscan:\s*2/);
  assert.match(monitor, /data-virtualized="true"/);
  assert.doesNotMatch(
    monitor,
    /batch\.videoJobs\.map\(/,
    "不得直接渲染全部 200 卡片",
  );
});

test("批量向导：50 图上限、4 并发上传、200 条上限和四步流程均有硬约束", () => {
  assert.match(wizard, /const UPLOAD_CONCURRENCY = 4/);
  assert.match(wizard, /50 - uploads\.length/);
  assert.match(wizard, /max=\{200\}/);
  assert.match(wizard, /上传素材.*选择风格.*生成数量.*确认提交/);
  assert.match(wizard, /\/api\/upload\/blob/);
  assert.match(wizard, /\/api\/batch-style-templates/);
  assert.match(wizard, /\/api\/batches/);
  assert.match(wizard, /BATCH_IMAGE_MIME_TYPES/);
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    assert.match(wizard, new RegExp(mime.replace("/", "\\/")));
  }
  assert.doesNotMatch(
    wizard,
    /file\.type\.startsWith\("image\/"\)/,
    "GIF/SVG 等未批准类型不得只凭 image/* 通过",
  );
});
