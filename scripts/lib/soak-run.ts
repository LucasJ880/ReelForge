/**
 * 真机压测（2026-11，抖音矩阵上线前「轮 2」）的纯逻辑：用例 × 钩子角度展开、分波与线路指派、
 * 点数估算、断点续跑的下一步判定、终态判定、汇总与放行线。
 * 不读 env、不触网、不碰数据库，便于单测（tests/soak-run.test.ts）。驱动在 scripts/ops/soak-run.ts。
 */
import { estimateSpend, type SpendEstimate } from "./experiment-budget";
import type { GoldenSetCase } from "./video-golden-set";

export const SOAK_DURATION_SEC = 15;
export const SOAK_ASPECT_RATIO = "9:16" as const;
export const SOAK_LANGUAGE = "zh-CN";
/// 15 秒单条故事板的帧数；驱动启动时与线上的 storyboardFrameCountForDuration(15) 对一遍，不一致就拒跑
export const SOAK_FRAMES_PER_ITEM = 4;
/// 幂等键前缀沿用实验批次的那一个（src/lib/experiments/run-key.ts），库里一眼认得出是压测数据
export const SOAK_KEY_PREFIX = "exp-2611-";

/**
 * 四个钩子角度：同一件商品、同一段商家原话，只换开头怎么抓人。
 * 写进给商家看的那段描述里（故事板与出片都读它），口播稿不动。
 */
export const SOAK_HOOK_ANGLES = [
  { id: "pain", label: "痛点开场", direction: "开头先拍没有它时的麻烦（一个看得见的小窘境），再让商品出场解决。" },
  { id: "result", label: "结果前置", direction: "开头第一个画面就是用完之后的效果，再回头交代是怎么做到的。" },
  { id: "contrast", label: "反差对比", direction: "开头把以前的做法和它放在一起比，差别一眼看得出来。" },
  { id: "scene", label: "场景代入", direction: "开头先交代一个具体的时间、地点和人正要做的事，商品自然地出现在这个场景里。" },
] as const;

export type SoakAngleId = (typeof SOAK_HOOK_ANGLES)[number]["id"];

export const SOAK_WAVES = ["morning", "noon", "evening"] as const;
export type SoakWave = (typeof SOAK_WAVES)[number];
export const SOAK_WAVE_LABELS: Record<SoakWave, string> = { morning: "早", noon: "午", evening: "晚" };

/// buddy = Shuyu（客户默认线路）；runway = 备用线路，派发时按请求点名
export type SoakRoute = "buddy" | "runway";

export interface SoakItem {
  /// `<用例>-<角度>`，目录名、幂等键、报告里都用它
  id: string;
  caseId: string;
  angleId: SoakAngleId;
  wave: SoakWave;
  route: SoakRoute;
}

/**
 * 10 个品类 × 4 个角度 = 40 条。顺序：先角度后品类（先把每个品类的第一个角度排完）。
 * 分波按 (品类序号 + 角度序号) 轮转：每一波里品类与角度都是混的，40 条分成 14 / 13 / 13。
 */
export function expandSoakItems(cases: ReadonlyArray<Pick<GoldenSetCase, "id">>): SoakItem[] {
  const items: SoakItem[] = [];
  SOAK_HOOK_ANGLES.forEach((angle, angleIndex) => {
    cases.forEach((item, caseIndex) => {
      items.push({
        id: `${item.id}-${angle.id}`,
        caseId: item.id,
        angleId: angle.id,
        wave: SOAK_WAVES[(caseIndex + angleIndex) % SOAK_WAVES.length],
        route: "buddy",
      });
    });
  });
  return items;
}

function parseList(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

/**
 * 选子集：`--arms bottle-pain,serum-scene`（点名条目）、`--cases` / `--angles`（按品类或角度筛）、`--limit N`（取前 N 条，冒烟用）。
 * 不认识的名字直接报错，不带着拼错的参数去花钱。
 */
export function selectSoakItems(
  items: readonly SoakItem[],
  filter: { arms?: string | null; cases?: string | null; angles?: string | null; limit?: number | null },
): SoakItem[] {
  const arms = parseList(filter.arms);
  const cases = parseList(filter.cases);
  const angles = parseList(filter.angles);
  const unknown = [
    ...arms.filter((id) => !items.some((item) => item.id === id)),
    ...cases.filter((id) => !items.some((item) => item.caseId === id)),
    ...angles.filter((id) => !SOAK_HOOK_ANGLES.some((angle) => angle.id === id)),
  ];
  if (unknown.length > 0) throw new Error(`不认识的条目 / 用例 / 角度：${unknown.join(", ")}`);
  if (filter.limit != null && (!Number.isInteger(filter.limit) || filter.limit < 1)) {
    throw new Error("--limit 要给正整数");
  }
  const selected = items.filter(
    (item) =>
      (arms.length === 0 || arms.includes(item.id)) &&
      (cases.length === 0 || cases.includes(item.caseId)) &&
      (angles.length === 0 || angles.includes(item.angleId)),
  );
  if (selected.length === 0) throw new Error("筛完一条都不剩");
  return filter.limit ? selected.slice(0, filter.limit) : selected;
}

/**
 * `--runway n`：在选中的条目里挑 n 条走 Runway，其余走 Shuyu。
 * 逐条挑「时段、角度、品类重复得最少」的第一条（按这个先后比），所以 4 条会落在 3 个时段、4 个角度、4 个品类上；
 * 同样的输入永远挑同样的几条。n 超过条数直接报错。
 */
export function assignRunwayRoutes(items: readonly SoakItem[], count: number): SoakItem[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("--runway 要给非负整数");
  if (count > items.length) throw new Error(`--runway ${count} 超过了选中的 ${items.length} 条`);
  const picked = new Set<number>();
  const used = new Map<string, number>();
  const seen = (key: string) => used.get(key) ?? 0;
  for (let round = 0; round < count; round++) {
    let best: { index: number; score: number[] } | null = null;
    items.forEach((item, index) => {
      if (picked.has(index)) return;
      const score = [seen(`wave:${item.wave}`), seen(`angle:${item.angleId}`), seen(`case:${item.caseId}`)];
      const differs = best === null ? -1 : score.findIndex((value, position) => value !== best!.score[position]);
      const better = best === null || (differs >= 0 && score[differs] < best.score[differs]);
      if (better) best = { index, score };
    });
    const chosen = items[best!.index];
    picked.add(best!.index);
    for (const key of [`wave:${chosen.wave}`, `angle:${chosen.angleId}`, `case:${chosen.caseId}`]) used.set(key, seen(key) + 1);
  }
  return items.map((item, index) => ({ ...item, route: picked.has(index) ? "runway" : "buddy" }));
}

export function parseWave(raw: string | null | undefined): SoakWave | "all" {
  if (raw === "all") return "all";
  const wave = SOAK_WAVES.find((value) => value === raw);
  if (!wave) throw new Error(`--wave 只能是 ${SOAK_WAVES.join(" | ")} | all`);
  return wave;
}

/** 给商家描述框的那段话：商家原话 + 这一条指定的开头钩子。 */
export function soakPrompt(item: Pick<GoldenSetCase, "story">, angleId: SoakAngleId): string {
  const angle = SOAK_HOOK_ANGLES.find((entry) => entry.id === angleId)!;
  return `${item.story}\n开头钩子（${angle.label}）：${angle.direction}`;
}

/** 建故事板的请求体：与创作页「生成 AI 故事板」发的一致（人工确认、单条故事板、口播稿只给镜头卡排镜头用）。 */
export function soakStoryboardBody(
  item: Pick<GoldenSetCase, "story" | "voiceover">,
  angleId: SoakAngleId,
  assetIds: readonly string[],
) {
  return {
    prompt: soakPrompt(item, angleId),
    durationSec: SOAK_DURATION_SEC,
    aspectRatio: SOAK_ASPECT_RATIO,
    sourceAssetIds: [...assetIds],
    approvalPolicy: "MANUAL" as const,
    purpose: "single-video-storyboard",
    voiceoverScript: item.voiceover,
  };
}

/**
 * 「生成视频」的请求体：与创作页的缺省设置一致——中文口播（原生口播）、逐词字幕、不配乐、不做品牌封装。
 * Shuyu 条目不点名线路（和浏览器一样走平台给客户的默认线路）；Runway 条目点名 runway，账号没开放就由服务端 403。
 */
export function soakDispatchBody(args: {
  item: Pick<GoldenSetCase, "story" | "voiceover">;
  angleId: SoakAngleId;
  assetIds: readonly string[];
  storyboardRunId: string;
  route: SoakRoute;
}) {
  return {
    request: {
      userType: "platform" as const,
      rawPrompt: soakPrompt(args.item, args.angleId),
      attachments: args.assetIds.map((assetId, index) => ({
        assetId,
        inferredRole: "product_image" as const,
        roleConfidence: 1,
        fileName: `product-image-${index + 1}`,
        durationSeconds: null,
        userAssignedRole: "product_image" as const,
        suggestedUse: null,
        warnings: [],
      })),
      selectedDuration: SOAK_DURATION_SEC,
      selectedAspectRatio: SOAK_ASPECT_RATIO,
      selectedBrandEndingMode: "none" as const,
      cta: null,
      platform: null,
      brandKit: null,
      language: SOAK_LANGUAGE,
      styleTemplateId: null,
      audio: {
        voiceover: { enabled: true, voiceId: "warm-confident", language: SOAK_LANGUAGE, script: args.item.voiceover },
        bgm: { trackId: "none" as const, volume: 0 },
      },
      captions: { enabled: true, style: "word_by_word" as const, language: SOAK_LANGUAGE, position: "bottom" as const, exportSrt: true },
    },
    storyboardRunId: args.storyboardRunId,
    ...(args.route === "runway" ? { videoRouteId: "runway" as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// 运行清单：第一次估算时把「选了哪些条、各走哪一波哪条线路」定下来，之后每次都得对得上
// ---------------------------------------------------------------------------

export interface SoakManifest {
  version: 1;
  runKey: string;
  createdAt: string;
  items: SoakItem[];
}

/** 同一个 run-key 换了筛选条件或 Runway 条数就拒绝：线路与分波一旦定了不能中途变。 */
export function assertManifestMatches(manifest: SoakManifest, items: readonly SoakItem[]): void {
  const same =
    manifest.items.length === items.length &&
    manifest.items.every((entry, index) => {
      const item = items[index];
      return entry.id === item.id && entry.wave === item.wave && entry.route === item.route;
    });
  if (!same) {
    throw new Error(
      `${manifest.runKey} 已经按另一组条目建过清单（${manifest.items.length} 条，Runway ${
        manifest.items.filter((entry) => entry.route === "runway").length
      } 条）：筛选条件与 --runway 要和第一次一致，或者换 --run-key`,
    );
  }
}

// ---------------------------------------------------------------------------
// 每条的落盘记录：只存事实（任务号、状态、时间），终态每次从事实现算
// ---------------------------------------------------------------------------

export interface SoakFrameFact {
  ordinal: number;
  attempt: number;
  isCurrent: boolean;
  status: string;
  submissionState: string;
  planId: string | null;
  errorCode: string | null;
}

export interface SoakJobFact {
  id: string;
  status: string;
  submissionState: string;
  submissionErrorClass: string | null;
  /// 这一段实际走的线路（VideoJob.videoRouteSnapshot）：Shuyu 失败改交 Runway 时会和计划的不一样
  route: string | null;
  frameQaStatus: string | null;
  retryCount: number;
  submitAttempts: number;
  submittedAt: string | null;
  finishedAt: string | null;
  /// 被重做 / 改交换下去的旧段
  superseded: boolean;
  unitPoints: number | null;
  unitUsd: number | null;
  error: string | null;
}

export interface SoakAttempt {
  /// 第几次尝试（从 0 起）。幂等键带着它：--retry 换新一次尝试 = 换新键
  attempt: number;
  storyboard: {
    /// 发出建故事板请求的时刻（本机时钟）；端到端从这里起算
    requestedAt: string | null;
    runId: string | null;
    status: string | null;
    error: string | null;
    /// 四帧出齐、等确认的时刻（脚本看到的）
    readyAt: string | null;
    approvedAt: string | null;
    frames: SoakFrameFact[];
    /// 建故事板时没用上 AI、退回兜底的步骤
    degradedStages: string[];
  };
  dispatch: {
    /// pending = 还没派发；requested = 请求发出去了但没拿到明确答复（同键重发，服务端回放）；
    /// accepted = 已建任务；rejected = 服务端明确拒绝（终态）
    state: "pending" | "requested" | "accepted" | "rejected";
    /// 因「可安全重试」的错误换过几次键
    retries: number;
    requestedAt: string | null;
    httpStatus: number | null;
    code: string | null;
    error: string | null;
    briefId: string | null;
    deliveryOrderId: string | null;
  };
  video: {
    briefStatus: string | null;
    finalVideoStatus: string | null;
    finalVideoUrl: string | null;
    /// 成片合成完成的时刻（库里的 FinalVideo.finishedAt）；端到端到这里为止
    finishedAt: string | null;
    error: string | null;
    jobs: SoakJobFact[];
  };
  /// cancel 子命令取消成功（或确认已无后续费用）的时刻
  cancelledAt: string | null;
}

export interface SoakRecord extends SoakItem {
  current: SoakAttempt;
  /// --retry 之前的尝试，最早的在前。放行线只看第一次尝试，重试救回来的不算
  history: SoakAttempt[];
}

export function blankSoakAttempt(attempt: number): SoakAttempt {
  return {
    attempt,
    storyboard: { requestedAt: null, runId: null, status: null, error: null, readyAt: null, approvedAt: null, frames: [], degradedStages: [] },
    dispatch: { state: "pending", retries: 0, requestedAt: null, httpStatus: null, code: null, error: null, briefId: null, deliveryOrderId: null },
    video: { briefStatus: null, finalVideoStatus: null, finalVideoUrl: null, finishedAt: null, error: null, jobs: [] },
    cancelledAt: null,
  };
}

export function initialSoakRecord(item: SoakItem): SoakRecord {
  return { ...item, current: blankSoakAttempt(0), history: [] };
}

/** 幂等键：同一条同一次尝试永远同一个键（断点续跑重发只会被服务端回放），换尝试才换键。 */
export function soakIdempotencyKey(
  runKey: string,
  record: Pick<SoakRecord, "id" | "current">,
  step: "storyboard" | "dispatch",
): string {
  const suffix = step === "storyboard" ? "sb" : `dispatch-r${record.current.dispatch.retries}`;
  return `${SOAK_KEY_PREFIX}${runKey}:${record.id}:a${record.current.attempt}:${suffix}`;
}

export type SoakOutcome =
  | { kind: "succeeded" }
  | { kind: "cancelled" }
  | { kind: "failed"; stage: "storyboard" | "dispatch" | "video" | "stitch"; reason: string };

const ACTIVE_JOB_STATUSES = ["QUEUED", "PAUSED", "RUNNING"];
const currentJobs = (attempt: SoakAttempt) => attempt.video.jobs.filter((job) => !job.superseded);

/**
 * 从事实判终态；null = 还在途（或还没开始）。
 * 段失败不立刻判死：Shuyu 明确失败会改交 Runway 重拍，只有 brief 被置成失败、且没有还在跑的段才算。
 */
export function deriveSoakOutcome(attempt: SoakAttempt): SoakOutcome | null {
  if (attempt.video.finalVideoStatus === "READY") return { kind: "succeeded" };
  if (attempt.cancelledAt || attempt.storyboard.status === "CANCELLED") return { kind: "cancelled" };
  if (attempt.storyboard.status === "FAILED") {
    return { kind: "failed", stage: "storyboard", reason: attempt.storyboard.error ?? "故事板失败" };
  }
  if (!attempt.storyboard.runId && attempt.storyboard.error) {
    return { kind: "failed", stage: "storyboard", reason: attempt.storyboard.error };
  }
  if (attempt.dispatch.state === "rejected") {
    return { kind: "failed", stage: "dispatch", reason: `${attempt.dispatch.code ?? "?"}：${attempt.dispatch.error ?? "派发被拒"}` };
  }
  if (attempt.video.finalVideoStatus === "FAILED") {
    return { kind: "failed", stage: "stitch", reason: attempt.video.error ?? "成片合成失败" };
  }
  if (
    attempt.video.briefStatus === "RENDER_FAILED" &&
    !currentJobs(attempt).some((job) => ACTIVE_JOB_STATUSES.includes(job.status))
  ) {
    const failed = currentJobs(attempt).find((job) => job.status === "FAILED" || job.status === "CANCELLED");
    return { kind: "failed", stage: "video", reason: failed?.error ?? attempt.video.error ?? "出片失败" };
  }
  return null;
}

export type SoakNextStep =
  | { kind: "create_storyboard" }
  | { kind: "wait_storyboard" }
  | { kind: "approve_storyboard" }
  | { kind: "dispatch" }
  | { kind: "wait_video" }
  | { kind: "done"; outcome: SoakOutcome };

/**
 * 下一步做什么。脚本只做商家会点的三下（出故事板、确认、生成视频），其余都是等线上 cron 推进。
 * 已有故事板号的不再新建，已建出任务（有 briefId）的不再派发——只续查。
 * 建故事板的请求发出去却没拿到号（超时 / 进程被杀）时仍回 create_storyboard：驱动先按幂等键查库，
 * 查不到才用同一个键重发，服务端按键回放，不会多建一轮。
 */
export function nextSoakStep(record: Pick<SoakRecord, "current">): SoakNextStep {
  const attempt = record.current;
  const outcome = deriveSoakOutcome(attempt);
  if (outcome) return { kind: "done", outcome };
  if (!attempt.storyboard.runId) return { kind: "create_storyboard" };
  if (attempt.dispatch.briefId || attempt.dispatch.state === "accepted") return { kind: "wait_video" };
  if (attempt.storyboard.status === "AWAITING_APPROVAL") return { kind: "approve_storyboard" };
  if (attempt.storyboard.status === "APPROVED") return { kind: "dispatch" };
  return { kind: "wait_storyboard" };
}

/** 是否已经在线上留下了东西（建过故事板或发过请求）且还没到终态。 */
export function isSoakInFlight(record: Pick<SoakRecord, "current">): boolean {
  const { storyboard } = record.current;
  return Boolean(storyboard.runId || storyboard.requestedAt) && deriveSoakOutcome(record.current) === null;
}

/**
 * `--retry`：把停在失败或已取消的条目换成新一次尝试（旧的进 history，幂等键随尝试号换新）。
 * 成功的、在途的不碰。返回换了几条。
 */
export function retrySoakRecord(record: SoakRecord): boolean {
  const outcome = deriveSoakOutcome(record.current);
  if (!outcome || outcome.kind === "succeeded") return false;
  record.history.push(record.current);
  record.current = blankSoakAttempt(record.current.attempt + 1);
  return true;
}

// ---------------------------------------------------------------------------
// 点数估算与投放节奏
// ---------------------------------------------------------------------------

/** 这一条还要花钱的部分：没建故事板的要 4 帧；没派发的要 1 条视频。到了终态的不再计。 */
export function pendingSoakSpend(record: Pick<SoakRecord, "current">): { frames: number; videos: number } {
  const step = nextSoakStep(record);
  if (step.kind === "done" || step.kind === "wait_video") return { frames: 0, videos: 0 };
  return { frames: step.kind === "create_storyboard" ? SOAK_FRAMES_PER_ITEM : 0, videos: 1 };
}

/**
 * 估算：故事板帧与 Shuyu 视频按实时套餐单价算点数；Runway 没有可查的价目，单价（美元 / 条）由调用方给，
 * 没给就是「未定价」，预算闸会拒绝花钱。Runway 条目的故事板帧仍按 Shuyu 出图算（默认如此，见驱动里的说明）。
 */
export function estimateSoakSpend(args: {
  records: ReadonlyArray<Pick<SoakRecord, "current" | "route">>;
  frameUnitPoints: number | null;
  shuyuVideoUnitPoints: number | null;
  runwayVideoUnitUsd: number | null;
}): SpendEstimate {
  let frames = 0;
  let shuyuVideos = 0;
  let runwayVideos = 0;
  for (const record of args.records) {
    const pending = pendingSoakSpend(record);
    frames += pending.frames;
    if (record.route === "runway") runwayVideos += pending.videos;
    else shuyuVideos += pending.videos;
  }
  return estimateSpend([
    { armId: "故事板帧", count: frames, unitPoints: args.frameUnitPoints, unitUsd: null },
    { armId: "Shuyu 视频", count: shuyuVideos, unitPoints: args.shuyuVideoUnitPoints, unitUsd: null },
    { armId: "Runway 视频", count: runwayVideos, unitPoints: null, unitUsd: args.runwayVideoUnitUsd },
  ]);
}

/**
 * 这一刻还能新开几轮故事板：线上对「一小时内新建故事板」按整点窗口限流（默认 10 轮），
 * 所以按本机整点小时数已发出的轮数，再扣掉在途上限。
 */
export function soakSubmitAllowance(args: {
  now: Date;
  /// 本次运行键下所有已发出的建故事板请求时刻
  requestedAts: ReadonlyArray<string | null>;
  perHour: number;
  inFlight: number;
  maxInFlight: number;
}): number {
  const hourStart = new Date(args.now);
  hourStart.setMinutes(0, 0, 0);
  const thisHour = args.requestedAts.filter((value) => value !== null && Date.parse(value) >= hourStart.getTime()).length;
  return Math.max(0, Math.min(args.perHour - thisHour, args.maxInFlight - args.inFlight));
}

// ---------------------------------------------------------------------------
// 汇总与放行线
// ---------------------------------------------------------------------------

export const SOAK_GATES = { successRate: 0.9, p90Minutes: 30, unverified: 0, firstPassRate: 0.8 } as const;

export type SoakVerdict = "达标" | "不达标" | "待定" | "待人工评分";

export interface SoakGate {
  name: string;
  target: string;
  actual: string;
  verdict: SoakVerdict;
}

/** 最近秩百分位（p 取 0–1）；没有样本返回 null。 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** 端到端毫秒：发出建故事板请求 → 成片合成完成。没成片返回 null。 */
export function soakEndToEndMs(attempt: SoakAttempt): number | null {
  if (attempt.video.finalVideoStatus !== "READY" || !attempt.storyboard.requestedAt || !attempt.video.finishedAt) return null;
  const ms = Date.parse(attempt.video.finishedAt) - Date.parse(attempt.storyboard.requestedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** 放行线看第一次尝试：重试救回来的不算首次成功。 */
export function firstSoakAttempt(record: SoakRecord): SoakAttempt {
  return record.history[0] ?? record.current;
}

export interface SoakGroupStats {
  key: string;
  started: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  p50Ms: number | null;
  p90Ms: number | null;
}

export interface SoakSummary {
  total: number;
  notStarted: number;
  started: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  retried: number;
  /// 成功 /（成功 + 失败）；取消的不进分母
  successRate: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  /// 在途里等得最久的一条已经等了多久（毫秒）；静默卡死看这个
  longestInFlightMs: number | null;
  failures: Array<{ id: string; stage: string; reason: string }>;
  /// 视频提交「确认未知」的条数（段的 submissionState = ACK_UNKNOWN，或派发回 SUBMISSION_ACK_UNKNOWN）
  videoAckUnknown: number;
  frames: { total: number; failed: number; cancelled: number; ackUnknown: number; failureRate: number | null };
  /// 帧质检各状态的段数；没写状态的记在「(未写入)」
  frameQa: Record<string, number>;
  /// 计划走 Shuyu、实际有段落到别的线路（失败改交）的条数
  rerouted: number;
  byWave: SoakGroupStats[];
  byRoute: SoakGroupStats[];
  gates: SoakGate[];
}

export interface SoakFirstPassInput {
  firstPass: number;
  total: number;
  /// 两位评分人都评了的条数
  rated: number;
}

const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60_000).toFixed(1)} 分`);
const percent = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);

function groupStats(key: string, attempts: readonly SoakAttempt[]): SoakGroupStats {
  const started = attempts.filter((attempt) => attempt.storyboard.requestedAt !== null);
  const outcomes = started.map((attempt) => deriveSoakOutcome(attempt));
  const durations = started.map(soakEndToEndMs).filter((value): value is number => value !== null);
  return {
    key,
    started: started.length,
    succeeded: outcomes.filter((outcome) => outcome?.kind === "succeeded").length,
    failed: outcomes.filter((outcome) => outcome?.kind === "failed").length,
    inFlight: outcomes.filter((outcome) => outcome === null).length,
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
  };
}

/**
 * 汇总一轮压测并对照放行线。还有没投的或在途的条目时，凡是结论还可能翻的都记「待定」，不抢着下结论：
 * 成功率按最坏 / 最好两种结局夹一下——最坏也达标才写达标，最好也不达标才写不达标。
 */
export function summarizeSoak(
  records: readonly SoakRecord[],
  options: { now: Date; firstPass?: SoakFirstPassInput | null },
): SoakSummary {
  const firsts = records.map((record) => ({ record, attempt: firstSoakAttempt(record) }));
  const started = firsts.filter(({ attempt }) => attempt.storyboard.requestedAt !== null);
  const outcomes = started.map(({ record, attempt }) => ({ record, attempt, outcome: deriveSoakOutcome(attempt) }));
  const succeeded = outcomes.filter(({ outcome }) => outcome?.kind === "succeeded").length;
  const failedEntries = outcomes.filter(({ outcome }) => outcome?.kind === "failed");
  const cancelled = outcomes.filter(({ outcome }) => outcome?.kind === "cancelled").length;
  const inFlightEntries = outcomes.filter(({ outcome }) => outcome === null);
  const notStarted = records.length - started.length;
  const decided = succeeded + failedEntries.length;
  /// 还可能改变结论的条数：在途的 + 还没投的
  const open = inFlightEntries.length + notStarted;

  const durations = started.map(({ attempt }) => soakEndToEndMs(attempt)).filter((value): value is number => value !== null);
  const p50Ms = percentile(durations, 0.5);
  const p90Ms = percentile(durations, 0.9);

  const allFrames = started.flatMap(({ attempt }) => attempt.storyboard.frames);
  const cancelledFrames = allFrames.filter((frame) => frame.status === "FAILED" && frame.errorCode === "RUN_CANCELLED").length;
  const failedFrames = allFrames.filter((frame) => frame.status === "FAILED" && frame.errorCode !== "RUN_CANCELLED").length;
  const jobs = started.flatMap(({ attempt }) => currentJobs(attempt));
  const frameQa: Record<string, number> = {};
  for (const job of jobs) {
    const key = job.frameQaStatus ?? "(未写入)";
    frameQa[key] = (frameQa[key] ?? 0) + 1;
  }
  const unverified = frameQa.UNVERIFIED ?? 0;

  const successRate = decided === 0 ? null : succeeded / decided;
  const worstRate = decided + open === 0 ? null : succeeded / (decided + open);
  const bestRate = decided + open === 0 ? null : (succeeded + open) / (decided + open);
  const successVerdict: SoakVerdict =
    worstRate === null || bestRate === null
      ? "待定"
      : worstRate >= SOAK_GATES.successRate
        ? "达标"
        : bestRate < SOAK_GATES.successRate
          ? "不达标"
          : "待定";
  const p90Verdict: SoakVerdict =
    p90Ms === null || open > 0 ? "待定" : p90Ms <= SOAK_GATES.p90Minutes * 60_000 ? "达标" : "不达标";
  const unverifiedVerdict: SoakVerdict =
    unverified > SOAK_GATES.unverified ? "不达标" : open > 0 || jobs.length === 0 ? "待定" : "达标";
  const firstPass = options.firstPass ?? null;
  const firstPassRate = firstPass && firstPass.total > 0 ? firstPass.firstPass / firstPass.total : null;
  const firstPassVerdict: SoakVerdict =
    firstPassRate === null || firstPass === null || firstPass.rated === 0
      ? "待人工评分"
      : firstPassRate >= SOAK_GATES.firstPassRate
        ? "达标"
        : /// 还有没评完的成片时，现有的分数不够也先不判死
          firstPass.rated < succeeded
          ? "待定"
          : "不达标";

  const group = (label: (record: SoakRecord) => string, keys: readonly string[]) =>
    keys.map((key) => groupStats(key, firsts.filter(({ record }) => label(record) === key).map(({ attempt }) => attempt)));

  return {
    total: records.length,
    notStarted,
    started: started.length,
    succeeded,
    failed: failedEntries.length,
    cancelled,
    inFlight: inFlightEntries.length,
    retried: records.filter((record) => record.history.length > 0).length,
    successRate,
    p50Ms,
    p90Ms,
    longestInFlightMs:
      inFlightEntries.length === 0
        ? null
        : Math.max(...inFlightEntries.map(({ attempt }) => options.now.getTime() - Date.parse(attempt.storyboard.requestedAt!))),
    failures: failedEntries.map(({ record, outcome }) => ({
      id: record.id,
      stage: outcome?.kind === "failed" ? outcome.stage : "?",
      reason: outcome?.kind === "failed" ? outcome.reason : "",
    })),
    videoAckUnknown: started.filter(
      ({ attempt }) =>
        attempt.dispatch.code === "SUBMISSION_ACK_UNKNOWN" || attempt.video.jobs.some((job) => job.submissionState === "ACK_UNKNOWN"),
    ).length,
    frames: {
      total: allFrames.length,
      failed: failedFrames,
      cancelled: cancelledFrames,
      ackUnknown: allFrames.filter((frame) => frame.submissionState === "ACK_UNKNOWN").length,
      failureRate: allFrames.length === 0 ? null : failedFrames / allFrames.length,
    },
    frameQa,
    rerouted: started.filter(
      ({ record, attempt }) => record.route === "buddy" && currentJobs(attempt).some((job) => job.route !== null && job.route !== "buddy"),
    ).length,
    byWave: group((record) => record.wave, SOAK_WAVES),
    byRoute: group((record) => record.route, ["buddy", "runway"]),
    gates: [
      {
        name: "成功率",
        target: `≥ ${percent(SOAK_GATES.successRate)}`,
        actual: `${percent(successRate)}（${succeeded} 成 / ${failedEntries.length} 败${open > 0 ? ` / ${open} 条未出结果` : ""}）`,
        verdict: successVerdict,
      },
      { name: "端到端 P90", target: `≤ ${SOAK_GATES.p90Minutes} 分`, actual: `${minutes(p90Ms)}（${durations.length} 条成片）`, verdict: p90Verdict },
      { name: "帧质检 UNVERIFIED", target: `= ${SOAK_GATES.unverified}`, actual: `${unverified} 段（共 ${jobs.length} 段）`, verdict: unverifiedVerdict },
      {
        name: "人工首过率",
        target: `≥ ${percent(SOAK_GATES.firstPassRate)}`,
        actual: firstPass && firstPass.rated > 0 ? `${percent(firstPassRate)}（${firstPass.firstPass} / ${firstPass.total}，已评 ${firstPass.rated} 条）` : "没有评分输入",
        verdict: firstPassVerdict,
      },
    ],
  };
}

function groupTable(title: string, groups: readonly SoakGroupStats[], label: (key: string) => string): string[] {
  return [
    `| ${title} | 已投 | 成功 | 失败 | 在途 | P50 | P90 |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...groups.map(
      (entry) =>
        `| ${label(entry.key)} | ${entry.started} | ${entry.succeeded} | ${entry.failed} | ${entry.inFlight} | ${minutes(entry.p50Ms)} | ${minutes(entry.p90Ms)} |`,
    ),
  ];
}

/** 报告正文（markdown）：放行线在最前，后面是读数与失败明细。 */
export function renderSoakReport(runKey: string, summary: SoakSummary, generatedAt: Date): string {
  const qa = Object.entries(summary.frameQa).sort(([left], [right]) => left.localeCompare(right));
  return [
    `# 真机压测 ${runKey}`,
    "",
    `生成于 ${generatedAt.toISOString()}。共 ${summary.total} 条：已投 ${summary.started}，成功 ${summary.succeeded}，失败 ${summary.failed}，取消 ${summary.cancelled}，在途 ${summary.inFlight}，未投 ${summary.notStarted}。`,
    summary.retried > 0 ? `其中 ${summary.retried} 条重试过；下面所有读数只看第一次尝试。` : "",
    summary.longestInFlightMs !== null ? `在途里等得最久的一条已等 ${minutes(summary.longestInFlightMs)}。` : "",
    "",
    "## 放行线",
    "",
    "| 项 | 放行线 | 实测 | 结论 |",
    "| --- | --- | --- | --- |",
    ...summary.gates.map((gate) => `| ${gate.name} | ${gate.target} | ${gate.actual} | ${gate.verdict} |`),
    "",
    "## 读数",
    "",
    `- 成功率 ${percent(summary.successRate)}，端到端 P50 ${minutes(summary.p50Ms)} / P90 ${minutes(summary.p90Ms)}（从点「生成故事板」到成片合成完成；故事板只靠线上每分钟一次的定时任务推进，比开着页面的商家略慢）`,
    `- 视频提交确认未知：${summary.videoAckUnknown} 条`,
    `- 故事板帧：共 ${summary.frames.total} 帧，失败 ${summary.frames.failed}（失败率 ${percent(summary.frames.failureRate)}），其中提交确认未知 ${summary.frames.ackUnknown}；另有 ${summary.frames.cancelled} 帧随取消停掉`,
    `- 帧质检：${qa.length === 0 ? "还没有段" : qa.map(([status, count]) => `${status} ${count}`).join("，")}`,
    (summary.frameQa.SKIPPED ?? 0) + (summary.frameQa["(未写入)"] ?? 0) > 0
      ? "- 注意：有段是 SKIPPED 或没写质检状态。没检不等于通过，先查原因（门禁没开、没给视频地址，还是轮 1 的 UNVERIFIED 改动没上线）。"
      : "",
    summary.rerouted > 0 ? `- 计划走 Shuyu、实际改交到别的线路：${summary.rerouted} 条（另有 Runway 费用，不在点数估算里）` : "",
    "",
    ...groupTable("时段", summary.byWave, (key) => SOAK_WAVE_LABELS[key as SoakWave] ?? key),
    "",
    ...groupTable("计划线路", summary.byRoute, (key) => (key === "buddy" ? "Shuyu" : "Runway")),
    "",
    ...(summary.failures.length > 0
      ? ["## 失败明细", "", "| 条目 | 阶段 | 原因 |", "| --- | --- | --- |", ...summary.failures.map((entry) => `| ${entry.id} | ${entry.stage} | ${entry.reason.replaceAll("|", "\\|").replace(/\s+/gu, " ").slice(0, 200)} |`), ""]
      : []),
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}
