/**
 * 漂移判据校准（X-SCAF-7 / E13）：抽帧 → 生产 vision 判据 + 可选本地 DINOv2-small 相似度 →
 * 与人工标签比召回 / 误杀，输出阈值表。
 *
 * - vision 只用生产 P01-B 的 `FRAME_DRIFT_SYSTEM` + `decideDriftVerdict`（适配层见
 *   scripts/lib/drift-calibration.ts）；P01-B 未合入时 vision 步骤跳过并说明，不自造判据。
 * - DINOv2（D-10，免采购）走本机 onnxruntime-node + 本地 onnx 模型文件；依赖不在 package.json 里，
 *   没装就跳过并提示安装方式（`npm i --no-save onnxruntime-node`），不往仓库加重依赖。
 * - 默认干跑：只核对视频 / 标签 / 参考图 / 判据 / 依赖是否齐，不抽帧、不调 OpenAI。
 *   `--run` 才执行；其中 vision（付费）还要 `--vision --max-vision-calls N` 显式授权与硬上限。
 *
 * 用法：
 *   npx tsx scripts/drift-calibrate.ts --help
 *   npx tsx scripts/drift-calibrate.ts --videos-dir tmp/experiments-2026-11/E7/videos --labels qa/e13-labels.csv \
 *     --samples-report tmp/real-template-samples/<runKey>.json
 *   npx tsx scripts/drift-calibrate.ts ... --run --dinov2-model ~/models/dinov2-small.onnx          # 只跑本地相似度
 *   npx tsx scripts/drift-calibrate.ts ... --run --vision --max-vision-calls 60 --frames 4 --detail high
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PRODUCTION_DRIFT_MODULES,
  confusionBySplit,
  embeddingFromOutput,
  evenlySpacedTimestamps,
  neutralDriftUserPrompt,
  normalizeDriftDecision,
  parseDriftLabelsCsv,
  resolveProductionDriftJudge,
  rgb24ToNchw,
  thresholdSweep,
  videoSimilarityScore,
  type DriftJudgeResolution,
  type DriftLabel,
} from "./lib/drift-calibration";

const HELP = `drift-calibrate —— 漂移判据校准（默认干跑，不抽帧、不调 OpenAI）

  --videos-dir <dir>       成片目录（默认 env VIDEO_DIR，否则 tmp/real-template-samples/template-samples-20260803-v1-videos）
  --labels <csv>           人工标签：videoId,drift[,sku,split]（videoId = 文件名去扩展名；split = train|holdout）
  --refs <json>            参考图映射 { "<videoId 或 sku>": ["<本地路径或 https URL>", ...] }
  --samples-report <json>  或者用样片脚本报告：videoId 的 slug → 产品集 → productImages
  --frames <n>             每条抽帧数（默认 6；E13 对照 4 / 6）
  --detail low|high        vision 图片精度（默认 low；E13 对照 low / high）
  --dinov2-model <onnx>    本地 DINOv2-small onnx 模型；要求本机装了 onnxruntime-node
  --thresholds <list>      相似度阈值表（默认 0.30..0.90 步长 0.05；score < 阈值判漂移）
  --run                    真的执行（抽帧 + 相似度；不带 --vision 时零花费）
  --vision                 同时跑生产 vision 判据（付费，需 OPENAI_API_KEY）
  --max-vision-calls <n>   vision 调用硬上限（--vision 时必填；超出直接拒绝，不截断）
  --out <file>             结果 JSON（默认 tmp/experiments-2026-11/E13/drift-calibrate-<时间>.json）
  --help                   打印本说明`;

interface Cli {
  videosDir: string;
  labels: string | null;
  refs: string | null;
  samplesReport: string | null;
  frames: number;
  detail: "low" | "high";
  dinov2Model: string | null;
  thresholds: number[];
  run: boolean;
  vision: boolean;
  maxVisionCalls: number | null;
  out: string | null;
  help: boolean;
}

const DEFAULT_THRESHOLDS = Array.from({ length: 13 }, (_, i) => Math.round((0.3 + i * 0.05) * 100) / 100);

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    videosDir:
      process.env.VIDEO_DIR?.trim() || "tmp/real-template-samples/template-samples-20260803-v1-videos",
    labels: null,
    refs: null,
    samplesReport: null,
    frames: 6,
    detail: "low",
    dinov2Model: null,
    thresholds: DEFAULT_THRESHOLDS,
    run: false,
    vision: false,
    maxVisionCalls: null,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const eq = argv[i].indexOf("=");
    const [flag, inline] = eq > 0 ? [argv[i].slice(0, eq), argv[i].slice(eq + 1)] : [argv[i], undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag} 缺参数`);
      return v;
    };
    switch (flag) {
      case "--help":
      case "-h":
        cli.help = true;
        break;
      case "--videos-dir":
        cli.videosDir = value();
        break;
      case "--labels":
        cli.labels = value();
        break;
      case "--refs":
        cli.refs = value();
        break;
      case "--samples-report":
        cli.samplesReport = value();
        break;
      case "--frames": {
        const n = Number.parseInt(value(), 10);
        if (!(n >= 1 && n <= 12)) throw new Error("--frames 取 1–12");
        cli.frames = n;
        break;
      }
      case "--detail": {
        const v = value();
        if (v !== "low" && v !== "high") throw new Error("--detail 只能是 low / high");
        cli.detail = v;
        break;
      }
      case "--dinov2-model":
        cli.dinov2Model = value();
        break;
      case "--thresholds":
        cli.thresholds = value().split(",").map(Number).filter((n) => Number.isFinite(n));
        break;
      case "--run":
        cli.run = true;
        break;
      case "--vision":
        cli.vision = true;
        break;
      case "--max-vision-calls": {
        const n = Number.parseInt(value(), 10);
        if (!(n > 0)) throw new Error("--max-vision-calls 必须是正整数");
        cli.maxVisionCalls = n;
        break;
      }
      case "--out":
        cli.out = value();
        break;
      default:
        throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return cli;
}

/** videoId 的 slug：样片脚本的非默认臂文件名是 `<slug>--<arm>`。 */
function slugOf(videoId: string): string {
  return videoId.split("--")[0];
}

function loadRefs(cli: Cli): (label: DriftLabel) => string[] {
  if (cli.refs) {
    const map = JSON.parse(readFileSync(cli.refs, "utf8")) as Record<string, string[]>;
    return (label) => map[label.videoId] ?? (label.sku ? map[label.sku] : undefined) ?? [];
  }
  if (cli.samplesReport) {
    const report = JSON.parse(readFileSync(cli.samplesReport, "utf8")) as {
      productImages?: Record<string, string[]>;
      items?: Array<{ slug: string; set: string }>;
    };
    const setBySlug = new Map((report.items ?? []).map((item) => [item.slug, item.set]));
    return (label) => {
      const set = setBySlug.get(slugOf(label.videoId)) ?? label.sku ?? "";
      return report.productImages?.[set] ?? [];
    };
  }
  return () => [];
}

async function resolveJudge(): Promise<DriftJudgeResolution> {
  const reasons: string[] = [];
  for (const relative of PRODUCTION_DRIFT_MODULES) {
    const file = path.resolve(process.cwd(), relative);
    if (!existsSync(file)) {
      reasons.push(`${relative} 不存在`);
      continue;
    }
    const mod = (await import(pathToFileURL(file).href).catch(() => null)) as Record<string, unknown> | null;
    const resolution = resolveProductionDriftJudge(relative, mod);
    if (resolution.ok) return resolution;
    reasons.push(resolution.reason);
  }
  return { ok: false, reason: reasons.join("；") };
}

type OrtModule = {
  InferenceSession: { create(model: string): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
};
type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: readonly number[] }>>;
};

async function loadOnnxRuntime(): Promise<{ ort: OrtModule | null; reason: string | null }> {
  try {
    const specifier = "onnxruntime-node";
    const ort = (await import(specifier)) as OrtModule & { default?: OrtModule };
    return { ort: ort.InferenceSession ? ort : (ort.default ?? null), reason: null };
  } catch {
    return {
      ort: null,
      reason: "未安装 onnxruntime-node（本机执行 `npm i --no-save onnxruntime-node`，不进 package.json）",
    };
  }
}

const DINO_SIZE = 224;

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(HELP);
    return;
  }

  const videoFiles = existsSync(cli.videosDir)
    ? readdirSync(cli.videosDir).filter((name) => /\.(mp4|mov|webm)$/i.test(name))
    : [];
  const fileById = new Map(videoFiles.map((name) => [name.replace(/\.[^.]+$/, ""), path.join(cli.videosDir, name)]));
  const labels = cli.labels && existsSync(cli.labels) ? parseDriftLabelsCsv(readFileSync(cli.labels, "utf8")) : [];
  const refsOf = loadRefs(cli);
  const matched = labels.filter((label) => fileById.has(label.videoId));
  const missingRefs = matched.filter((label) => refsOf(label).length === 0).map((label) => label.videoId);
  const judge = await resolveJudge();
  const onnx = cli.dinov2Model ? await loadOnnxRuntime() : { ort: null, reason: "未指定 --dinov2-model" };
  const dinoReady = Boolean(onnx.ort && cli.dinov2Model && existsSync(cli.dinov2Model));
  const visionCalls = matched.length;

  const plan = {
    mode: cli.run ? "run" : "dry-run",
    videosDir: cli.videosDir,
    videosFound: videoFiles.length,
    labels: {
      file: cli.labels,
      total: labels.length,
      positives: labels.filter((label) => label.drift).length,
      negatives: labels.filter((label) => !label.drift).length,
      holdout: labels.filter((label) => label.split === "holdout").length,
      matchedVideos: matched.length,
      unmatched: labels.filter((label) => !fileById.has(label.videoId)).map((label) => label.videoId),
    },
    refs: { source: cli.refs ?? cli.samplesReport ?? null, missingFor: missingRefs },
    frames: cli.frames,
    detail: cli.detail,
    visionJudge: judge.ok ? { ready: true, module: judge.judge.modulePath } : { ready: false, reason: judge.reason },
    vision: {
      requested: cli.vision,
      plannedCalls: visionCalls,
      imagesPerCall: `${cli.frames} 帧 + 参考图`,
      maxVisionCalls: cli.maxVisionCalls,
    },
    dinov2: dinoReady
      ? { ready: true, model: cli.dinov2Model }
      : { ready: false, reason: onnx.reason ?? `模型文件不存在：${cli.dinov2Model}` },
  };

  if (!cli.run) {
    console.log(JSON.stringify(plan, null, 2));
    console.log("干跑结束：未抽帧、未调用任何付费接口。加 --run 执行（vision 另需 --vision --max-vision-calls）。");
    return;
  }
  if (matched.length === 0) throw new Error("没有任何标签条目能对上视频文件，先检查 --videos-dir 与 --labels");
  const runVision = cli.vision && judge.ok;
  if (cli.vision && !judge.ok) console.warn(`⚠ vision 跳过：${judge.reason}`);
  if (runVision) {
    if (cli.maxVisionCalls === null) throw new Error("--vision 必须同时给 --max-vision-calls 硬上限");
    if (visionCalls > cli.maxVisionCalls) {
      throw new Error(`vision 预计 ${visionCalls} 次 > 上限 ${cli.maxVisionCalls}，拒绝执行（缩小标签集或调高上限）`);
    }
  }
  if (!runVision && !dinoReady) {
    const visionWhy = !cli.vision ? "未带 --vision" : judge.ok ? "" : judge.reason;
    throw new Error(`vision 与 DINOv2 都不可用，无事可做：vision=${visionWhy}；dinov2=${onnx.reason ?? "模型文件不存在"}`);
  }

  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
  const { probeMedia, runFfmpeg } = await import("../src/lib/media/ffmpeg-bin");
  const ai = runVision ? await import("../src/lib/ai") : null;
  const session = dinoReady ? await onnx.ort!.InferenceSession.create(cli.dinov2Model!) : null;

  async function embed(source: string, workDir: string, name: string, seekSec?: number): Promise<Float32Array> {
    const rawPath = path.join(workDir, `${name}.rgb`);
    await runFfmpeg(
      [
        "-v", "error",
        ...(seekSec !== undefined ? ["-ss", String(seekSec)] : []),
        "-i", source,
        "-frames:v", "1",
        "-vf", `scale=${DINO_SIZE}:${DINO_SIZE}`,
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        rawPath, "-y",
      ],
      { timeoutMs: 30_000 },
    );
    const tensor = new onnx.ort!.Tensor("float32", rgb24ToNchw(new Uint8Array(await readFile(rawPath)), DINO_SIZE), [1, 3, DINO_SIZE, DINO_SIZE]);
    const output = await session!.run({ [session!.inputNames[0]]: tensor });
    const first = output[session!.outputNames[0]];
    return embeddingFromOutput(first.data, first.dims);
  }

  async function imageDataUrl(source: string): Promise<string> {
    if (/^https:\/\//i.test(source)) return source;
    const ext = path.extname(source).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${(await readFile(source)).toString("base64")}`;
  }

  const results: Array<Record<string, unknown>> = [];
  const visionPredictions = new Map<string, boolean>();
  const similarityScores = new Map<string, number>();
  let visionCallsUsed = 0;

  for (const label of matched) {
    const file = fileById.get(label.videoId)!;
    const refs = refsOf(label);
    const workDir = await mkdtemp(path.join(tmpdir(), "drift-calibrate-"));
    const row: Record<string, unknown> = { videoId: label.videoId, drift: label.drift, split: label.split, sku: label.sku, refs: refs.length };
    try {
      const probe = await probeMedia(file).catch(() => null);
      const times = evenlySpacedTimestamps(probe?.durationSec && probe.durationSec > 0 ? probe.durationSec : 15, cli.frames);

      if (runVision && refs.length > 0) {
        const framePaths: string[] = [];
        for (const [index, t] of times.entries()) {
          const out = path.join(workDir, `f${index}.jpg`);
          await runFfmpeg(["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=480:-1", "-q:v", "6", out, "-y"], { timeoutMs: 30_000 });
          framePaths.push(out);
        }
        const images = [...(await Promise.all(refs.map(imageDataUrl))), ...(await Promise.all(framePaths.map(imageDataUrl)))];
        const prompt = judge.ok && judge.judge.buildUserPrompt
          ? judge.judge.buildUserPrompt(refs.length, framePaths.length)
          : neutralDriftUserPrompt(refs.length, framePaths.length);
        const started = Date.now();
        visionCallsUsed += 1;
        const response = await ai!.analyzeImages(images, judge.ok ? judge.judge.system : "", prompt, { detail: cli.detail });
        const findings = Array.isArray((response.data as { frames?: unknown }).frames)
          ? ((response.data as { frames: unknown[] }).frames)
          : [];
        const decision = normalizeDriftDecision(judge.ok ? judge.judge.decide(findings, framePaths.length) : null);
        visionPredictions.set(label.videoId, decision.drifted);
        row.vision = { drifted: decision.drifted, ms: Date.now() - started, model: response.modelUsed, tokenUsage: response.tokenUsage, decision: decision.detail };
      } else if (runVision) {
        row.vision = { skipped: "没有参考图" };
      }

      if (session && refs.length > 0) {
        const refEmbeddings = [];
        for (const [index, ref] of refs.entries()) refEmbeddings.push(await embed(ref, workDir, `r${index}`));
        const frameEmbeddings = [];
        for (const [index, t] of times.entries()) frameEmbeddings.push(await embed(file, workDir, `e${index}`, t));
        const { score, perFrame } = videoSimilarityScore(frameEmbeddings, refEmbeddings);
        similarityScores.set(label.videoId, score);
        row.dinov2 = { score, perFrame };
      } else if (session) {
        row.dinov2 = { skipped: "没有参考图" };
      }
    } catch (error) {
      row.error = (error as Error).message.slice(0, 300);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
    results.push(row);
    console.error(`· ${label.videoId} ${JSON.stringify({ vision: row.vision ?? null, dinov2: (row.dinov2 as { score?: number } | undefined)?.score ?? null, error: row.error ?? null })}`);
  }

  const summary = {
    ...plan,
    visionCallsUsed,
    visionMetrics: runVision ? confusionBySplit(matched, visionPredictions) : null,
    dinov2Thresholds: session ? thresholdSweep(matched, similarityScores, cli.thresholds) : null,
    results,
  };
  const out =
    cli.out ??
    path.resolve(process.cwd(), "tmp/experiments-2026-11/E13", `drift-calibrate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ out, visionCallsUsed, visionHoldout: summary.visionMetrics?.holdout ?? null }, null, 2));
}

main().catch((error) => {
  console.error(`[drift-calibrate] ${(error as Error).message}`);
  process.exitCode = 1;
});
