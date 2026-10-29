/**
 * 视频评测集（2026-10-29）：同一批用例、同一条 Shuyu 线路，比较不同代码版本出的片。
 * 规程：docs/acceptance/2026-10-29-video-golden-set.md；纯逻辑：scripts/lib/video-golden-set.ts。
 *
 * 子命令（在仓库根目录跑，产物落 tmp/experiments-2026-11/golden-set/<run-key>/，tmp 不进仓库）：
 *   prompts  按每个臂的 git 版本建临时工作区，用那一版的代码算提示词（只调 LLM，不花供应商的钱）
 *   run      先估算 Shuyu 点数；加 --confirm-spend --max-points <上限> 才真的出图出片。
 *            随时 Ctrl-C：每一步落盘，重跑从断点续上，已有任务号的只续查、绝不重提
 *   score    抽帧拼图、音轨检查、AI 看图预评（只调 LLM）
 *   report   生成盲评页（左右随机、不显示是哪一版）与揭盲汇总（只给内部看）
 *   tally    读盲评页导出的票，揭盲算胜率
 *
 * 例：
 *   npx tsx scripts/eval/video-golden-set.ts prompts --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
 *   npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b
 *   npx tsx scripts/eval/video-golden-set.ts run --run-key golden-1029 --arms old=3431ff4,new=9cc6b2b --confirm-spend --max-points 40000
 *
 * 绝不碰数据库：进程里的 DATABASE_URL 换成一个连不上的地址，任何误用都会当场报错而不是写到生产库。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  AI_SCORED_DIMENSIONS,
  GOLDEN_SET_DIMENSIONS,
  blindLayout,
  initialRunRecord,
  nextGoldenSetStep,
  normalizeAiScores,
  parseArms,
  goldenSetRequestKey,
  parseGoldenSetCases,
  pendingSpend,
  retryFailedSteps,
  selectCases,
  tallyBlindVotes,
  type BlindPair,
  type BlindVotes,
  type DimensionScore,
  type GoldenSetArm,
  type GoldenSetCase,
  type GoldenSetDimension,
  type GoldenSetFrameRecord,
  type GoldenSetRunRecord,
} from "../lib/video-golden-set";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  estimateSpend,
  parsePositiveLimit,
} from "../lib/experiment-budget";

const REPO = resolve(__dirname, "../..");
const CASES_FILE = join(REPO, "scripts/eval/golden-set.cases.json");
const BUILD_SCRIPT = join(REPO, "scripts/eval/build-arm-prompts.ts");
const OUTPUT_ROOT = join(REPO, "tmp/experiments-2026-11/golden-set");
/// 连不上的库：评测只看提示词与供应商，绝不该碰数据库
const NO_DATABASE_URL = "postgresql://golden-set-no-db@127.0.0.1:9/none";
const FRAME_POLL_MS = 8_000;
const VIDEO_POLL_MS = 15_000;
/// 续查时限：到点就先放下这一条（任务号留着，下次重跑接着查）；不判失败——判失败再重试会新建一单、重复扣点
const FRAME_POLL_DEADLINE_MS = 15 * 60_000;
const VIDEO_POLL_DEADLINE_MS = 40 * 60_000;
const overdue = (submittedAt: string | null, limitMs: number) =>
  submittedAt !== null && Date.now() - Date.parse(submittedAt) > limitMs;

type Flags = Record<string, string | true>;

function parseFlags(argv: readonly string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = argv;
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`看不懂的参数：${token}`);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) flags[token.slice(2)] = true;
    else {
      flags[token.slice(2)] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function flag(flags: Flags, name: string): string | null {
  const value = flags[name];
  return typeof value === "string" ? value : null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(args: readonly string[], cwd = REPO): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/// 运行目录：第一次跑 prompts 时把用例文件快照进来，之后各步都读快照（用例文件改了也不影响这一轮）
function runContext(flags: Flags) {
  const runKey = flag(flags, "run-key");
  if (!runKey || !/^[a-z0-9][a-z0-9-]{2,47}$/u.test(runKey)) {
    throw new Error("必须给 --run-key（小写字母、数字、连字符，如 golden-1029）");
  }
  const runDir = join(OUTPUT_ROOT, runKey);
  const snapshot = join(runDir, "cases.json");
  const allCases = parseGoldenSetCases(readJson(existsSync(snapshot) ? snapshot : CASES_FILE));
  return {
    runKey,
    runDir,
    snapshot,
    arms: parseArms(flag(flags, "arms")),
    cases: selectCases(allCases, flag(flags, "cases")),
  };
}

function loadEnv(): void {
  loadEnvConfig(REPO, true);
  process.env.DATABASE_URL = NO_DATABASE_URL;
  process.env.DIRECT_URL = NO_DATABASE_URL;
  process.env.CAPABILITY_WRITE_THROUGH = "0";
  /// 本工具存在的意义就是真实出片，杜绝被本地 mock 静默降级
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.IMAGE_ENGINE_MOCK = "false";
  process.env.VIDEO_PROVIDER = "shuyu";
}

// ---------------------------------------------------------------------------
// prompts：按 git 版本建临时工作区，用那一版的代码算提示词
// ---------------------------------------------------------------------------

function prepareCheckout(ref: string): { dir: string; sha: string } {
  if (ref === ".") {
    const dirty = git(["status", "--porcelain"]).length > 0;
    return { dir: REPO, sha: `${git(["rev-parse", "HEAD"])}${dirty ? "+dirty" : ""}` };
  }
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  const root = process.env.EVAL_WORKTREE_ROOT?.trim() || join(tmpdir(), "aivora-eval-worktrees");
  const dir = join(root, sha.slice(0, 12));
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(root, { recursive: true });
    git(["worktree", "add", "--detach", dir, sha]);
  }
  /// 依赖共用主仓库那一份（两版的依赖清单相同时才可比；不同就别用这个工具比）
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
  return { dir, sha };
}

function commandPrompts(flags: Flags): void {
  const context = runContext(flags);
  loadEnv();
  if (!existsSync(context.snapshot)) {
    mkdirSync(context.runDir, { recursive: true });
    copyFileSync(CASES_FILE, context.snapshot);
  }
  const order = parseGoldenSetCases(readJson(context.snapshot)).map((item) => item.id);
  for (const arm of context.arms) {
    const out = join(context.runDir, arm.id, "prompts.json");
    const existing = existsSync(out) ? readJson<ArmPrompts>(out) : null;
    if (existing && flags.force !== true) {
      console.log(`[prompts] ${arm.id}: 已有 ${relative(REPO, out)}，跳过（--force 重算；配 --cases 只重算那几条）`);
      continue;
    }
    if (existing && existing.ref !== arm.ref) throw new Error(`${arm.id} 已有的提示词是 ${existing.ref} 算的，这次给的是 ${arm.ref}：换 --run-key`);
    const checkout = prepareCheckout(arm.ref);
    const script = join(checkout.dir, "scripts/eval/build-arm-prompts.ts");
    if (checkout.dir !== REPO) {
      mkdirSync(dirname(script), { recursive: true });
      copyFileSync(BUILD_SCRIPT, script);
    }
    console.log(`[prompts] ${arm.id} = ${arm.ref} (${checkout.sha.slice(0, 12)})，在 ${checkout.dir} 里算 ${context.cases.length} 条`);
    const partial = join(context.runDir, arm.id, "prompts.partial.json");
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/eval/build-arm-prompts.ts",
        context.snapshot,
        partial,
        "--cases",
        context.cases.map((item) => item.id).join(","),
        /// Kelin 精控流程的人物设定图默认出；--no-character-sheet 只比全英文 + 首帧版
        ...(flags["no-character-sheet"] === true ? ["--no-character-sheet"] : []),
        /// --kling-plan <套餐号>：同一套做法改投 Shuyu 上的 Kling（开场帧排第一张、2500 字、不拼负面）
        ...(typeof flags["kling-plan"] === "string" ? ["--kling-plan", flags["kling-plan"]] : []),
      ],
      { cwd: checkout.dir, env: process.env, stdio: "inherit" },
    );
    /// 只重算几条（--cases）时并回已有的那份：这几条换新，其余原样，按用例文件的顺序排
    const fresh = readJson<Pick<ArmPrompts, "cases"> & { builtAt: string }>(partial);
    const kept = (existing?.cases ?? []).filter((entry) => !fresh.cases.some((item) => item.caseId === entry.caseId));
    const cases = [...kept, ...fresh.cases].sort((left, right) => order.indexOf(left.caseId) - order.indexOf(right.caseId));
    writeJson(out, { armId: arm.id, ref: arm.ref, sha: checkout.sha, builtAt: fresh.builtAt, cases });
    rmSync(partial, { force: true });
  }
}

interface ArmPrompts {
  armId: string;
  ref: string;
  sha: string;
  cases: Array<{
    caseId: string;
    shotCardsDesigned: boolean;
    frames: Array<{ ordinal: number; beat: string; prompt: string }>;
    /// Kelin 精控流程（10-29 起支持的版本才有）：从开场帧出一张人物设定图，作视频的人物参考
    characterSheet?: { prompt: string; aspectRatio: string } | null;
    video: {
      prompt: string;
      negativePrompt: string | null;
      durationSec: number;
      /// 参考图怎么带：keyframes = 实拍 + 全部关键帧（缺省，旧版）；opening_frame = 实拍 + 设定图 + 开场帧；
      /// opening_frame_first = 开场帧 + 设定图 + 实拍（Kling 这类把第一张图当首帧的模型）
      referencePlan?: ReferencePlan;
      /// 指定 Shuyu 套餐（10-29 试 Kling 4.0）：绕过只放行 Seedance 的审计层直接建任务，不会被换回 Seedance
      planId?: string;
    };
  }>;
}

type ReferencePlan = "keyframes" | "opening_frame" | "opening_frame_first";

/** 指定套餐的单条点数（按秒的乘时长）；不在 Shuyu 可用目录里就报错，不静默换套餐。 */
async function shuyuPlanPoints(planId: string, durationSec: number): Promise<number> {
  const { getShuyuPrices } = await import("@/lib/providers/shuyu");
  const plan = (await getShuyuPrices({ timeoutMs: 15_000 })).data.find((entry) => entry.plan_id === planId);
  if (!plan || plan.kind !== "video") throw new Error(`Shuyu 目录里没有可用的视频套餐 ${planId}`);
  return plan.unit === "second" ? plan.sale_points * durationSec : plan.sale_points;
}

function loadArmPrompts(runDir: string, arm: GoldenSetArm): ArmPrompts {
  const path = join(runDir, arm.id, "prompts.json");
  if (!existsSync(path)) throw new Error(`${arm.id} 还没有提示词：先跑 prompts`);
  const prompts = readJson<ArmPrompts>(path);
  if (prompts.ref !== arm.ref) throw new Error(`${arm.id} 的提示词是 ${prompts.ref} 算的，这次给的是 ${arm.ref}：换 --run-key 或 prompts --force`);
  return prompts;
}

// ---------------------------------------------------------------------------
// run：估算 → 预算闸 → 真机出图出片（可续跑、可取消）
// ---------------------------------------------------------------------------

function recordPath(runDir: string, armId: string, caseId: string): string {
  return join(runDir, armId, `${caseId}.record.json`);
}

function loadOrInitRecord(runDir: string, arm: ArmPrompts, item: GoldenSetCase): GoldenSetRunRecord {
  const path = recordPath(runDir, arm.armId, item.id);
  if (existsSync(path)) return readJson<GoldenSetRunRecord>(path);
  const prompts = arm.cases.find((entry) => entry.caseId === item.id);
  if (!prompts) throw new Error(`${arm.armId} 的提示词里没有 ${item.id}：重跑 prompts --force`);
  return initialRunRecord({
    caseId: item.id,
    armId: arm.armId,
    ref: arm.ref,
    sha: arm.sha,
    framePrompts: prompts.frames.map((frame) => frame.prompt),
    characterSheetPrompt: prompts.characterSheet?.prompt ?? null,
    video: { prompt: prompts.video.prompt, negativePrompt: prompts.video.negativePrompt, durationSec: prompts.video.durationSec },
  });
}

let stopping = false;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const errorText = (error: unknown) => {
  /// 提交被拒时把 HTTP 状态与错误码一起记下（10-29 Kling 拒单只有一句笼统的话，没法判断是不是上游临时故障）
  const meta = error && typeof error === "object" ? (error as { httpStatus?: unknown; code?: unknown }) : {};
  const extra = [
    typeof meta.httpStatus === "number" ? `http ${meta.httpStatus}` : null,
    typeof meta.code === "string" && meta.code ? `code ${meta.code}` : null,
  ].filter(Boolean);
  const message = error instanceof Error ? error.message : String(error);
  return (extra.length > 0 ? `${message} [${extra.join(", ")}]` : message).slice(0, 500);
};

async function runOne(args: {
  runKey: string;
  runDir: string;
  item: GoldenSetCase;
  record: GoldenSetRunRecord;
  imagePlan: import("@/lib/providers/shuyu-catalog").AuditedShuyuImagePlan;
  referencePlan: ReferencePlan;
  sheetAspectRatio: GoldenSetCase["aspectRatio"];
  /// 指定套餐（Kling 4.0 等）与它的单条点数；缺省走审计放行的默认 Seedance 套餐
  planId?: string;
  planPoints: number | null;
}): Promise<void> {
  const { submitShuyuImageTask, pollShuyuImageTask } = await import("@/lib/providers/shuyu-image-provider");
  const { composeStoryboardFrameInputImages, fitStoryboardFramePrompt, STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX } =
    await import("@/lib/video-generation/storyboard-frame-inputs");
  const { composeSingleVideoReferenceGroups } = await import("@/lib/video-generation/storyboard-service");
  const { SHUYU_MAX_REFERENCE_IMAGES, createShuyuVideoTask } = await import("@/lib/providers/shuyu");
  const { NEGATIVE_CONSTRAINTS_SEPARATOR } = await import("@/lib/video-generation/storyboard-beats");
  const { ShuyuVideoProvider } = await import("@/lib/video-generation/providers/shuyu-video-provider");
  const provider = new ShuyuVideoProvider();
  const { item, record } = args;
  const tag = `${record.armId}/${item.id}`;
  const save = () => writeJson(recordPath(args.runDir, record.armId, item.id), record);
  const now = () => new Date().toISOString();
  /// 出图任务续查（故事板帧与人物设定图同一套）：先查后判超时；返回 false = 到点先放下这一条
  const pollImage = async (image: GoldenSetFrameRecord, label: string): Promise<boolean> => {
    const result = await pollShuyuImageTask(image.taskId!, { timeoutMs: 20_000 }).catch((error: unknown) => ({
      status: "processing" as const,
      rawStatus: `poll_error: ${errorText(error)}`,
      outputUrls: [] as string[],
    }));
    if (result.status === "succeeded") {
      Object.assign(image, { status: "succeeded", outputUrl: result.outputUrls[0] ?? null, finishedAt: now() });
      console.log(`[run] ${tag} ${label} 出好了`);
      save();
    } else if (result.status === "failed") {
      Object.assign(image, { status: "failed", error: "errorMessage" in result ? result.errorMessage ?? result.rawStatus : result.rawStatus, finishedAt: now() });
      save();
    } else if (overdue(image.submittedAt, FRAME_POLL_DEADLINE_MS)) {
      /// 先查后判超时：续跑时排队轮到它可能早过了时限，没查过就放下会把早已出好的图晾着（10-29 踩过）
      console.log(`[run] ${tag} ${label}（${image.taskId}）超过 15 分钟没结果，先放下；重跑会接着查，不会重提`);
      return false;
    } else {
      await sleep(FRAME_POLL_MS);
    }
    return true;
  };

  while (!stopping) {
    const step = nextGoldenSetStep(record);
    if (step.kind === "done") return console.log(`[run] ${tag} 完成`);
    if (step.kind === "failed") return console.log(`[run] ${tag} 停在失败：${step.reason}`);
    if (step.kind === "submit_frame") {
      const frame = record.frames[step.ordinal];
      /// 与线上出帧同一套入参：实拍在前（保底 3 张），最近一张已成的前帧在后
      const inputs = composeStoryboardFrameInputImages({
        productImages: item.productImages,
        priorFrames: record.frames.filter((prior) => prior.ordinal < step.ordinal && prior.outputUrl).map((prior) => prior.outputUrl!),
        isFirstFrame: step.ordinal === 0,
        max: args.imagePlan.inputImagesMax ?? STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX,
      });
      try {
        const submitted = await submitShuyuImageTask({
          requestKey: goldenSetRequestKey(args.runKey, record, { ordinal: step.ordinal }),
          prompt: fitStoryboardFramePrompt(frame.prompt),
          aspectRatio: item.aspectRatio,
          /// 与线上一致：合作方 0728 起下线 1K，故事板帧出 2K
          resolution: "2K",
          inputImages: inputs.map((input) => input.url),
          planSnapshot: args.imagePlan,
          timeoutMs: 45_000,
        });
        Object.assign(frame, {
          status: "submitted",
          taskId: submitted.externalTaskId,
          planId: submitted.planSnapshot.planId,
          points: submitted.planSnapshot.points ?? null,
          submittedAt: now(),
        });
        console.log(`[run] ${tag} 帧 ${step.ordinal + 1} 已提交 ${submitted.externalTaskId}`);
      } catch (error) {
        Object.assign(frame, { status: "failed", error: errorText(error) });
      }
      save();
      continue;
    }
    if (step.kind === "poll_frame") {
      if (!(await pollImage(record.frames[step.ordinal], `帧 ${step.ordinal + 1}`))) return;
      continue;
    }
    if (step.kind === "submit_sheet") {
      /// 人物设定图从开场帧出（输入图：开场帧在前，实拍在后——实拍只用来认出商品、让设定图里别出现它）
      const sheet = record.characterSheet!;
      const inputs = [record.frames[0]?.outputUrl, ...item.productImages]
        .filter((url): url is string => Boolean(url))
        .slice(0, args.imagePlan.inputImagesMax ?? STORYBOARD_FRAME_INPUT_IMAGES_DEFAULT_MAX);
      try {
        const submitted = await submitShuyuImageTask({
          requestKey: goldenSetRequestKey(args.runKey, record, "sheet"),
          prompt: fitStoryboardFramePrompt(sheet.prompt),
          aspectRatio: args.sheetAspectRatio,
          resolution: "2K",
          inputImages: inputs,
          planSnapshot: args.imagePlan,
          timeoutMs: 45_000,
        });
        Object.assign(sheet, {
          status: "submitted",
          taskId: submitted.externalTaskId,
          planId: submitted.planSnapshot.planId,
          points: submitted.planSnapshot.points ?? null,
          submittedAt: now(),
        });
        console.log(`[run] ${tag} 人物设定图已提交 ${submitted.externalTaskId}`);
      } catch (error) {
        Object.assign(sheet, { status: "failed", error: errorText(error) });
      }
      save();
      continue;
    }
    if (step.kind === "poll_sheet") {
      if (!(await pollImage(record.characterSheet!, "人物设定图"))) return;
      continue;
    }
    if (step.kind === "submit_video") {
      /// 参考图三种带法：逐帧（旧版、现行版：实拍在前、已确认的帧在后，Shuyu 上限 9）；
      /// 首帧版（Kelin 精控：实拍 → 人物设定图 → 开场帧）；开场帧在前（Kling：开场帧 → 设定图 → 实拍）
      const frameUrls = record.frames.map((frame) => frame.outputUrl!).filter(Boolean);
      const sheetUrl = record.characterSheet?.outputUrl ?? null;
      const references =
        args.referencePlan === "opening_frame_first"
          ? [frameUrls[0], sheetUrl, ...item.productImages]
              .filter((url): url is string => Boolean(url))
              .slice(0, SHUYU_MAX_REFERENCE_IMAGES)
          : composeSingleVideoReferenceGroups({
              productImageUrls: item.productImages,
              personUrls: args.referencePlan === "opening_frame" && sheetUrl ? [sheetUrl] : [],
              storyboardFrameUrls: args.referencePlan === "opening_frame" ? frameUrls.slice(0, 1) : frameUrls,
              limit: SHUYU_MAX_REFERENCE_IMAGES,
            }).references;
      try {
        if (args.planId) {
          /// 指定套餐：直接建任务，不经只放行 Seedance 的审计层，被拒也不会悄悄换回 Seedance
          const negative = record.video.negativePrompt?.trim();
          const { taskId } = await createShuyuVideoTask({
            providerRequestKey: goldenSetRequestKey(args.runKey, record, "video"),
            prompt: negative ? `${record.video.prompt}${NEGATIVE_CONSTRAINTS_SEPARATOR}${negative}` : record.video.prompt,
            duration: record.video.durationSec,
            aspectRatio: item.aspectRatio,
            inputImages: references,
            planId: args.planId,
            model: "studio-video",
            timeoutMs: 45_000,
          });
          Object.assign(record.video, { status: "submitted", taskId, planId: args.planId, points: args.planPoints, submittedAt: now() });
          console.log(`[run] ${tag} 视频已提交 ${taskId}（${args.planId}）`);
          save();
          continue;
        }
        const accepted = await provider.createVideoJob({
          providerRequestKey: goldenSetRequestKey(args.runKey, record, "video"),
          prompt: record.video.prompt,
          negativePrompt: record.video.negativePrompt ?? undefined,
          referenceImages: references.map((url) => ({ url, role: "content" as const })),
          durationSec: record.video.durationSec,
          aspectRatio: item.aspectRatio,
          generateAudio: true,
        });
        Object.assign(record.video, {
          status: "submitted",
          taskId: accepted.providerJobId,
          planId: accepted.providerPlanId ?? null,
          points: accepted.providerUnitPoints ?? null,
          submittedAt: now(),
        });
        console.log(`[run] ${tag} 视频已提交 ${accepted.providerJobId}（${accepted.providerPlanId ?? "默认套餐"}）`);
      } catch (error) {
        Object.assign(record.video, { status: "failed", error: errorText(error) });
      }
      save();
      continue;
    }
    if (step.kind === "poll_video") {
      const status = await provider.getVideoJobStatus(record.video.taskId!).catch(() => null);
      if (status?.normalizedStatus === "succeeded" && status.videoUrl) {
        Object.assign(record.video, { status: "succeeded", outputUrl: status.videoUrl, finishedAt: now() });
        save();
      } else if (status?.normalizedStatus === "failed" || status?.normalizedStatus === "cancelled") {
        Object.assign(record.video, { status: "failed", error: status.errorMessage ?? status.rawProviderStatus, finishedAt: now() });
        save();
      } else if (overdue(record.video.submittedAt, VIDEO_POLL_DEADLINE_MS)) {
        return console.log(`[run] ${tag} 视频（${record.video.taskId}）超过 40 分钟没结果，先放下；重跑会接着查，不会重提`);
      } else {
        await sleep(VIDEO_POLL_MS);
      }
      continue;
    }
    /// download_video
    const response = await fetch(record.video.outputUrl!);
    if (!response.ok) {
      console.log(`[run] ${tag} 成片下载失败 HTTP ${response.status}，稍后重跑续上`);
      return;
    }
    const file = join(args.runDir, record.armId, `${item.id}.mp4`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    record.video.localFile = relative(args.runDir, file);
    save();
  }
}

async function commandRun(flags: Flags): Promise<void> {
  const context = runContext(flags);
  loadEnv();
  const { getAvailableShuyuImagePlans, getShuyuBalance, resolveShuyuVideoPlan, shuyuVideoPlanPointsForDuration } =
    await import("@/lib/providers/shuyu");
  const { selectAuditedImage2Plan } = await import("@/lib/providers/shuyu-catalog");
  const arms = context.arms.map((arm) => loadArmPrompts(context.runDir, arm));
  /// --retry-failed：把停在失败的那一步放回待提交（尝试次数 +1、请求键换新）；只在真花钱时才落盘
  const records = context.cases.flatMap((item) =>
    arms.map((arm) => {
      const record = loadOrInitRecord(context.runDir, arm, item);
      if (flags["retry-failed"] === true) retryFailedSteps(record);
      const casePrompts = arm.cases.find((entry) => entry.caseId === item.id);
      return {
        item,
        record,
        referencePlan: casePrompts?.video.referencePlan ?? ("keyframes" as const),
        planId: casePrompts?.video.planId,
        /// 设定图横版（并排四个视角）；落盘的是字符串，这里收回用例同一套画幅类型
        sheetAspectRatio: (casePrompts?.characterSheet?.aspectRatio ?? "16:9") as GoldenSetCase["aspectRatio"],
      };
    }),
  );

  const imagePlan = selectAuditedImage2Plan({ imagePlans: await getAvailableShuyuImagePlans({ timeoutMs: 15_000 }) }, "2K");
  const videoPlan = await resolveShuyuVideoPlan({ timeoutMs: 15_000 });
  const defaultVideoUnit = shuyuVideoPlanPointsForDuration(videoPlan, 15);
  /// 指定了套餐的臂按那个套餐的价估（同一臂的用例共用一个套餐）
  const armPlans = new Map<string, { planId: string | undefined; unit: number }>();
  for (const arm of arms) {
    const planId = arm.cases.find((entry) => entry.video.planId)?.video.planId;
    armPlans.set(arm.armId, { planId, unit: planId ? await shuyuPlanPoints(planId, 15) : defaultVideoUnit });
  }
  const videoUnit = (armId: string) => armPlans.get(armId)?.unit ?? defaultVideoUnit;
  const estimate = estimateSpend(
    context.arms.flatMap((arm) => {
      const pending = records
        .filter(({ record }) => record.armId === arm.id)
        .reduce((sum, { record }) => {
          const next = pendingSpend(record);
          return { frames: sum.frames + next.frames, videos: sum.videos + next.videos };
        }, { frames: 0, videos: 0 });
      return [
        { armId: `${arm.id}·帧`, count: pending.frames, unitPoints: imagePlan.points ?? null, unitUsd: null },
        { armId: `${arm.id}·视频`, count: pending.videos, unitPoints: videoUnit(arm.id), unitUsd: null },
      ];
    }),
  );
  console.log(`[run] ${context.runKey}：${context.cases.length} 条用例 × ${context.arms.length} 个臂`);
  console.log(`[run] 出帧套餐 ${imagePlan.planId}（${imagePlan.points ?? "?"} 点/张），视频套餐 ${videoPlan.planId} ${videoPlan.displayName}（15 秒 ${defaultVideoUnit} 点）`);
  for (const [armId, plan] of armPlans) {
    if (plan.planId) console.log(`[run]   ${armId} 指定视频套餐 ${plan.planId}（15 秒 ${plan.unit} 点，不经审计层）`);
  }
  for (const line of estimate.lines) console.log(`[run]   ${line.armId}：${line.count} × ${line.unitPoints ?? "?"} = ${line.points} 点`);
  console.log(`[run] 合计预估 ${estimate.totalPoints} 点（实扣以 Shuyu 为准）`);
  /// 干跑也读一次余额（只读）：批预算时直接看到跑完还剩多少、会不会撞预留线
  const balance = await getShuyuBalance({ timeoutMs: 15_000 }).catch(() => null);
  const reservePoints = parsePositiveLimit(flag(flags, "reserve-points")) ?? SHUYU_RESERVE_POINTS_DEFAULT;
  console.log(
    balance
      ? `[run] Shuyu 余额 ${balance.available_points} 点，跑完约剩 ${balance.available_points - estimate.totalPoints} 点（预留线 ${reservePoints}）`
      : "[run] 查不到 Shuyu 余额：真跑时预算闸会拦下",
  );
  if (flags["confirm-spend"] !== true) {
    console.log("[run] 干跑：没有提交任何任务。真跑加 --confirm-spend --max-points <上限>");
    return;
  }
  const gate = checkBudgetGate({
    estimate,
    maxPoints: parsePositiveLimit(flag(flags, "max-points")),
    maxUsd: null,
    availablePoints: balance?.available_points ?? null,
    reservePoints,
  });
  if (!gate.ok) {
    for (const reason of gate.reasons) console.log(`[run] 预算闸拦下：${reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[run] 余额 ${balance?.available_points} 点，开始真机出片（Ctrl-C 随时停，重跑续上）`);
  process.once("SIGINT", () => {
    stopping = true;
    console.log("\n[run] 收到取消：做完手头这一步就停，已提交的任务号都已落盘");
  });
  const concurrency = Math.max(1, Math.min(4, Number.parseInt(flag(flags, "concurrency") ?? "2", 10) || 2));
  const queue = [...records];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!stopping && queue.length > 0) {
        const next = queue.shift()!;
        await runOne({
          runKey: context.runKey,
          runDir: context.runDir,
          item: next.item,
          record: next.record,
          imagePlan,
          referencePlan: next.referencePlan,
          sheetAspectRatio: next.sheetAspectRatio,
          planId: next.planId,
          planPoints: next.planId ? videoUnit(next.record.armId) : null,
        });
      }
    }),
  );
  const after = await getShuyuBalance({ timeoutMs: 15_000 }).catch(() => null);
  if (balance && after) {
    console.log(`[run] 余额 ${balance.available_points} → ${after.available_points}（差 ${balance.available_points - after.available_points} 点，含同期线上用量）`);
  }
}

// ---------------------------------------------------------------------------
// score：抽帧拼图 + 音轨检查 + AI 看图预评
// ---------------------------------------------------------------------------

interface AudioCheck {
  hasAudio: boolean;
  durationSec: number | null;
  voicedSec: number | null;
  /// 最后一段有声音的结束时刻；离片尾不到 0.2 秒说明台词可能被截断
  lastSoundEndSec: number | null;
}

function probeAndListen(file: string): AudioCheck & { width: number | null; height: number | null } {
  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { encoding: "utf8" }),
  ) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  const durationSec = probe.format?.duration ? Number(probe.format.duration) : null;
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const hasAudio = Boolean(probe.streams?.some((stream) => stream.codec_type === "audio"));
  let voicedSec: number | null = null;
  let lastSoundEndSec: number | null = null;
  if (hasAudio && durationSec) {
    const log = execFileSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-30dB:d=0.3", "-f", "null", "-"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    const silences: Array<[number, number]> = [];
    let start: number | null = null;
    for (const match of log.matchAll(/silence_(start|end): ([\d.]+)/gu)) {
      if (match[1] === "start") start = Number(match[2]);
      else if (start !== null) {
        silences.push([start, Number(match[2])]);
        start = null;
      }
    }
    if (start !== null) silences.push([start, durationSec]);
    const silent = silences.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0);
    voicedSec = Math.max(0, Math.round((durationSec - silent) * 10) / 10);
    const trailing = silences.find(([, to]) => Math.abs(to - durationSec) < 0.05);
    lastSoundEndSec = trailing ? trailing[0] : durationSec;
  }
  return { hasAudio, durationSec, voicedSec, lastSoundEndSec, width: video?.width ?? null, height: video?.height ?? null };
}

const AI_SYSTEM_PROMPT = `You are a strict reviewer of short AI-generated product ad videos for small businesses.
You get the merchant's product photos first, then 8 frames of a 15-second vertical video sampled every 1.8 seconds, in order.
Be strict: 2 means a professional ad editor would ship it as is; anything you would have to explain away is 1 or 0.
Score each dimension 0, 1 or 2 with one short sentence of visual evidence in Simplified Chinese:
- hook: does the first frame give a reason to keep watching (a visible problem, a contrast, a surprising action)? A product simply poured, held or posed with no tension is 1 at most; a static or confusing first frame is 0.
- product: does the product match the photos in every frame (shape, proportions, color, parts, printed marks)? Compare close-ups with the wide shots: a body that gets wider, rounder or changes parts is 0 or 1.
- physics: count the key props frame by frame (lids, cups, shoes, earbuds, tubes, toys). The same object shown twice, a lid both on the product and in a hand, an object appearing from nowhere or vanishing, malformed hands, or liquid or steam coming from the wrong place is 0.
- story: do events happen in the merchant's order, and does the ending pay off the claim instead of drifting to another action?
- motion: does every shot show visible action rather than a still image being panned or zoomed?
Judge only what is visible. Return JSON only: {"scores":{"hook":{"score":0,"evidence":""},"product":{...},"physics":{...},"story":{...},"motion":{...}}}`;

/// 商品照先在本机取下、缩到 768 以内转 JPEG，再以 data URL 给看图模型：让 OpenAI 自己去拉 Blob 图会偶发下载超时（10-29 出提示词时撞到过）
async function productPhotoDataUrls(runDir: string, item: GoldenSetCase): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const dir = join(runDir, "product-photos");
  mkdirSync(dir, { recursive: true });
  const urls: string[] = [];
  for (const [index, url] of item.productImages.entries()) {
    const file = join(dir, `${item.id}-${index + 1}.jpg`);
    if (!existsSync(file)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`商品照下载失败 HTTP ${response.status}：${url}`);
      const jpeg = await sharp(Buffer.from(await response.arrayBuffer()))
        .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      writeFileSync(file, jpeg);
    }
    urls.push(`data:image/jpeg;base64,${readFileSync(file).toString("base64")}`);
  }
  return urls;
}

async function commandScore(flags: Flags): Promise<void> {
  const context = runContext(flags);
  loadEnv();
  const { analyzeImages } = await import("@/lib/ai");
  for (const arm of context.arms) {
    for (const item of context.cases) {
      const recordFile = recordPath(context.runDir, arm.id, item.id);
      if (!existsSync(recordFile)) continue;
      const record = readJson<GoldenSetRunRecord>(recordFile);
      if (!record.video.localFile) continue;
      const scoreFile = join(context.runDir, arm.id, `${item.id}.score.json`);
      /// 已评过的跳过；AI 预评失败的那条重跑时重评
      if (existsSync(scoreFile) && flags.force !== true && readJson<{ ai: unknown }>(scoreFile).ai !== null) continue;
      const video = join(context.runDir, record.video.localFile);
      const sheet = join(context.runDir, arm.id, `${item.id}.sheet.jpg`);
      /// 拼图给人评看；AI 一张张看单帧（拼图里每格太小，数不清杯盖这类细节——10-29 自测漏判）
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "fps=1/1.8,scale=320:-1,tile=4x2", "-frames:v", "1", sheet]);
      const framesDir = join(context.runDir, arm.id, `${item.id}.frames`);
      rmSync(framesDir, { recursive: true, force: true });
      mkdirSync(framesDir, { recursive: true });
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", "fps=1/1.8,scale=540:-1", "-frames:v", "8", join(framesDir, "%02d.jpg")]);
      const technical = probeAndListen(video);
      let ai: Record<GoldenSetDimension, DimensionScore> | null = null;
      let aiError: string | null = null;
      try {
        const frameUrls = Array.from({ length: 8 }, (_, index) => join(framesDir, `${String(index + 1).padStart(2, "0")}.jpg`))
          .filter((file) => existsSync(file))
          .map((file) => `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`);
        const result = await analyzeImages(
          [...(await productPhotoDataUrls(context.runDir, item)), ...frameUrls],
          AI_SYSTEM_PROMPT,
          [`Merchant's description: ${item.story}`, `Voice-over (for story order only): ${item.voiceover}`, `Known traps to check: ${item.watchFor.join("; ")}`].join("\n"),
          { detail: "high", maxTokens: 1200 },
        );
        ai = normalizeAiScores(result.data);
      } catch (error) {
        aiError = errorText(error);
      }
      writeJson(scoreFile, { caseId: item.id, armId: arm.id, technical, ai, aiError, scoredAt: new Date().toISOString() });
      console.log(`[score] ${arm.id}/${item.id}：${ai ? AI_SCORED_DIMENSIONS.map((id) => `${id} ${ai![id].score ?? "-"}`).join(" ") : `AI 预评失败 ${aiError}`}`);
    }
  }
}

// ---------------------------------------------------------------------------
// report：盲评页 + 揭盲汇总；tally：读票揭盲
// ---------------------------------------------------------------------------

interface ScoreFile {
  technical: AudioCheck & { width: number | null; height: number | null };
  ai: Record<GoldenSetDimension, DimensionScore> | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function twoArms(arms: readonly GoldenSetArm[]): [string, string] {
  if (arms.length !== 2) throw new Error("盲评只比两个臂：--arms 给两个");
  return [arms[0].id, arms[1].id];
}

function commandReport(flags: Flags): void {
  const context = runContext(flags);
  const armIds = twoArms(context.arms);
  const ready = context.cases.filter((item) =>
    armIds.every((armId) => existsSync(join(context.runDir, armId, `${item.id}.mp4`))),
  );
  if (ready.length === 0) throw new Error("还没有两边都出好的成片：先跑 run");
  const layout = blindLayout(context.runKey, ready.map((item) => item.id), armIds);
  writeJson(join(context.runDir, "blind-key.json"), { runKey: context.runKey, arms: context.arms, layout });

  /// 盲评文件名不带臂名：review/<case>-L.mp4 / -R.mp4
  const reviewDir = join(context.runDir, "review");
  rmSync(reviewDir, { recursive: true, force: true });
  mkdirSync(reviewDir, { recursive: true });
  const score = (armId: string, caseId: string): ScoreFile | null => {
    const path = join(context.runDir, armId, `${caseId}.score.json`);
    return existsSync(path) ? readJson<ScoreFile>(path) : null;
  };
  const sections = layout.map((pair: BlindPair, index: number) => {
    const item = ready.find((entry) => entry.id === pair.caseId)!;
    for (const [side, armId] of [["L", pair.left], ["R", pair.right]] as const) {
      symlinkSync(join(context.runDir, armId, `${item.id}.mp4`), join(reviewDir, `${item.id}-${side}.mp4`));
    }
    const radios = [...GOLDEN_SET_DIMENSIONS.map((dimension) => ({ id: dimension.id as string, label: dimension.label, question: dimension.question })), { id: "overall", label: "整体", question: "哪一条你更愿意直接发出去？" }]
      .map(
        (dimension) => `<fieldset data-dim="${dimension.id}"><legend title="${escapeHtml(dimension.question)}">${escapeHtml(dimension.label)}</legend>${["left", "tie", "right"]
          .map((vote) => `<label><input type="radio" name="${item.id}-${dimension.id}" value="${vote}"> ${vote === "left" ? "左更好" : vote === "right" ? "右更好" : "差不多"}</label>`)
          .join("")}</fieldset>`,
      )
      .join("");
    const aiRow = (side: string, armId: string) => {
      const ai = score(armId, item.id)?.ai;
      return `<tr><th>${side}</th>${AI_SCORED_DIMENSIONS.map((id) => `<td title="${escapeHtml(ai?.[id].evidence ?? "")}">${ai?.[id].score ?? "—"}</td>`).join("")}</tr>`;
    };
    return `<section data-case="${item.id}"><h2>${index + 1}. ${escapeHtml(item.category)} · ${escapeHtml(item.productName)}</h2>
<p><b>商家原话：</b>${escapeHtml(item.story)}</p><p><b>口播：</b>${escapeHtml(item.voiceover)}</p>
<p><b>重点看：</b>${item.watchFor.map(escapeHtml).join("；")}</p>
<div class="pair"><figure><figcaption>左</figcaption><video src="review/${item.id}-L.mp4" controls preload="metadata" playsinline></video></figure><figure><figcaption>右</figcaption><video src="review/${item.id}-R.mp4" controls preload="metadata" playsinline></video></figure></div>
<form>${radios}</form>
<details><summary>AI 预评（先自己评完再看）</summary><table><tr><th></th>${AI_SCORED_DIMENSIONS.map((id) => `<th>${escapeHtml(GOLDEN_SET_DIMENSIONS.find((dimension) => dimension.id === id)!.label)}</th>`).join("")}</tr>${aiRow("左", pair.left)}${aiRow("右", pair.right)}</table></details></section>`;
  });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>视频盲评 · ${escapeHtml(context.runKey)}</title>
<meta name="color-scheme" content="light dark">
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;background:Canvas;color:CanvasText}section{border-top:1px solid GrayText;padding:16px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}video{width:100%;max-height:70vh}fieldset{display:inline-block;border:1px solid GrayText;margin:4px;padding:4px 8px}table{border-collapse:collapse}td,th{border:1px solid GrayText;padding:2px 8px;text-align:center}#bar{position:sticky;top:0;background:Canvas;padding:8px 0;border-bottom:1px solid GrayText}@media (max-width:640px){.pair{grid-template-columns:1fr}}</style></head><body>
<div id="bar"><b>视频盲评 · ${escapeHtml(context.runKey)}</b> · 每条两段视频左右顺序随机，看不出哪段是新版。评审人：<input id="reviewer" placeholder="名字"> <button id="export">导出评分</button> <span id="count"></span></div>
<p>六项各选「左更好 / 差不多 / 右更好」，最后选整体更愿意发哪条。鼠标停在项目名上能看到判断标准。评完点「导出评分」，把下载的 JSON 发回来揭盲。</p>
${sections.join("\n")}
<script>
const KEY = ${JSON.stringify(`golden-set-votes:${context.runKey}`)};
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })();
for (const input of document.querySelectorAll("input[type=radio]")) {
  const [caseId, dim] = input.name.split(/-(?=[^-]+$)/);
  if (saved[caseId] && saved[caseId][dim] === input.value) input.checked = true;
  input.addEventListener("change", () => { saved[caseId] = saved[caseId] || {}; saved[caseId][dim] = input.value; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} update(); });
}
function update() { const n = Object.values(saved).reduce((s, v) => s + Object.keys(v).length, 0); document.getElementById("count").textContent = "已评 " + n + " 项"; }
update();
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ runKey: ${JSON.stringify(context.runKey)}, reviewer: document.getElementById("reviewer").value, votes: saved }, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "votes-" + ${JSON.stringify(context.runKey)} + ".json"; link.click();
});
</script></body></html>`;
  writeFileSync(join(context.runDir, "report.html"), html);

  /// 揭盲汇总：只给内部看（含臂名），评审人不要看
  const lines = [`# ${context.runKey} 揭盲汇总（评审完再看）`, "", `臂：${context.arms.map((arm) => `${arm.id} = ${arm.ref}`).join("，")}`, ""];
  lines.push(`| 用例 | 臂 | ${AI_SCORED_DIMENSIONS.map((id) => GOLDEN_SET_DIMENSIONS.find((dimension) => dimension.id === id)!.label).join(" | ")} | 有声段 / 末声 | 实扣点数 |`);
  lines.push(`| --- | --- | ${AI_SCORED_DIMENSIONS.map(() => "---").join(" | ")} | --- | --- |`);
  const totals = Object.fromEntries(armIds.map((armId) => [armId, { sum: 0, n: 0 }]));
  for (const item of ready) {
    for (const armId of armIds) {
      const result = score(armId, item.id);
      const record = readJson<GoldenSetRunRecord>(recordPath(context.runDir, armId, item.id));
      const spent = record.frames.reduce((sum, frame) => sum + (frame.points ?? 0), 0) + (record.video.points ?? 0);
      const cells = AI_SCORED_DIMENSIONS.map((id) => {
        const value = result?.ai?.[id].score;
        if (typeof value === "number") {
          totals[armId].sum += value;
          totals[armId].n += 1;
        }
        return value ?? "—";
      });
      const audio = result?.technical.hasAudio
        ? `${result.technical.voicedSec ?? "?"}s / ${result.technical.lastSoundEndSec ?? "?"}s`
        : "无音轨";
      lines.push(`| ${item.id} | ${armId} | ${cells.join(" | ")} | ${audio} | ${spent} |`);
    }
  }
  lines.push("", ...armIds.map((armId) => `- ${armId} AI 预评平均：${totals[armId].n ? (totals[armId].sum / totals[armId].n).toFixed(2) : "—"}（满分 2）`));
  writeFileSync(join(context.runDir, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`[report] 盲评页 ${relative(REPO, join(context.runDir, "report.html"))}（${ready.length} 条）；揭盲汇总 summary.md 别给评审人看`);
}

function commandTally(flags: Flags): void {
  const context = runContext(flags);
  const votesPath = flag(flags, "votes");
  if (!votesPath) throw new Error("--votes <盲评页导出的 JSON>");
  const key = readJson<{ layout: BlindPair[] }>(join(context.runDir, "blind-key.json"));
  const { reviewer, votes } = readJson<{ reviewer?: string; votes: BlindVotes }>(votesPath);
  const tally = tallyBlindVotes(key.layout, votes);
  const armIds = twoArms(context.arms);
  const lines = [`# ${context.runKey} 盲评结果（评审：${reviewer || "未署名"}）`, "", `| 项 | ${armIds.map((armId) => `${armId} 胜 / 平 / 负`).join(" | ")} |`, `| --- | ${armIds.map(() => "---").join(" | ")} |`];
  for (const [dimension, perArm] of Object.entries(tally)) {
    const label = dimension === "overall" ? "整体" : GOLDEN_SET_DIMENSIONS.find((entry) => entry.id === dimension)!.label;
    lines.push(`| ${label} | ${armIds.map((armId) => `${perArm[armId].win} / ${perArm[armId].tie} / ${perArm[armId].loss}`).join(" | ")} |`);
  }
  const out = join(context.runDir, `tally-${(reviewer || "anonymous").replace(/[^\w-]/gu, "_")}.md`);
  writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));
  if (command === "prompts") return commandPrompts(flags);
  if (command === "run") return commandRun(flags);
  if (command === "score") return commandScore(flags);
  if (command === "report") return commandReport(flags);
  if (command === "tally") return commandTally(flags);
  console.log(readFileSync(__filename, "utf8").split("*/")[0]);
}

main().catch((error: unknown) => {
  console.error(`[golden-set] ${errorText(error)}`);
  process.exitCode = 1;
});
