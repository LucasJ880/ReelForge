/**
 * 付费实验的预算闸（X-SCAF-1 / X-SCAF-8 共用）。
 *
 * 规则只有一条：**先估算、再比上限、再比余额，三关都过才花钱**。估算用的单价必须来自
 * 实时价目（Shuyu /prices 审计结果，或调用方显式给的 USD 单价），不再用 900 点/条之类的常量——
 * 套餐与单价会整体轮换，用旧常量估算会让闸门要么误放、要么误拦。
 *
 * 纯函数：不读 env、不触网，便于单测。
 */

/** 路线图 §8：Shuyu 账户的预留线（≈7k 点），实验与验收都不碰。 */
export const SHUYU_RESERVE_POINTS_DEFAULT = 7_000;

export interface SpendLine {
  /** 臂 / 线路标识（报告与幂等键里用的同一个字符串）。 */
  armId: string;
  /** 本臂要出的条数。 */
  count: number;
  /** 单条积分（Shuyu 实时价 × 时长）；null = 未定价。 */
  unitPoints: number | null;
  /** 单条美元成本；null = 该臂不按美元计或未定价。 */
  unitUsd: number | null;
}

export interface SpendEstimate {
  totalPoints: number;
  totalUsd: number;
  /** 单价未知（积分与美元都是 null）的臂；有任何一个都不许花钱。 */
  unpricedArms: string[];
  /** 单条最贵的积分（用于余额余量提示）。 */
  maxUnitPoints: number;
  lines: Array<SpendLine & { points: number; usd: number }>;
}

export function estimateSpend(lines: ReadonlyArray<SpendLine>): SpendEstimate {
  let totalPoints = 0;
  let totalUsd = 0;
  let maxUnitPoints = 0;
  const unpricedArms: string[] = [];
  const out: SpendEstimate["lines"] = [];
  for (const line of lines) {
    if (line.count <= 0) {
      out.push({ ...line, points: 0, usd: 0 });
      continue;
    }
    if (line.unitPoints === null && line.unitUsd === null) {
      if (!unpricedArms.includes(line.armId)) unpricedArms.push(line.armId);
    }
    const points = (line.unitPoints ?? 0) * line.count;
    const usd = (line.unitUsd ?? 0) * line.count;
    totalPoints += points;
    totalUsd += usd;
    if (line.unitPoints !== null) maxUnitPoints = Math.max(maxUnitPoints, line.unitPoints);
    out.push({ ...line, points, usd });
  }
  return {
    totalPoints,
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    unpricedArms,
    maxUnitPoints,
    lines: out,
  };
}

export interface BudgetGateInput {
  estimate: SpendEstimate;
  /** 积分硬上限；有积分支出时必填。 */
  maxPoints: number | null;
  /** 美元硬上限；有美元支出时必填。 */
  maxUsd: number | null;
  /** Shuyu 实时可用积分；有积分支出时必填（null = 没查到 → 拒绝）。 */
  availablePoints: number | null;
  /** 预留线，余额扣完本轮后不得低于它。 */
  reservePoints: number;
}

export interface BudgetGateResult {
  ok: boolean;
  reasons: string[];
}

export function checkBudgetGate(input: BudgetGateInput): BudgetGateResult {
  const { estimate } = input;
  const reasons: string[] = [];
  if (estimate.unpricedArms.length > 0) {
    reasons.push(`以下臂没有实时单价，拒绝花钱：${estimate.unpricedArms.join(", ")}`);
  }
  if (estimate.totalPoints > 0) {
    if (input.maxPoints === null) {
      reasons.push(`本轮预估 ${estimate.totalPoints} 点，但没给积分硬上限（--max-points / *_MAX_POINTS）`);
    } else if (estimate.totalPoints > input.maxPoints) {
      reasons.push(`本轮预估 ${estimate.totalPoints} 点 > 硬上限 ${input.maxPoints} 点`);
    }
    if (input.availablePoints === null) {
      reasons.push("没拿到 Shuyu 实时余额，拒绝花钱");
    } else if (input.availablePoints - estimate.totalPoints < input.reservePoints) {
      reasons.push(
        `余额 ${input.availablePoints} − 预估 ${estimate.totalPoints} = ${
          input.availablePoints - estimate.totalPoints
        } 点，低于预留线 ${input.reservePoints} 点`,
      );
    }
  }
  if (estimate.totalUsd > 0) {
    if (input.maxUsd === null) {
      reasons.push(`本轮预估 $${estimate.totalUsd}，但没给美元硬上限`);
    } else if (estimate.totalUsd > input.maxUsd) {
      reasons.push(`本轮预估 $${estimate.totalUsd} > 硬上限 $${input.maxUsd}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** 解析正数上限（env / CLI 字符串）；空、非数、≤0 一律 null（= 没给上限）。 */
export function parsePositiveLimit(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}
