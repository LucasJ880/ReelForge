/**
 * Shuyu 套餐对照 bake-off（X-SCAF-8；E7′ 2.0 vs 2.5、E12 720P vs 1080P 排队、E2″ 新档实证共用）。
 *
 * 路线图 D-5：直连供应商、**不写库**、不走批量管线；固定输入清单 + 同一份 prompt
 * （生产 prompt-intelligence 启发式分镜）+ 同样的参考图顺序，臂 = Shuyu plan_id，
 * 走 createShuyuVideoTask 显式 plan_id。结果写 tmp/experiments-2026-11/<实验>/<runTag>.json。
 *
 * 安全默认：
 *   - 默认干跑：只打印任务清单、prompt 摘要与按内置参考价（未知分辨率按最贵的 1080P）的保守预估，
 *     不读 env、不触网；加 --live-price 才读一次 Shuyu /prices（只读、免费）给出精确估价。
 *   - --confirm 才花钱，且必须 --max-points 硬上限；按实时价估算，超上限 / 余额穿预留线 /
 *     实时价超参考价 2 倍任何一条都拒绝。
 *   - 1080P（final 档）套餐要 SHUYU_ALLOW_FINAL_TIER=1（P03-A1；VERCEL_ENV=production 一律忽略），
 *     由生产 resolveShuyuVideoPlan 判定，本脚本不另开口子。
 *   - 并发默认 2（X-SCAF-0），E10 吞吐测量可显式 --concurrency 到 10。
 *   - 每个任务的 Idempotency-Key 由 (实验, runTag, 条目, 套餐, 第几次) 唯一决定，续跑不重复扣点；
 *     结果文件里已有 taskId 的任务只轮询、不重提。
 *   - 能力状态回写（markCapability）强制关闭：CAPABILITY_WRITE_THROUGH=0。
 *
 * 用法：
 *   npx tsx scripts/bakeoff-runner.ts --help
 *   npx tsx scripts/bakeoff-runner.ts --manifest scripts/bakeoff/e7-manifest.example.json --arms video-plan-04,video-plan-08
 *   npx tsx scripts/bakeoff-runner.ts --manifest m.json --arms video-plan-04,video-plan-08 --live-price
 *   SHUYU_ALLOW_FINAL_TIER=1 npx tsx scripts/bakeoff-runner.ts --manifest m.json --arms video-plan-08 \
 *     --run-tag e12-slot1 --confirm --max-points 15000
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  estimateSpend,
  parsePositiveLimit,
} from "./lib/experiment-budget";
import {
  buildBakeoffPrompt,
  expandTasks,
  isTerminalShuyuStatus,
  livePriceSanity,
  observeTask,
  orderInputImages,
  parseArms,
  parseBakeoffManifest,
  referencePointsPerTask,
  type BakeoffItem,
  type BakeoffManifest,
  type TaskTimeline,
} from "./lib/bakeoff-plan";

const HELP = `bakeoff-runner —— Shuyu 套餐对照（直连、不写库、默认干跑）

  --manifest <json>       固定输入清单（schema 见 scripts/lib/bakeoff-plan.ts；示例 scripts/bakeoff/e7-manifest.example.json）
  --arms <id,id>          臂 = Shuyu plan_id 列表（1080P 档需 SHUYU_ALLOW_FINAL_TIER=1）
  --run-tag <tag>         运行标签（默认当天 UTC 日期）；决定结果文件名与幂等键
  --repeats <n>           每条 × 每臂重复次数（默认 1；E12 每时段 3）
  --confirm               真的提交（花点数）；不带 = 干跑
  --max-points <n>        积分硬上限（--confirm 时必填）
  --reserve-points <n>    余额预留线（默认 ${SHUYU_RESERVE_POINTS_DEFAULT}）
  --concurrency <n>       同时在途任务数（默认 2，最大 10）
  --live-price            干跑时读一次 Shuyu /prices（只读、免费）给出精确估价
  --poll-ms <n>           轮询间隔（默认 20000）
  --deadline-min <n>      总轮询时限（默认 120 分钟；超时未完的任务下次续跑接着轮询）
  --no-download           不下载成片
  --help                  打印本说明`;

interface Cli {
  manifest: string | null;
  arms: string | null;
  runTag: string;
  repeats: number;
  confirm: boolean;
  maxPoints: number | null;
  reservePoints: number;
  concurrency: number;
  livePrice: boolean;
  pollMs: number;
  deadlineMin: number;
  download: boolean;
  help: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    manifest: null,
    arms: null,
    runTag: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    repeats: 1,
    confirm: false,
    maxPoints: null,
    reservePoints: SHUYU_RESERVE_POINTS_DEFAULT,
    concurrency: 2,
    livePrice: false,
    pollMs: 20_000,
    deadlineMin: 120,
    download: true,
    help: false,
  };
  const int = (raw: string, flag: string, min: number, max: number) => {
    const n = Number.parseInt(raw, 10);
    if (!(n >= min && n <= max)) throw new Error(`${flag} 取 ${min}–${max}`);
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const eq = argv[i].indexOf("=");
    const flag = eq > 0 ? argv[i].slice(0, eq) : argv[i];
    const value = () => {
      const v = eq > 0 ? argv[i].slice(eq + 1) : argv[++i];
      if (v === undefined) throw new Error(`${flag} 缺参数`);
      return v;
    };
    switch (flag) {
      case "--help":
      case "-h": cli.help = true; break;
      case "--manifest": cli.manifest = value(); break;
      case "--arms": cli.arms = value(); break;
      case "--run-tag": {
        const tag = value();
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(tag)) throw new Error("--run-tag 只能是字母数字、- 和 _（≤32）");
        cli.runTag = tag;
        break;
      }
      case "--repeats": cli.repeats = int(value(), flag, 1, 10); break;
      case "--confirm": cli.confirm = true; break;
      case "--max-points": cli.maxPoints = parsePositiveLimit(value()); break;
      case "--reserve-points": cli.reservePoints = int(value(), flag, 0, 10_000_000); break;
      case "--concurrency": cli.concurrency = int(value(), flag, 1, 10); break;
      case "--live-price": cli.livePrice = true; break;
      case "--poll-ms": cli.pollMs = int(value(), flag, 2_000, 600_000); break;
      case "--deadline-min": cli.deadlineMin = int(value(), flag, 1, 24 * 60); break;
      case "--no-download": cli.download = false; break;
      default: throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return cli;
}

interface ArmPlan {
  planId: string;
  resolution: string | null;
  tier: string | null;
  billingUnit: string | null;
  unitSalePoints: number | null;
  inputImagesMax: number | null;
  pointsPerTask: number | null;
  priceSource: "live" | "reference";
  note?: string;
}

interface TaskRecord extends TaskTimeline {
  key: string;
  itemId: string;
  planId: string;
  rep: number;
  promptSha256: string;
  inputImages: string[];
  points: number | null;
  providerTaskId: string | null;
  outputs: string[];
  localPath: string | null;
  error: string | null;
  /** 提交未拿到确认（可能已建任务）：不自动重提，人工用供应商后台核对。 */
  ackUnknown?: boolean;
  /** 人工 QA 0–2（商品 / 人物 / 口型），由评审回填。 */
  qa: { product: number | null; person: number | null; lipSync: number | null };
}

interface ResultFile {
  experiment: string;
  runTag: string;
  manifestPath: string;
  manifestSha256: string;
  sourceNote: string | null;
  durationSec: number;
  aspectRatio: string;
  startedAt: string;
  finishedAt?: string;
  arms: ArmPlan[];
  prompts: Record<string, { sha256: string; prompt: string; negativePrompt: string }>;
  budget?: Record<string, unknown>;
  balanceStart?: number | null;
  balanceEnd?: number | null;
  tasks: TaskRecord[];
}

const sleep = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(HELP);
    return;
  }
  if (!cli.manifest) throw new Error("缺 --manifest（--help 看用法）");
  const manifestText = readFileSync(cli.manifest, "utf8");
  const manifest: BakeoffManifest = parseBakeoffManifest(JSON.parse(manifestText));
  const arms = parseArms(cli.arms);
  const tasks = expandTasks(manifest, arms, cli.runTag, cli.repeats);
  const itemById = new Map<string, BakeoffItem>(manifest.items.map((item) => [item.id, item]));
  const prompts = Object.fromEntries(
    manifest.items.map((item) => [item.id, buildBakeoffPrompt(manifest, item)]),
  );
  const outDir = path.resolve(process.cwd(), "tmp/experiments-2026-11", manifest.experiment);
  const outPath = path.join(outDir, `${cli.runTag}.json`);
  const prior: ResultFile | null = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as ResultFile) : null;
  const submittedKeys = new Set((prior?.tasks ?? []).filter((task) => task.providerTaskId || task.ackUnknown).map((task) => task.key));
  const toSubmit = tasks.filter((task) => !submittedKeys.has(task.key));

  const needLive = cli.confirm || cli.livePrice;
  let shuyu: typeof import("../src/lib/providers/shuyu") | null = null;
  if (needLive) {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(process.cwd());
    process.env.CAPABILITY_WRITE_THROUGH = "0";
    shuyu = await import("../src/lib/providers/shuyu");
  }

  const armPlans: ArmPlan[] = [];
  for (const planId of arms) {
    if (!shuyu) {
      armPlans.push({
        planId, resolution: null, tier: null, billingUnit: null, unitSalePoints: null, inputImagesMax: null,
        pointsPerTask: referencePointsPerTask(null, manifest.durationSec),
        priceSource: "reference",
        note: "未触网：按内置 1080P 参考价保守估（--live-price 读实时价）",
      });
      continue;
    }
    try {
      const plan = await shuyu.resolveShuyuVideoPlan({ planId });
      const pointsPerTask = shuyu.shuyuVideoPlanPointsForDuration(plan, manifest.durationSec);
      const sanity = livePriceSanity({ planId, resolution: plan.resolution, livePointsPerTask: pointsPerTask, durationSec: manifest.durationSec });
      armPlans.push({
        planId, resolution: plan.resolution, tier: plan.tier, billingUnit: plan.billingUnit,
        unitSalePoints: plan.unitSalePoints, inputImagesMax: shuyu.shuyuReferenceImageLimit(plan),
        pointsPerTask: sanity.ok ? pointsPerTask : null, priceSource: "live",
        ...(sanity.ok ? {} : { note: sanity.reason! }),
      });
    } catch (error) {
      const message = (error as Error).message;
      armPlans.push({
        planId, resolution: null, tier: null, billingUnit: null, unitSalePoints: null, inputImagesMax: null,
        pointsPerTask: null, priceSource: "live",
        note: /final-tier/.test(message) ? `${message}（1080P 档需 SHUYU_ALLOW_FINAL_TIER=1）` : message.slice(0, 200),
      });
    }
  }
  const armById = new Map(armPlans.map((arm) => [arm.planId, arm]));
  const estimate = estimateSpend(
    armPlans.map((arm) => ({
      armId: arm.planId,
      count: toSubmit.filter((task) => task.planId === arm.planId).length,
      unitPoints: arm.pointsPerTask,
      unitUsd: null,
    })),
  );

  if (!cli.confirm) {
    console.log(JSON.stringify({
      mode: "dry-run",
      experiment: manifest.experiment,
      runTag: cli.runTag,
      out: path.relative(process.cwd(), outPath),
      items: manifest.items.length,
      arms: armPlans,
      repeats: cli.repeats,
      tasks: tasks.length,
      alreadySubmitted: tasks.length - toSubmit.length,
      estimate: { totalPoints: estimate.totalPoints, unpricedArms: estimate.unpricedArms, perArm: estimate.lines.map((line) => ({ planId: line.armId, count: line.count, points: line.points })) },
      prompts: manifest.items.map((item) => ({
        itemId: item.id,
        sha256: prompts[item.id].sha256.slice(0, 16),
        chars: prompts[item.id].prompt.length,
        head: prompts[item.id].prompt.slice(0, 160),
        inputImages: item.productImages.length + item.storyboardFrames.length,
      })),
      hint: "--confirm --max-points <上限> 才会提交；1080P 档另需 SHUYU_ALLOW_FINAL_TIER=1",
    }, null, 2));
    return;
  }

  const balanceStart = (await shuyu!.getShuyuBalance()).available_points;
  const gate = checkBudgetGate({ estimate, maxPoints: cli.maxPoints, maxUsd: null, availablePoints: balanceStart, reservePoints: cli.reservePoints });
  console.log(`预估：${toSubmit.length} 条待提交，${estimate.totalPoints} 点；余额 ${balanceStart}，上限 ${cli.maxPoints ?? "—"}，预留线 ${cli.reservePoints}`);
  const armProblems = armPlans.filter((arm) => arm.pointsPerTask === null).map((arm) => `${arm.planId}：${arm.note}`);
  if (!gate.ok || armProblems.length > 0) {
    throw new Error(`拒绝提交：\n  - ${[...armProblems, ...gate.reasons].join("\n  - ")}`);
  }
  if (cli.concurrency > 2) console.warn(`⚠ 并发 ${cli.concurrency} > 2：会占用 Shuyu 账户与客户共享的并发，只用于 E10 吞吐测量，避开客户高峰`);

  mkdirSync(outDir, { recursive: true });
  const result: ResultFile = {
    experiment: manifest.experiment,
    runTag: cli.runTag,
    manifestPath: cli.manifest,
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    sourceNote: manifest.sourceNote ?? null,
    durationSec: manifest.durationSec,
    aspectRatio: manifest.aspectRatio,
    startedAt: prior?.startedAt ?? new Date().toISOString(),
    arms: armPlans,
    prompts,
    budget: { at: new Date().toISOString(), estimate, maxPoints: cli.maxPoints, reservePoints: cli.reservePoints },
    balanceStart: prior?.balanceStart ?? balanceStart,
    tasks: prior?.tasks ?? [],
  };
  const save = () => writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  save();

  const recordOf = (key: string) => result.tasks.find((task) => task.key === key);
  const queue = [...toSubmit];
  const deadline = Date.now() + cli.deadlineMin * 60_000;
  const inFlight = () => result.tasks.filter((task) => task.providerTaskId && !isTerminalShuyuStatus(task.status));

  for (;;) {
    while (queue.length > 0 && inFlight().length < cli.concurrency) {
      const spec = queue.shift()!;
      const item = itemById.get(spec.itemId)!;
      const arm = armById.get(spec.planId)!;
      const record: TaskRecord = recordOf(spec.key) ?? {
        key: spec.key, itemId: spec.itemId, planId: spec.planId, rep: spec.rep,
        promptSha256: prompts[item.id].sha256,
        inputImages: orderInputImages(item, arm.inputImagesMax ?? 0),
        points: arm.pointsPerTask, providerTaskId: null, outputs: [], localPath: null, error: null,
        qa: { product: null, person: null, lipSync: null },
      };
      if (!recordOf(spec.key)) result.tasks.push(record);
      try {
        const { taskId } = await shuyu!.createShuyuVideoTask({
          providerRequestKey: spec.key,
          prompt: prompts[item.id].prompt,
          duration: manifest.durationSec,
          aspectRatio: manifest.aspectRatio,
          inputImages: record.inputImages,
          planId: spec.planId,
        });
        record.providerTaskId = taskId;
        record.submittedAt = new Date().toISOString();
        record.status = "queued";
        record.error = null;
      } catch (error) {
        const confirmedNoJob = (error as { providerConfirmedNoJob?: boolean }).providerConfirmedNoJob === true;
        record.error = (error as Error).message.slice(0, 300);
        record.ackUnknown = !confirmedNoJob;
        record.status = confirmedNoJob ? "rejected" : "ack_unknown";
      }
      save();
      console.log(`submit ${spec.key} → ${record.providerTaskId ?? record.status}`);
    }

    const active = inFlight();
    if (queue.length === 0 && active.length === 0) break;
    if (Date.now() > deadline) {
      console.log(`轮询超时（${cli.deadlineMin} 分钟）：${active.length} 条在途、${queue.length} 条未提交，续跑同一 --run-tag 接着来`);
      break;
    }
    await sleep(cli.pollMs);
    for (const record of active) {
      try {
        const task = await shuyu!.getShuyuVideoTask(record.providerTaskId!);
        Object.assign(record, observeTask(record, task.status, new Date()));
        record.outputs = (task.outputs ?? []).map((output) => output.url);
      } catch (error) {
        record.error = `poll: ${(error as Error).message.slice(0, 200)}`;
      }
    }
    save();
    const counts: Record<string, number> = {};
    for (const record of result.tasks) counts[record.status ?? "unknown"] = (counts[record.status ?? "unknown"] ?? 0) + 1;
    console.log(JSON.stringify({ at: new Date().toISOString(), queued: queue.length, statuses: counts }));
  }

  if (cli.download) {
    const videoDir = path.join(outDir, `${cli.runTag}-videos`);
    mkdirSync(videoDir, { recursive: true });
    for (const record of result.tasks) {
      if (record.status !== "completed" || record.outputs.length === 0 || record.localPath) continue;
      const file = path.join(videoDir, `${record.itemId}--${record.planId.replace(/[^A-Za-z0-9._-]/g, "_")}-r${record.rep}.mp4`);
      const response = await fetch(record.outputs[0]);
      if (!response.ok) {
        record.error = `download HTTP ${response.status}`;
        continue;
      }
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      record.localPath = path.relative(process.cwd(), file);
    }
  }

  result.balanceEnd = (await shuyu!.getShuyuBalance()).available_points;
  result.finishedAt = new Date().toISOString();
  save();
  const failed = result.tasks.filter((task) => task.status !== "completed");
  console.log(JSON.stringify({
    out: path.relative(process.cwd(), outPath),
    completed: result.tasks.length - failed.length,
    notCompleted: failed.map((task) => ({ key: task.key, status: task.status, error: task.error })),
    balanceStart: result.balanceStart,
    balanceEnd: result.balanceEnd,
    expectedPoints: result.tasks.filter((task) => task.providerTaskId && task.status !== "refunded").reduce((sum, task) => sum + (task.points ?? 0), 0),
  }, null, 2));
  if (failed.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[bakeoff-runner] ${(error as Error).message}`);
  process.exitCode = 1;
});
