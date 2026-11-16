/**
 * 导演线路 CLI（2026-11-16）：Claude 写镜头脚本 → OpenAI gpt-image-2 出故事板 → Shuyu Seedance 出片。
 * 规程：.claude/skills/aivora-director/SKILL.md；纯逻辑：scripts/lib/director-plan.ts。
 *
 * 一条视频一个任务目录（缺省 tmp/director/<任务名>/，tmp 不进仓库），里面的 job.json 由导演（Claude）写：
 *   check   <任务目录>   校验脚本、打印拼好的提示词与参考图顺序、按实时价目估算点数。不花钱
 *   frames  <任务目录>   出故事板帧（OpenAI）。不带 --confirm-spend 只打印要出几张
 *   select  <任务目录>   --frame <帧 id> --variant <第几张>：定稿这一帧
 *   video   <任务目录>   出片（Shuyu）。不带 --confirm-spend --max-points <上限> 只打印估算
 *   review  <任务目录>   看片用的抽帧：每个镜头从切点起取几帧拼成图，外加静音段与片尾检查。不花钱
 *   post    <任务目录>   本地后期：按 cuts 切成几条、烧字幕、压片尾落款（复用线上合成器）。不花点数
 *   status  <任务目录>   看进度
 *
 * 例：
 *   npm run director -- check tmp/director/zebra-blind-01
 *   npm run director -- frames tmp/director/zebra-blind-01 --confirm-spend
 *   npm run director -- select tmp/director/zebra-blind-01 --frame opening --variant 2
 *   npm run director -- video tmp/director/zebra-blind-01 --confirm-spend --max-points 2000
 *
 * 出片缺省 Seedance 2.5 · 720P（按时长取最便宜的一档）；--resolution 1080P 才用 1080P。
 * 试别家模型：--family any --plan <套餐 id>（必须点名套餐，例：MiniMax H3）。
 * 随时 Ctrl-C：每一步落盘（state.json），重跑从断点续上——有任务号的只续查、绝不重提；
 * 提交确认未知的用同一个幂等键重投。绝不碰数据库（DATABASE_URL 换成连不上的地址）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  buildFramePrompt,
  buildVideoPrompt,
  directorParts,
  directorRequestKey,
  directorSpokenLines,
  initialDirectorState,
  lintDirectorJob,
  meetsResolution,
  nextDirectorVideoStep,
  openAiFrameSize,
  parseDirectorJob,
  partScript,
  rankDirectorVideoPlans,
  reviewFrameTimes,
  scriptSpeechWords,
  selectedFrameVariant,
  videoReferenceOrder,
  type DirectorJob,
  type DirectorPriceEntry,
  type DirectorResolution,
  type DirectorState,
  type DirectorVideoAttempt,
  type DirectorVideoPlan,
} from "../lib/director-plan";
import { SHUYU_RESERVE_POINTS_DEFAULT, checkBudgetGate, estimateSpend, parsePositiveLimit } from "../lib/experiment-budget";

const REPO = resolve(__dirname, "../..");
const NO_DATABASE_URL = "postgresql://director-no-db@127.0.0.1:9/none";
const FRAME_MODEL = "gpt-image-2";
const FRAME_IMAGES_MAX_DEFAULT = 8;
const VIDEO_POLL_MS = 15_000;
/// Shuyu 约两成的片要 30–67 分钟（11-10 实测），一次最多守 75 分钟；到点放下，重跑接着查
const VIDEO_POLL_DEADLINE_MS = 75 * 60_000;

type Flags = Record<string, string | true>;

function parseArgs(argv: readonly string[]): { command: string; jobDir: string | null; flags: Flags } {
  const [command = "", ...rest] = argv;
  const flags: Flags = {};
  let jobDir: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) {
      jobDir ??= token;
      continue;
    }
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { command, jobDir, flags };
}

function flag(flags: Flags, name: string): string | null {
  const value = flags[name];
  return typeof value === "string" ? value : null;
}

function fail(message: string): never {
  console.error(`[director] ${message}`);
  process.exit(1);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const now = () => new Date().toISOString();

function loadEnv(): void {
  loadEnvConfig(REPO, true);
  process.env.DATABASE_URL = NO_DATABASE_URL;
  process.env.DIRECT_URL = NO_DATABASE_URL;
  process.env.CAPABILITY_WRITE_THROUGH = "0";
  /// 这条线路只做真实出片，杜绝被本地 mock 静默降级
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.IMAGE_ENGINE_MOCK = "false";
  process.env.VIDEO_PROVIDER = "shuyu";
}

interface Workspace {
  dir: string;
  job: DirectorJob;
  state: DirectorState;
  save: () => void;
}

function openWorkspace(jobDir: string | null): Workspace {
  if (!jobDir) fail("要给任务目录，例：npm run director -- check tmp/director/<任务名>");
  const dir = resolve(REPO, jobDir);
  const jobFile = join(dir, "job.json");
  if (!existsSync(jobFile)) fail(`找不到 ${relative(REPO, jobFile)}`);
  let job: DirectorJob;
  try {
    job = parseDirectorJob(JSON.parse(readFileSync(jobFile, "utf8")));
  } catch (error) {
    fail(`job.json 不合格：\n${errorText(error)}`);
  }
  const stateFile = join(dir, "state.json");
  const state: DirectorState = existsSync(stateFile)
    ? (JSON.parse(readFileSync(stateFile, "utf8")) as DirectorState)
    : initialDirectorState(job.id);
  if (state.jobId !== job.id) fail(`state.json 是任务 ${state.jobId} 的，job.json 是 ${job.id}：换个目录，别混用`);
  const save = () => writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return { dir, job, state, save };
}

/** 有错就停；提醒照打，导演自己判断认不认。 */
function lintOrExit(job: DirectorJob): void {
  const lint = lintDirectorJob(job);
  for (const warning of lint.warnings) console.log(`[director] 提醒：${warning}`);
  if (lint.errors.length > 0) {
    for (const error of lint.errors) console.error(`[director] 不合格：${error}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 参考图：本地文件或 https 地址
// ---------------------------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function sniffImageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

interface LoadedImage {
  bytes: Buffer;
  mimeType: string;
  /// 已经是公开 https 地址的原样带给 Shuyu，不用再传一遍
  publicUrl: string | null;
  name: string;
}

async function loadImage(workspace: Workspace, source: string): Promise<LoadedImage> {
  if (/^https:\/\//iu.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`取不到参考图 ${source}（HTTP ${response.status}）`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType) throw new Error(`参考图 ${source} 不是 png / jpg / webp`);
    return { bytes, mimeType, publicUrl: source, name: basename(new URL(source).pathname) || "reference" };
  }
  const candidates = isAbsolute(source) ? [source] : [join(workspace.dir, source), join(REPO, source)];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`找不到参考图 ${source}（按任务目录和仓库根目录都找过）`);
  const bytes = readFileSync(file);
  const mimeType = sniffImageType(bytes) ?? IMAGE_TYPES[extname(file).toLowerCase()] ?? null;
  if (!mimeType || !sniffImageType(bytes)) throw new Error(`参考图 ${source} 不是 png / jpg / webp（HEIC 先转成 jpg）`);
  return { bytes, mimeType, publicUrl: null, name: basename(file) };
}

/** 本地图传到我们自己的存储，拿公开地址给 Shuyu；内容没变就不重传。 */
async function publicUrlFor(workspace: Workspace, id: string, image: LoadedImage): Promise<string> {
  if (image.publicUrl) return image.publicUrl;
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  const known = workspace.state.uploads[id];
  if (known?.sha256 === sha256) return known.url;
  const { getStorageProvider } = await import("@/lib/storage");
  const storage = getStorageProvider();
  if (!storage.isConfigured()) throw new Error("存储没配好（BLOB_READ_WRITE_TOKEN），本地图没法给 Shuyu");
  const extension = image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
  const uploaded = await storage.uploadBuffer("renders", image.bytes, {
    key: `director/${workspace.job.id}/${id}-${sha256.slice(0, 16)}.${extension}`,
    contentType: image.mimeType,
    access: "public",
    overwrite: true,
  });
  workspace.state.uploads[id] = { url: uploaded.url, sha256 };
  workspace.save();
  return uploaded.url;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function loadShuyuPrices(): Promise<DirectorPriceEntry[]> {
  const { getShuyuPrices } = await import("@/lib/providers/shuyu");
  return (await getShuyuPrices({ timeoutMs: 20_000 })).data;
}

function ladderFor(job: DirectorJob, prices: DirectorPriceEntry[], flags: Flags): DirectorVideoPlan[] {
  const resolution = flag(flags, "resolution")?.toUpperCase() ?? null;
  if (resolution && !["1080P", "720P", "480P"].includes(resolution)) fail("--resolution 只能是 1080P / 720P / 480P");
  const family = flag(flags, "family");
  if (family && family !== "seedance-2.5" && family !== "seedance-2.0" && family !== "any") fail("--family 只能是 seedance-2.5 / seedance-2.0 / any");
  if (family === "any" && !flag(flags, "plan")) fail("--family any 必须同时给 --plan <套餐 id>：别家模型只能点名一档来试");
  const maxResolution = (resolution as DirectorResolution | null) ?? undefined;
  return rankDirectorVideoPlans(prices, {
    durationSec: job.durationSec,
    aspectRatio: job.aspectRatio,
    referenceCount: videoReferenceOrder(job).length,
    ...(maxResolution ? { maxResolution } : {}),
    /// 点名了更低的档就以它为底；--no-step-down 把底抬到起始档
    ...(maxResolution === "480P" ? { minResolution: "480P" as const } : {}),
    ...(flags["no-step-down"] && maxResolution ? { minResolution: maxResolution } : {}),
    ...(family ? { family: family as "seedance-2.5" | "seedance-2.0" | "any" } : {}),
    ...(flag(flags, "plan") ? { planId: flag(flags, "plan")! } : {}),
  });
}

async function commandCheck(workspace: Workspace, flags: Flags): Promise<void> {
  const { job } = workspace;
  lintOrExit(job);
  console.log(`\n== ${job.title}（${job.id}）· ${job.aspectRatio} · ${job.durationSec} 秒`);
  for (const frame of job.frames) {
    const prompt = buildFramePrompt(job, frame);
    console.log(`\n-- 故事板帧 ${frame.id}（出 ${frame.variants} 张，${openAiFrameSize(job.aspectRatio)}，参考图 ${frame.references.join(", ") || "无"}，${prompt.length} 字）\n${prompt}`);
  }
  const prompt = buildVideoPrompt(job);
  console.log(`\n-- 出片参考图顺序（提示词里的 image N）`);
  videoReferenceOrder(job).forEach((reference, index) => console.log(`   image ${index + 1} = ${reference.id}${reference.openingFrame ? "（开场帧）" : reference.frame ? "（故事板帧）" : ""}`));
  const parts = directorParts(job);
  if (parts.length > 1) console.log(`\n-- 分条交付：${parts.map((part) => `第 ${part.index} 条 ${part.fromSec}–${part.toSec} 秒`).join("，")}`);
  const lines = directorSpokenLines(job);
  if (lines.length > 0) {
    console.log("\n-- 台词（字幕按这个时间烧；开通语音识别后跟着人声走）");
    for (const line of lines) console.log(`   镜头 ${line.shot}（${line.fromSec.toFixed(1)}–${line.toSec.toFixed(1)} 秒）${line.text}`);
  }
  console.log(`\n-- 出片提示词（${prompt.length} 字）\n${prompt}`);
  if (flags.offline) return;
  const ladder = ladderFor(job, await loadShuyuPrices(), flags);
  console.log("\n-- Shuyu 套餐阶梯（按实时价目；第一档先试）");
  if (ladder.length === 0) console.log("   没有符合条件的套餐：换时长 / 画幅，或检查价目表");
  for (const plan of ladder) console.log(`   ${plan.planId}  ${plan.displayName}  ${plan.points} 点（${plan.unitSalePoints}/${plan.billingUnit === "second" ? "秒" : "条"}）`);
  console.log("\n[director] 脚本合格。下一步：frames --confirm-spend");
}

// ---------------------------------------------------------------------------
// frames：OpenAI gpt-image-2
// ---------------------------------------------------------------------------

async function commandFrames(workspace: Workspace, flags: Flags): Promise<void> {
  const { job, state } = workspace;
  lintOrExit(job);
  const only = flag(flags, "frame");
  const quality = (flag(flags, "quality") ?? "high") as "low" | "medium" | "high";
  if (!["low", "medium", "high"].includes(quality)) fail("--quality 只能是 low / medium / high");
  const extra = parsePositiveLimit(flag(flags, "more")) ?? 0;
  const maxImages = parsePositiveLimit(flag(flags, "max-images")) ?? FRAME_IMAGES_MAX_DEFAULT;
  const frames = job.frames.filter((frame) => !only || frame.id === only);
  if (frames.length === 0) fail(`没有帧 ${only}`);

  /// 每帧还差几张：脚本要的张数 − 已成的；--more N 在已有的基础上再抽 N 张
  const todo = frames.map((frame) => {
    const entry = (state.frames[frame.id] ??= { variants: [], selected: null });
    const done = entry.variants.filter((variant) => variant.status === "done").length;
    return { frame, entry, count: Math.max(0, frame.variants - done) + extra };
  });
  const total = todo.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return console.log("[director] 故事板帧都出好了。要再抽：frames --more 1 --confirm-spend");
  console.log(`[director] 要出 ${total} 张故事板帧（${FRAME_MODEL}，${openAiFrameSize(job.aspectRatio)}，quality=${quality}）`);
  if (total > maxImages) fail(`一次最多出 ${maxImages} 张（--max-images 可改）`);
  if (!flags["confirm-spend"]) return console.log("[director] 没带 --confirm-spend：只是预演，没有调用 OpenAI");
  if (!process.env.OPENAI_API_KEY) fail("没有 OPENAI_API_KEY");

  const { default: OpenAI } = await import("openai");
  const { toFile } = await import("openai/uploads");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60_000, maxRetries: 1 });
  const framesDir = join(workspace.dir, "frames");
  mkdirSync(framesDir, { recursive: true });

  let succeeded = 0;
  for (const { frame, entry, count } of todo) {
    const prompt = buildFramePrompt(job, frame);
    const inputs = await Promise.all(
      frame.references.map(async (id) => {
        const reference = job.references.find((item) => item.id === id)!;
        const image = await loadImage(workspace, reference.source);
        return toFile(image.bytes, image.name, { type: image.mimeType });
      }),
    );
    for (let round = 0; round < count; round += 1) {
      const index = entry.variants.reduce((max, variant) => Math.max(max, variant.index), 0) + 1;
      const size = openAiFrameSize(job.aspectRatio);
      console.log(`[director] 帧 ${frame.id} 第 ${index} 张…`);
      try {
        const response =
          inputs.length > 0
            ? /// 不带 input_fidelity：gpt-image-2 不收这个参数（11-16 真机 400），它本来就按高保真处理输入图
              await openai.images.edit({ model: FRAME_MODEL, image: inputs, prompt, size, quality, n: 1 })
            : await openai.images.generate({ model: FRAME_MODEL, prompt, size, quality, n: 1 });
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) throw new Error("OpenAI 没有返回图片");
        const file = join(framesDir, `${frame.id}-v${index}.png`);
        writeFileSync(file, Buffer.from(b64, "base64"));
        entry.variants.push({
          index,
          status: "done",
          file: relative(workspace.dir, file),
          model: FRAME_MODEL,
          size,
          quality,
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          createdAt: now(),
        });
        /// 多了一张就要重新挑
        if (entry.variants.filter((variant) => variant.status === "done").length > 1) entry.selected = null;
        succeeded += 1;
        console.log(`[director] 帧 ${frame.id} 第 ${index} 张 → ${relative(REPO, file)}`);
      } catch (error) {
        entry.variants.push({ index, status: "failed", error: errorText(error), createdAt: now() });
        console.error(`[director] 帧 ${frame.id} 第 ${index} 张失败：${errorText(error)}`);
      }
      workspace.save();
    }
  }
  if (succeeded < total) console.error(`[director] ${total - succeeded} 张没出来（原因见上）；重跑 frames 会补上`);
  if (succeeded > 0) console.log("[director] 下一步：导演逐张看图（商品走样、文字乱码、正脸、构图），再 select --frame <id> --variant <n>");
  if (succeeded === 0) process.exitCode = 1;
}

function commandSelect(workspace: Workspace, flags: Flags): void {
  const frameId = flag(flags, "frame");
  const variant = parsePositiveLimit(flag(flags, "variant"));
  if (!frameId || !variant) fail("用法：select <任务目录> --frame <帧 id> --variant <第几张>");
  const entry = workspace.state.frames[frameId];
  const chosen = entry?.variants.find((item) => item.index === variant && item.status === "done");
  if (!entry || !chosen) fail(`帧 ${frameId} 没有出好的第 ${variant} 张`);
  entry.selected = variant;
  workspace.save();
  console.log(`[director] 帧 ${frameId} 定稿：${chosen.file}`);
}

// ---------------------------------------------------------------------------
// video：Shuyu Seedance
// ---------------------------------------------------------------------------

function probeVideo(file: string): { width: number | null; height: number | null; durationSec: number | null; hasAudio: boolean } {
  try {
    const probe = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { encoding: "utf8" }),
    ) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      durationSec: probe.format?.duration ? Math.round(Number(probe.format.duration) * 10) / 10 : null,
      hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")),
    };
  } catch {
    return { width: null, height: null, durationSec: null, hasAudio: false };
  }
}

async function commandVideo(workspace: Workspace, flags: Flags): Promise<void> {
  const { job, state } = workspace;
  lintOrExit(job);
  /// 出片要带的故事板帧（开场帧、关键帧、分镜总览图）都得先看过图、定了稿
  const frameFiles = new Map<string, string>();
  for (const reference of videoReferenceOrder(job)) {
    if (!reference.frame) continue;
    const chosen = selectedFrameVariant(state, reference.id);
    if (!chosen?.file) fail(`故事板帧 ${reference.id} 还没定稿：先 frames，看过图再 select`);
    frameFiles.set(reference.id, chosen.file);
  }

  const { createShuyuVideoTask, getShuyuBalance } = await import("@/lib/providers/shuyu");
  const { ProviderSubmissionError } = await import("@/lib/video-generation/providers/submission-error");
  const { ShuyuVideoProvider } = await import("@/lib/video-generation/providers/shuyu-video-provider");
  const provider = new ShuyuVideoProvider();
  const prompt = buildVideoPrompt(job);
  const maxPoints = parsePositiveLimit(flag(flags, "max-points"));

  /// 参考图的公开地址：顺序与提示词里的 image N 一致，开场帧在最后
  const referenceUrls = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const reference of videoReferenceOrder(job)) {
      if (reference.frame) {
        const bytes = readFileSync(join(workspace.dir, frameFiles.get(reference.id)!));
        urls.push(await publicUrlFor(workspace, `frame-${reference.id}`, { bytes, mimeType: "image/png", publicUrl: null, name: `${reference.id}.png` }));
      } else {
        const source = job.references.find((item) => item.id === reference.id)!.source;
        urls.push(await publicUrlFor(workspace, reference.id, await loadImage(workspace, source)));
      }
    }
    return urls;
  };

  const submit = async (attempt: DirectorVideoAttempt): Promise<void> => {
    try {
      const { taskId } = await createShuyuVideoTask({
        providerRequestKey: attempt.requestKey,
        prompt,
        duration: job.durationSec,
        aspectRatio: job.aspectRatio,
        inputImages: await referenceUrls(),
        planId: attempt.planId,
        model: "studio-video",
        timeoutMs: 45_000,
      });
      Object.assign(attempt, { status: "submitted", taskId, submittedAt: now() });
      console.log(`[director] 已提交 ${taskId}（${attempt.displayName}，${attempt.points} 点）`);
    } catch (error) {
      /// 确认没建任务（4xx 等）才记「被拒」并换下一档；确认未知的留在 submitting，重跑用同一个键重投
      const definite = error instanceof ProviderSubmissionError && error.disposition === "definitely_not_created";
      if (definite) Object.assign(attempt, { status: "rejected", error: errorText(error), finishedAt: now() });
      else attempt.error = errorText(error);
      console.error(`[director] ${attempt.displayName} ${definite ? "当场被拒" : "提交确认未知（重跑会用同一个键重投，不会重复扣点）"}：${errorText(error)}`);
      if (!definite) {
        workspace.save();
        process.exit(1);
      }
    }
    workspace.save();
  };

  for (;;) {
    const step = nextDirectorVideoStep(state);
    if (step.kind === "done") {
      const { attempt } = step;
      const ok = meetsResolution(attempt.resolution, attempt.width ?? null, attempt.height ?? null);
      console.log(
        `[director] 成片：${attempt.localFile}（${attempt.width}×${attempt.height}，${attempt.durationSec} 秒，${attempt.hasAudio ? "有" : "没有"}声音，${attempt.displayName}，${attempt.points} 点）`,
      );
      if (!ok) console.log(`[director] 注意：买的是 ${attempt.resolution}，量出来不够这一档`);
      return console.log("[director] 下一步：导演抽帧看片（商品、动作、口型与台词、片尾有没有被截断），再决定交付还是重拍");
    }
    if (step.kind === "resubmit") {
      console.log(`[director] 上次提交确认未知，用同一个键重投（${step.attempt.requestKey}）`);
      if (!flags["confirm-spend"]) return console.log("[director] 没带 --confirm-spend：没有重投");
      await submit(step.attempt);
      continue;
    }
    if (step.kind === "poll") {
      const { attempt } = step;
      const status = await provider.getVideoJobStatus(attempt.taskId!).catch(() => null);
      if (status?.normalizedStatus === "succeeded" && status.videoUrl) {
        Object.assign(attempt, { status: "succeeded", outputUrl: status.videoUrl, finishedAt: now() });
        workspace.save();
      } else if (status?.normalizedStatus === "failed" || status?.normalizedStatus === "cancelled") {
        Object.assign(attempt, { status: "failed", error: status.errorMessage ?? status.rawProviderStatus, finishedAt: now() });
        workspace.save();
        /// 受理后失败：停下来让导演看原因（多半是参考图被审核拦了），不自动再花一次
        return console.error(`[director] Shuyu 判失败：${attempt.error}。改脚本或换开场帧后重跑 video`);
      } else if (attempt.submittedAt && Date.now() - Date.parse(attempt.submittedAt) > VIDEO_POLL_DEADLINE_MS) {
        return console.log(`[director] ${attempt.taskId} 超过 75 分钟还没结果，先放下；重跑 video 接着查，不会重提`);
      } else {
        await sleep(VIDEO_POLL_MS);
      }
      continue;
    }
    if (step.kind === "download") {
      const { attempt } = step;
      const response = await fetch(attempt.outputUrl!);
      if (!response.ok) return console.error(`[director] 成片下载失败 HTTP ${response.status}，稍后重跑 video 续上`);
      const file = join(workspace.dir, `${job.id}-take${attempt.attempt}.mp4`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      Object.assign(attempt, { localFile: relative(workspace.dir, file), ...probeVideo(file) });
      workspace.save();
      continue;
    }

    /// submit：实时价目 → 阶梯里还没被拒的第一档 → 估算、比上限、比余额，三关都过才提交
    const ladder = ladderFor(job, await loadShuyuPrices(), flags).filter((plan) => !step.triedPlanIds.includes(plan.planId));
    const plan = ladder[0];
    if (!plan) fail("没有可用的套餐了（都被拒过，或价目表里没有符合条件的档）");
    const estimate = estimateSpend([{ armId: plan.planId, count: 1, unitPoints: plan.points, unitUsd: null }]);
    console.log(`[director] 第 ${step.attemptNumber} 次出片：${plan.displayName}，预估 ${plan.points} 点，提示词 ${prompt.length} 字，参考图 ${videoReferenceOrder(job).length} 张`);
    if (!flags["confirm-spend"]) return console.log("[director] 没带 --confirm-spend：只是估算，没有提交。真要出片：--confirm-spend --max-points <上限>");
    const balance = await getShuyuBalance({ timeoutMs: 20_000 }).then((result) => result.available_points).catch(() => null);
    const gate = checkBudgetGate({ estimate, maxPoints, maxUsd: null, availablePoints: balance, reservePoints: SHUYU_RESERVE_POINTS_DEFAULT });
    if (!gate.ok) fail(`预算闸没过：\n  ${gate.reasons.join("\n  ")}`);
    const attempt: DirectorVideoAttempt = {
      attempt: step.attemptNumber,
      planId: plan.planId,
      displayName: plan.displayName,
      resolution: plan.resolution,
      points: plan.points,
      requestKey: directorRequestKey(job.id, step.attemptNumber),
      status: "submitting",
    };
    /// 先落盘再提交：进程中途断了，重跑也只会用这同一个键
    state.video.attempts.push(attempt);
    workspace.save();
    await submit(attempt);
  }
}

// ---------------------------------------------------------------------------
// review：看片用的抽帧（本机 ffmpeg，不花钱）
// ---------------------------------------------------------------------------

function latestTake(workspace: Workspace): { file: string; attempt: DirectorVideoAttempt } {
  const attempt = [...workspace.state.video.attempts].reverse().find((item) => item.status === "succeeded" && item.localFile);
  if (!attempt?.localFile) fail("还没有成片：先 video");
  const file = join(workspace.dir, attempt.localFile);
  if (!existsSync(file)) fail(`成片文件不见了：${attempt.localFile}`);
  return { file, attempt };
}

async function commandReview(workspace: Workspace, flags: Flags): Promise<void> {
  const { job } = workspace;
  const { ffmpegBin, runFfmpeg } = await import("@/lib/media/ffmpeg-bin");
  const source = flag(flags, "file") ? resolve(workspace.dir, flag(flags, "file")!) : latestTake(workspace).file;
  if (!existsSync(source)) fail(`找不到 ${source}`);
  const perShot = Math.min(6, Math.max(2, parsePositiveLimit(flag(flags, "per-shot")) ?? 4));
  const reviewDir = join(workspace.dir, "review");
  const stillsDir = join(reviewDir, "stills");
  rmSync(stillsDir, { recursive: true, force: true });
  mkdirSync(stillsDir, { recursive: true });

  /// 每个镜头一行，第一帧紧贴切点
  const times = reviewFrameTimes(job, perShot);
  times.forEach((time, index) => {
    execFileSync(ffmpegBin(), ["-v", "error", "-y", "-ss", time.atSec.toFixed(2), "-i", source, "-frames:v", "1", "-vf", "scale=300:-2", join(stillsDir, `${String(index).padStart(3, "0")}.jpg`)]);
  });
  const rowsPerSheet = 3;
  const sheets: string[] = [];
  for (let first = 0; first < job.video.shots.length; first += rowsPerSheet) {
    const rows = Math.min(rowsPerSheet, job.video.shots.length - first);
    const file = join(reviewDir, `shots-${first + 1}-${first + rows}.jpg`);
    execFileSync(ffmpegBin(), [
      "-v", "error", "-y", "-framerate", "1", "-start_number", String(first * perShot),
      "-i", join(stillsDir, "%03d.jpg"), "-frames:v", "1", "-vf", `tile=${perShot}x${rows}:nb_frames=${perShot * rows}`, file,
    ]);
    sheets.push(file);
  }
  console.log(`[director] 抽帧（每行一个镜头，每个镜头 ${perShot} 帧，第一帧紧贴切点）：`);
  for (const file of sheets) console.log(`   ${relative(REPO, file)}`);
  job.video.shots.forEach((shot, index) => console.log(`   镜头 ${index + 1}（${shot.fromSec}–${shot.toSec} 秒）${shot.action}`));

  /// 静音段与片尾：尾巴上一段静音多半是片尾被截或音乐提前收了
  const probe = probeVideo(source);
  const audio = await runFfmpeg(["-hide_banner", "-nostats", "-i", source, "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"], { allowNonZeroExit: true });
  const silences = [...audio.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/gu)].map((match) => [Number(match[1]), Number(match[2])] as const);
  const openTail = /silence_start: ([\d.]+)(?![\s\S]*silence_end)/u.exec(audio.stderr);
  console.log(`[director] 成片 ${probe.width}×${probe.height}，${probe.durationSec} 秒，${probe.hasAudio ? "有" : "没有"}声音`);
  if (silences.length === 0 && !openTail) console.log("[director] 没有 0.4 秒以上的静音段");
  for (const [from, to] of silences) console.log(`[director] 静音 ${from.toFixed(2)}–${to.toFixed(2)} 秒`);
  if (openTail) console.log(`[director] 从 ${Number(openTail[1]).toFixed(2)} 秒起静音到片尾：核对最后一句台词和音乐有没有被截`);
  if (probe.durationSec !== null && Math.abs(probe.durationSec - job.durationSec) > 0.6) console.log(`[director] 注意：脚本 ${job.durationSec} 秒，成片 ${probe.durationSec} 秒`);

  /// 台词：有语音识别就自动听一遍，没有就明说要人听
  const lines = directorSpokenLines(job);
  if (lines.length > 0 && probe.hasAudio) {
    const wav = join(reviewDir, "speech.wav");
    execFileSync(ffmpegBin(), ["-v", "error", "-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    const { transcribeSpeechWithOpenAi } = await import("@/lib/providers/openai-transcription");
    const language = lines.some((line) => /[㐀-鿿]/u.test(line.text)) ? "zh" : "en";
    const words = await transcribeSpeechWithOpenAi({ audioPath: wav, language });
    rmSync(wav, { force: true });
    console.log(`[director] 脚本台词：${lines.map((line) => line.text).join(" ")}`);
    if (words) console.log(`[director] 识别到的：${words.map((word) => word.text).join(language === "zh" ? "" : " ")}`);
    else console.log("[director] 语音识别用不了（密钥没有 whisper-1 权限，或没识别出来）：台词念得对不对要人听");
  }
  console.log("[director] 下一步：导演逐张看抽帧（商品走样、正脸、每个镜头是不是脚本写的那样、死黑 / 偏色），没问题再 post");
}

// ---------------------------------------------------------------------------
// post：本地后期（切条、字幕、片尾落款）。复用线上合成器，不花点数
// ---------------------------------------------------------------------------

async function commandPost(workspace: Workspace, flags: Flags): Promise<void> {
  const { job } = workspace;
  lintOrExit(job);
  const { file: take, attempt } = latestTake(workspace);
  const { ffmpegBin } = await import("@/lib/media/ffmpeg-bin");
  const { composeTimeline } = await import("@/lib/media/stitch-pipeline");
  const { transcribeSpeechWithOpenAi } = await import("@/lib/providers/openai-transcription");
  const captions = job.post?.captions ?? true;
  const signoff = job.post?.signoff ?? null;
  const platform = flag(flags, "platform");
  const lines = directorSpokenLines(job);
  const parts = directorParts(job);
  const language = lines.some((line) => /[㐀-鿿]/u.test(line.text)) ? "zh-CN" : "en-US";
  const workRoot = join(workspace.dir, "post-work");
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  const useRecognition = !flags["script-timing"];

  for (const part of parts) {
    const suffix = parts.length > 1 ? `-part${part.index}` : "";
    const workDir = join(workRoot, `part${part.index}`);
    mkdirSync(workDir, { recursive: true });
    let source = take;
    if (parts.length > 1) {
      /// 精确到帧只能重编码；高码率过一道，后面合成器再编最后一次
      source = join(workDir, "cut.mp4");
      execFileSync(ffmpegBin(), [
        "-v", "error", "-y", "-ss", String(part.fromSec), "-i", take, "-t", String(part.toSec - part.fromSec),
        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", source,
      ]);
    }
    const script = captions ? partScript(lines, part) : "";
    const scriptWords = scriptSpeechWords(lines, part);
    let timing = "没有字幕";
    const composed = await composeTimeline({
      clips: [{ path: source, intendedDurationSec: null, trimToFit: false, role: "ai_generated" }],
      aspectRatio: job.aspectRatio,
      postProduction: {
        audio: {
          /// 口播是视频模型自己说的，音乐也是它自己配的：这里只保留原声，不另加配音和曲库
          voiceover: { enabled: true, voiceId: "native", language, script },
          bgm: { trackId: "none", volume: 0 },
        },
        captions: { enabled: Boolean(script), style: "plain", language, position: "bottom", exportSrt: true },
        ...(signoff ? { signoff: { enabled: true, brandName: signoff.brandName, cta: signoff.cta ?? null } } : {}),
      },
      /// 字幕时间：能识别就跟着人声走；识别不了（现在的密钥没有 whisper-1）按脚本里每句台词所在的镜头推
      transcribeSpeech: script
        ? async ({ audioPath, language: spoken }) => {
            const heard = useRecognition ? await transcribeSpeechWithOpenAi({ audioPath, language: spoken }) : null;
            timing = heard ? "跟着识别到的人声" : "按脚本的镜头时间估（没有语音识别）";
            return heard ?? scriptWords;
          }
        : null,
      platform: platform ?? null,
      ...(flags["ai-badge"] ? { aiBadge: true } : platform ? {} : { aiBadge: false }),
      workDir,
      outputName: "composed.mp4",
    });
    const output = join(workspace.dir, `${job.id}-take${attempt.attempt}${suffix}-post.mp4`);
    copyFileSync(composed.videoPath, output);
    if (composed.srtPath) copyFileSync(composed.srtPath, output.replace(/\.mp4$/u, ".srt"));
    const applied = [
      composed.applied.captions ? `字幕（${timing}${composed.captionSource && composed.captionSource !== "speech" ? "；对齐没成，按字数摊的" : ""}）` : null,
      composed.applied.signoff ? `片尾落款「${signoff?.brandName}」` : null,
      composed.applied.aiBadge ? "AI 生成角标" : null,
    ].filter(Boolean);
    console.log(`[director] ${parts.length > 1 ? `第 ${part.index} 条（${part.fromSec}–${part.toSec} 秒）` : "成片"} → ${relative(REPO, output)}（${composed.durationSec} 秒；${applied.join("、") || "只重新封装，没有叠加任何东西"}）`);
    if (signoff && !composed.applied.signoff) console.log("[director] 注意：落款没压上（这一条太短）");
  }
  rmSync(workRoot, { recursive: true, force: true });
  console.log("[director] 下一步：review --file <后期后的文件>，看字幕压没压住画面、落款的字对不对");
}

function commandStatus(workspace: Workspace): void {
  const { job, state } = workspace;
  console.log(`${job.title}（${job.id}）· ${job.aspectRatio} · ${job.durationSec} 秒`);
  for (const frame of job.frames) {
    const entry = state.frames[frame.id];
    const done = entry?.variants.filter((variant) => variant.status === "done") ?? [];
    const chosen = selectedFrameVariant(state, frame.id);
    console.log(`  帧 ${frame.id}：出好 ${done.length}/${frame.variants} 张，${chosen ? `定稿第 ${chosen.index} 张` : "未定稿"}`);
  }
  if (state.video.attempts.length === 0) console.log("  出片：还没提交");
  for (const attempt of state.video.attempts) {
    console.log(`  出片第 ${attempt.attempt} 次：${attempt.status} · ${attempt.displayName} · ${attempt.points} 点${attempt.taskId ? ` · ${attempt.taskId}` : ""}${attempt.localFile ? ` · ${attempt.localFile}` : ""}${attempt.error ? ` · ${attempt.error}` : ""}`);
  }
}

async function main(): Promise<void> {
  const { command, jobDir, flags } = parseArgs(process.argv.slice(2));
  if (!["check", "frames", "select", "video", "review", "post", "status"].includes(command)) {
    fail("用法：npm run director -- <check | frames | select | video | review | post | status> <任务目录> [选项]（说明见本文件开头）");
  }
  loadEnv();
  const workspace = openWorkspace(jobDir);
  if (command === "check") return commandCheck(workspace, flags);
  if (command === "frames") return commandFrames(workspace, flags);
  if (command === "select") return commandSelect(workspace, flags);
  if (command === "video") return commandVideo(workspace, flags);
  if (command === "review") return commandReview(workspace, flags);
  if (command === "post") return commandPost(workspace, flags);
  return commandStatus(workspace);
}

main().catch((error: unknown) => {
  console.error(`[director] ${errorText(error)}`);
  process.exit(1);
});
