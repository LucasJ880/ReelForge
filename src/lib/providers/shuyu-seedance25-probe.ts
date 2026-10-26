/**
 * Shuyu 价目表里的 Seedance 2.5 档探针（X-SCAF-4，E7′ / E2″ 的触发器）。
 *
 * 纯函数，**不依赖任何服务端模块**，输入是 `/prices` 的原始 JSON（unknown）而不是
 * 严格 schema 解析后的结果——这一点是刻意的：`shuyuPriceSchema` 把 durations 卡在 ≤15，
 * 2.5 档一旦带着 30s 上架，严格解析会让整份价目表失败、新档字段也会被 strip 掉，
 * 那样探针恰好在最该报警的时候什么都看不见。这里宽松读取每一条，只摘信号：
 *
 * - 候选：video 条目里 display_name 或 model 含「2.5」（含 `2-5` / `2_5` 写法）；
 * - durations 是否含 30（E7′ 的 30s 多镜头臂、E11 的前提）；
 * - capabilities 里是否出现音频 / 视频参考类字段（E4″ 的前提），以及审计不认识的新字段与新 mode。
 *
 * 调用方另行报告「严格 schema 是否仍能解析」（它决定生产 /prices 会不会整体失败）。
 */

/** 审计已知的 capabilities 字段；其余一律当「新字段」报出来。 */
const KNOWN_CAPABILITY_KEYS = new Set([
  "aspect_ratios",
  "input_images_max",
  "modes",
  "durations",
  "quality",
]);
const KNOWN_MODES = new Set(["text2video", "image2video", "frames2video"]);
const REFERENCE_KEY_PATTERN = /audio|video|reference|(^|_)ref(_|$)/i;
/// `generate_audio` 之类是生成开关，不是参考输入；单独报（E2″ 要看它可不可控）。
const GENERATION_SWITCH_PATTERN = /^generate_/i;
const SEEDANCE_25_PATTERN = /2[._-]5(?!\d)/;

export interface Seedance25PlanSignal {
  planId: string | null;
  displayName: string | null;
  model: string | null;
  resolution: string | null;
  unit: string | null;
  salePoints: number | null;
  durations: number[];
  supports30s: boolean;
  /** capabilities（及条目顶层）里像音频/视频参考的字段名。 */
  referenceFields: string[];
  /** 审计不认识的 capabilities 字段名（含 referenceFields）。 */
  unknownCapabilityKeys: string[];
  /** 审计不认识的 mode（如 reference2video）。 */
  unknownModes: string[];
  /** capabilities 里出现的 generate_* 开关（如 generate_audio）。 */
  generationSwitches: string[];
}

export interface Seedance25CatalogSignal {
  /** 原始 payload 里能读出的条目数（不是严格解析后的条数）。 */
  entryCount: number;
  /** 出现 2.5 候选档 = E7′ 可以排期。 */
  detected: boolean;
  candidates: Seedance25PlanSignal[];
  /** 任何 video 条目 durations 含 30（不论叫不叫 2.5）。 */
  duration30PlanIds: string[];
  /** 任何 video 条目带音频/视频参考字段（不论叫不叫 2.5）。 */
  referencePlanIds: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function catalogEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const data = asRecord(raw)?.data;
  return Array.isArray(data) ? data : [];
}

function signalOf(entry: Record<string, unknown>): Seedance25PlanSignal {
  const capabilities = asRecord(entry.capabilities) ?? {};
  const durations = Array.isArray(capabilities.durations)
    ? capabilities.durations.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  const modes = Array.isArray(capabilities.modes)
    ? capabilities.modes.filter((value): value is string => typeof value === "string")
    : [];
  const unknownCapabilityKeys = Object.keys(capabilities)
    .filter((key) => !KNOWN_CAPABILITY_KEYS.has(key))
    .sort();
  const isReferenceKey = (key: string) =>
    REFERENCE_KEY_PATTERN.test(key) && !GENERATION_SWITCH_PATTERN.test(key);
  const topLevelReference = Object.keys(entry).filter(
    (key) => key !== "capabilities" && isReferenceKey(key),
  );
  const referenceFields = [
    ...unknownCapabilityKeys.filter(isReferenceKey),
    ...topLevelReference,
  ].sort();
  return {
    planId: asString(entry.plan_id),
    displayName: asString(entry.display_name),
    model: asString(entry.model),
    resolution: asString(entry.resolution),
    unit: asString(entry.unit),
    salePoints: typeof entry.sale_points === "number" ? entry.sale_points : null,
    durations: [...durations].sort((a, b) => a - b),
    supports30s: durations.includes(30),
    referenceFields,
    unknownCapabilityKeys,
    unknownModes: modes.filter((mode) => !KNOWN_MODES.has(mode)).sort(),
    generationSwitches: unknownCapabilityKeys.filter((key) => GENERATION_SWITCH_PATTERN.test(key)),
  };
}

function isSeedance25(signal: Seedance25PlanSignal): boolean {
  return [signal.displayName, signal.model].some(
    (text) => text !== null && SEEDANCE_25_PATTERN.test(text),
  );
}

export function detectShuyuSeedance25(raw: unknown): Seedance25CatalogSignal {
  const entries = catalogEntries(raw)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const videoSignals = entries
    .filter((entry) => entry.kind === undefined || entry.kind === "video")
    .map(signalOf);
  const candidates = videoSignals.filter(isSeedance25);
  const idOf = (signal: Seedance25PlanSignal) => signal.planId ?? signal.displayName ?? "(无 plan_id)";
  return {
    entryCount: entries.length,
    detected: candidates.length > 0,
    candidates,
    duration30PlanIds: videoSignals.filter((signal) => signal.supports30s).map(idOf),
    referencePlanIds: videoSignals.filter((signal) => signal.referenceFields.length > 0).map(idOf),
  };
}

/** 一行人读结论（真值表 / 探针日志用）；不含任何凭据。 */
export function describeSeedance25Signal(
  signal: Seedance25CatalogSignal,
  strictSchemaOk: boolean | null,
): string {
  const parts: string[] = [];
  if (signal.detected) {
    const list = signal.candidates
      .map((candidate) => {
        const traits = [
          candidate.resolution,
          candidate.salePoints !== null && candidate.unit ? `${candidate.salePoints}/${candidate.unit}` : null,
          candidate.durations.length ? `durations=${candidate.durations.join("/")}` : null,
          candidate.referenceFields.length ? `参考字段=${candidate.referenceFields.join("+")}` : null,
          candidate.unknownModes.length ? `新 mode=${candidate.unknownModes.join("+")}` : null,
          candidate.generationSwitches.length ? `开关=${candidate.generationSwitches.join("+")}` : null,
        ].filter(Boolean);
        return `${candidate.planId ?? "?"}「${candidate.displayName ?? "?"}」${traits.join(" ")}`;
      })
      .join("；");
    parts.push(`出现 2.5 候选档 ${signal.candidates.length} 个：${list}`);
    parts.push(signal.candidates.some((candidate) => candidate.supports30s) ? "含 30s" : "无 30s");
    parts.push(
      signal.candidates.some((candidate) => candidate.referenceFields.length > 0)
        ? "有音频/视频参考字段"
        : "无音频/视频参考字段",
    );
  } else {
    parts.push(`未出现 2.5 档（${signal.entryCount} 条目）`);
    if (signal.duration30PlanIds.length) parts.push(`但有 30s 档：${signal.duration30PlanIds.join(",")}`);
    if (signal.referencePlanIds.length) parts.push(`但有参考字段：${signal.referencePlanIds.join(",")}`);
  }
  if (strictSchemaOk === false) {
    parts.push("⚠ 严格 schema 解析失败：生产 getShuyuPrices 会整体报 invalid_response（buddy 线路停机）");
  }
  return parts.join("；");
}
