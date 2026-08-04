import { z } from "zod";
import { db } from "@/lib/db";
import {
  getShuyuPrices,
  isAuditedShuyuVideoPlan,
  resolveShuyuVideoPlan,
  shuyuPriceSchema,
  shuyuVideoPlanPointsForDuration,
  SHUYU_VIDEO_MODEL,
} from "@/lib/providers/shuyu";

/**
 * C1 · 能力探测（PRD §6 / M7）。
 *
 * 与存活探测的区别：health 只回答「接口通不通」，回答不了
 * 「套餐 ID 换了没有」「分辨率降了没有」「音频能力还在不在」——
 * 0728 套餐轮换、0729 线路崩溃都栽在这个盲区。
 *
 * 探测的产出是**逐字段的漂移诊断**，不是一个布尔值：
 * 「audited plan 没找到」没法行动，「sale_points 从 900 变成 1200」才能行动。
 */

type ShuyuPlan = z.infer<typeof shuyuPriceSchema>;

export type CapabilityDrift = {
  field: string;
  expected: string;
  actual: string;
};

export type ProbeResult = {
  provider: "shuyu";
  ok: boolean;
  /// 契约完全匹配的套餐（正常时恰好一个）
  auditedPlanFound: boolean;
  drifts: CapabilityDrift[];
  /// 上游完全没返回 video 套餐时为 true —— 这是最严重的一档
  videoPlansGone: boolean;
  probedAt: Date;
};

/** 期望契约，与 auditShuyuVideoPlan 的语义判据一一对应(0803 起不钉 plan_id/单价)。 */
const EXPECTED: Array<{
  field: string;
  expected: string;
  actual: (plan: ShuyuPlan) => string;
  matches: (plan: ShuyuPlan) => boolean;
}> = [
  {
    field: "model",
    expected: SHUYU_VIDEO_MODEL,
    actual: (plan) => plan.model,
    matches: (plan) => plan.model === SHUYU_VIDEO_MODEL,
  },
  {
    field: "unit",
    expected: "generation 或 second",
    actual: (plan) => plan.unit,
    matches: (plan) => plan.unit === "generation" || plan.unit === "second",
  },
  {
    field: "resolution",
    expected: "720P 或 480P",
    actual: (plan) => plan.resolution,
    matches: (plan) =>
      plan.resolution === "720P" || plan.resolution === "480P",
  },
  {
    /// 计价漂移最危险:实际扣分随 /prices 走,这里只守健全区间——
    /// 越界(疯涨/疑似错价)会让审计不过并阻断线路,而不是照单扣。
    field: "sale_points",
    expected: "按条 100-2000 / 按秒 10-300",
    actual: (plan) => `${plan.sale_points}/${plan.unit}`,
    matches: (plan) =>
      plan.unit === "generation"
        ? plan.sale_points >= 100 && plan.sale_points <= 2_000
        : plan.sale_points >= 10 && plan.sale_points <= 300,
  },
  {
    field: "status",
    expected: "available",
    actual: (plan) => plan.status,
    matches: (plan) => plan.status === "available",
  },
  {
    /// 审计契约要求 9:16 / 16:9 / 1:1 三个画幅齐全。
    field: "aspect_ratios",
    expected: "包含 9:16、16:9 与 1:1",
    actual: (plan) => plan.capabilities.aspect_ratios.join(","),
    matches: (plan) =>
      plan.capabilities.aspect_ratios.includes("9:16") &&
      plan.capabilities.aspect_ratios.includes("16:9") &&
      plan.capabilities.aspect_ratios.includes("1:1"),
  },
  {
    field: "input_images_max",
    expected: ">= 9",
    actual: (plan) => String(plan.capabilities.input_images_max),
    matches: (plan) => plan.capabilities.input_images_max >= 9,
  },
  {
    /// 0728 的另一个坑：durations 里 15s 被下线，health 查不出来。
    field: "modes",
    expected: "含 text2video 与 image2video",
    actual: (plan) => plan.capabilities.modes?.join(",") ?? "(缺失)",
    matches: (plan) =>
      (plan.capabilities.modes?.includes("text2video") ?? false) &&
      (plan.capabilities.modes?.includes("image2video") ?? false),
  },
  {
    field: "durations",
    expected: "含 15s",
    actual: (plan) => plan.capabilities.durations?.join(",") ?? "(缺失)",
    matches: (plan) => plan.capabilities.durations?.includes(15) ?? false,
  },
  {
    field: "quality",
    expected: "与 resolution 一致或缺省",
    actual: (plan) => plan.capabilities.quality ?? "(缺省)",
    matches: (plan) =>
      plan.capabilities.quality === undefined ||
      plan.capabilities.quality === plan.resolution,
  },
];

/**
 * 探测判据必须与 isAuditedShuyuVideoPlan **一一对应**：
 * 判据比审计松会出现「审计不过但报不出漂移」，比审计紧会报假漂移。
 * 有测试拿完整契约套餐同时过两者来守住这一点。
 */

/**
 * 对比「最像的那个 video 套餐」逐字段找漂移。
 *
 * 为什么不只对比 plan_id 相同的：0728 的事故正是套餐 ID 轮换 ——
 * ID 变了但同型号套餐还在。按 model 找最近的候选，才能报出
 * 「plan_id 从 X 变成 Y」而不是「什么都没找到」。
 */
export function diagnoseDrift(plans: ShuyuPlan[]): {
  auditedPlanFound: boolean;
  videoPlansGone: boolean;
  drifts: CapabilityDrift[];
} {
  const videoPlans = plans.filter((plan) => plan.kind === "video");
  if (videoPlans.length === 0) {
    return {
      auditedPlanFound: false,
      videoPlansGone: true,
      drifts: [
        {
          field: "kind=video",
          expected: "至少一个 video 套餐",
          actual: "上游一个都没返回",
        },
      ],
    };
  }

  if (videoPlans.some((plan) => isAuditedShuyuVideoPlan(plan))) {
    return { auditedPlanFound: true, videoPlansGone: false, drifts: [] };
  }

  /// 找最像的候选：先按 model 家族，最后拿第一个(plan_id 轮换是常态,不参与匹配)。
  const candidate =
    videoPlans.find((plan) => plan.model === SHUYU_VIDEO_MODEL) ??
    videoPlans[0];

  const drifts = EXPECTED.filter((check) => !check.matches(candidate)).map(
    (check) => ({
      field: check.field,
      expected: check.expected,
      actual: check.actual(candidate),
    }),
  );

  return { auditedPlanFound: false, videoPlansGone: false, drifts };
}

export async function probeShuyuCapabilities(): Promise<ProbeResult> {
  const probedAt = new Date();
  let plans: ShuyuPlan[] = [];
  let fetchError: string | null = null;
  try {
    plans = (await getShuyuPrices()).data;
  } catch (err) {
    fetchError = (err as Error).message;
  }

  const diagnosis = fetchError
    ? {
        auditedPlanFound: false,
        videoPlansGone: true,
        drifts: [
          { field: "prices接口", expected: "可访问", actual: fetchError.slice(0, 200) },
        ],
      }
    : diagnoseDrift(plans);

  const result: ProbeResult = {
    provider: "shuyu",
    ok: diagnosis.auditedPlanFound,
    ...diagnosis,
    probedAt,
  };

  /// 每次探测都落库：漂移要在**事故前**被看见，靠的是探测历史，
  /// 不是事故后翻日志。
  await db.capabilityProbe.create({
    data: {
      provider: result.provider,
      ok: result.ok,
      auditedPlanFound: result.auditedPlanFound,
      videoPlansGone: result.videoPlansGone,
      driftsJson: result.drifts.length
        ? (result.drifts as unknown as object)
        : undefined,
      probedAt,
    },
  });

  if (!result.ok) {
    /// 告警走 stderr（Vercel 日志告警规则抓它）。降级本身由
    /// route discovery 的 contractMatches=false 完成，这里不重复做。
    console.error(
      `[capability-probe] Shuyu 能力漂移：${JSON.stringify(result.drifts)}`,
    );
  }
  return result;
}

/** 用户侧一句话：当前线路与预计消耗（PRD C1 的另一半）。 */
export async function currentRouteSummary(): Promise<string> {
  const latest = await db.capabilityProbe.findFirst({
    where: { provider: "shuyu" },
    orderBy: { probedAt: "desc" },
  });
  if (!latest || latest.ok) {
    /// 报价随 /prices 实时解析;解析不到时不编数字。
    try {
      const plan = await resolveShuyuVideoPlan();
      return `当前线路：Shuyu ${plan.model} · 每条约 ${shuyuVideoPlanPointsForDuration(plan, 15)} 积分`;
    } catch {
      return "当前线路：Shuyu studio-video";
    }
  }
  return "主线路能力异常，已自动切换备用线路；生成可能稍慢";
}
