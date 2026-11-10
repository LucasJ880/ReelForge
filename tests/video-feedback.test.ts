import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VIDEO_FEEDBACK_NOTE_MAX,
  VIDEO_FEEDBACK_REASONS,
  summarizeVideoFeedback,
  toVideoFeedbackView,
  videoFeedbackInputSchema,
} from "@/lib/contracts/video-feedback";

/**
 * 成片评价（2026-11-10）：成片画面质检关掉之后唯一来自真人的质量读数。
 * 守住：契约干净（满意不带原因、不满意原因去重）、只有主人能评、表没建时不拖垮别的功能、迁移只加不删。
 */

test("评价入参：满意不带原因与备注；不满意的原因去重；多余字段、认不出的原因、超长备注都拒绝", () => {
  const up = videoFeedbackInputSchema.parse({ rating: "up", reasons: ["other"], note: "很好" });
  assert.deepEqual(up, { rating: "up", reasons: [], note: null });

  const down = videoFeedbackInputSchema.parse({
    rating: "down",
    reasons: ["unnatural_motion", "unnatural_motion", "product_mismatch"],
    note: "  倒水的时候水流到杯子外面了  ",
  });
  assert.deepEqual(down, {
    rating: "down",
    reasons: ["unnatural_motion", "product_mismatch"],
    note: "倒水的时候水流到杯子外面了",
  });
  assert.equal(videoFeedbackInputSchema.parse({ rating: "down", reasons: ["other"], note: "   " }).note, null);

  assert.equal(videoFeedbackInputSchema.safeParse({ rating: "meh" }).success, false);
  assert.equal(videoFeedbackInputSchema.safeParse({ rating: "down", reasons: ["made_up"] }).success, false);
  assert.equal(videoFeedbackInputSchema.safeParse({ rating: "up", userId: "someone-else" }).success, false);
  assert.equal(
    videoFeedbackInputSchema.safeParse({ rating: "down", reasons: ["other"], note: "字".repeat(VIDEO_FEEDBACK_NOTE_MAX + 1) }).success,
    false,
  );
});

test("读回评价：认不出的评分当作没评，认不出的原因丢掉", () => {
  assert.equal(toVideoFeedbackView(null), null);
  assert.equal(toVideoFeedbackView({ rating: "maybe", reasons: [], note: null }), null);
  assert.deepEqual(toVideoFeedbackView({ rating: "down", reasons: ["off_brief", "legacy_reason"], note: "x" }), {
    rating: "down",
    reasons: ["off_brief"],
    note: "x",
  });
});

test("汇总：满意率按条算，原因按出现的条数算；一条评价都没有时满意率是 null", () => {
  assert.equal(summarizeVideoFeedback([]).satisfactionRate, null);
  const summary = summarizeVideoFeedback([
    { rating: "up", reasons: [] },
    { rating: "up", reasons: [] },
    { rating: "up", reasons: ["other"] },
    { rating: "down", reasons: ["unnatural_motion", "unnatural_motion", "product_mismatch"] },
    { rating: "weird", reasons: ["other"] },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.up, 3);
  assert.equal(summary.down, 1);
  assert.equal(summary.satisfactionRate, 75);
  assert.equal(summary.reasons.unnatural_motion, 1, "同一条里重复的原因只算一次");
  assert.equal(summary.reasons.product_mismatch, 1);
  assert.equal(summary.reasons.other, 0, "满意的那条带的原因不算");
  assert.deepEqual(Object.keys(summary.reasons).sort(), [...VIDEO_FEEDBACK_REASONS].sort());
});

test("接口：先鉴权、再校验、只有成片主人能评；表没建回 503 而不是 500", async () => {
  const route = await readFile("src/app/api/briefs/[id]/feedback/route.ts", "utf8");
  const order = ["requireAuth()", "videoFeedbackInputSchema.safeParse", "checkBriefAccess(id, auth.session)", "saveVideoFeedback("];
  const positions = order.map((marker) => route.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0), "四步都在");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "顺序：鉴权 → 校验 → 归属 → 落库");
  assert.match(route, /!access\.allowed \|\| access\.reason !== "owner"/);
  assert.match(route, /error instanceof VideoFeedbackUnavailableError[\s\S]{0,200}status: 503/);
  const service = await readFile("src/lib/services/video-feedback-service.ts", "utf8");
  assert.match(service, /error\.code === "P2021"/);
});

test("迁移只新建一张独立的表：不改不删既有表，没有外键", async () => {
  const sql = await readFile("prisma/migrations/20261110150000_video_feedback/migration.sql", "utf8");
  const statements = sql.replace(/^--.*$/gmu, "");
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "VideoFeedback"/);
  assert.doesNotMatch(statements, /\bDROP\b|\bALTER TABLE\b|\bDELETE\b|\bUPDATE\b|\bREFERENCES\b/iu);
  assert.match(statements, /SET lock_timeout = '5s';/);
  const schema = await readFile("prisma/schema.prisma", "utf8");
  const model = schema.slice(schema.indexOf("model VideoFeedback {"), schema.indexOf("}", schema.indexOf("model VideoFeedback {")));
  assert.doesNotMatch(model, /@relation/);
});

test("成片详情：只对本人的已成片给评价与「再做一条」；评价读不到不挡页面；已成片不再有「刷新进度」", async () => {
  const detail = await readFile("src/app/(platform)/app/library/[id]/page.tsx", "utf8");
  assert.match(detail, /const canMakeAnother = canAct && item\.source === "order" && item\.status === "ready";/);
  assert.match(detail, /const canRate = canAct && item\.status === "ready" && Boolean\(item\.videoUrl\);/);
  assert.match(detail, /await getVideoFeedback\(item\.briefId\)\.catch\(\(\) => null\)/);
  assert.match(detail, /href=\{`\/app\/create\?retry=\$\{encodeURIComponent\(item\.id\)\}`\}/);
  assert.match(detail, /showRefresh=\{item\.status !== "ready"\}/);
  const panel = await readFile("src/components/library/video-feedback-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /@\/lib\/services\//, "客户端组件只引契约，不引服务端模块");
});

test("成品库：手机上成片墙也是两列", async () => {
  const list = await readFile("src/app/(platform)/app/library/page.tsx", "utf8");
  assert.match(list, /<ul className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-label=\{copy\.listLabel\}>/);
});
