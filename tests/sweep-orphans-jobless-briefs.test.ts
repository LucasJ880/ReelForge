import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  FinalVideoStatus,
  VideoBriefStatus,
  VideoDispatchRequestState,
  VideoJobStatus,
} from "@prisma/client";
import { db } from "../src/lib/db";
import { sweepStuckTasks, __test__ as sweepTest } from "../src/lib/services/sweep-service";
import { QUOTA_REFUND_CUTOFF_DEFAULT, quotaRefundCutoff } from "../src/lib/services/quota-refund-service";

/**
 * round 1025 · A1b 清扫新增两段的回归：
 *  2.4 等待合成：查询只筛「分段全成功」并排序；孤儿 FinalVideo 只改状态归档为 FAILED。
 *  2.5 无任务 brief 看门狗：只处理自助派发、本轮之后创建、派发请求已不可能在跑的
 *      brief；内部代运营流程停在 SCENE_PROMPT_READY 的 brief 一律不碰。
 *
 * 全部 monkey-patch Prisma，不触真实 DB，零计费。
 */

function patch(t: TestContext, model: Record<string, unknown>, patches: Record<string, unknown>) {
  const originals: Record<string, unknown> = {};
  for (const key of Object.keys(patches)) {
    originals[key] = model[key];
    model[key] = patches[key];
  }
  t.after(() => {
    for (const key of Object.keys(originals)) model[key] = originals[key];
  });
}

const NOW = new Date("2026-10-27T12:00:00.000Z");
const minutesAgo = (min: number) => new Date(NOW.getTime() - min * 60_000);

/// 其他清扫段的查询全部返回空；任何物理删除都直接判失败（铁律 §4.2）。
function quietOtherSweeps(t: TestContext) {
  const forbidDelete = async () => {
    throw new Error("清扫不得物理删除任何行");
  };
  patch(t, db.videoJob as unknown as Record<string, unknown>, {
    findMany: async () => [],
    delete: forbidDelete,
    deleteMany: forbidDelete,
  });
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async () => [],
    delete: forbidDelete,
    deleteMany: forbidDelete,
  });
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [],
    delete: forbidDelete,
    deleteMany: forbidDelete,
  });
}

/// ---------- 2.4 等待合成 / 孤儿 FinalVideo ----------

test("2.4 等待合成：查询直接筛「至少一段且全部 SUCCEEDED」，按创建时间排序取前 50", async (t) => {
  quietOtherSweeps(t);
  const queries: Array<Record<string, unknown>> = [];
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      queries.push(args);
      return [];
    },
  });

  await sweepStuckTasks(NOW);

  const awaiting = queries.find(
    (args) =>
      JSON.stringify((args.where as Record<string, unknown>).segments) ===
      JSON.stringify(sweepTest.awaitingStitchCandidateWhere().segments),
  );
  assert.ok(awaiting, "等待合成的候选必须在查询层筛「分段全成功」");
  assert.deepEqual((awaiting.where as Record<string, unknown>).segments, {
    some: {},
    every: { status: VideoJobStatus.SUCCEEDED },
  });
  assert.deepEqual(awaiting.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.equal(awaiting.take, 50);
});

test("2.4 孤儿：没有 brief 也没有段、超过一天的 PENDING → 只改状态为 FAILED", async (t) => {
  quietOtherSweeps(t);
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let orphanQuery: Record<string, unknown> | null = null;
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown> }) => {
      const where = args.where;
      if (JSON.stringify(where.segments) !== JSON.stringify({ none: {} })) return [];
      orphanQuery = args as unknown as Record<string, unknown>;
      return [
        { id: "fv-orphan-old", createdAt: minutesAgo(90 * 24 * 60), brief: null, segments: [] },
      ];
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      return { count: 1 };
    },
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.failedOrphanFinalVideos, ["fv-orphan-old"]);
  assert.ok(orphanQuery);
  const where = (orphanQuery as { where: Record<string, unknown> }).where;
  assert.equal(where.status, FinalVideoStatus.PENDING);
  assert.deepEqual(where.brief, { is: null });
  assert.deepEqual(where.createdAt, { lt: minutesAgo(24 * 60) });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].where, { id: "fv-orphan-old", ...sweepTest.orphanFinalVideoWhere() });
  assert.equal(writes[0].data.status, FinalVideoStatus.FAILED);
  assert.deepEqual(
    Object.keys(writes[0].data).sort(),
    ["ffmpegError", "finishedAt", "status", "stitchAttemptToken"],
    "只改状态字段，不动其他数据",
  );
});

test("2.4 孤儿：查询误返回有 brief / 有段 / 未满一天的行时纵深防御跳过", async (t) => {
  quietOtherSweeps(t);
  let writes = 0;
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown> }) => {
      if (JSON.stringify(args.where.segments) !== JSON.stringify({ none: {} })) return [];
      return [
        { id: "has-brief", createdAt: minutesAgo(3000), brief: { id: "b1" }, segments: [] },
        { id: "has-segment", createdAt: minutesAgo(3000), brief: null, segments: [{ id: "j1" }] },
        { id: "too-young", createdAt: minutesAgo(60), brief: null, segments: [] },
      ];
    },
    updateMany: async () => {
      writes += 1;
      return { count: 1 };
    },
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.failedOrphanFinalVideos, []);
  assert.equal(writes, 0);
});

test("2.4 孤儿清扫出错不拖垮既有清扫段（结果照常返回）", async (t) => {
  quietOtherSweeps(t);
  patch(t, db.finalVideo as unknown as Record<string, unknown>, {
    findMany: async (args: { where: Record<string, unknown> }) => {
      if (JSON.stringify(args.where.segments) === JSON.stringify({ none: {} })) {
        throw new Error("transient");
      }
      return [];
    },
  });
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = warn;
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.failedOrphanFinalVideos, []);
});

/// ---------- 2.5 无任务 brief 看门狗 ----------

function joblessBrief(id: string, createdAt: Date, ownerId = "owner-1") {
  return {
    id,
    createdAt,
    contentAngle: { round: { deliveryOrder: { createdById: ownerId } } },
  };
}

/// 按 Prisma JSON path 过滤的语义判断一个订单 productInput 能否被看门狗选中。
function deliveryOrderMatches(productInput: Record<string, unknown> | null): boolean {
  const where = sweepTest.joblessSelfServeBriefWhere() as {
    contentAngle: { round: { deliveryOrder: { AND: Array<{ productInput: { path: string[]; equals: unknown } }> } } };
  };
  return where.contentAngle.round.deliveryOrder.AND.every(({ productInput: filter }) => {
    let value: unknown = productInput;
    for (const key of filter.path) {
      value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    }
    return value === filter.equals;
  });
}

test("2.5 范围：只选自助派发（unified_input + web_app）、两种卡住状态、没有任何任务的 brief", () => {
  const where = sweepTest.joblessSelfServeBriefWhere() as Record<string, unknown>;
  assert.deepEqual(where.status, {
    in: [VideoBriefStatus.SCENE_PROMPT_READY, VideoBriefStatus.RENDER_QUEUED],
  });
  assert.deepEqual(where.videoJobs, { none: {} });

  /// 自助派发路由写入的订单
  assert.equal(
    deliveryOrderMatches({ source: "unified_input", requestOrigin: "web_app", userType: "platform" }),
    true,
  );
  /// 内部代运营流程 / 脚本 / 历史 unified_input / b-roll：一律不碰
  assert.equal(deliveryOrderMatches({ source: "manual_brief" }), false);
  assert.equal(deliveryOrderMatches({ source: "unified_input" }), false, "缺 requestOrigin 的历史脚本写入");
  assert.equal(deliveryOrderMatches({ source: "unified_input", requestOrigin: "script" }), false);
  assert.equal(deliveryOrderMatches({ source: "broll_route", requestOrigin: "web_app" }), false);
  assert.equal(deliveryOrderMatches(null), false);
});

test("2.5 范围：只看本轮上线之后创建、且至少 2 分钟前创建的 brief", async (t) => {
  quietOtherSweeps(t);
  let briefQuery: Record<string, unknown> | null = null;
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      briefQuery = args;
      return [];
    },
  });

  await sweepStuckTasks(NOW);

  assert.ok(briefQuery);
  const where = (briefQuery as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.createdAt, {
    gt: new Date(QUOTA_REFUND_CUTOFF_DEFAULT),
    lt: minutesAgo(2),
  });
  assert.equal(sweepTest.joblessBriefSweepSince().toISOString(), QUOTA_REFUND_CUTOFF_DEFAULT);
  assert.equal(where.status !== undefined && where.videoJobs !== undefined, true);
});

test("2.5 / D1：看门狗起点与按条返还截止线同源——QUOTA_REFUND_CUTOFF 一处设置两处生效", async (t) => {
  const previous = process.env.QUOTA_REFUND_CUTOFF;
  /// 部署早于默认零点：上线时把环境变量设成真实部署时刻
  process.env.QUOTA_REFUND_CUTOFF = "2026-10-24T21:00:00.000Z";
  t.after(() => {
    if (previous === undefined) delete process.env.QUOTA_REFUND_CUTOFF;
    else process.env.QUOTA_REFUND_CUTOFF = previous;
  });
  quietOtherSweeps(t);
  let briefQuery: Record<string, unknown> | null = null;
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async (args: Record<string, unknown>) => {
      briefQuery ??= args;
      return [];
    },
  });

  await sweepStuckTasks(NOW);

  assert.ok(briefQuery);
  const where = (briefQuery as { where: Record<string, unknown> }).where;
  const deployedAt = new Date("2026-10-24T21:00:00.000Z");
  assert.deepEqual(
    where.createdAt,
    { gt: deployedAt, lt: minutesAgo(2) },
    "部署到零点之间创建的无任务 brief 也要被看门狗收口",
  );
  assert.equal(sweepTest.joblessBriefSweepSince().toISOString(), deployedAt.toISOString());
  assert.equal(quotaRefundCutoff().toISOString(), deployedAt.toISOString(), "返还截止线读同一个值");
});

test("2.5：比路由执行上限还老的无任务 brief → RENDER_FAILED（不必再查派发请求）", async (t) => {
  quietOtherSweeps(t);
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let requestLookups = 0;
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [joblessBrief("brief-stale", minutesAgo(20))],
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      writes.push(args);
      return { count: 1 };
    },
  });
  patch(t, db.videoDispatchRequest as unknown as Record<string, unknown>, {
    count: async () => {
      requestLookups += 1;
      return 1;
    },
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.failedJoblessBriefs, ["brief-stale"]);
  assert.equal(requestLookups, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].where, {
    id: "brief-stale",
    ...sweepTest.joblessSelfServeBriefWhere(),
  }, "写入时 CAS：状态未变、仍然零任务、仍是自助派发");
  assert.equal(writes[0].data.status, VideoBriefStatus.RENDER_FAILED);
  assert.equal(writes[0].data.errorMessage, sweepTest.JOBLESS_BRIEF_FAILED_MESSAGE);
  assert.deepEqual(Object.keys(writes[0].data).sort(), ["errorMessage", "status"]);
});

test("2.5：派发请求可能还在跑（同用户、窗口内仍 PROCESSING）→ 不碰", async (t) => {
  quietOtherSweeps(t);
  const lookups: Array<Record<string, unknown>> = [];
  let writes = 0;
  const createdAt = minutesAgo(5);
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [joblessBrief("brief-inflight", createdAt, "owner-9")],
    updateMany: async () => {
      writes += 1;
      return { count: 1 };
    },
  });
  patch(t, db.videoDispatchRequest as unknown as Record<string, unknown>, {
    count: async (args: { where: Record<string, unknown> }) => {
      lookups.push(args.where);
      return 1;
    },
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.failedJoblessBriefs, []);
  assert.equal(writes, 0);
  assert.deepEqual(lookups, [
    {
      userId: "owner-9",
      state: VideoDispatchRequestState.PROCESSING,
      createdAt: {
        gte: new Date(createdAt.getTime() - 900_000),
        lte: createdAt,
      },
    },
  ]);
});

test("2.5：派发请求已写回终态（窗口内没有 PROCESSING）→ 不必等满路由上限", async (t) => {
  quietOtherSweeps(t);
  let writes = 0;
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [joblessBrief("brief-settled", minutesAgo(5))],
    updateMany: async () => {
      writes += 1;
      return { count: 1 };
    },
  });
  patch(t, db.videoDispatchRequest as unknown as Record<string, unknown>, {
    count: async () => 0,
  });

  const result = await sweepStuckTasks(NOW);

  assert.deepEqual(result.failedJoblessBriefs, ["brief-settled"]);
  assert.equal(writes, 1);
});

test("2.5：CAS 落空（期间已建出任务或状态已变）不计入结果", async (t) => {
  quietOtherSweeps(t);
  patch(t, db.videoBrief as unknown as Record<string, unknown>, {
    findMany: async () => [joblessBrief("brief-raced", minutesAgo(30))],
    updateMany: async () => ({ count: 0 }),
  });

  const result = await sweepStuckTasks(NOW);
  assert.deepEqual(result.failedJoblessBriefs, []);
});

test("2.5：给客户的原因是人话，不含内部术语", async () => {
  const { containsBannedPersonalTerm } = await import(
    "../src/lib/video-generation/personal-status"
  );
  assert.equal(containsBannedPersonalTerm(sweepTest.JOBLESS_BRIEF_FAILED_MESSAGE), false);
  assert.doesNotMatch(sweepTest.JOBLESS_BRIEF_FAILED_MESSAGE, /brief|dispatch|Shuyu|VideoJob/i);
});
