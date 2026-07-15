import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  batchCreateErrorMessage,
  dispatchRecoveryHint,
} from "../src/lib/api/customer-video-dispatch-recovery";
import { customerRecoveryActions } from "../src/lib/contracts/customer-api";

test("H1 UI contract: every recovery action has visible bilingual guidance", () => {
  for (const action of customerRecoveryActions) {
    const zh = dispatchRecoveryHint(action, "zh-CN");
    const en = dispatchRecoveryHint(action, "en-US");
    assert.ok(zh.length >= 10, `${action} must have Chinese guidance`);
    assert.ok(en.length >= 10, `${action} must have English guidance`);
  }
});

test("batch create selects customer copy by error code and never echoes Chinese into English UI", () => {
  const upstreamChinese = "当前模板每条至少需要 3 张图，实际只有 1 张";
  const english = batchCreateErrorMessage(
    "VALIDATION_FAILED",
    "en-US",
    upstreamChinese,
  );
  assert.match(english, /selected style.*product images.*batch settings/i);
  assert.doesNotMatch(english, /[\u3400-\u9fff]/);
  assert.equal(
    batchCreateErrorMessage("VALIDATION_FAILED", "zh-CN", upstreamChinese),
    upstreamChinese,
  );
  assert.doesNotMatch(
    batchCreateErrorMessage(undefined, "en-US", upstreamChinese),
    /[\u3400-\u9fff]/,
  );
});

test("H1 UI contract: batch create consumes template, upload, and submit recovery actions", async () => {
  const [wizard, upload] = await Promise.all([
    readFile("src/components/batch/batch-create-wizard.tsx", "utf8"),
    readFile("src/lib/upload/blob-xhr.ts", "utf8"),
  ]);
  assert.match(wizard, /payload\.action \?\? "retry"/);
  assert.match(wizard, /uploadError\?\.details\.action/);
  assert.match(wizard, /data\.action \?\? "retry"/);
  assert.match(wizard, /dispatchRecoveryHint\(/);
  assert.match(wizard, /上传失败明细/);
  assert.match(wizard, /重新加载模板/);
  assert.match(wizard, /setTemplateReloadToken/);
  assert.match(
    wizard,
    /item\.recoveryAction === "replace_asset"[\s\S]{0,500}removeUpload\(item\.localId\)/,
  );
  assert.match(
    wizard,
    /\(item\.recoveryAction \?\? "retry"\) === "retry"[\s\S]{0,500}uploadOne\(item\)/,
  );
  assert.match(upload, /class BlobUploadHttpError/);
  assert.match(upload, /action:\s*payload\.action/);
});

test("H1 UI contract: unsafe batch failures show guidance, never a retry control", async () => {
  const monitor = await readFile(
    "src/components/batch/batch-monitor.tsx",
    "utf8",
  );
  assert.match(monitor, /job\.error\?\.retryable/);
  assert.match(
    monitor,
    /job\.status === "FAILED" && job\.error \? \([\s\S]*?setDetailJob\(job\)/,
  );
  assert.match(monitor, /detailJob\.error\.action/);
  assert.match(monitor, /dispatchRecoveryHint\(/);
  assert.doesNotMatch(
    monitor,
    /SUBMISSION_ACK_UNKNOWN[\s\S]{0,500}(?:onClick|retry-)/,
    "the UI must not special-case an ambiguous acknowledgement into a retry",
  );
});
