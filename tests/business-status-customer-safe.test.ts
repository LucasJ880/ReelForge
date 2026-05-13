import assert from "node:assert/strict";
import test from "node:test";
import { FinalVideoStatus, VideoBriefStatus, VideoJobStatus } from "@prisma/client";
import {
  containsBannedCustomerTerm,
  deriveBusinessStatus,
  __test__,
} from "../src/lib/video-generation/business-status";

const { LABELS, SHORT_LABELS, CTAS, BANNED_CUSTOMER_TERMS } = __test__;

/**
 * Phase 2.5 polish 守门：每一个会出现在客户端的字符串都不能含内部术语。
 * 这是 demo 安全的硬约束；任何后续编辑只要让长/短 label 出现内部词就会立即失败。
 */
test("business-status: 长 label 不含任何 banned customer 术语", () => {
  for (const [status, label] of Object.entries(LABELS)) {
    assert.equal(
      containsBannedCustomerTerm(label),
      false,
      `[${status}] long label leaks: "${label}"`,
    );
  }
});

test("business-status: 短 label 不含任何 banned customer 术语", () => {
  for (const [status, short] of Object.entries(SHORT_LABELS)) {
    assert.equal(
      containsBannedCustomerTerm(short),
      false,
      `[${status}] short label leaks: "${short}"`,
    );
  }
});

test("business-status: CTA 不含任何 banned customer 术语", () => {
  for (const [status, cta] of Object.entries(CTAS)) {
    if (!cta) continue;
    assert.equal(
      containsBannedCustomerTerm(cta),
      false,
      `[${status}] CTA leaks: "${cta}"`,
    );
  }
});

test("business-status: shortLabel 长度 ≤ 6 个中文字符（chip 容纳）", () => {
  for (const [status, short] of Object.entries(SHORT_LABELS)) {
    assert.ok(short.length <= 6, `[${status}] short label too long: "${short}"`);
  }
});

test("business-status: ready 提供查看视频 CTA，failed 提供重新生成 CTA", () => {
  const ready = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.READY,
  });
  assert.equal(ready.status, "ready");
  assert.ok(ready.cta && ready.cta.length > 0, "ready 应有 CTA");
  assert.ok(/查看|预览/.test(ready.cta!), "ready CTA 文案应是预览/查看相关");

  const failed = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.FAILED,
  });
  assert.equal(failed.status, "failed");
  assert.ok(failed.cta && failed.cta.length > 0, "failed 应有 CTA");
  assert.ok(/重新|重试/.test(failed.cta!), "failed CTA 文案应是重新生成相关");
});

test("business-status: 进行中态（planning / generating / assembling）无 CTA", () => {
  const planning = deriveBusinessStatus({
    briefStatus: VideoBriefStatus.BRIEF_PENDING,
  });
  const generating = deriveBusinessStatus({
    briefStatus: VideoBriefStatus.RENDERING,
  });
  const assembling = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.STITCHING,
  });
  assert.equal(planning.cta, null);
  assert.equal(generating.cta, null);
  assert.equal(assembling.cta, null);
});

test("business-status: failed label 提供可执行的下一步（重新生成 / 联系客服）", () => {
  const r = deriveBusinessStatus({
    jobStatuses: [VideoJobStatus.FAILED, VideoJobStatus.FAILED],
  });
  assert.equal(r.status, "failed");
  assert.ok(
    /重新生成|联系客服|重试/.test(r.label),
    `failed label 必须告诉用户怎么办: "${r.label}"`,
  );
});

test("business-status: ready label 不再承诺一定可下载（避免无 URL 时虚假承诺）", () => {
  const r = deriveBusinessStatus({
    finalVideoStatus: FinalVideoStatus.READY,
  });
  /// 之前的 "已就绪，可下载" 在 finalVideoUrl 缺失时会让用户找不到下载入口。
  /// 新文案只承诺「就绪」，下载入口由 UI 在 URL 真实存在时才显示。
  assert.ok(!r.label.includes("可下载"), `ready label 不应硬承诺下载: "${r.label}"`);
});

test("business-status: containsBannedCustomerTerm 正确识别中英术语", () => {
  /// 阳性
  assert.equal(containsBannedCustomerTerm("ffmpeg failed"), true);
  assert.equal(containsBannedCustomerTerm("Seedance provider error"), true);
  assert.equal(containsBannedCustomerTerm("blob 上传失败"), true);
  assert.equal(containsBannedCustomerTerm("STITCHING"), true);
  assert.equal(containsBannedCustomerTerm("内部 adapter 报错"), true);
  /// 阴性（customer-safe）
  assert.equal(containsBannedCustomerTerm("视频已就绪"), false);
  assert.equal(containsBannedCustomerTerm("正在准备您的视频"), false);
  assert.equal(containsBannedCustomerTerm("AI 正在生成画面"), false);
});

test("business-status: BANNED_CUSTOMER_TERMS 至少覆盖 demo spec 列表", () => {
  const required = ["ffmpeg", "seedance", "stitch", "concat", "blob", "mock", "provider", "adapter"];
  for (const term of required) {
    assert.ok(
      BANNED_CUSTOMER_TERMS.some((t) => t.toLowerCase() === term),
      `BANNED_CUSTOMER_TERMS missing: ${term}`,
    );
  }
});
