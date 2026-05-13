import assert from "node:assert/strict";
import test from "node:test";
import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoJobStatus,
} from "@prisma/client";
import {
  containsBannedPersonalTerm,
  customerSafeFinalVideoUrl,
  derivePersonalStatus,
  __test__,
} from "../src/lib/video-generation/personal-status";

const { LABELS, SHORT_LABELS, CTAS, PROGRESS_HINT_TEXT } = __test__;

/**
 * Phase 3 demo 守门：所有 C 端可见字符串都不能含内部术语。
 * 任何编辑只要让 label / shortLabel / cta / progress hint 出现内部词
 * （ffmpeg / seedance / provider / blob / stitch / mock / adapter / debug / json /
 * concat / executor / pipeline / 渲染 / 拼接）都会立即失败。
 */
test("personal-status: 长 label 不含任何 banned customer 术语", () => {
  for (const [status, label] of Object.entries(LABELS)) {
    assert.equal(
      containsBannedPersonalTerm(label),
      false,
      `[${status}] label leaks: "${label}"`,
    );
  }
});

test("personal-status: 短 label 不含任何 banned customer 术语", () => {
  for (const [status, short] of Object.entries(SHORT_LABELS)) {
    assert.equal(
      containsBannedPersonalTerm(short),
      false,
      `[${status}] short label leaks: "${short}"`,
    );
  }
});

test("personal-status: CTA 不含任何 banned customer 术语", () => {
  for (const [status, cta] of Object.entries(CTAS)) {
    if (!cta) continue;
    assert.equal(
      containsBannedPersonalTerm(cta),
      false,
      `[${status}] CTA leaks: "${cta}"`,
    );
  }
});

test("personal-status: 进度提示文案不含任何 banned customer 术语", () => {
  for (const [status, hint] of Object.entries(PROGRESS_HINT_TEXT)) {
    if (!hint) continue;
    assert.equal(
      containsBannedPersonalTerm(hint),
      false,
      `[${status}] progress hint leaks: "${hint}"`,
    );
  }
});

test("personal-status: shortLabel 长度 ≤ 6 个中文字符（chip 容纳）", () => {
  for (const [status, short] of Object.entries(SHORT_LABELS)) {
    assert.ok(short.length <= 6, `[${status}] short label too long: "${short}"`);
  }
});

test("personal-status: 文案符合 demo spec 约定的 5 类客户标签", () => {
  /// 5 类 demo-spec 标签
  assert.match(LABELS.planning, /准备/);
  assert.match(LABELS.generating, /生成/);
  assert.match(LABELS.assembling, /马上|稍候|准备|合成/);
  assert.match(LABELS.ready, /完成/);
  assert.match(LABELS.failed, /重试|重新|失败/);
});

test("personal-status: ready 提供查看视频 CTA，failed 提供重新生成 CTA", () => {
  const ready = derivePersonalStatus({
    finalVideoStatus: FinalVideoStatus.READY,
  });
  assert.equal(ready.status, "ready");
  assert.ok(ready.cta && ready.cta.length > 0, "ready 应有 CTA");
  assert.ok(/查看|预览/.test(ready.cta!), "ready CTA 文案应是查看/预览相关");

  const failed = derivePersonalStatus({
    finalVideoStatus: FinalVideoStatus.FAILED,
  });
  assert.equal(failed.status, "failed");
  assert.ok(failed.cta && failed.cta.length > 0, "failed 应有 CTA");
  assert.ok(/重新|重试/.test(failed.cta!), "failed CTA 文案应是重新生成相关");
});

test("personal-status: 进行中态（planning / generating / assembling）无 CTA", () => {
  const planning = derivePersonalStatus({
    briefStatus: VideoBriefStatus.BRIEF_PENDING,
  });
  const generating = derivePersonalStatus({
    briefStatus: VideoBriefStatus.RENDERING,
  });
  const assembling = derivePersonalStatus({
    finalVideoStatus: FinalVideoStatus.STITCHING,
  });
  assert.equal(planning.cta, null);
  assert.equal(generating.cta, null);
  assert.equal(assembling.cta, null);
});

test("personal-status: failed 文案告诉用户该怎么办（不只是说『失败』）", () => {
  const r = derivePersonalStatus({
    jobStatuses: [VideoJobStatus.FAILED, VideoJobStatus.FAILED],
  });
  assert.equal(r.status, "failed");
  assert.ok(
    /重新|重试|再/.test(r.label),
    `failed label 必须告诉用户怎么办: "${r.label}"`,
  );
});

test("personal-status: 与 B2B 状态机分类完全一致（C-side 不重复实现状态分类）", () => {
  /// 同样的输入应该得出同样的 status code，仅文案不同。
  const cases: Array<{
    name: string;
    input: Parameters<typeof derivePersonalStatus>[0];
    expect: string;
  }> = [
    { name: "READY", input: { finalVideoStatus: FinalVideoStatus.READY }, expect: "ready" },
    { name: "FAILED", input: { finalVideoStatus: FinalVideoStatus.FAILED }, expect: "failed" },
    {
      name: "STITCHING",
      input: { finalVideoStatus: FinalVideoStatus.STITCHING },
      expect: "assembling",
    },
    {
      name: "RENDERING",
      input: { briefStatus: VideoBriefStatus.RENDERING },
      expect: "generating",
    },
    {
      name: "BRIEF_PENDING",
      input: { briefStatus: VideoBriefStatus.BRIEF_PENDING },
      expect: "planning",
    },
  ];
  for (const c of cases) {
    const r = derivePersonalStatus(c.input);
    assert.equal(r.status, c.expect, `[${c.name}] expected ${c.expect}, got ${r.status}`);
  }
});

test("customerSafeFinalVideoUrl: 只放行 http(s) URL", () => {
  assert.equal(
    customerSafeFinalVideoUrl("https://cdn.example.com/v.mp4"),
    "https://cdn.example.com/v.mp4",
  );
  assert.equal(
    customerSafeFinalVideoUrl("http://cdn.example.com/v.mp4"),
    "http://cdn.example.com/v.mp4",
  );
  assert.equal(customerSafeFinalVideoUrl(null), null);
  assert.equal(customerSafeFinalVideoUrl(undefined), null);
  assert.equal(customerSafeFinalVideoUrl(""), null);
  assert.equal(customerSafeFinalVideoUrl("   "), null);
  /// dev 模式可能产出 file:// 路径，必须过滤
  assert.equal(
    customerSafeFinalVideoUrl("file:///tmp/dev/output.mp4"),
    null,
  );
  /// 任何相对路径或内部协议都不能透出
  assert.equal(customerSafeFinalVideoUrl("/internal/output.mp4"), null);
  assert.equal(customerSafeFinalVideoUrl("blob:https://x"), null);
  assert.equal(
    customerSafeFinalVideoUrl("data:video/mp4;base64,AAAA"),
    null,
  );
});

test("customerSafeFinalVideoUrl: 去除首尾空白后再判定", () => {
  assert.equal(
    customerSafeFinalVideoUrl("  https://x.com/a.mp4  "),
    "https://x.com/a.mp4",
  );
});
