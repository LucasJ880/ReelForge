/**
 * 运维（只读）：按批次统计人工 QA 首过率 + 两位评分者的 Cohen's kappa（X-SCAF-9 / §7 P0-1）。
 *
 * 输入 CSV（表头必含）：batchJobId,videoJobId,productScore,personScore,lipScore,rater
 *   - 分值 0–2 的整数；lipScore 可留空（原生口播不承诺口型同步，只做参考）
 *   - 每条视频两位 rater 各一行（可多于两位：kappa 取名字排序后的前两位，其余只参与首过判定）
 *
 * 首过（first pass）的定义——与路线图 §7 P0-1 一致：
 *   该条是**首次成片**（DB：VideoJob.retryCount = 0 且 submitAttempts ≤ 1，没有重抽/重投）
 *   且**每位** rater 的商品分、人物分都 ≥ 1。
 * 分母 = 该批次在 DB 里的全部 VideoJob（含失败、未评分的）：没成片或没人评的条不算首过，
 * 这样 20 条批次「≥ 16/20」的分母才是 20，而不是「评过的条数」。
 *
 * 用法（.env.local 直连生产库；只 SELECT）：
 *   npx tsx --env-file=.env.local scripts/ops/qa-first-pass.ts --csv qa/batch-xxx.csv --batch-id <batchJobId> [--json]
 *   --batch-id 可省略：CSV 里只有一个 batchJobId 时自动取它。
 *
 * tests/qa-first-pass.test.ts 覆盖纯计算部分（CSV 解析、首过判定、kappa）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface QaRatingRow {
  batchJobId: string;
  videoJobId: string;
  productScore: number;
  personScore: number;
  lipScore: number | null;
  rater: string;
}

export interface JobFacts {
  videoJobId: string;
  retryCount: number;
  submitAttempts: number;
  status: string | null;
}

export interface KappaResult {
  /** 两位 rater 都评了的条数 */
  n: number;
  /** 观察一致率 */
  po: number | null;
  /** 期望一致率 */
  pe: number | null;
  /** Cohen's kappa；n = 0 或 pe = 1（两边都只打一种分且相同）时为 null */
  kappa: number | null;
}

export interface VideoVerdict {
  videoJobId: string;
  status: string | null;
  firstAttempt: boolean | null;
  raters: string[];
  scoresOk: boolean;
  firstPass: boolean;
  reasons: string[];
}

export interface FirstPassReport {
  batchJobId: string;
  totalVideos: number;
  ratedVideos: number;
  unratedVideos: number;
  singleRaterVideos: number;
  notFirstAttempt: number;
  firstPass: number;
  /** firstPass / totalVideos */
  firstPassRate: number | null;
  raterPair: [string, string] | null;
  kappa: { product: KappaResult; person: KappaResult; lip: KappaResult };
  unknownVideoIds: string[];
  verdicts: VideoVerdict[];
}

const REQUIRED_COLUMNS = ["batchJobId", "videoJobId", "productScore", "personScore", "rater"] as const;

function parseScore(value: string, column: string, line: number): number {
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < 0 || n > 2) {
    throw new Error(`第 ${line} 行 ${column}=${JSON.stringify(value)} 不是 0–2 的整数`);
  }
  return n;
}

/** 最小 CSV：逗号分隔、支持双引号字段、忽略空行与 BOM。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export function parseQaCsv(text: string): QaRatingRow[] {
  const lines = text
    .replace(/^﻿/u, "")
    .split(/\r?\n/u)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("CSV 为空");
  const header = splitCsvLine(lines[0].line).map((cell) => cell.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) throw new Error(`CSV 缺少列 ${column}`);
  }
  const col = (name: string) => header.indexOf(name);
  const rows: QaRatingRow[] = [];
  for (const { line, index } of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const get = (name: string) => (col(name) === -1 ? "" : (cells[col(name)] ?? "")).trim();
    const lipRaw = get("lipScore");
    rows.push({
      batchJobId: get("batchJobId"),
      videoJobId: get("videoJobId"),
      productScore: parseScore(get("productScore"), "productScore", index),
      personScore: parseScore(get("personScore"), "personScore", index),
      lipScore: lipRaw === "" ? null : parseScore(lipRaw, "lipScore", index),
      rater: get("rater"),
    });
    const row = rows[rows.length - 1];
    if (!row.videoJobId || !row.rater) throw new Error(`第 ${index} 行缺 videoJobId 或 rater`);
  }
  return rows;
}

/**
 * Cohen's kappa（无权重，类别 0/1/2）。pairs 是同一条视频上两位 rater 的分数对。
 * pe = Σ_k p(rater A 打 k) × p(rater B 打 k)。pe = 1 时公式退化（分母 0），返回 null。
 */
export function cohensKappa(pairs: Array<[number, number]>): KappaResult {
  const n = pairs.length;
  if (n === 0) return { n: 0, po: null, pe: null, kappa: null };
  const categories = [0, 1, 2];
  let agree = 0;
  const marginalA = new Map<number, number>();
  const marginalB = new Map<number, number>();
  for (const [a, b] of pairs) {
    if (a === b) agree += 1;
    marginalA.set(a, (marginalA.get(a) ?? 0) + 1);
    marginalB.set(b, (marginalB.get(b) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const k of categories) {
    pe += ((marginalA.get(k) ?? 0) / n) * ((marginalB.get(k) ?? 0) / n);
  }
  const kappa = Math.abs(1 - pe) < 1e-12 ? null : (po - pe) / (1 - pe);
  return {
    n,
    po: round4(po),
    pe: round4(pe),
    kappa: kappa === null ? null : round4(kappa),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * 纯计算：rows 已按 batchJobId 过滤；jobs 是该批次在 DB 里的全部 VideoJob。
 * 没出现在 jobs 里的 videoJobId 记入 unknownVideoIds（CSV 写错或不属于该批次），不计首过。
 */
export function computeFirstPass(
  batchJobId: string,
  rows: QaRatingRow[],
  jobs: JobFacts[],
): FirstPassReport {
  const jobById = new Map(jobs.map((job) => [job.videoJobId, job]));
  const rowsByVideo = new Map<string, QaRatingRow[]>();
  for (const row of rows) {
    if (row.batchJobId && row.batchJobId !== batchJobId) continue;
    const list = rowsByVideo.get(row.videoJobId) ?? [];
    list.push(row);
    rowsByVideo.set(row.videoJobId, list);
  }

  const raterNames = [...new Set(rows.map((row) => row.rater))].sort();
  const raterPair: [string, string] | null =
    raterNames.length >= 2 ? [raterNames[0], raterNames[1]] : null;

  const verdicts: VideoVerdict[] = [];
  const unknownVideoIds: string[] = [];
  let singleRaterVideos = 0;
  let notFirstAttempt = 0;
  let firstPass = 0;

  const productPairs: Array<[number, number]> = [];
  const personPairs: Array<[number, number]> = [];
  const lipPairs: Array<[number, number]> = [];

  for (const videoJobId of rowsByVideo.keys()) {
    if (!jobById.has(videoJobId)) unknownVideoIds.push(videoJobId);
  }

  for (const job of jobs) {
    const videoRows = rowsByVideo.get(job.videoJobId) ?? [];
    const raters = [...new Set(videoRows.map((row) => row.rater))].sort();
    const reasons: string[] = [];
    const firstAttempt = job.retryCount === 0 && job.submitAttempts <= 1;
    if (!firstAttempt) {
      notFirstAttempt += 1;
      reasons.push(`非首次成片（retryCount=${job.retryCount}, submitAttempts=${job.submitAttempts}）`);
    }
    if (raters.length === 0) {
      reasons.push("未评分");
    } else if (raters.length === 1) {
      singleRaterVideos += 1;
      reasons.push(`只有 1 位 rater（${raters[0]}）`);
    }
    const scoresOk =
      raters.length >= 2 &&
      videoRows.every((row) => row.productScore >= 1 && row.personScore >= 1);
    if (raters.length >= 2 && !scoresOk) {
      const low = videoRows
        .filter((row) => row.productScore < 1 || row.personScore < 1)
        .map((row) => `${row.rater}: 商品${row.productScore}/人物${row.personScore}`);
      reasons.push(`有 0 分（${low.join("；")}）`);
    }
    const pass = firstAttempt && scoresOk;
    if (pass) firstPass += 1;
    verdicts.push({
      videoJobId: job.videoJobId,
      status: job.status,
      firstAttempt,
      raters,
      scoresOk,
      firstPass: pass,
      reasons,
    });

    if (raterPair) {
      const a = videoRows.find((row) => row.rater === raterPair[0]);
      const b = videoRows.find((row) => row.rater === raterPair[1]);
      if (a && b) {
        productPairs.push([a.productScore, b.productScore]);
        personPairs.push([a.personScore, b.personScore]);
        if (a.lipScore !== null && b.lipScore !== null) lipPairs.push([a.lipScore, b.lipScore]);
      }
    }
  }

  const ratedVideos = jobs.filter((job) => (rowsByVideo.get(job.videoJobId) ?? []).length > 0).length;
  return {
    batchJobId,
    totalVideos: jobs.length,
    ratedVideos,
    unratedVideos: jobs.length - ratedVideos,
    singleRaterVideos,
    notFirstAttempt,
    firstPass,
    firstPassRate: jobs.length === 0 ? null : round4(firstPass / jobs.length),
    raterPair,
    kappa: {
      product: cohensKappa(productPairs),
      person: cohensKappa(personPairs),
      lip: cohensKappa(lipPairs),
    },
    unknownVideoIds,
    verdicts,
  };
}

function parseArgs(argv: string[]): { csv: string; batchId: string | null; json: boolean } {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      map.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      map.set(arg.slice(2), argv[i + 1]);
      i += 1;
    } else {
      map.set(arg.slice(2), "true");
    }
  }
  const csv = map.get("csv");
  if (!csv) throw new Error("用法：--csv <path> [--batch-id <batchJobId>] [--json]");
  return { csv, batchId: map.get("batch-id") ?? null, json: map.get("json") === "true" };
}

function formatKappa(label: string, result: KappaResult): string {
  if (result.n === 0) return `${label} kappa：无共同评分`;
  const k = result.kappa === null ? "n/a（两边分布退化）" : result.kappa.toFixed(3);
  return `${label} kappa：${k}（n=${result.n}，po=${result.po}，pe=${result.pe}）`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseQaCsv(readFileSync(args.csv, "utf8"));
  const batchIds = [...new Set(rows.map((row) => row.batchJobId).filter((id) => id.length > 0))];
  const batchId = args.batchId ?? (batchIds.length === 1 ? batchIds[0] : null);
  if (!batchId) {
    throw new Error(`CSV 里有 ${batchIds.length} 个 batchJobId，请用 --batch-id 指定：${batchIds.join(", ")}`);
  }

  /// 动态 import：测试只导入上面的纯函数，不把 Prisma 拉进来
  const { db } = await import("../../src/lib/db");
  try {
    const jobs = await db.videoJob.findMany({
      where: { batchJobId: batchId },
      select: { id: true, retryCount: true, submitAttempts: true, status: true, batchIndex: true },
      orderBy: { batchIndex: "asc" },
    });
    const report = computeFirstPass(
      batchId,
      rows.filter((row) => !row.batchJobId || row.batchJobId === batchId),
      jobs.map((job) => ({
        videoJobId: job.id,
        retryCount: job.retryCount,
        submitAttempts: job.submitAttempts,
        status: job.status,
      })),
    );

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    console.log(`批次 ${batchId}：${report.totalVideos} 条 VideoJob，已评 ${report.ratedVideos}，未评 ${report.unratedVideos}，只有 1 位 rater ${report.singleRaterVideos}，非首次成片 ${report.notFirstAttempt}`);
    console.log(
      `首过率：${report.firstPass}/${report.totalVideos}${report.firstPassRate === null ? "" : ` = ${(report.firstPassRate * 100).toFixed(1)}%`}`,
    );
    if (report.raterPair) {
      console.log(`rater 对：${report.raterPair[0]} × ${report.raterPair[1]}`);
      console.log(`  ${formatKappa("商品", report.kappa.product)}`);
      console.log(`  ${formatKappa("人物", report.kappa.person)}`);
      console.log(`  ${formatKappa("口型（参考）", report.kappa.lip)}`);
    } else {
      console.log("rater 不足 2 位，不算 kappa。");
    }
    if (report.unknownVideoIds.length > 0) {
      console.log(`⚠ CSV 里 ${report.unknownVideoIds.length} 个 videoJobId 不属于该批次：${report.unknownVideoIds.join(", ")}`);
    }
    for (const verdict of report.verdicts) {
      console.log(
        `  ${verdict.firstPass ? "✓" : "✗"} ${verdict.videoJobId}  ${String(verdict.status ?? "").padEnd(9)} ${verdict.reasons.length > 0 ? verdict.reasons.join("；") : "首过"}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
