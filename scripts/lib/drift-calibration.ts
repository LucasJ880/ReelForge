/**
 * scripts/drift-calibrate.ts 的纯函数部分（X-SCAF-7 / E13）。不读 env、不触网、不跑 ffmpeg。
 *
 * 判据不在这里发明：vision 打分只认生产 P01-B 的 `FRAME_DRIFT_SYSTEM` + `decideDriftVerdict`
 * （resolveProductionDriftJudge 从模块对象里取，取不到就报「未合入」并跳过 vision）；
 * 这里只负责标签解析、相似度数学与召回/误杀统计。
 */

/* ── 生产判据适配层 ───────────────────────────────────────────────── */

/**
 * P01-B 合入后判据所在的模块（按顺序尝试）。plan §3 链 V 写的是 frame-qa.ts 里新增
 * `FrameQaVerdict.drift` / `FRAME_DRIFT_SYSTEM` / `decideDriftVerdict`；若实现时拆成独立文件，
 * 把路径加在这里即可，脚本其余部分不用动。
 */
export const PRODUCTION_DRIFT_MODULES = [
  "src/lib/video-generation/frame-qa.ts",
  "src/lib/video-generation/frame-drift.ts",
] as const;

export interface ProductionDriftJudge {
  modulePath: string;
  system: string;
  decide: (findings: unknown[], frameCount: number) => unknown;
  /** P01-B 若导出了 user 提示词构造器就用它；否则只用一句不含判据的图片排序说明。 */
  buildUserPrompt: ((refCount: number, frameCount: number) => string) | null;
}

export type DriftJudgeResolution =
  | { ok: true; judge: ProductionDriftJudge }
  | { ok: false; reason: string };

export function resolveProductionDriftJudge(
  modulePath: string,
  mod: Record<string, unknown> | null,
): DriftJudgeResolution {
  if (!mod) return { ok: false, reason: `${modulePath} 无法加载` };
  const missing = [
    typeof mod.FRAME_DRIFT_SYSTEM === "string" ? null : "FRAME_DRIFT_SYSTEM",
    typeof mod.decideDriftVerdict === "function" ? null : "decideDriftVerdict",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    return { ok: false, reason: `${modulePath} 缺 ${missing.join(" / ")}（P01-B 未合入）` };
  }
  return {
    ok: true,
    judge: {
      modulePath,
      system: mod.FRAME_DRIFT_SYSTEM as string,
      decide: mod.decideDriftVerdict as ProductionDriftJudge["decide"],
      buildUserPrompt:
        typeof mod.buildDriftUserPrompt === "function"
          ? (mod.buildDriftUserPrompt as ProductionDriftJudge["buildUserPrompt"])
          : null,
    },
  };
}

/** 只描述图片顺序，不含任何判据——判据全在生产的 FRAME_DRIFT_SYSTEM 里。 */
export function neutralDriftUserPrompt(refCount: number, frameCount: number): string {
  return (
    `The first ${refCount} image(s) are reference photos. ` +
    `The next ${frameCount} image(s) are frames sampled evenly from ONE generated video, in order. ` +
    "Respond with the JSON envelope defined in the system instructions."
  );
}

/**
 * 把 decideDriftVerdict 的返回归一成「判漂移与否」。P01-B 的返回形状尚未定稿：
 * 认 `drifted: boolean`，或 `ok: boolean`（ok=false 视为漂移），或包在 `drift` 字段里；
 * 都不是就抛错——宁可停下来补一行适配，也不猜。
 */
export function normalizeDriftDecision(raw: unknown): { drifted: boolean; detail: unknown } {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!record) throw new Error("decideDriftVerdict 返回的不是对象，请在 normalizeDriftDecision 补适配");
  if (typeof record.drifted === "boolean") return { drifted: record.drifted, detail: raw };
  if (typeof record.ok === "boolean") return { drifted: !record.ok, detail: raw };
  if (record.drift !== undefined) return normalizeDriftDecision(record.drift);
  throw new Error(
    `decideDriftVerdict 返回形状未识别（键：${Object.keys(record).join(",")}），请在 normalizeDriftDecision 补适配`,
  );
}

/* ── 人工标签 ─────────────────────────────────────────────────────── */

export type DriftSplit = "train" | "holdout";

export interface DriftLabel {
  videoId: string;
  /** true = 人工判为漂移（正例）。 */
  drift: boolean;
  sku: string | null;
  split: DriftSplit;
}

const TRUE_LABELS = new Set(["1", "drift", "true", "yes", "漂移"]);
const FALSE_LABELS = new Set(["0", "ok", "false", "no", "正常"]);

/**
 * 标签 CSV：表头必含 `videoId,drift`；可选 `sku,split`（split 缺省 train，取值 train|holdout）。
 * videoId = 视频文件名去掉扩展名。同一 videoId 出现多次时以最后一行为准（合并后的终版标签）。
 */
export function parseDriftLabelsCsv(text: string): DriftLabel[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  const col = (name: string) => header.indexOf(name);
  if (col("videoId") < 0 || col("drift") < 0) {
    throw new Error("标签 CSV 表头必须包含 videoId,drift（可选 sku,split）");
  }
  const byId = new Map<string, DriftLabel>();
  lines.slice(1).forEach((line, offset) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const videoId = cells[col("videoId")];
    if (!videoId) throw new Error(`第 ${offset + 2} 行缺 videoId`);
    const rawDrift = (cells[col("drift")] ?? "").toLowerCase();
    let drift: boolean;
    if (TRUE_LABELS.has(rawDrift)) drift = true;
    else if (FALSE_LABELS.has(rawDrift)) drift = false;
    else throw new Error(`第 ${offset + 2} 行 drift 取值「${rawDrift}」无法识别（用 1/0）`);
    const rawSplit = col("split") >= 0 ? (cells[col("split")] ?? "").toLowerCase() : "";
    if (rawSplit && rawSplit !== "train" && rawSplit !== "holdout") {
      throw new Error(`第 ${offset + 2} 行 split 只能是 train / holdout`);
    }
    byId.set(videoId, {
      videoId,
      drift,
      sku: col("sku") >= 0 ? cells[col("sku")] || null : null,
      split: rawSplit === "holdout" ? "holdout" : "train",
    });
  });
  return [...byId.values()];
}

/* ── 召回 / 误杀 ──────────────────────────────────────────────────── */

export interface ConfusionMetrics {
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** tp / (tp + fn)；没有正例 = null。 */
  recall: number | null;
  /** 召回的 Wilson 95% 区间下界（§7 P0-1 判据要看它 ≥ 0.6）。 */
  recallCiLow: number | null;
  /** 误杀率 fp / (fp + tn)；没有负例 = null。 */
  falseKillRate: number | null;
  precision: number | null;
}

export function wilsonLowerBound(successes: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / denom);
}

/** predictions：videoId → 判漂移与否；没有预测的条目（跳过 / 失败）不计入，另行报告。 */
export function confusion(
  labels: ReadonlyArray<DriftLabel>,
  predictions: ReadonlyMap<string, boolean>,
): ConfusionMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const label of labels) {
    const predicted = predictions.get(label.videoId);
    if (predicted === undefined) continue;
    if (label.drift && predicted) tp += 1;
    else if (label.drift) fn += 1;
    else if (predicted) fp += 1;
    else tn += 1;
  }
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    n: tp + fp + fn + tn,
    tp,
    fp,
    fn,
    tn,
    recall: ratio(tp, tp + fn),
    recallCiLow: wilsonLowerBound(tp, tp + fn),
    falseKillRate: ratio(fp, fp + tn),
    precision: ratio(tp, tp + fp),
  };
}

export function confusionBySplit(
  labels: ReadonlyArray<DriftLabel>,
  predictions: ReadonlyMap<string, boolean>,
): Record<"all" | DriftSplit, ConfusionMetrics> {
  return {
    all: confusion(labels, predictions),
    train: confusion(labels.filter((label) => label.split === "train"), predictions),
    holdout: confusion(labels.filter((label) => label.split === "holdout"), predictions),
  };
}

/* ── embedding 相似度 ─────────────────────────────────────────────── */

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) throw new Error("向量维度不一致或为空");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * 从 onnx 输出取图像 embedding：二维 [1, D]（pooler_output）直接用；
 * 三维 [1, T, D]（last_hidden_state）取 CLS token（第 0 个）。
 */
export function embeddingFromOutput(data: ArrayLike<number>, dims: ReadonlyArray<number>): Float32Array {
  if (dims.length === 2 && dims[0] === 1) return Float32Array.from(Array.prototype.slice.call(data, 0, dims[1]));
  if (dims.length === 3 && dims[0] === 1) return Float32Array.from(Array.prototype.slice.call(data, 0, dims[2]));
  throw new Error(`不认识的 onnx 输出形状 [${dims.join(",")}]`);
}

/** ImageNet 归一化：rgb24 HWC 字节 → float32 NCHW（DINOv2 预处理）。 */
export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export function rgb24ToNchw(bytes: Uint8Array, size: number): Float32Array {
  const pixels = size * size;
  if (bytes.length !== pixels * 3) throw new Error(`rgb24 字节数 ${bytes.length} ≠ ${size}×${size}×3`);
  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[c * pixels + i] = (bytes[i * 3 + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return out;
}

/**
 * 一条视频的相似度分：每帧取与所有参考图的最高相似度，视频取最差的那一帧
 * （漂移往往只发生在中后段，均值会把它稀释掉）。
 */
export function videoSimilarityScore(
  frameEmbeddings: ReadonlyArray<ArrayLike<number>>,
  refEmbeddings: ReadonlyArray<ArrayLike<number>>,
): { score: number; perFrame: number[] } {
  if (frameEmbeddings.length === 0 || refEmbeddings.length === 0) {
    throw new Error("帧或参考图 embedding 为空");
  }
  const perFrame = frameEmbeddings.map((frame) =>
    Math.max(...refEmbeddings.map((ref) => cosineSimilarity(frame, ref))),
  );
  return { score: Math.min(...perFrame), perFrame };
}

/** 阈值扫描：score < threshold 判漂移；给阈值表（E13 交付物之一）。 */
export function thresholdSweep(
  labels: ReadonlyArray<DriftLabel>,
  scores: ReadonlyMap<string, number>,
  thresholds: ReadonlyArray<number>,
): Array<{ threshold: number } & Record<"all" | DriftSplit, ConfusionMetrics>> {
  return thresholds.map((threshold) => {
    const predictions = new Map<string, boolean>();
    for (const [videoId, score] of scores) predictions.set(videoId, score < threshold);
    return { threshold, ...confusionBySplit(labels, predictions) };
  });
}

/** 均匀抽帧时刻（秒）：每段中点，避开首尾黑场。 */
export function evenlySpacedTimestamps(durationSec: number, count: number): number[] {
  if (!(durationSec > 0) || count <= 0) return [];
  const step = durationSec / count;
  return Array.from({ length: count }, (_, i) => Math.round((step * i + step / 2) * 1000) / 1000);
}
