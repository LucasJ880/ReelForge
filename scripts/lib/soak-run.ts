/**
 * 真机压测（2026-11，抖音矩阵上线前「轮 2」）的纯逻辑：用例 × 钩子角度 × A/B 两组展开、分波与线路指派、
 * 点数估算、断点续跑的下一步判定、终态判定、汇总与放行线、帧质检去留依据、出方案对照。
 * 不读 env、不触网、不碰数据库，便于单测（tests/soak-run.test.ts）。驱动在 scripts/ops/soak-run.ts。
 */
import { estimateSpend, type SpendEstimate } from "./experiment-budget";
import {
  GOLDEN_SET_DIMENSIONS,
  tallyBlindVotes,
  type BlindPair,
  type BlindVotes,
  type GoldenSetCase,
} from "./video-golden-set";

export const SOAK_DURATION_SEC = 15;
export const SOAK_ASPECT_RATIO = "9:16" as const;
export const SOAK_LANGUAGE = "zh-CN";
/// 15 秒单条故事板的帧数；驱动启动时与线上的 storyboardFrameCountForDuration(15) 对一遍，不一致就拒跑
export const SOAK_FRAMES_PER_ITEM = 4;
/// 幂等键前缀沿用实验批次的那一个（src/lib/experiments/run-key.ts），库里一眼认得出是压测数据
export const SOAK_KEY_PREFIX = "exp-2611-";

/**
 * 两个钩子角度：同一件商品、同一段商家原话，只换开头怎么抓人。
 * 写进给商家看的那段描述里（故事板与出片都读它），口播稿不动。
 */
export const SOAK_HOOK_ANGLES = [
  { id: "pain", label: "痛点开场", direction: "开头先拍没有它时的麻烦（一个看得见的小窘境），再让商品出场解决。" },
  { id: "result", label: "结果前置", direction: "开头第一个画面就是用完之后的效果，再回头交代是怎么做到的。" },
] as const;

export type SoakAngleId = (typeof SOAK_HOOK_ANGLES)[number]["id"];

/**
 * 两组对照：同一件商品、同一个角度、同一批商品图，只差「出方案」调不调语言模型。
 * A = 现状（线上出方案，调 OpenAI）；B = 出方案各步走模板 / 启发式兜底加商家原话。B 组怎么做到、做不到哪些，见驱动文件头。
 */
export const SOAK_GROUPS = [
  { id: "A", label: "A 组（调 OpenAI 出方案）" },
  { id: "B", label: "B 组（不调 OpenAI 出方案）" },
] as const;
export type SoakGroup = (typeof SOAK_GROUPS)[number]["id"];

export const SOAK_WAVES = ["morning", "noon", "evening"] as const;
export type SoakWave = (typeof SOAK_WAVES)[number];
export const SOAK_WAVE_LABELS: Record<SoakWave, string> = { morning: "早", noon: "午", evening: "晚" };

/// buddy = Shuyu（客户默认线路）；runway = 备用线路，派发时按请求点名
export type SoakRoute = "buddy" | "runway";

export interface SoakItem {
  /// `<用例>-<角度>-<a|b>`，目录名、幂等键、报告里都用它
  id: string;
  /// `<用例>-<角度>`：A、B 两条共用，盲评按它配对
  pairId: string;
  caseId: string;
  angleId: SoakAngleId;
  group: SoakGroup;
  wave: SoakWave;
  route: SoakRoute;
}

/**
 * 10 个品类 × 2 个角度 × 2 组 = 40 条（20 对）。顺序：先角度后品类，每对 A 在前 B 紧跟。
 * 分波按对：(品类序号 + 角度序号) 轮转，一对的两条永远在同一波（时段波动不混进两组的差别里），
 * 20 对分成 7 / 7 / 6 对，即 14 / 14 / 12 条。
 */
export function expandSoakItems(cases: ReadonlyArray<Pick<GoldenSetCase, "id">>): SoakItem[] {
  const items: SoakItem[] = [];
  SOAK_HOOK_ANGLES.forEach((angle, angleIndex) => {
    cases.forEach((item, caseIndex) => {
      const pairId = `${item.id}-${angle.id}`;
      for (const group of SOAK_GROUPS) {
        items.push({
          id: `${pairId}-${group.id.toLowerCase()}`,
          pairId,
          caseId: item.id,
          angleId: angle.id,
          group: group.id,
          wave: SOAK_WAVES[(caseIndex + angleIndex) % SOAK_WAVES.length],
          route: "buddy",
        });
      }
    });
  });
  return items;
}

function parseList(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

/**
 * 选子集：`--arms bottle-pain,serum-result-b`（点名一对或单条）、`--cases` / `--angles`（按品类或角度筛）、
 * `--limit N`（取前 N 条，冒烟用：2 = 第一对的 A 与 B）。
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
    ...arms.filter((id) => !items.some((item) => item.id === id || item.pairId === id)),
    ...cases.filter((id) => !items.some((item) => item.caseId === id)),
    ...angles.filter((id) => !SOAK_HOOK_ANGLES.some((angle) => angle.id === id)),
  ];
  if (unknown.length > 0) throw new Error(`不认识的条目 / 用例 / 角度：${unknown.join(", ")}`);
  if (filter.limit != null && (!Number.isInteger(filter.limit) || filter.limit < 1)) {
    throw new Error("--limit 要给正整数");
  }
  const selected = items.filter(
    (item) =>
      (arms.length === 0 || arms.includes(item.id) || arms.includes(item.pairId)) &&
      (cases.length === 0 || cases.includes(item.caseId)) &&
      (angles.length === 0 || angles.includes(item.angleId)),
  );
  if (selected.length === 0) throw new Error("筛完一条都不剩");
  return filter.limit ? selected.slice(0, filter.limit) : selected;
}

/**
 * `--runway n`：在选中的条目里挑 n 条走 Runway，其余走 Shuyu。按对挑（n 要是偶数）：一对的 A、B 走同一条线路，
 * 否则线路的差别会混进两组的对比。逐对挑「时段、角度、品类重复得最少」的第一对；同样的输入永远挑同样的几对。
 */
export function assignRunwayRoutes(items: readonly SoakItem[], count: number): SoakItem[] {
  if (!Number.isInteger(count) || count < 0) throw new Error("--runway 要给非负整数");
  if (count % 2 !== 0) throw new Error("--runway 要给偶数：一对的 A、B 两条走同一条线路");
  const pairs = [...new Set(items.map((item) => item.pairId))]
    .map((pairId) => items.filter((item) => item.pairId === pairId))
    .filter((members) => SOAK_GROUPS.every((group) => members.some((item) => item.group === group.id)));
  if (count / 2 > pairs.length) throw new Error(`--runway ${count} 超过了选中的 ${pairs.length} 对（${pairs.length * 2} 条）`);
  const picked = new Set<string>();
  const used = new Map<string, number>();
  const seen = (key: string) => used.get(key) ?? 0;
  for (let round = 0; round < count / 2; round++) {
    let best: { pair: SoakItem; score: number[] } | null = null;
    for (const [pair] of pairs) {
      if (picked.has(pair.pairId)) continue;
      const score = [seen(`wave:${pair.wave}`), seen(`angle:${pair.angleId}`), seen(`case:${pair.caseId}`)];
      const differs = best === null ? -1 : score.findIndex((value, position) => value !== best!.score[position]);
      if (best === null || (differs >= 0 && score[differs] < best.score[differs])) best = { pair, score };
    }
    const chosen = best!.pair;
    picked.add(chosen.pairId);
    for (const key of [`wave:${chosen.wave}`, `angle:${chosen.angleId}`, `case:${chosen.caseId}`]) used.set(key, seen(key) + 1);
  }
  return items.map((item) => ({ ...item, route: picked.has(item.pairId) ? "runway" : "buddy" }));
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
 * confirmedPrompts 只给 B 组：创作页「确认脚本」用的同一个字段，把线上方案里 AI 段的提示词正文换成本机不调模型算出来的那一份。
 */
export function soakDispatchBody(args: {
  item: Pick<GoldenSetCase, "story" | "voiceover">;
  angleId: SoakAngleId;
  assetIds: readonly string[];
  storyboardRunId: string;
  route: SoakRoute;
  confirmedPrompts?: ReadonlyArray<{ segmentOrder: number; prompt: string }> | null;
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
    ...(args.confirmedPrompts ? { confirmedPrompts: args.confirmedPrompts.map((entry) => ({ ...entry })) } : {}),
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
      return entry.id === item.id && entry.group === item.group && entry.wave === item.wave && entry.route === item.route;
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
  /// 这一段累计被帧质检拦了几次（frameQaDetail.blockCount，跨重抽累计）
  frameQaBlockCount: number;
  /// 库里最后一次写质检结论的时刻
  frameQaCheckedAt: string | null;
  /// 质检认领这一段的时刻：库里只在质检进行中（CHECKING）留着，结论一写就被覆盖，所以只有轮询正好撞上才抄得到
  frameQaClaimedAt: string | null;
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
    /// 建故事板这一步用了多久（毫秒）。A 组是线上接口往返（含设计镜头卡、原话英译两次模型调用与提交第 0 帧）；
    /// B 组是本机建（不调模型，同样提交第 0 帧）
    createMs: number | null;
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
    /// 「生成视频」这一下从发出到拿到答复用了多久（毫秒）；线上会重出一遍方案，两组都含这一段模型调用
    requestMs: number | null;
    /// B 组：本机不调模型算段提示词用了多久（毫秒）
    localPlanMs: number | null;
    /// B 组：本机算出来、随派发请求交上去的段提示词。落盘后重发用同一份——同一个幂等键下请求体必须一字不差
    confirmedPrompts: Array<{ segmentOrder: number; prompt: string }> | null;
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
    storyboard: { requestedAt: null, createMs: null, runId: null, status: null, error: null, readyAt: null, approvedAt: null, frames: [], degradedStages: [] },
    dispatch: { state: "pending", retries: 0, requestedAt: null, httpStatus: null, code: null, error: null, briefId: null, deliveryOrderId: null, requestMs: null, localPlanMs: null, confirmedPrompts: null },
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
 * 估算，两组分开列：故事板帧与 Shuyu 视频按实时套餐单价算点数；Runway 没有可查的价目，单价（美元 / 条）由调用方给，
 * 没给就是「未定价」，预算闸会拒绝花钱。Runway 条目的故事板帧仍按 Shuyu 出图算（默认如此，见驱动里的说明）。
 */
export function estimateSoakSpend(args: {
  records: ReadonlyArray<Pick<SoakRecord, "current" | "route" | "group">>;
  frameUnitPoints: number | null;
  shuyuVideoUnitPoints: number | null;
  runwayVideoUnitUsd: number | null;
}): SpendEstimate {
  return estimateSpend(
    SOAK_GROUPS.flatMap((group) => {
      let frames = 0;
      let shuyuVideos = 0;
      let runwayVideos = 0;
      for (const record of args.records.filter((entry) => entry.group === group.id)) {
        const pending = pendingSoakSpend(record);
        frames += pending.frames;
        if (record.route === "runway") runwayVideos += pending.videos;
        else shuyuVideos += pending.videos;
      }
      return [
        { armId: `${group.id} 组·故事板帧`, count: frames, unitPoints: args.frameUnitPoints, unitUsd: null },
        { armId: `${group.id} 组·Shuyu 视频`, count: shuyuVideos, unitPoints: args.shuyuVideoUnitPoints, unitUsd: null },
        { armId: `${group.id} 组·Runway 视频`, count: runwayVideos, unitPoints: null, unitUsd: args.runwayVideoUnitUsd },
      ];
    }),
  );
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
// 盲评配对：A/B 两条都出了片的才配成一对
// ---------------------------------------------------------------------------

/** 放行线与对照都看第一次尝试：重试救回来的不算首次成功。 */
export function firstSoakAttempt(record: SoakRecord): SoakAttempt {
  return record.history[0] ?? record.current;
}

export interface SoakBlindPairSource {
  pairId: string;
  caseId: string;
  angleId: SoakAngleId;
  /// 两组各自的成片地址
  videos: Record<SoakGroup, string>;
}

/** 两组第一次尝试都出了成片的对，按清单顺序。 */
export function soakBlindPairs(records: readonly SoakRecord[]): SoakBlindPairSource[] {
  const ready = (group: SoakGroup, pairId: string) => {
    const record = records.find((entry) => entry.pairId === pairId && entry.group === group);
    const attempt = record ? firstSoakAttempt(record) : null;
    return attempt?.video.finalVideoStatus === "READY" ? attempt.video.finalVideoUrl : null;
  };
  return [...new Set(records.map((record) => record.pairId))].flatMap((pairId) => {
    const a = ready("A", pairId);
    const b = ready("B", pairId);
    const first = records.find((record) => record.pairId === pairId)!;
    return a && b ? [{ pairId, caseId: first.caseId, angleId: first.angleId, videos: { A: a, B: b } }] : [];
  });
}

export interface SoakBlindTally {
  reviewer: string;
  /// 评了几对（「整体」那一项有票的对数）
  pairsVoted: number;
  /// B 组相对 A 组的胜 / 平 / 负：六项 + 整体
  rows: Array<{ id: string; label: string; win: number; tie: number; loss: number }>;
}

/** 揭盲：把盲评页导出的「左 / 右 / 差不多」按布局还原成 B 组的胜平负（沿用评测集的计票）。 */
export function soakBlindTally(layout: readonly BlindPair[], votes: BlindVotes, reviewer: string): SoakBlindTally {
  const tally = tallyBlindVotes(layout, votes);
  const blank = { win: 0, tie: 0, loss: 0 };
  const rows = [...GOLDEN_SET_DIMENSIONS.map((dimension) => ({ id: dimension.id as string, label: dimension.label })), { id: "overall", label: "整体" }].map(
    (dimension) => ({ ...dimension, ...(tally[dimension.id as keyof typeof tally]?.B ?? blank) }),
  );
  const overall = rows[rows.length - 1];
  return { reviewer: reviewer.trim() || "未署名", pairsVoted: overall.win + overall.tie + overall.loss, rows };
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

export interface SoakGroupStats {
  key: string;
  started: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  /// 成功 /（成功 + 失败）
  successRate: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
}

/** 质检的五种结论（未合并分支上的 UNVERIFIED 按字符串读） */
export const FRAME_QA_STATUSES = ["PASSED", "BLOCKED", "WOULD_BLOCK", "UNVERIFIED", "SKIPPED"] as const;

export interface SoakFrameQaEvidence {
  /// 已建出的段数（不含被换下去的旧段）
  jobs: number;
  /// 五种结论各几段（没出现记 0）；还在检或没写状态的记在「(未写入)」等原样的键下
  statuses: Record<string, number>;
  /// 累计拦截次数：各段 frameQaDetail.blockCount 之和
  blockCount: number;
  /// 被质检拦过的条数：拦截次数 > 0，或最后结论是 BLOCKED / WOULD_BLOCK
  flaggedItems: number;
  /// 质检多花的时间。库里没有「供应商出片」的时刻，所以「出片 → 任务成功」这一段无法测量；
  /// 能测的是「质检认领 → 任务转成功」，而且只有轮询正好撞上质检进行中的段才抄得到认领时刻
  overhead: { measured: number; unmeasured: number; p50Ms: number | null; p90Ms: number | null };
  /// 与人工评分的对照；没有评分输入为 null
  human: null | {
    /// 两位评分人都评了的条数
    rated: number;
    humanBad: number;
    /// 人工判不合格的条里，质检拦过的
    humanBadFlagged: number;
    /// 质检拦过的条里，人工评了的 / 人工也判不合格的
    flaggedRated: number;
    flaggedHumanBad: number;
    table: Array<{ status: string; ok: number; bad: number; unrated: number }>;
  };
}

export interface SoakPlanGroupStats extends SoakGroupStats {
  label: string;
  /// 建故事板这一步的中位用时（A：线上接口往返；B：本机建，不调模型）
  storyboardCreateP50Ms: number | null;
  /// 「生成视频」这一下的中位用时（线上重出方案，两组都含模型调用）
  dispatchRequestP50Ms: number | null;
  /// B 组本机不调模型算段提示词的中位用时
  localPlanP50Ms: number | null;
  /// 建故事板时线上记了「AI 没用上、退回兜底」的轮数（A 组本该用上 AI，这个数大说明 A 组实际也在走兜底）
  degradedStoryboards: number;
}

export interface SoakPlanComparison {
  groups: SoakPlanGroupStats[];
  pairs: number;
  /// 两组都出了成片、可以盲评的对数
  pairsReady: number;
  tallies: SoakBlindTally[];
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
  frameQaEvidence: SoakFrameQaEvidence;
  planComparison: SoakPlanComparison;
}

export interface SoakFirstPassInput {
  firstPass: number;
  total: number;
  /// 两位评分人都评了的条数
  rated: number;
  /// 两位评分人都评了的条目：ok = 每位的商品分、人物分都 ≥ 1；bad = 有 0 分。键是条目 id
  scores: Record<string, "ok" | "bad">;
}

const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60_000).toFixed(1)} 分`);
const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} 秒`);
const percent = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);
const numbers = (values: ReadonlyArray<number | null>) => values.filter((value): value is number => value !== null);

function groupStats(key: string, attempts: readonly SoakAttempt[]): SoakGroupStats {
  const started = attempts.filter((attempt) => attempt.storyboard.requestedAt !== null);
  const outcomes = started.map((attempt) => deriveSoakOutcome(attempt));
  const durations = numbers(started.map(soakEndToEndMs));
  const succeeded = outcomes.filter((outcome) => outcome?.kind === "succeeded").length;
  const failed = outcomes.filter((outcome) => outcome?.kind === "failed").length;
  return {
    key,
    started: started.length,
    succeeded,
    failed,
    inFlight: outcomes.filter((outcome) => outcome === null).length,
    successRate: succeeded + failed === 0 ? null : succeeded / (succeeded + failed),
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
  };
}

const latestJob = (attempt: SoakAttempt) => currentJobs(attempt).at(-1) ?? null;
const qaFlagged = (job: SoakJobFact | null) =>
  job !== null && (job.frameQaBlockCount > 0 || job.frameQaStatus === "BLOCKED" || job.frameQaStatus === "WOULD_BLOCK");

function frameQaEvidence(started: ReadonlyArray<{ record: SoakRecord; attempt: SoakAttempt }>, firstPass: SoakFirstPassInput | null): SoakFrameQaEvidence {
  const jobs = started.flatMap(({ attempt }) => currentJobs(attempt));
  const statuses: Record<string, number> = Object.fromEntries(FRAME_QA_STATUSES.map((status) => [status, 0]));
  for (const job of jobs) {
    const key = job.frameQaStatus ?? "(未写入)";
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  const checked = jobs.filter((job) => (FRAME_QA_STATUSES as readonly string[]).includes(job.frameQaStatus ?? ""));
  const overhead = numbers(
    checked.map((job) => {
      if (job.status !== "SUCCEEDED" || !job.frameQaClaimedAt || !job.finishedAt) return null;
      const ms = Date.parse(job.finishedAt) - Date.parse(job.frameQaClaimedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : null;
    }),
  );
  const rows = started.map(({ record, attempt }) => {
    const job = latestJob(attempt);
    return { status: job?.frameQaStatus ?? (job ? "(未写入)" : "(没有段)"), flagged: qaFlagged(job), human: firstPass?.scores[record.id] ?? null };
  });
  const flagged = rows.filter((row) => row.flagged);
  return {
    jobs: jobs.length,
    statuses,
    blockCount: jobs.reduce((sum, job) => sum + job.frameQaBlockCount, 0),
    flaggedItems: flagged.length,
    overhead: {
      measured: overhead.length,
      unmeasured: checked.length - overhead.length,
      p50Ms: percentile(overhead, 0.5),
      p90Ms: percentile(overhead, 0.9),
    },
    human:
      firstPass === null || Object.keys(firstPass.scores).length === 0
        ? null
        : {
            rated: rows.filter((row) => row.human !== null).length,
            humanBad: rows.filter((row) => row.human === "bad").length,
            humanBadFlagged: rows.filter((row) => row.human === "bad" && row.flagged).length,
            flaggedRated: flagged.filter((row) => row.human !== null).length,
            flaggedHumanBad: flagged.filter((row) => row.human === "bad").length,
            table: [...new Set(rows.map((row) => row.status))].sort().map((status) => {
              const matching = rows.filter((row) => row.status === status);
              return {
                status,
                ok: matching.filter((row) => row.human === "ok").length,
                bad: matching.filter((row) => row.human === "bad").length,
                unrated: matching.filter((row) => row.human === null).length,
              };
            }),
          },
  };
}

/**
 * 汇总一轮压测并对照放行线。还有没投的或在途的条目时，凡是结论还可能翻的都记「待定」，不抢着下结论：
 * 成功率按最坏 / 最好两种结局夹一下——最坏也达标才写达标，最好也不达标才写不达标。
 * 放行线按全部条目算（A、B 两组合在一起）；只看现状路径的读数在「出方案对照」的 A 组那一行。
 */
export function summarizeSoak(
  records: readonly SoakRecord[],
  options: { now: Date; firstPass?: SoakFirstPassInput | null; blindTallies?: readonly SoakBlindTally[] },
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

  const durations = numbers(started.map(({ attempt }) => soakEndToEndMs(attempt)));
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
  const pairIds = [...new Set(records.map((record) => record.pairId))];

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
    frameQaEvidence: frameQaEvidence(started, firstPass),
    planComparison: {
      groups: SOAK_GROUPS.map((entry) => {
        const attempts = firsts.filter(({ record }) => record.group === entry.id).map(({ attempt }) => attempt);
        return {
          ...groupStats(entry.id, attempts),
          label: entry.label,
          storyboardCreateP50Ms: percentile(numbers(attempts.map((attempt) => attempt.storyboard.createMs)), 0.5),
          dispatchRequestP50Ms: percentile(numbers(attempts.map((attempt) => attempt.dispatch.requestMs)), 0.5),
          localPlanP50Ms: percentile(numbers(attempts.map((attempt) => attempt.dispatch.localPlanMs)), 0.5),
          degradedStoryboards: attempts.filter((attempt) => attempt.storyboard.degradedStages.length > 0).length,
        };
      }),
      pairs: pairIds.length,
      pairsReady: soakBlindPairs(records).length,
      tallies: [...(options.blindTallies ?? [])],
    },
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

/** 「帧质检去留依据」一节：只陈述数字，不替人做决定。 */
function frameQaSection(evidence: SoakFrameQaEvidence): string[] {
  const { statuses, overhead, human } = evidence;
  const others = Object.entries(statuses).filter(([status]) => !(FRAME_QA_STATUSES as readonly string[]).includes(status));
  const overheadLine =
    overhead.measured === 0
      ? `认领到任务转成功的间隔：无法测量（${overhead.unmeasured} 段有结论，但轮询都没撞上质检进行中，认领时刻已被结论覆盖）`
      : `认领到任务转成功的间隔：测到 ${overhead.measured} 段，P50 ${seconds(overhead.p50Ms)} / P90 ${seconds(overhead.p90Ms)}；另有 ${overhead.unmeasured} 段没测到`;
  const humanSummary = human
    ? `人工判不合格 ${human.humanBad} 条，其中质检拦过 ${human.humanBadFlagged} 条；质检拦过的 ${evidence.flaggedItems} 条里人工评了 ${human.flaggedRated} 条，判不合格 ${human.flaggedHumanBad} 条`
    : "人工对照待人工评分";
  return [
    "## 帧质检去留依据",
    "",
    `- 结论分布（共 ${evidence.jobs} 段）：${FRAME_QA_STATUSES.map((status) => `${status} ${statuses[status] ?? 0}`).join("，")}${
      others.length > 0 ? `；其它：${others.map(([status, count]) => `${status} ${count}`).join("，")}` : ""
    }`,
    `- 累计拦截 ${evidence.blockCount} 次（各段 frameQaDetail.blockCount 之和），涉及 ${evidence.flaggedItems} 条`,
    "- 质检多花的时间：供应商出片到任务转成功的间隔无法测量——库里没有记供应商出片的时刻",
    `- ${overheadLine}`,
    ...(human
      ? [
          "",
          "| 质检最后结论 | 人工合格 | 人工不合格 | 未评 |",
          "| --- | --- | --- | --- |",
          ...human.table.map((row) => `| ${row.status} | ${row.ok} | ${row.bad} | ${row.unrated} |`),
          "",
          "- 被拦后重抽的条，人工看到的是重抽后的成片，被拦下的那一版看不到；所以「质检拦对了没有」只能从最后结论是 WOULD_BLOCK 的条上直接对照",
        ]
      : ["- 与人工评分的对照：待人工评分（report 加 --qa-csv）"]),
    "",
    `数字小结：${evidence.jobs} 段里放行 ${statuses.PASSED ?? 0} 段、拦下 ${statuses.BLOCKED ?? 0} 段、影子判拦 ${statuses.WOULD_BLOCK ?? 0} 段、没检成 ${statuses.UNVERIFIED ?? 0} 段、跳过 ${statuses.SKIPPED ?? 0} 段，累计拦截 ${evidence.blockCount} 次；${humanSummary}。`,
    "",
  ];
}

/** 「出方案对照」一节：两组各自的读数与盲评胜平负，只陈述数字。 */
function planComparisonSection(comparison: SoakPlanComparison): string[] {
  const [a, b] = comparison.groups;
  const overallOf = (tally: SoakBlindTally) => tally.rows.find((row) => row.id === "overall")!;
  return [
    "## 出方案对照",
    "",
    "| 组 | 已投 | 成功 | 失败 | 在途 | 成功率 | P50 | P90 | 建故事板用时（中位） | 点「生成视频」用时（中位） | 本机算段提示词（中位） | 故事板记了兜底的轮数 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...comparison.groups.map(
      (entry) =>
        `| ${entry.label} | ${entry.started} | ${entry.succeeded} | ${entry.failed} | ${entry.inFlight} | ${percent(entry.successRate)} | ${minutes(entry.p50Ms)} | ${minutes(entry.p90Ms)} | ${seconds(entry.storyboardCreateP50Ms)} | ${seconds(entry.dispatchRequestP50Ms)} | ${seconds(entry.localPlanP50Ms)} | ${entry.degradedStoryboards} |`,
    ),
    "",
    "- 出方案阶段耗时的口径：A 组建故事板是线上接口往返（含镜头卡与原话英译两次模型调用）；B 组是本机建、不调模型。「生成视频」那一下线上都会重出一遍方案（调模型），B 组只是把其中 AI 段的提示词正文换成本机算的，所以这一列两组都含模型调用，不代表砍掉 OpenAI 之后的耗时。",
    `- 配对：共 ${comparison.pairs} 对，两组都出了成片、可以盲评的 ${comparison.pairsReady} 对`,
    ...(comparison.tallies.length === 0
      ? ["- 盲评：还没有票（把盲评页导出的 JSON 交给 tally 子命令）"]
      : comparison.tallies.flatMap((tally) => [
          "",
          `盲评 · 评审 ${tally.reviewer}（评了 ${tally.pairsVoted} 对）：`,
          "",
          "| 项 | B 胜 | 平 | B 负 |",
          "| --- | --- | --- | --- |",
          ...tally.rows.map((row) => `| ${row.label} | ${row.win} | ${row.tie} | ${row.loss} |`),
        ])),
    "",
    `数字小结：A 组成功率 ${percent(a.successRate)}、P50 ${minutes(a.p50Ms)} / P90 ${minutes(a.p90Ms)}；B 组成功率 ${percent(b.successRate)}、P50 ${minutes(b.p50Ms)} / P90 ${minutes(b.p90Ms)}；${
      comparison.tallies.length === 0
        ? "盲评待评"
        : comparison.tallies.map((tally) => `盲评整体（${tally.reviewer}）B 胜 ${overallOf(tally).win} / 平 ${overallOf(tally).tie} / 负 ${overallOf(tally).loss}`).join("；")
    }。`,
    "",
  ];
}

/** 报告正文（markdown）：放行线在最前，后面是读数、帧质检去留依据、出方案对照与失败明细。 */
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
    "放行线按全部条目算（A、B 两组合在一起）；只看现状路径的读数见「出方案对照」的 A 组那一行。",
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
    ...frameQaSection(summary.frameQaEvidence),
    ...planComparisonSection(summary.planComparison),
    ...(summary.failures.length > 0
      ? ["## 失败明细", "", "| 条目 | 阶段 | 原因 |", "| --- | --- | --- |", ...summary.failures.map((entry) => `| ${entry.id} | ${entry.stage} | ${entry.reason.replaceAll("|", "\\|").replace(/\s+/gu, " ").slice(0, 200)} |`), ""]
      : []),
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}
