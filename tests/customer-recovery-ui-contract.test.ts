import assert from "node:assert/strict";
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

