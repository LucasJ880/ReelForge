import { z } from "zod";
import { db } from "@/lib/db";
import {
  getShuyuBalance,
  getShuyuPrices,
  auditShuyuVideoPlan,
  isShuyuVideoPlanInLane,
  listAuditedShuyuVideoPlans,
  shuyuDefaultVideoLane,
  shuyuVideoLaneLabel,
  ShuyuApiError,
  shuyuApiKey,
  shuyuPriceSchema,
  shuyuVideoPlanFamily,
  shuyuVideoPlanPointsForDuration,
  shuyuVideoPlanResolution,
  shuyuVideoPlanSalePointsWithinBounds,
  shuyuVideoPlanTier,
  SHUYU_MIN_REFERENCE_IMAGES,
  SHUYU_VIDEO_MODEL,
} from "@/lib/providers/shuyu";
import { parseShuyuCatalog } from "@/lib/providers/shuyu-catalog";
import { detectShuyuSeedance25 } from "@/lib/providers/shuyu-seedance25-probe";
import { openAiProbePlan, openAiTokenLimitParam } from "@/lib/ai/providers/openai-provider";
import { resolveTtsProviderId, type TtsProviderId } from "@/lib/providers/tts/config";
import { ELEVENLABS_API_BASE, resolveElevenLabsTtsModel } from "@/lib/providers/tts/elevenlabs";
import { OPENAI_TTS_ENDPOINT, OPENAI_TTS_MODEL } from "@/lib/providers/tts/openai";
import { resolveTtsVoice } from "@/lib/providers/tts/voices";
import { classifyHttpStatus, classifyNetworkError, safeNote } from "@/lib/capabilities/classify";
import {
  isFailingStatus,
  type CapabilityDetail,
  type CapabilityKey,
  type CapabilityObservation,
  type CapabilityReason,
  type CapabilityRecord,
  type CapabilitySource,
  type CapabilityStatus,
} from "@/lib/capabilities/registry";
import {
  capabilityConfiguration,
  defaultCapabilityStore,
  recordCapabilityObservations,
  type CapabilityStore,
} from "@/lib/services/capability-status-service";

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

/** C4：/prices 里与能力状态相关的摘要（图像线路还在不在、一条视频 / 一张图最少多少积分）。 */
export type ShuyuCatalogSummary = {
  imagePlanCount: number;
  cheapestImagePoints: number | null;
  cheapestVideo15sPoints: number | null;
  /// X-SCAF-4：价目表里是否出现 Seedance 2.5 档（E7′ 触发器）。这里拿到的是严格解析后的套餐，
  /// 只能认出 display_name / model 含「2.5」且 durations ≤15 的条目；带 30s 的新档会让严格解析整体
  /// 失败（落在 fetchError），完整信号由 route-truth-table 读原始 /prices 给出。
  seedance25?: { detected: boolean; candidatePlanIds: string[] };
};

export type ProbeResult = {
  provider: "shuyu";
  ok: boolean;
  /// 默认档(draft:720P/480P)里有审计通过的套餐。只剩 final 档(1080P)算 false:
  /// 默认解析在 draft 内取不到套餐,等于默认线路停机。
  auditedPlanFound: boolean;
  drifts: CapabilityDrift[];
  /// 上游完全没返回 video 套餐时为 true —— 这是最严重的一档
  videoPlansGone: boolean;
  probedAt: Date;
  /// C4：图像套餐与计价摘要；/prices 拿不到时为 null
  catalog?: ShuyuCatalogSummary | null;
  /// C4：/prices 失败的分类（未配置 / key 被拒 / 欠费 / 超时…），给能力状态挑原因
  fetchError?: { code: string | null; httpStatus: number | null } | null;
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
    field: "family",
    expected: "display_name 属 Seedance 2.0 / 2.5",
    actual: (plan) => plan.display_name,
    matches: (plan) => shuyuVideoPlanFamily(plan.display_name) !== null,
  },
  {
    field: "unit",
    expected: "generation 或 second",
    actual: (plan) => plan.unit,
    matches: (plan) => plan.unit === "generation" || plan.unit === "second",
  },
  {
    /// 1026(P03-A1)起 1080P 入审计族(final 档);4K 仍出族。白名单与审计同一个函数。
    field: "resolution",
    expected: "720P、480P 或 1080P",
    actual: (plan) => plan.resolution,
    matches: (plan) => shuyuVideoPlanResolution(plan.resolution) !== null,
  },
  {
    /// 默认档必须在:只剩 1080P(final)时默认解析取不到套餐,等于默认线路停机。
    /// 分辨率出族时交给上面的 resolution 判据报,这里不重复。
    field: "tier",
    expected: "draft 档(720P/480P)至少一个;1080P 只是 final 档",
    actual: (plan) => {
      const resolution = shuyuVideoPlanResolution(plan.resolution);
      return resolution ? shuyuVideoPlanTier(resolution) : plan.resolution;
    },
    matches: (plan) => {
      const resolution = shuyuVideoPlanResolution(plan.resolution);
      return resolution === null || shuyuVideoPlanTier(resolution) === "draft";
    },
  },
  {
    /// 计价漂移最危险:实际扣分随 /prices 走,这里只守健全区间——
    /// 越界(疯涨/疑似错价)会让审计不过并阻断线路,而不是照单扣。
    /// 区间按分辨率分区,与审计共用 shuyuVideoPlanPointBounds(同一把尺子);
    /// 分辨率出族时交给 resolution 判据单独报,这里直接算匹配,不叠一个无意义的计价漂移。
    field: "sale_points",
    expected:
      "720P/480P 按条 100-2000 / 按秒 10-300;1080P 按条 100-8000 / 按秒 100-400",
    actual: (plan) => `${plan.sale_points}/${plan.unit}`,
    matches: (plan) => {
      const resolution = shuyuVideoPlanResolution(plan.resolution);
      if (resolution === null) return true;
      return shuyuVideoPlanSalePointsWithinBounds(resolution, plan.unit, plan.sale_points);
    },
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
    /// 与审计共用同一个常量：此前探测要求 ≥9、审计只要 ≥4，
    /// 4 图套餐会被报成「漂移」却照常放行，两把尺子互相打架。
    field: "input_images_max",
    expected: `>= ${SHUYU_MIN_REFERENCE_IMAGES}`,
    actual: (plan) => String(plan.capabilities.input_images_max),
    matches: (plan) =>
      plan.capabilities.input_images_max >= SHUYU_MIN_REFERENCE_IMAGES,
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
 * 探测判据必须与 isAuditedShuyuDraftVideoPlan **一一对应**(审计 + 默认档)：
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

  /// 默认线路(2.5 · 1080P)的档也算找到默认档:它在 draft 之外,但正是默认解析会取的档。
  const lane = shuyuDefaultVideoLane();
  const isDefaultCandidate = (plan: ShuyuPlan) => {
    const audited = auditShuyuVideoPlan(plan);
    return audited !== null && (audited.tier === "draft" || isShuyuVideoPlanInLane(audited, lane));
  };
  if (videoPlans.some(isDefaultCandidate)) {
    return { auditedPlanFound: true, videoPlansGone: false, drifts: [] };
  }

  /// 找最像的候选：先按 model 家族里的 draft 分辨率(默认档的候选最该被诊断),
  /// 再按 model 家族,最后拿第一个(plan_id 轮换是常态,不参与匹配)。
  /// 1027 起同一个 model 下混着多家模型,家族相同的候选优先(否则会去诊断 Kling)。
  const sameFamily = videoPlans.filter(
    (plan) => shuyuVideoPlanFamily(plan.display_name) !== null,
  );
  const pool = sameFamily.length > 0 ? sameFamily : videoPlans;
  const candidate =
    pool.find((plan) => {
      const resolution = shuyuVideoPlanResolution(plan.resolution);
      return (
        plan.model === SHUYU_VIDEO_MODEL &&
        resolution !== null &&
        shuyuVideoPlanTier(resolution) === "draft"
      );
    }) ??
    pool.find((plan) => plan.model === SHUYU_VIDEO_MODEL) ??
    pool[0];

  const drifts = EXPECTED.filter((check) => !check.matches(candidate)).map(
    (check) => ({
      field: check.field,
      expected: check.expected,
      actual: check.actual(candidate),
    }),
  );

  return { auditedPlanFound: false, videoPlansGone: false, drifts };
}

/** C4：从 /prices 里摘出图像线路与最低计价（图像套餐不存在 → 产品图与故事板暂停）。 */
export function summarizeShuyuCatalog(plans: ShuyuPlan[]): ShuyuCatalogSummary {
  let imagePoints: number[] = [];
  try {
    imagePoints = parseShuyuCatalog({ data: plans }).imagePlans.map((plan) => plan.points);
  } catch {
    imagePoints = [];
  }
  /// 「一条视频最少多少积分」按默认解析会取的那一组档算:默认线路在场就看线路,
  /// 缺席才看 draft 档(其余 final 档对客户不可选,不进能力口径)。
  const lane = shuyuDefaultVideoLane();
  const audited = listAuditedShuyuVideoPlans(plans.filter((plan) => plan.kind === "video"), lane);
  const lanePlans = audited.filter((plan) => isShuyuVideoPlanInLane(plan, lane));
  const videoPoints = (lanePlans.length > 0 ? lanePlans : audited.filter((plan) => plan.tier === "draft"))
    .map((plan) => shuyuVideoPlanPointsForDuration(plan, 15));
  const seedance25 = detectShuyuSeedance25(plans);
  return {
    imagePlanCount: imagePoints.length,
    cheapestImagePoints: imagePoints.length ? Math.min(...imagePoints) : null,
    cheapestVideo15sPoints: videoPoints.length ? Math.min(...videoPoints) : null,
    seedance25: {
      detected: seedance25.detected,
      candidatePlanIds: seedance25.candidates.map((candidate) => candidate.planId ?? "?"),
    },
  };
}

export async function probeShuyuCapabilities(
  deps: { getPrices?: () => Promise<{ data: ShuyuPlan[] }> } = {},
): Promise<ProbeResult> {
  const probedAt = new Date();
  let plans: ShuyuPlan[] = [];
  let fetchError: string | null = null;
  let fetchErrorInfo: ProbeResult["fetchError"] = null;
  try {
    plans = (await (deps.getPrices ?? (() => getShuyuPrices()))()).data;
  } catch (err) {
    fetchError = (err as Error).message;
    fetchErrorInfo = {
      code: err instanceof ShuyuApiError ? err.code : null,
      httpStatus: err instanceof ShuyuApiError ? (err.httpStatus ?? null) : null,
    };
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
  /// 默认线路缺席不判停机(默认解析回落 draft),但要留痕:成片在被静默降回旧档。
  const lane = shuyuDefaultVideoLane();
  if (
    !fetchError &&
    lane &&
    !listAuditedShuyuVideoPlans(plans.filter((plan) => plan.kind === "video"), lane).some((plan) =>
      isShuyuVideoPlanInLane(plan, lane),
    )
  ) {
    diagnosis.drifts = [
      ...diagnosis.drifts,
      { field: "lane", expected: shuyuVideoLaneLabel(lane), actual: "价目表无审计通过的档,默认解析已回落 draft" },
    ];
  }

  const result: ProbeResult = {
    provider: "shuyu",
    ok: diagnosis.auditedPlanFound,
    ...diagnosis,
    probedAt,
    catalog: fetchError ? null : summarizeShuyuCatalog(plans),
    fetchError: fetchErrorInfo,
  };

  /// 每次探测都落库：漂移要在**事故前**被看见，靠的是探测历史，
  /// 不是事故后翻日志。历史写失败只记日志：探测结论照常返回，后面的能力状态探测照常跑。
  try {
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
  } catch (err) {
    console.error("[capability-probe] 探测历史落库失败（结论照常返回）：", (err as Error).message);
  }

  if (!result.ok) {
    /// 告警走 stderr（Vercel 日志告警规则抓它）。降级本身由
    /// route discovery 的 contractMatches=false 完成，这里不重复做。
    console.error(
      `[capability-probe] Shuyu 能力漂移：${JSON.stringify(result.drifts)}`,
    );
  }
  return result;
}

/* ════════════════════════════════════════════════════════════════════
 * C4 · 全能力探测：每小时一轮，把每个能力的结论写进 CapabilityStatus。
 *
 * 只做免费或近乎免费的探测（与 scripts/e2e-1025/route-truth-table.ts 同一批端点）：
 *  - text / vision：1 token 的 chat completion（额度用完 429 insufficient_quota → 暂停）
 *  - voice：1 个字符的 TTS，**每 24 小时最多一次**（其余时间沿用上一条；?force=1 可强制）
 *  - moderation：免费端点；图库：一次 1 条结果的搜索；抓取：查剩余额度；抠图：查账户额度
 *  - image / video：复用上面的 Shuyu /prices 探测 + 余额
 *  - graphics（配图与 Logo）没有便宜的探测：由账户状态推断 + 生产回写
 *  - email：只看配置
 * 任何一项探测失败都只影响它自己那一行，不会抛给调用方。
 * ════════════════════════════════════════════════════════════════════ */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const OPENAI_API_BASE = "https://api.openai.com/v1";
const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const PROBE_TIMEOUT_MS = 15_000;
const HOUR_MS = 60 * 60_000;
/** TTS 是唯一按次计费的探测：每 24 小时最多一次。 */
export const TTS_PROBE_INTERVAL_MS = 24 * HOUR_MS;
const ACCOUNT_LEVEL_REASONS: ReadonlySet<CapabilityReason> = new Set(["quota", "auth"]);

export type CapabilityProbeDeps = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  store?: CapabilityStore;
  /** cron 已经跑过 probeShuyuCapabilities 就把结果传进来，免得 /prices 打两次。 */
  shuyu?: ProbeResult | null;
  /** 没传 shuyu 时跑这个（默认真正去探 /prices，并照旧落探测历史）。 */
  probeShuyu?: () => Promise<ProbeResult>;
  getShuyuBalance?: () => Promise<{ available_points: number }>;
  /** 把 24 小时节流的 TTS 探测也跑一遍：运维补完额度 / 权限后手动触发（cron ?force=1）。 */
  force?: boolean;
  /** 覆盖探测用的模型（测试用）；默认与生产调用同一套解析。 */
  models?: { text?: string[]; vision?: string };
  timeoutMs?: number;
};

export type CapabilityProbeReportItem = {
  key: CapabilityKey;
  status: CapabilityStatus;
  reason: CapabilityReason;
  source: CapabilitySource;
  /** 这一轮没发请求、沿用上一条（例如 TTS 24 小时节流） */
  kept?: boolean;
  httpStatus?: number;
};

export type CapabilityProbeReport = {
  probedAt: string;
  items: CapabilityProbeReportItem[];
};

type ProbeContext = {
  env: EnvLike;
  fetchImpl: typeof fetch;
  timeoutMs: number;
};

type HttpOutcome =
  | { ok: true; status: number; body: string }
  | { ok: false; error: unknown };

async function httpProbe(
  ctx: ProbeContext,
  url: string,
  init: RequestInit,
  options: { binary?: boolean } = {},
): Promise<HttpOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const response = await ctx.fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    let body = "";
    if (options.binary && response.ok) {
      /// 音频直接读完丢掉：只要状态码，不留内容。
      await response.arrayBuffer().catch(() => null);
    } else {
      body = (await response.text().catch(() => "")).slice(0, 4_000);
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

function envValue(ctx: ProbeContext, name: string): string | undefined {
  const value = ctx.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** 上游错误体里只取错误码 / 类型做 note，不留原文（可能回显请求内容）。 */
function errorCodeFrom(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } | string; code?: unknown };
    const error = parsed.error;
    if (error && typeof error === "object") {
      const code = typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : undefined;
      return safeNote(code, 80);
    }
    if (typeof parsed.code === "string") return safeNote(parsed.code, 80);
  } catch {
    /* 非 JSON：不留原文 */
  }
  return undefined;
}

function withDetail(observation: CapabilityObservation, detail: CapabilityDetail): CapabilityObservation {
  const merged: CapabilityDetail = { ...(observation.detail ?? {}), ...detail };
  for (const key of Object.keys(merged) as Array<keyof CapabilityDetail>) {
    if (merged[key] === undefined) delete merged[key];
  }
  return { ...observation, detail: merged };
}

function fromHttp(outcome: HttpOutcome, detail: CapabilityDetail): CapabilityObservation {
  if (!outcome.ok) return withDetail(classifyNetworkError(outcome.error), detail);
  return withDetail(classifyHttpStatus(outcome.status, outcome.body), {
    ...detail,
    note: detail.note ?? errorCodeFrom(outcome.body),
  });
}

function notConfigured(): CapabilityObservation {
  return { status: "not_configured", reason: "not_configured" };
}

function uncheckedAvailable(note?: string): CapabilityObservation {
  return { status: "available", reason: "unchecked", ...(note ? { detail: { note } } : {}) };
}

/** 文本探测的候选模型：与 chatJsonByTier("fast") 同一条回退链（OPENAI_MODEL 优先，已知无权限的 4 系沉底）。 */
export function textProbeModels(): string[] {
  return openAiProbePlan().textModels;
}

/** 1 token 的 chat completion。模型不存在（404）才换下一个候选——与生产回退规则一致。 */
export async function probeOpenAiChat(ctx: ProbeContext, models: string[]): Promise<CapabilityObservation> {
  const key = envValue(ctx, "OPENAI_API_KEY");
  if (!key) return notConfigured();
  let last: CapabilityObservation | null = null;
  for (const model of models.slice(0, 3)) {
    const send = (limit: number) =>
      httpProbe(ctx, `${OPENAI_API_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          ...openAiTokenLimitParam(model, limit),
        }),
      });
    let outcome = await send(1);
    if (outcome.ok && outcome.status === 400) {
      /// 个别（推理）模型拒绝 1 token 上限：放宽到 16 再试一次（仍是几分之一美分）。
      /// 400 是请求形状问题而不是账户问题，不能直接当成「写作不稳定」挂给客户。
      outcome = await send(16);
    }
    const observation = fromHttp(outcome, { provider: "openai", model });
    if (outcome.ok && outcome.status === 404 && observation.reason === "permission") {
      last = observation;
      continue;
    }
    return observation;
  }
  return last ?? { status: "degraded", reason: "unknown", detail: { provider: "openai", note: "no model candidates" } };
}

/** 1 个字符的 TTS（与 providers/tts/openai 的生产合成同一个模型与端点）。 */
export async function probeOpenAiTts(ctx: ProbeContext): Promise<CapabilityObservation> {
  const key = envValue(ctx, "OPENAI_API_KEY");
  if (!key) return notConfigured();
  const outcome = await httpProbe(
    ctx,
    OPENAI_TTS_ENDPOINT,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: resolveTtsVoice("openai", null),
        input: "a",
        response_format: "mp3",
      }),
    },
    { binary: true },
  );
  return fromHttp(outcome, { provider: "openai", model: OPENAI_TTS_MODEL });
}

/** ElevenLabs：GET /v1/user 只校验 key 与订阅（不耗字符额度）；401 → auth，与生产合成同一把 key。 */
export async function probeElevenLabsTts(ctx: ProbeContext): Promise<CapabilityObservation> {
  const key = envValue(ctx, "ELEVENLABS_API_KEY");
  if (!key) return notConfigured();
  const outcome = await httpProbe(ctx, `${ELEVENLABS_API_BASE}/v1/user`, {
    method: "GET",
    headers: { "xi-api-key": key },
  });
  return fromHttp(outcome, { provider: "elevenlabs", model: resolveElevenLabsTtsModel(ctx.env) });
}

const TTS_PROBES: Record<TtsProviderId, (ctx: ProbeContext) => Promise<CapabilityObservation>> = {
  openai: probeOpenAiTts,
  elevenlabs: probeElevenLabsTts,
};

/** 探当前 TTS_PROVIDER 选中的那一家：探测与生产必须是同一个供应商。 */
export function probeTts(ctx: ProbeContext): Promise<CapabilityObservation> {
  return TTS_PROBES[resolveTtsProviderId(ctx.env)](ctx);
}

export async function probeOpenAiModeration(ctx: ProbeContext): Promise<CapabilityObservation> {
  const key = envValue(ctx, "OPENAI_API_KEY");
  if (!key) return notConfigured();
  const outcome = await httpProbe(ctx, `${OPENAI_API_BASE}/moderations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input: "ok" }),
  });
  return fromHttp(outcome, { provider: "openai", model: OPENAI_MODERATION_MODEL });
}

function firstListValue(raw: string | undefined): string | undefined {
  return raw?.split(",").map((part) => part.trim()).find(Boolean);
}

/** 图库：Pexels 优先（一次 1 条结果的搜索，免费）；只配了 Pixabay 就探 Pixabay。 */
export async function probeStockFootage(ctx: ProbeContext): Promise<CapabilityObservation> {
  const pexels = firstListValue(ctx.env.PEXELS_API_KEYS);
  if (pexels) {
    const outcome = await httpProbe(ctx, "https://api.pexels.com/videos/search?query=nature&per_page=1", {
      method: "GET",
      headers: { Authorization: pexels },
    });
    return fromHttp(outcome, { provider: "pexels" });
  }
  const pixabay = firstListValue(ctx.env.PIXABAY_API_KEYS);
  if (pixabay) {
    const url = new URL("https://pixabay.com/api/videos/");
    url.searchParams.set("key", pixabay);
    url.searchParams.set("q", "nature");
    url.searchParams.set("per_page", "3");
    const outcome = await httpProbe(ctx, url.toString(), { method: "GET" });
    return fromHttp(outcome, { provider: "pixabay" });
  }
  return notConfigured();
}

/** 抓取：查剩余额度（不消耗额度）。额度接口不存在时不拦客户——Firecrawl 只是直抓的兜底层。 */
export async function probeFirecrawl(ctx: ProbeContext): Promise<CapabilityObservation> {
  const key = envValue(ctx, "FIRECRAWL_API_KEY");
  if (!key) return notConfigured();
  const outcome = await httpProbe(ctx, "https://api.firecrawl.dev/v1/team/credit-usage", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const detail: CapabilityDetail = { provider: "firecrawl" };
  if (outcome.ok && outcome.status === 404) {
    return withDetail(uncheckedAvailable("credit endpoint 404"), detail);
  }
  if (outcome.ok && outcome.status === 200) {
    try {
      const remaining = (JSON.parse(outcome.body) as { data?: { remaining_credits?: unknown } }).data?.remaining_credits;
      if (typeof remaining === "number" && remaining <= 0) {
        return { status: "unavailable", reason: "quota", detail: { ...detail, httpStatus: 200, note: "remaining_credits=0" } };
      }
    } catch {
      /* 200 但解析不了：按正常处理 */
    }
  }
  return fromHttp(outcome, detail);
}

/** 抠图：remove.bg 账户接口（免费）。只配了 Clipdrop 时没有免费探测，只看配置。 */
export async function probeCutout(ctx: ProbeContext): Promise<CapabilityObservation> {
  const key = envValue(ctx, "REMOVE_BG_API_KEY");
  if (!key) {
    return envValue(ctx, "CLIPDROP_API_KEY") ? withDetail(uncheckedAvailable(), { provider: "clipdrop" }) : notConfigured();
  }
  const outcome = await httpProbe(ctx, "https://api.remove.bg/v1.0/account", {
    method: "GET",
    headers: { "X-Api-Key": key },
  });
  const detail: CapabilityDetail = { provider: "remove_bg" };
  if (outcome.ok && outcome.status === 200) {
    try {
      const attributes = (JSON.parse(outcome.body) as {
        data?: { attributes?: { credits?: { total?: unknown }; api?: { free_calls?: unknown } } };
      }).data?.attributes;
      const credits = attributes?.credits?.total;
      const freeCalls = attributes?.api?.free_calls;
      if (typeof credits === "number" && credits <= 0 && typeof freeCalls === "number" && freeCalls <= 0) {
        return { status: "unavailable", reason: "quota", detail: { ...detail, httpStatus: 200, note: "no credits" } };
      }
    } catch {
      /* 200 但解析不了：按正常处理 */
    }
  }
  return fromHttp(outcome, detail);
}

function shuyuErrorObservation(code: string | null, httpStatus: number | null): CapabilityObservation {
  const detail: CapabilityDetail = {
    provider: "shuyu",
    ...(httpStatus ? { httpStatus } : {}),
    ...(code ? { note: code } : {}),
  };
  switch (code) {
    case "not_configured":
      return { status: "not_configured", reason: "not_configured", detail };
    case "authentication_rejected":
      return { status: "unavailable", reason: "auth", detail };
    case "insufficient_balance":
      return { status: "unavailable", reason: "quota", detail };
    case "rate_limited":
      return { status: "degraded", reason: "rate_limited", detail };
    default:
      return { status: "degraded", reason: "upstream", detail };
  }
}

export type ShuyuBalanceOutcome =
  | { points: number }
  | { error: { code: string | null; httpStatus: number | null } }
  | null;

/**
 * Shuyu /prices 探测 + 余额 → 图像（产品图与故事板）与视频两条能力。
 *  - 视频：契约匹配 → 正常；套餐还在但漂移 → 不稳定（提交照常走、自动重试；生产没有可切的备用套餐）；视频套餐整体消失 → 暂停
 *  - 图像：没有可用的图像套餐 → 暂停
 *  - 余额不够一条 15 秒视频 / 一张图 → 对应能力暂停（提交必然 402）
 */
export function shuyuCapabilityObservations(
  result: Pick<ProbeResult, "auditedPlanFound" | "videoPlansGone" | "drifts" | "catalog" | "fetchError">,
  balance: ShuyuBalanceOutcome,
): { image: CapabilityObservation; video: CapabilityObservation } {
  if (result.fetchError) {
    const failed = shuyuErrorObservation(result.fetchError.code, result.fetchError.httpStatus);
    return { image: failed, video: failed };
  }
  const balanceError = balance && "error" in balance ? balance.error : null;
  if (balanceError && (balanceError.code === "authentication_rejected" || balanceError.code === "insufficient_balance")) {
    const rejected = shuyuErrorObservation(balanceError.code, balanceError.httpStatus);
    return { image: rejected, video: rejected };
  }
  const points = balance && "points" in balance ? balance.points : null;
  const base: CapabilityDetail = { provider: "shuyu", ...(points !== null ? { balancePoints: points } : {}) };

  let video: CapabilityObservation;
  if (result.videoPlansGone) {
    video = { status: "unavailable", reason: "contract_drift", detail: { ...base, note: "no video plans" } };
  } else if (!result.auditedPlanFound) {
    video = {
      status: "degraded",
      reason: "contract_drift",
      detail: { ...base, note: safeNote(result.drifts.map((drift) => drift.field).join(",")) },
    };
  } else {
    video = { status: "available", reason: "ok", detail: base };
  }
  const videoCost = result.catalog?.cheapestVideo15sPoints ?? null;
  if (points !== null && videoCost !== null && points < videoCost) {
    video = { status: "unavailable", reason: "quota", detail: { ...base, note: `balance ${points} < ${videoCost}` } };
  }

  let image: CapabilityObservation;
  if (!result.catalog || result.catalog.imagePlanCount === 0) {
    image = { status: "unavailable", reason: "contract_drift", detail: { ...base, note: "no image plans" } };
  } else {
    image = { status: "available", reason: "ok", detail: base };
  }
  const imageCost = result.catalog?.cheapestImagePoints ?? null;
  if (points !== null && imageCost !== null && points < imageCost) {
    image = { status: "unavailable", reason: "quota", detail: { ...base, note: `balance ${points} < ${imageCost}` } };
  }
  return { image, video };
}

/**
 * voice 这一轮要不要真的发 TTS：
 *  - 从没探过 / 强制 → 探
 *  - 距上一次真实证据（TTS 探测或生产里的 TTS 调用）满 24 小时 → 探
 *  - 上一条失败是账户层（额度 / key）而账户这一轮已恢复 → 补探一次（至多每小时一次），
 *    否则账户恢复后它会一直挂着一条过期的「额度用完」
 */
export function shouldProbeTts(args: {
  prev: CapabilityRecord | undefined;
  account: CapabilityObservation | null;
  now: Date;
  force: boolean;
}): boolean {
  const { prev, account, now, force } = args;
  if (force || !prev || prev.status === "not_configured") return true;
  const probedAt = prev.detail?.ttsProbedAt ? Date.parse(prev.detail.ttsProbedAt) || 0 : 0;
  const runtimeAt = prev.source === "runtime" ? Date.parse(prev.checkedAt) || 0 : 0;
  if (now.getTime() - Math.max(probedAt, runtimeAt) >= TTS_PROBE_INTERVAL_MS) return true;
  return (
    prev.status === "unavailable" &&
    ACCOUNT_LEVEL_REASONS.has(prev.reason) &&
    account?.status === "available" &&
    now.getTime() - probedAt >= HOUR_MS
  );
}

type Planned =
  | { key: CapabilityKey; observation: CapabilityObservation; source: CapabilitySource }
  | { key: CapabilityKey; kept: true };

async function probeShuyuLines(
  ctx: ProbeContext,
  deps: CapabilityProbeDeps,
): Promise<{ image: CapabilityObservation; video: CapabilityObservation }> {
  if (!shuyuApiKey(ctx.env)) return { image: notConfigured(), video: notConfigured() };
  try {
    const result = deps.shuyu ?? (await (deps.probeShuyu ?? (() => probeShuyuCapabilities()))());
    let balance: ShuyuBalanceOutcome = null;
    if (!result.fetchError) {
      try {
        const response = await (deps.getShuyuBalance ?? (() => getShuyuBalance()))();
        balance = { points: response.available_points };
      } catch (error) {
        balance = {
          error: {
            code: error instanceof ShuyuApiError ? error.code : null,
            httpStatus: error instanceof ShuyuApiError ? (error.httpStatus ?? null) : null,
          },
        };
      }
    }
    return shuyuCapabilityObservations(result, balance);
  } catch (error) {
    const failed = classifyNetworkError(error);
    return { image: failed, video: failed };
  }
}

/**
 * 跑一轮全能力探测并落库。单项探测的错误只影响它自己那一行；返回每个能力这一轮的结论（含「沿用上一条」）。
 */
export async function runCapabilityProbeCycle(deps: CapabilityProbeDeps = {}): Promise<CapabilityProbeReport> {
  const now = (deps.now ?? (() => new Date()))();
  const ctx: ProbeContext = {
    env: deps.env ?? process.env,
    fetchImpl: deps.fetchImpl ?? fetch,
    timeoutMs: deps.timeoutMs ?? PROBE_TIMEOUT_MS,
  };
  const store = deps.store ?? defaultCapabilityStore();
  const previous = new Map<CapabilityKey, CapabilityRecord>(
    (await store.readAll().catch(() => [] as CapabilityRecord[])).map((record) => [record.key, record]),
  );
  const configured = capabilityConfiguration(ctx.env);
  /// 中国区（AI_PROVIDER=volcengine）的写作 / 看图 / 配图不走 OpenAI：不拿 OpenAI 的结论冒充它们。
  const openAiChat = configured.text && ctx.env.AI_PROVIDER?.trim() !== "volcengine";
  const safely = async (run: () => Promise<CapabilityObservation>): Promise<CapabilityObservation> => {
    try {
      return await run();
    } catch (error) {
      return classifyNetworkError(error);
    }
  };

  const textModels = deps.models?.text ?? textProbeModels();
  const [text, moderation, stock, scrape, cutout, shuyu] = await Promise.all([
    openAiChat ? safely(() => probeOpenAiChat(ctx, textModels)) : Promise.resolve(null),
    configured.moderation ? safely(() => probeOpenAiModeration(ctx)) : Promise.resolve(notConfigured()),
    configured.stock ? safely(() => probeStockFootage(ctx)) : Promise.resolve(notConfigured()),
    configured.scrape ? safely(() => probeFirecrawl(ctx)) : Promise.resolve(notConfigured()),
    configured.cutout ? safely(() => probeCutout(ctx)) : Promise.resolve(notConfigured()),
    probeShuyuLines(ctx, deps),
  ]);

  const planned: Planned[] = [];
  const add = (key: CapabilityKey, observation: CapabilityObservation, source: CapabilitySource = "probe") => {
    planned.push({ key, observation, source });
  };
  const keep = (key: CapabilityKey) => {
    planned.push({ key, kept: true });
  };

  // text
  if (!configured.text) add("text", notConfigured(), "config");
  else if (text) add("text", text);
  else keep("text");

  // vision：链首与文本同一个模型就直接沿用文本结论，否则把整条 vision 链交给 probeOpenAiChat
  //（与文本探测同写法：404 / 没权限就试下一档，和 analyzeImages 的回退一致）
  if (!configured.vision) add("vision", notConfigured(), "config");
  else if (!openAiChat || !text) keep("vision");
  else {
    const visionModels = deps.models?.vision ? [deps.models.vision] : openAiProbePlan().visionModels;
    const visionModel = visionModels[0]!;
    if (visionModel === text.detail?.model) add("vision", withDetail(text, { model: visionModel }));
    else add("vision", await safely(() => probeOpenAiChat(ctx, visionModels)));
  }

  // voice：每 24 小时最多一次真实 TTS；只有 OpenAI 配音才跟着 OpenAI 账户恢复补探
  const ttsAccount = resolveTtsProviderId(ctx.env) === "openai" ? text : null;
  if (!configured.voice) add("voice", notConfigured(), "config");
  else if (shouldProbeTts({ prev: previous.get("voice"), account: ttsAccount, now, force: deps.force ?? false })) {
    const observation = await safely(() => probeTts(ctx));
    add("voice", withDetail(observation, { ttsProbedAt: now.toISOString() }));
  } else keep("voice");

  // graphics：没有便宜的探测——账户恢复时把「因账户而停」的旧结论翻回来，其余交给生产回写
  const graphicsPrev = previous.get("graphics");
  if (!configured.graphics) add("graphics", notConfigured(), "config");
  else if (!openAiChat || !text) keep("graphics");
  else if (!graphicsPrev || graphicsPrev.status === "not_configured") add("graphics", uncheckedAvailable(), "derived");
  else if (
    isFailingStatus(graphicsPrev.status) &&
    ACCOUNT_LEVEL_REASONS.has(graphicsPrev.reason) &&
    text.status === "available"
  ) {
    add("graphics", uncheckedAvailable("account recovered"), "derived");
  } else keep("graphics");

  add("moderation", moderation, configured.moderation ? "probe" : "config");
  add("stock", stock, configured.stock ? "probe" : "config");
  add("scrape", scrape, configured.scrape ? "probe" : "config");
  add("cutout", cutout, configured.cutout ? "probe" : "config");
  add("image", configured.image ? shuyu.image : notConfigured(), configured.image ? "probe" : "config");
  add("video", configured.video ? shuyu.video : notConfigured(), configured.video ? "probe" : "config");

  // email：只看配置；配了之后的真实状态由发信回写维护，探测不覆盖它
  const emailPrev = previous.get("email");
  if (!configured.email) add("email", notConfigured(), "config");
  else if (!emailPrev || emailPrev.status === "not_configured") add("email", uncheckedAvailable(), "config");
  else keep("email");

  const toWrite = planned.filter(
    (item): item is Extract<Planned, { observation: CapabilityObservation }> => "observation" in item,
  );
  const written = await recordCapabilityObservations(toWrite, { now, store, previous });
  const writtenByKey = new Map(written.map((record) => [record.key, record]));

  const items: CapabilityProbeReportItem[] = planned.map((item) => {
    const record = "kept" in item ? previous.get(item.key) : writtenByKey.get(item.key);
    const observation = "observation" in item ? item.observation : null;
    const httpStatus = record?.detail?.httpStatus ?? observation?.detail?.httpStatus;
    return {
      key: item.key,
      status: record?.status ?? observation?.status ?? "available",
      reason: record?.reason ?? observation?.reason ?? "unchecked",
      source: record?.source ?? ("source" in item ? item.source : "probe"),
      ...("kept" in item ? { kept: true } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
  });

  const paused = items.filter((item) => item.status === "unavailable").map((item) => `${item.key}:${item.reason}`);
  if (paused.length > 0) {
    /// 告警走 stderr（Vercel 日志告警规则抓它），与 Shuyu 漂移告警同一路。
    console.error(`[capability-probe] 能力暂停：${paused.join(", ")}`);
  }
  return { probedAt: now.toISOString(), items };
}
