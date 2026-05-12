import assert from "node:assert/strict";
import test from "node:test";
import { AngleType, RoundStatus } from "@prisma/client";
import {
  SINGLE_DIRECTION_ANGLE_TITLE,
  ensureSingleDirectionRoundWith,
  type SingleDirectionDBClient,
} from "../src/lib/services/angle-service";

/**
 * 单创意方向 Round 幂等性测试 —— 不依赖真实 Prisma。
 *
 * 验证契约：
 * 1. 第一次调用：创建 Round{ optimizationSlots:1, explorationSlots:0 } + 1 ContentAngle
 * 2. 第二次调用（同一 deliveryOrderId）：直接返回同一 roundId / angleId，不写库
 * 3. 创建出的 Round.optimizationSlots = 1, explorationSlots = 0（绝不创建赛马 5 槽）
 * 4. ContentAngle 标题等于 SINGLE_DIRECTION_ANGLE_TITLE，便于 wizard-script-service 复用
 */

interface FakeRoundRow {
  id: string;
  deliveryOrderId: string;
  roundIndex: number;
  optimizationSlots: number;
  explorationSlots: number;
  angles: FakeAngleRow[];
}

interface FakeAngleRow {
  id: string;
  roundId: string;
  sortOrder: number;
  title: string;
  type: AngleType;
}

class FakeDB implements SingleDirectionDBClient {
  rounds: FakeRoundRow[] = [];
  angles: FakeAngleRow[] = [];
  /// 记录写入次数，便于断言「第二次调用没有任何写入」
  writeCounts = { round: 0, angle: 0, transactions: 0 };
  private idSeq = 0;

  private nextId(prefix: string) {
    this.idSeq += 1;
    return `${prefix}_${this.idSeq}`;
  }

  round = {
    findFirst: async (args: {
      where: { deliveryOrderId: string };
    }) => {
      const matches = this.rounds
        .filter((r) => r.deliveryOrderId === args.where.deliveryOrderId)
        .sort((a, b) => a.roundIndex - b.roundIndex);
      const r = matches[0];
      if (!r) return null;
      const angles = [...r.angles]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 1);
      return { id: r.id, angles: angles.map((a) => ({ id: a.id })) };
    },
    create: async (args: {
      data: {
        deliveryOrderId: string;
        roundIndex: number;
        status: RoundStatus;
        optimizationSlots: number;
        explorationSlots: number;
      };
    }) => {
      this.writeCounts.round += 1;
      const id = this.nextId("round");
      const row: FakeRoundRow = {
        id,
        deliveryOrderId: args.data.deliveryOrderId,
        roundIndex: args.data.roundIndex,
        optimizationSlots: args.data.optimizationSlots,
        explorationSlots: args.data.explorationSlots,
        angles: [],
      };
      this.rounds.push(row);
      return { id };
    },
  };

  contentAngle = {
    create: async (args: {
      data: {
        roundId: string;
        sortOrder: number;
        type: AngleType;
        title: string;
        hook: string | null;
        narrative: string;
      };
    }) => {
      this.writeCounts.angle += 1;
      const id = this.nextId("angle");
      const row: FakeAngleRow = {
        id,
        roundId: args.data.roundId,
        sortOrder: args.data.sortOrder,
        title: args.data.title,
        type: args.data.type,
      };
      this.angles.push(row);
      const round = this.rounds.find((r) => r.id === args.data.roundId);
      if (round) round.angles.push(row);
      return { id };
    },
  };

  async $transaction<T>(fn: (tx: SingleDirectionDBClient) => Promise<T>): Promise<T> {
    this.writeCounts.transactions += 1;
    /// 简单实现：把自己当作 tx 传回去（无真实事务回滚，单元测试足够）
    return fn(this);
  }
}

test("ensureSingleDirectionRound: 第一次调用创建 Round{1+0} + 1 ContentAngle", async () => {
  const fakeDb = new FakeDB();
  const result = await ensureSingleDirectionRoundWith("order_1", fakeDb);

  assert.equal(result.created, true);
  assert.ok(result.roundId.startsWith("round_"));
  assert.ok(result.angleId.startsWith("angle_"));

  /// 写入计数：1 round + 1 angle，且整体在 transaction 内
  assert.equal(fakeDb.writeCounts.round, 1);
  assert.equal(fakeDb.writeCounts.angle, 1);
  assert.equal(fakeDb.writeCounts.transactions, 1);

  /// 关键断言：optimizationSlots=1, explorationSlots=0（不进赛马）
  const round = fakeDb.rounds[0]!;
  assert.equal(round.optimizationSlots, 1);
  assert.equal(round.explorationSlots, 0);
  assert.equal(round.roundIndex, 1);

  /// ContentAngle 标题等于共享常量（便于 wizard-script-service 复用判别）
  const angle = fakeDb.angles[0]!;
  assert.equal(angle.title, SINGLE_DIRECTION_ANGLE_TITLE);
  assert.equal(angle.type, AngleType.OPTIMIZATION);
  assert.equal(angle.sortOrder, 1);
});

test("ensureSingleDirectionRound: 幂等 —— 第二次调用返回同一 ID，不写库", async () => {
  const fakeDb = new FakeDB();
  const first = await ensureSingleDirectionRoundWith("order_1", fakeDb);
  const writesAfterFirst = { ...fakeDb.writeCounts };

  const second = await ensureSingleDirectionRoundWith("order_1", fakeDb);

  assert.equal(second.roundId, first.roundId, "复用同一 roundId");
  assert.equal(second.angleId, first.angleId, "复用同一 angleId");
  assert.equal(second.created, false, "第二次调用不应该 created=true");

  /// 第二次不应该有任何写入
  assert.deepEqual(fakeDb.writeCounts, writesAfterFirst);
});

test("ensureSingleDirectionRound: 不会创建赛马 5 angle —— 即使被连续调用 5 次", async () => {
  const fakeDb = new FakeDB();
  for (let i = 0; i < 5; i++) {
    await ensureSingleDirectionRoundWith("order_1", fakeDb);
  }
  assert.equal(fakeDb.angles.length, 1, "5 次调用累计只创建 1 个 ContentAngle");
  assert.equal(fakeDb.rounds.length, 1, "5 次调用累计只创建 1 个 Round");
});

test("ensureSingleDirectionRound: 跨 deliveryOrder 隔离 —— 不同 order 各自独立创建", async () => {
  const fakeDb = new FakeDB();
  const a = await ensureSingleDirectionRoundWith("order_a", fakeDb);
  const b = await ensureSingleDirectionRoundWith("order_b", fakeDb);

  assert.notEqual(a.roundId, b.roundId);
  assert.notEqual(a.angleId, b.angleId);
  assert.equal(fakeDb.rounds.length, 2);
  assert.equal(fakeDb.angles.length, 2);
});

test("ensureSingleDirectionRound: 已有 Round（admin 创建）但没 angle → 在该 Round 上补一条 angle", async () => {
  const fakeDb = new FakeDB();
  /// 模拟 admin 流程已经建过一个 5 槽 Round 但还没生成 angles 的中间态
  fakeDb.rounds.push({
    id: "round_admin_1",
    deliveryOrderId: "order_admin",
    roundIndex: 1,
    optimizationSlots: 3,
    explorationSlots: 2,
    angles: [],
  });

  const r = await ensureSingleDirectionRoundWith("order_admin", fakeDb);
  assert.equal(r.roundId, "round_admin_1", "复用 admin 已建好的 Round");
  assert.equal(r.created, true, "因为新建了 angle，所以 created=true");
  assert.equal(fakeDb.angles.length, 1);

  /// 注意：我们**不**修改 admin Round 的 5 槽位（避免破坏赛马设定），
  /// 只是在它上面挂一条 wizard angle
  assert.equal(fakeDb.rounds[0]!.optimizationSlots, 3);
  assert.equal(fakeDb.rounds[0]!.explorationSlots, 2);
});
