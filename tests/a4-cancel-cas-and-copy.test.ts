import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../src/lib/db";
import {
  ProductImageRequestError,
  cancelProductImageJob,
} from "../src/lib/services/product-image-service";
import {
  heuristicPlan,
  type ContentPlanInput,
} from "../src/lib/services/content-plan-service";

/**
 * A4 5.5：产品图取消加 CAS；Stripe 支付回跳不再指向已下线的页面。
 * A4 5.6：本周内容兜底文案不替商家做承诺、不把 AI 图说成实拍，CTA 指向主页链接。
 */

function patch(t: TestContext, target: object, values: Record<string, unknown>) {
  const record = target as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    originals[key] = record[key];
    record[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) record[key] = value;
  });
}

function installProductImageCancel(
  t: TestContext,
  options: { jobClaimCount: number },
) {
  const log: Array<{ op: string; args: unknown }> = [];
  const tx = {
    productImageJob: {
      updateMany: async (args: unknown) => {
        log.push({ op: "job.updateMany", args });
        return { count: options.jobClaimCount };
      },
    },
    productImageProviderTask: {
      updateMany: async (args: unknown) => {
        log.push({ op: "task.updateMany", args });
        return { count: 1 };
      },
    },
  };
  patch(t, db, {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  });
  patch(t, db.productImageJob, {
    findFirst: async (args: { select?: unknown }) => {
      if (args.select) {
        return { id: "job-1", status: "PROCESSING", idempotencyKey: "key-1" };
      }
      return { id: "job-1", status: "CANCELLED" };
    },
  });
  return log;
}

test("🔴 产品图取消 CAS：读完状态后 poll 抢先收成 SUCCEEDED，取消不能把成功覆盖掉", async (t) => {
  const log = installProductImageCancel(t, { jobClaimCount: 0 });
  await assert.rejects(
    cancelProductImageJob({ jobId: "job-1", userId: "user-1" }),
    (err: unknown) =>
      err instanceof ProductImageRequestError && err.status === 409 && err.code === "INVALID_STATE",
  );
  const claim = log.find((entry) => entry.op === "job.updateMany")?.args as {
    where: { status: { in: string[] }; userId: string };
  };
  assert.deepEqual(claim.where.status.in.sort(), ["PROCESSING", "QUEUED"], "写入必须带源状态条件");
  assert.equal(claim.where.userId, "user-1");
  assert.ok(
    !log.some((entry) => entry.op === "task.updateMany"),
    "抢输了就不能再动 provider task",
  );
});

test("产品图取消 CAS 抢到：任务与未终态 provider task 一起改已取消，幂等键改写", async (t) => {
  const log = installProductImageCancel(t, { jobClaimCount: 1 });
  const job = await cancelProductImageJob({ jobId: "job-1", userId: "user-1" });
  assert.equal(job.status, "CANCELLED");
  const claim = log.find((entry) => entry.op === "job.updateMany")?.args as {
    data: { status: string; idempotencyKey: string };
  };
  assert.equal(claim.data.status, "CANCELLED");
  assert.match(claim.data.idempotencyKey, /^cancelled:\d+:key-1$/);
  assert.ok(log.some((entry) => entry.op === "task.updateMany"));
});

/// 用任意行业、且不含任何优惠字眼的输入，确认兜底文案自己不会编出来。
const NEUTRAL_INPUTS: ContentPlanInput[] = [
  { sentence: "我家做手工咖啡豆烘焙", industry: "咖啡", brandName: "小林咖啡" },
  { sentence: "社区宠物美容店" },
  { sentence: "定制百叶窗", industry: "定制窗帘", productFacts: ["商品名：定制卷帘"] },
];

function publishedText(input: ContentPlanInput): string[] {
  const plan = heuristicPlan(input);
  return plan.posts.flatMap((post) => [
    post.copy.hook,
    post.copy.body,
    post.copy.cta ?? "",
    ...post.hashtags,
    ...post.slides.map((slide) => slide.overlayText ?? ""),
  ]);
}

test("🔴 兜底文案不编优惠、不编数据、不把 AI 图说成实拍", () => {
  const forbidden = [/免费/, /上门量尺/, /实拍/, /真实成交/, /真实数据/, /上个月最多/];
  for (const input of NEUTRAL_INPUTS) {
    for (const text of publishedText(input)) {
      for (const pattern of forbidden) {
        assert.doesNotMatch(text, pattern, `「${text}」不能出现 ${pattern}（输入：${input.sentence}）`);
      }
    }
  }
});

test("兜底文案的行动号召指向主页链接（询盘页），不再引到评论区 / 私信", () => {
  for (const input of NEUTRAL_INPUTS) {
    const plan = heuristicPlan(input);
    for (const post of plan.posts) {
      const cta = post.copy.cta ?? "";
      assert.match(cta, /主页链接/, `${post.key} 的 CTA 要指向主页链接：${cta}`);
      assert.doesNotMatch(cta, /评论|私信|留言区/);
    }
  }
});

test("商家自己说的优惠照样保留（是商家的事实，不是我们编的）", () => {
  const plan = heuristicPlan({ sentence: "我家做定制百叶窗，免费上门量尺" });
  assert.ok(
    plan.posts.some((post) => post.copy.hook.includes("免费上门量尺") || post.copy.body.includes("免费上门量尺")),
    "商家原话里的优惠应当沿用",
  );
});
