import assert from "node:assert/strict";
import test from "node:test";
import {
  checkOriginality,
  findLongestOverlap,
  flattenPlanText,
  normalizeForComparison,
  ORIGINALITY_THRESHOLD,
  toNgrams,
} from "../src/lib/services/originality-check";

/**
 * PRD §3 O4 验收 3：「由配方生成的内容是原创的：可通过重复度检查」。
 * 这是合规主张的证据链，不是质量分。
 */

const REFERENCE = [
  "夏天太阳太刺眼？装上遮光卷帘，卧室瞬间凉快下来。现在预约免费上门量尺，还送安装。",
  "旧窗帘换新只要一天。多伦多本地团队，免费上门量尺，先看效果再决定。",
];

test("结构相同、措辞不同 → 判为原创", () => {
  const produced = `想换窗饰却不知道从哪开始？我们先到现场把尺寸量清楚，你再挑款式。
本地团队上门，看过实际光线之后给建议。`;
  const report = checkOriginality(produced, REFERENCE);
  assert.ok(
    report.passed,
    `结构借鉴不该判抄袭，实际 containment=${report.containment.toFixed(3)}`,
  );
  assert.ok(report.containment < ORIGINALITY_THRESHOLD);
});

test("🔴 整句照抄 → 判为不通过，并指出抄的是哪一段", () => {
  const produced = "换个说法开头。现在预约免费上门量尺，还送安装。后面再补一句。";
  const report = checkOriginality(produced, REFERENCE);
  assert.equal(report.passed, false, "照抄一整句必须被拦下");
  assert.ok(report.longestOverlap, "要能指出抄了什么");
  assert.match(report.longestOverlap!, /预约免费上门量尺/);
});

test("只改标点骗不过检查", () => {
  const produced = "现在预约免费上门量尺！！！还送安装～～～";
  const report = checkOriginality(produced, REFERENCE);
  assert.equal(report.passed, false, "改标点不是原创");
});

test("大小写与空白差异不影响判定（英文素材）", () => {
  const reference = ["Book a FREE in-home measurement today, installation included."];
  const produced = "book a free in-home   measurement today, Installation Included.";
  assert.equal(checkOriginality(produced, reference).passed, false);
});

test("文本太短时不判通过 —— 不能用「没检查」冒充「检查通过」", () => {
  const report = checkOriginality("短", REFERENCE);
  assert.equal(report.sampleSize, 0);
  assert.equal(report.passed, false);
});

test("没有参考素材时判通过：没东西可抄", () => {
  const report = checkOriginality("我家做定制百叶窗，欢迎来问。", []);
  assert.equal(report.passed, true);
  assert.equal(report.containment, 0);
  assert.equal(report.longestOverlap, null);
});

test("归一化去掉标点空白与大小写", () => {
  assert.equal(normalizeForComparison(" Hello,  World! "), "helloworld");
  assert.equal(normalizeForComparison("免费，上门 量尺。"), "免费上门量尺");
});

test("n-gram 切分对中英文都稳定", () => {
  assert.ok(toNgrams("免费上门量尺").has("免费上门量"));
  assert.ok(toNgrams("measurement").has("measu"));
  /// 比 n-gram 还短的文本切不出东西，这是有意的。
  assert.equal(toNgrams("短文").size, 0);
});

test("最长重合片段短于 n-gram 长度时不报", () => {
  assert.equal(findLongestOverlap("完全不同的内容", ["另一段文字"]), null);
});

test("摊平计划时钩子、正文、CTA、叠字都要进检查", () => {
  const text = flattenPlanText({
    posts: [
      {
        copy: { hook: "钩子句", body: "正文句", cta: "行动句" },
        slides: [{ overlayText: "叠字句" }, { overlayText: null }],
      },
    ],
  });
  for (const part of ["钩子句", "正文句", "行动句", "叠字句"]) {
    assert.ok(text.includes(part), `${part} 必须进检查范围`);
  }
});

test("阈值是刻意保守的，改动要有理由", () => {
  /// 结构相同措辞不同通常落在 0.02-0.08；抄一句十几个字会顶到 0.2 以上。
  assert.ok(ORIGINALITY_THRESHOLD > 0.1 && ORIGINALITY_THRESHOLD < 0.25);
});
