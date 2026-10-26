/**
 * P01-B 段级漂移判据（影子）：段视频抽帧 vs 参考图，逐帧判商品是否同一件、人物是否一致。
 *
 * - 开关 `FRAME_QA_DRIFT_MODE=off|shadow`，默认 off：off 不取参考图、不调 vision；
 *   shadow 只把结论记进 frameQaDetail.drift，**不改放行结论**（拦截留给 P01-G，等 E13 校准）。
 * - 参考图按行类型取：批量行 = `assignedAssets.assets[].url`；单条段行 = `brief.referenceImageUrls`
 *   按首派写回的 `directorPlan.referenceLayout`（P02-F(v)）切出实拍 + 故事板首帧。
 * - vision 调用在烧字门禁的 45s race 之外、自带 30s 超时（frame-qa.raceGateWithDrift 编排），
 *   超时 / 出错只记 `drift.skipped`，永不 throw、不影响烧字结论。
 * - 判据只复用 storyboard-gacha 的身份 / 几何扣分条目；system 与 JSON 信封在这里自己写。
 *   scripts/drift-calibrate.ts 直接 import 这里的 FRAME_DRIFT_SYSTEM / buildDriftUserPrompt /
 *   decideDriftVerdict——校准跑的就是生产这一组函数（X-SCAF-7）。
 */
import { readStoryboardReferenceLayout } from "@/lib/video-generation/storyboard-beats";
import { STORYBOARD_RUBRIC_IDENTITY_PENALTIES } from "@/lib/video-generation/storyboard-gacha";

export type FrameDriftMode = "off" | "shadow";

export function frameDriftMode(env: Record<string, string | undefined> = process.env): FrameDriftMode {
  return env.FRAME_QA_DRIFT_MODE?.trim().toLowerCase() === "shadow" ? "shadow" : "off";
}

/** 漂移 vision 调用自己的超时（从抽帧完成起算，不占烧字门禁的 45s） */
export const FRAME_DRIFT_TIMEOUT_MS = 30_000;
/** 每次最多带几张实拍（E13 前的保守值；P01-B2 按校准结论调） */
export const FRAME_DRIFT_MAX_PRODUCT_REFS = 3;
/** 单帧一致性评分低于它算漂移（E13 前的保守值，影子模式只记录） */
export const FRAME_DRIFT_SCORE_FLOOR = 4;
/** vision 精度与输出上限：与烧字门禁同为 low（P01-B2 按 E13 定档） */
export const FRAME_DRIFT_VISION_OPTIONS = { detail: "low", maxTokens: 1200 } as const;

export const FRAME_DRIFT_SYSTEM = `You are a strict continuity inspector for AI-generated ecommerce product video ads.
You will receive images in two groups, in order:
1) CONTEXT images: real reference photos of the product (the only truth for product identity, shape, parts, material, color, proportions, labels and packaging), optionally followed by an approved storyboard keyframe that defines the on-camera person, wardrobe and location.
2) FRAMES: frames sampled evenly from ONE generated video segment, in time order.
Judge every FRAME against the CONTEXT images. Heavily penalize:
${STORYBOARD_RUBRIC_IDENTITY_PENALTIES.join("\n")}
Ignore burned-in text, captions and watermarks (checked separately), and ignore normal changes of camera angle, framing, motion blur or lighting.
For EACH frame decide:
- productMatch: false only if the product shown is a different or altered product (shape, parts, color, material, proportions, labels, packaging) compared with the product photos; true if it matches or if the product is not visible in this frame.
- personConsistent: false only if a person on screen is clearly a different person (face, hair, skin tone, build, age) or wears a different outfit than in the storyboard keyframe or the earlier frames; true if consistent, if no person is on screen, or if there is no person reference.
- score: 0-10 overall fidelity of this frame to the CONTEXT images (10 = same product and same cast, 0 = unrelated).
- issues: one short sentence naming what drifted (empty string if nothing).
Respond with JSON only: {"frames":[{"index":0,"productMatch":true,"personConsistent":true,"score":9,"issues":""}, ...]} — one entry per FRAME, in the same order as given; "index" is the 0-based index within the FRAMES group.`;

/**
 * user 提示词只讲图片顺序与张数，判据全在 FRAME_DRIFT_SYSTEM。
 * 校准脚本以 (refCount, frameCount) 调用——那时参考图全按实拍算。
 */
export function buildDriftUserPrompt(
  refCount: number,
  frameCount: number,
  opts: { storyboardCount?: number } = {},
): string {
  const storyboard = Math.min(refCount, Math.max(0, opts.storyboardCount ?? 0));
  const photos = refCount - storyboard;
  const context = storyboard > 0
    ? `${photos} real product photo(s), then ${storyboard} approved storyboard keyframe(s)`
    : `${photos} real product photo(s)`;
  return (
    `The first ${refCount} image(s) are CONTEXT images: ${context}. ` +
    `The next ${frameCount} image(s) are FRAMES sampled evenly from ONE generated video segment, in time order. ` +
    "Respond with the JSON envelope defined in the system instructions."
  );
}

// ---------- 参考图 ----------

export type FrameDriftReferenceSource = "batch_assets" | "brief_storyboard" | "manual" | "none";

export interface FrameDriftReferences {
  source: FrameDriftReferenceSource;
  productUrls: string[];
  storyboardUrls: string[];
  /** 取不到参考图的原因：有值就不调 vision，记 drift.skipped */
  unavailableReason?: string;
}

export function unavailableDriftReferences(
  source: FrameDriftReferenceSource,
  reason: string,
): FrameDriftReferences {
  return { source, productUrls: [], storyboardUrls: [], unavailableReason: reason };
}

function isImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/** 批量行：assignedAssets.assets[].url 就是这条视频分到的商家实拍。 */
export function batchDriftReferences(assignedAssets: unknown): FrameDriftReferences {
  const assets =
    assignedAssets && typeof assignedAssets === "object" && !Array.isArray(assignedAssets)
      ? (assignedAssets as { assets?: unknown }).assets
      : null;
  const urls = Array.isArray(assets)
    ? [...new Set(assets.map((asset) => (asset as { url?: unknown } | null)?.url).filter(isImageUrl))]
    : [];
  if (urls.length === 0) return unavailableDriftReferences("batch_assets", "批量行没有分配到商家实拍");
  return { source: "batch_assets", productUrls: urls.slice(0, FRAME_DRIFT_MAX_PRODUCT_REFS), storyboardUrls: [] };
}

/**
 * 单条段行：brief.referenceImageUrls 按 实拍 → 切片 → 主播 → 帧 排（P02-F(v)），
 * 按 directorPlan.referenceLayout 的张数切出实拍与故事板首帧；没有布局（P02-F(v) 之前派发）就不猜。
 */
export function briefDriftReferences(
  referenceImageUrls: readonly string[] | null | undefined,
  directorPlan: unknown,
): FrameDriftReferences {
  const layout = readStoryboardReferenceLayout(directorPlan);
  if (!layout) {
    return unavailableDriftReferences("brief_storyboard", "参考图布局未知（P02-F(v) 之前派发或非故事板单条）");
  }
  const urls = (referenceImageUrls ?? []).slice(0, layout.limit);
  const productUrls = urls.slice(0, layout.productPhotoCount).filter(isImageUrl).slice(0, FRAME_DRIFT_MAX_PRODUCT_REFS);
  const firstFrame = urls[layout.productPhotoCount + layout.anchorCount + layout.personCount];
  const storyboardUrls = layout.frameCount > 0 && isImageUrl(firstFrame) ? [firstFrame] : [];
  if (productUrls.length === 0 && storyboardUrls.length === 0) {
    return unavailableDriftReferences("brief_storyboard", "参考图里没有实拍与故事板帧");
  }
  return { source: "brief_storyboard", productUrls, storyboardUrls };
}

// ---------- 判定 ----------

export interface FrameDriftFinding {
  index: number;
  /** null = vision 没给这一项 */
  productMatch: boolean | null;
  personConsistent: boolean | null;
  score: number | null;
  issues: string;
}

export interface FrameDriftResult {
  v: 1;
  mode: "shadow";
  /** false = 没跑成（无参考图 / 抽帧未完成 / 超时 / 出错），原因在 skipped */
  checked: boolean;
  skipped?: string;
  /** 影子结论：false = 检出漂移。只记录，不影响 FrameQaVerdict.ok */
  ok: boolean;
  drifted: boolean;
  /** 各帧最低分（漂移往往只在中后段，均值会稀释） */
  score: number | null;
  frameCount: number;
  frames: FrameDriftFinding[];
  issues: Array<{ frameIndex: number; detail: string }>;
  summary: string;
  references?: { source: FrameDriftReferenceSource; productCount: number; storyboardCount: number };
  elapsedMs?: number;
}

export function skipDriftResult(reason: string, references?: FrameDriftReferences): FrameDriftResult {
  return {
    v: 1,
    mode: "shadow",
    checked: false,
    skipped: reason,
    ok: true,
    drifted: false,
    score: null,
    frameCount: 0,
    frames: [],
    issues: [],
    summary: `漂移检查跳过：${reason}`,
    ...(references ? { references: referenceMeta(references) } : {}),
  };
}

function referenceMeta(references: FrameDriftReferences): NonNullable<FrameDriftResult["references"]> {
  return {
    source: references.source,
    productCount: references.productUrls.length,
    storyboardCount: references.storyboardUrls.length,
  };
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : null;
}

function asIssues(value: unknown): string {
  const text = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("; ")
    : typeof value === "string"
      ? value
      : "";
  return text.trim().slice(0, 200);
}

/**
 * 纯判定：vision 逐帧返回 → 漂移结论。任一帧商品不符 / 人物不一致 / 评分低于下限即判漂移。
 * vision 没给 frames（空数组）→ checked=false，不当成「没漂移」。
 */
export function decideDriftVerdict(findings: unknown[], frameCount: number): FrameDriftResult {
  if (!Array.isArray(findings) || findings.length === 0) {
    return skipDriftResult("vision 返回缺少 frames 数组");
  }
  const frames: FrameDriftFinding[] = findings.map((raw, position) => {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      index: typeof record.index === "number" && Number.isInteger(record.index) ? record.index : position,
      productMatch: asBoolean(record.productMatch),
      personConsistent: asBoolean(record.personConsistent),
      score: asScore(record.score),
      issues: asIssues(record.issues),
    };
  });
  const issues: FrameDriftResult["issues"] = [];
  for (const frame of frames) {
    const reasons: string[] = [];
    if (frame.productMatch === false) reasons.push("商品与参考图不一致");
    if (frame.personConsistent === false) reasons.push("人物与故事板不一致");
    if (frame.score !== null && frame.score < FRAME_DRIFT_SCORE_FLOOR) {
      reasons.push(`一致性 ${frame.score}/10 低于 ${FRAME_DRIFT_SCORE_FLOOR}`);
    }
    if (reasons.length > 0) {
      issues.push({ frameIndex: frame.index, detail: `${reasons.join("、")}${frame.issues ? `（${frame.issues}）` : ""}` });
    }
  }
  const scores = frames.map((frame) => frame.score).filter((score): score is number => score !== null);
  const score = scores.length > 0 ? Math.min(...scores) : null;
  const drifted = issues.length > 0;
  return {
    v: 1,
    mode: "shadow",
    checked: true,
    ok: !drifted,
    drifted,
    score,
    frameCount,
    frames,
    issues,
    summary: drifted
      ? `漂移影子：${issues.map((issue) => `第${issue.frameIndex + 1}帧 ${issue.detail}`).join("；")}`
      : `漂移影子：${frameCount} 帧商品 / 人物一致${score !== null ? `（最低 ${score}/10）` : ""}`,
  };
}

// ---------- 执行（vision 注入，永不 throw） ----------

export type DriftVisionCall = (
  imageUrls: string[],
  system: string,
  user: string,
  options: { detail: "low" | "high" | "auto"; maxTokens: number },
) => Promise<{ data: unknown }>;

export async function runFrameDriftCheck(args: {
  frames: string[];
  references: FrameDriftReferences;
  analyze: DriftVisionCall;
  timeoutMs?: number;
  now?: () => number;
}): Promise<FrameDriftResult> {
  const { references } = args;
  if (references.unavailableReason) return skipDriftResult(references.unavailableReason, references);
  const contextUrls = [...references.productUrls, ...references.storyboardUrls];
  if (contextUrls.length === 0) return skipDriftResult("没有参考图", references);
  if (args.frames.length === 0) return skipDriftResult("段视频没有抽到帧", references);
  const now = args.now ?? Date.now;
  const timeoutMs = args.timeoutMs ?? FRAME_DRIFT_TIMEOUT_MS;
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const judged = (async () => {
      const { data } = await args.analyze(
        [...contextUrls, ...args.frames],
        FRAME_DRIFT_SYSTEM,
        buildDriftUserPrompt(contextUrls.length, args.frames.length, {
          storyboardCount: references.storyboardUrls.length,
        }),
        { ...FRAME_DRIFT_VISION_OPTIONS },
      );
      const frames = (data as { frames?: unknown } | null)?.frames;
      return decideDriftVerdict(Array.isArray(frames) ? frames : [], args.frames.length);
    })();
    const result = await Promise.race([
      judged,
      new Promise<FrameDriftResult>((resolve) => {
        timer = setTimeout(() => resolve(skipDriftResult(`漂移检查超时（>${timeoutMs / 1000}s）`)), timeoutMs);
      }),
    ]);
    return { ...result, references: referenceMeta(references), elapsedMs: Math.max(0, now() - startedAt) };
  } catch (error) {
    return {
      ...skipDriftResult(`漂移检查异常：${(error as Error).message}`, references),
      elapsedMs: Math.max(0, now() - startedAt),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
