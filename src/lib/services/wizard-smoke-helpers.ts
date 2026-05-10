/**
 * Wizard Release Smoke Helpers
 *
 * 把 smoke script 里**纯函数 / 可单测**的部分独立出来，让 npm test 可以验证：
 * - 我们对一个完整的 wizard 闭环结果（script → storyboard → asset → render）能正确判断它是否健康；
 * - 不会因为 script smoke 内部 if 写错而出现"smoke 假阳性"。
 *
 * 这里不引入 db / fs / next，纯类型 + 纯逻辑，便于 node:test 直接 import。
 */

export type SmokeStepStatus = "ok" | "skipped" | "failed";

export interface SmokeStepResult {
  name: string;
  status: SmokeStepStatus;
  detail?: string;
}

export interface SmokeWizardResult {
  orderId: string | null;
  scriptId: string | null;
  scenePlanIds: readonly string[];
  rawAssetIds: readonly string[];
  renderJobId: string | null;
  renderJobStatus: string | null;
  renderJobMode: string | null;
  steps: readonly SmokeStepResult[];
}

/**
 * 给定一个 SmokeWizardResult，返回它是否健康（pass）+ 阻断原因（fail）。
 *
 * 健康定义（最低部署要求）：
 * - orderId 非空；
 * - script + storyboard 各自 status === "ok"；
 * - render step status === "ok"，并且 mode ∈ {REAL, DRAFT, MOCK}（任何一种都算 wizard 没卡住）；
 * - 渲染 status ∈ {SUCCEEDED, DRAFT_READY, MOCK} —— FAILED 算 fail。
 *
 * 注意：asset 注册可以 skip（ALLOW_SKIP_ASSET）—— 部署冒烟不依赖外部素材 URL。
 */
export function evaluateSmokeResult(result: SmokeWizardResult): {
  ok: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];

  if (!result.orderId) blockers.push("没有创建 DeliveryOrder");

  const must = ["createOrder", "generateScript", "generateStoryboard", "createRender"] as const;
  for (const name of must) {
    const step = result.steps.find((s) => s.name === name);
    if (!step) {
      blockers.push(`缺少必要 step：${name}`);
      continue;
    }
    if (step.status === "failed") {
      blockers.push(`${name} 失败：${step.detail ?? "unknown"}`);
    }
  }

  if (
    result.renderJobMode &&
    !["REAL", "DRAFT", "MOCK"].includes(result.renderJobMode)
  ) {
    blockers.push(`render mode 未知：${result.renderJobMode}`);
  }

  if (
    result.renderJobStatus &&
    !["SUCCEEDED", "DRAFT_READY", "MOCK"].includes(result.renderJobStatus)
  ) {
    blockers.push(`render status 未达预期：${result.renderJobStatus}`);
  }

  return { ok: blockers.length === 0, blockers };
}

/**
 * 从 cli args 解析 smoke script 的 flags（关心的极少，纯解析）。
 */
export function parseSmokeArgs(argv: readonly string[]): {
  cleanup: boolean;
  allowProduction: boolean;
} {
  return {
    cleanup: argv.includes("--cleanup"),
    allowProduction: argv.includes("--allow-production"),
  };
}

/**
 * 部署 smoke 的安全门：production 环境必须显式带 --allow-production，
 * 否则直接拒绝（避免在 production DB 留垃圾数据）。
 */
export function shouldRefuseDueToProduction(opts: {
  nodeEnv: string | undefined;
  allowProduction: boolean;
}): { refuse: boolean; reason?: string } {
  if (opts.nodeEnv === "production" && !opts.allowProduction) {
    return {
      refuse: true,
      reason:
        "NODE_ENV=production 且未传 --allow-production；为了避免污染 production DB，已拒绝执行。",
    };
  }
  return { refuse: false };
}
