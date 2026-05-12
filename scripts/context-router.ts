/**
 * scripts/context-router.ts
 *
 * 给 AI agent / 开发者一个简单的命令：
 *   npm run context:find -- "你的任务关键词"
 *
 * 它会读取 ai-context/file-summary-map.json 和 area-map.json，
 * 用纯静态打分给出 top 10 最相关的文件，并解释为什么相关。
 *
 * 设计目标：
 *   - 不调 LLM，纯字符串 + 路径打分，毫秒级返回
 *   - 永远不读取大文件 / 媒体 / 构建产物
 *   - 提示用户合理的阅读顺序，避免 token 浪费
 *
 * 使用示例：
 *   npm run context:find -- "real footage ad demo video generation"
 *   npm run context:find -- "ffmpeg stitching audio loudness"
 *   npm run context:find -- "Prisma demo leads"
 *   npm run context:find -- "Vercel Blob generated video URL"
 *   npm run context:find -- "Sunny Shutter commercial prompt"
 *
 * 可选参数：
 *   --json         以 JSON 格式输出（给程序解析）
 *   --top=20       改变返回条数（默认 10）
 *   --area=demo    只在某个 area 内匹配
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, "package.json"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return start;
}

const REPO_ROOT = findRepoRoot(process.cwd());
const AI_CONTEXT_DIR = join(REPO_ROOT, "ai-context");

// ----------------------------- 数据加载 -----------------------------

interface FileSummary {
  path: string;
  type: string;
  area: string;
  exports: string[];
  imports: string[];
  importantSymbols: string[];
  lineCount: number;
  sizeBytes: number;
  notes: string;
}

interface FileSummaryDoc {
  generatedAt: string;
  files: FileSummary[];
}

interface AreaMapDoc {
  generatedAt: string;
  areas: Record<string, string[]>;
}

interface RouteEntry {
  routePath: string;
  filePath: string;
  kind: string;
  httpMethods?: string[];
}

interface RouteDoc {
  generatedAt: string;
  routes: RouteEntry[];
}

function loadJson<T>(name: string): T {
  const path = join(AI_CONTEXT_DIR, name);
  if (!existsSync(path)) {
    console.error(
      `\n[context-router] 找不到 ${name}。请先运行：npm run codemap:build\n`,
    );
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    console.error(`[context-router] 解析 ${name} 失败：`, err);
    process.exit(2);
  }
}

// ----------------------------- 关键词处理 -----------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for",
  "is", "are", "be", "with", "by", "at", "as",
  "我", "的", "是", "和", "在", "了", "把", "给", "做", "改",
]);

// 同义词扩展：让用户用自然语言时也能命中代码里实际的命名
const SYNONYMS: Record<string, string[]> = {
  // 视频生成 / FFmpeg
  ffmpeg: ["ffmpeg", "stitch", "concat", "loudnorm", "loudness", "encode"],
  stitch: ["stitch", "concat", "ffmpeg", "stitching"],
  audio: ["audio", "loudnorm", "loudness", "bgm"],
  loudness: ["loudness", "loudnorm"],
  video: ["video", "videojob", "seedance", "render"],
  generation: ["generation", "generate", "render", "synthesis"],
  // demo
  demo: ["demo", "showcase", "walkthrough", "real-footage", "real_footage", "realfootage"],
  walkthrough: ["walkthrough", "demo", "real-footage"],
  "sunny-shutter": ["sunny-shutter", "sunny", "shutter", "real-footage-ads"],
  "real-footage": ["real-footage", "real_footage", "realfootage", "real-footage-ads"],
  // 数据
  prisma: ["prisma", "db", "schema", "model"],
  db: ["db", "prisma", "database"],
  leads: ["leads", "waitlist", "lead"],
  blob: ["blob", "@vercel/blob", "vercel-blob", "uploadblob"],
  storage: ["storage", "blob", "@vercel/blob"],
  // 其他
  commercial: ["commercial", "advertisement", "ad-plan", "ad-render", "ad-edit"],
  prompt: ["prompt", "prompt-intelligence", "prompts"],
  ai: ["ai", "openai", "llm", "gpt"],
  openai: ["openai", "gpt", "llm"],
  auth: ["auth", "next-auth", "session"],
  upload: ["upload", "uploader", "attachment"],
};

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "");
}

function expandKeywords(query: string): string[] {
  const raw = query
    .split(/[\s,;]+/)
    .map(normalize)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  const expanded = new Set<string>(raw);
  for (const tok of raw) {
    const syn = SYNONYMS[tok];
    if (syn) for (const s of syn) expanded.add(s);
    const camel = tok.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/);
    for (const c of camel) if (c.length >= 3) expanded.add(c);
  }
  return Array.from(expanded);
}

// ----------------------------- 评分 -----------------------------

interface ScoredFile {
  summary: FileSummary;
  score: number;
  reasons: string[];
  flags: string[];
}

function scoreFile(file: FileSummary, keywords: string[]): ScoredFile | null {
  let score = 0;
  const reasons: string[] = [];
  const flags: string[] = [];

  const lowerPath = file.path.toLowerCase();
  const lowerArea = (file.area ?? "").toLowerCase();
  const lowerNotes = (file.notes ?? "").toLowerCase();
  const exportsLower = (file.exports ?? []).map((e) => e.toLowerCase());
  const symbolsLower = (file.importantSymbols ?? []).map((e) => e.toLowerCase());

  for (const kw of keywords) {
    if (!kw) continue;
    let hit = false;

    // 路径匹配（最强信号，因为路径就是项目结构最核心的语义）
    if (lowerPath.includes(kw)) {
      score += 8;
      reasons.push(`path 包含 "${kw}"`);
      hit = true;
    }
    // area 完全匹配
    if (lowerArea === kw || lowerArea.includes(kw)) {
      score += 6;
      reasons.push(`area=${file.area}`);
      hit = true;
    }
    // notes 匹配
    if (lowerNotes.includes(kw)) {
      score += 3;
      reasons.push(`notes 提到 "${kw}"`);
      hit = true;
    }
    // 导出 / important symbols
    for (const s of symbolsLower) {
      if (s.includes(kw)) {
        score += 4;
        reasons.push(`exports ${file.importantSymbols.find((x) => x.toLowerCase() === s)}`);
        hit = true;
        break;
      }
    }
    if (!hit) {
      // 在剩余 exports（不在 importantSymbols 中的）找一下
      for (const e of exportsLower) {
        if (e.includes(kw) && !symbolsLower.includes(e)) {
          score += 2;
          break;
        }
      }
    }
  }

  if (score === 0) return null;

  // 类型加权：业务代码 > 类型 > 配置 / 文档 / 测试
  const typeBoost: Record<string, number> = {
    api: 3,
    service: 3,
    provider: 2,
    page: 2,
    component: 2,
    "server-action": 3,
    util: 1,
    schema: 1,
    prisma: 2,
    script: 1,
    layout: 0,
    config: -1,
    doc: -1,
    test: -2,
  };
  if (file.type in typeBoost) score += typeBoost[file.type] ?? 0;

  // 文件过大警告（让 agent 知道少读 / 用 line range）
  if (file.lineCount > 800) flags.push(`large file (${file.lineCount} lines) — consider line-range read`);
  if (file.sizeBytes > 50_000) flags.push(`size ${(file.sizeBytes / 1024).toFixed(1)} KB`);

  // 路径警告
  if (file.path.startsWith("public/")) flags.push("public asset — usually generated, do NOT inline");
  if (file.path.startsWith("docs/")) flags.push("documentation — read for spec, not code");

  return { summary: file, score, reasons, flags };
}

// ----------------------------- 推荐顺序 -----------------------------

const READ_ORDER_PRIORITY: Record<string, number> = {
  prisma: 0,
  schema: 1,
  type: 1,
  provider: 2,
  service: 3,
  api: 4,
  "server-action": 4,
  page: 5,
  component: 6,
  layout: 7,
  util: 8,
  script: 9,
  config: 10,
  test: 11,
  doc: 12,
  unknown: 13,
};

function suggestReadOrder(top: ScoredFile[]): string[] {
  const sorted = [...top].sort((a, b) => {
    const pa = READ_ORDER_PRIORITY[a.summary.type] ?? 99;
    const pb = READ_ORDER_PRIORITY[b.summary.type] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.score - a.score;
  });
  return sorted.map((s) => s.summary.path);
}

// ----------------------------- CLI -----------------------------

interface Cli {
  query: string;
  top: number;
  json: boolean;
  area?: string;
}

function parseArgs(argv: string[]): Cli {
  let json = false;
  let top = 10;
  let area: string | undefined;
  const queryParts: string[] = [];
  for (const a of argv) {
    if (a === "--json") { json = true; continue; }
    if (a.startsWith("--top=")) {
      const n = Number(a.slice(6));
      if (Number.isFinite(n) && n > 0) top = Math.floor(n);
      continue;
    }
    if (a.startsWith("--area=")) {
      area = a.slice(7).toLowerCase();
      continue;
    }
    queryParts.push(a);
  }
  return { query: queryParts.join(" ").trim(), top, json, area };
}

function formatHuman(cli: Cli, ranked: ScoredFile[], allKeywords: string[], areaFiles: Record<string, string[]>, routes: RouteEntry[]): string {
  const lines: string[] = [];
  lines.push(`\n=== context-router ===`);
  lines.push(`query:    ${cli.query}`);
  lines.push(`keywords: ${allKeywords.join(", ")}`);
  if (cli.area) lines.push(`area:     ${cli.area}`);

  // 命中的 area
  const hitAreas = new Set<string>();
  for (const r of ranked) hitAreas.add(r.summary.area);
  if (hitAreas.size > 0) {
    lines.push(`\n命中 area：${Array.from(hitAreas).join(", ")}`);
    for (const a of hitAreas) {
      const all = areaFiles[a] ?? [];
      lines.push(`  · ${a}: ${all.length} 个文件`);
    }
  }

  // 相关路由
  const fileSet = new Set(ranked.map((r) => r.summary.path));
  const matchedRoutes = routes.filter((r) => fileSet.has(r.filePath));
  if (matchedRoutes.length > 0) {
    lines.push(`\n相关路由 (${matchedRoutes.length})：`);
    for (const r of matchedRoutes.slice(0, 8)) {
      const m = r.httpMethods && r.httpMethods.length ? `[${r.httpMethods.join(",")}] ` : "";
      lines.push(`  · ${m}${r.routePath}  ←  ${r.filePath}`);
    }
  }

  // top N
  lines.push(`\nTop ${ranked.length} 文件：`);
  let i = 1;
  for (const r of ranked) {
    const sym = r.summary.importantSymbols.length > 0
      ? `  symbols: ${r.summary.importantSymbols.slice(0, 5).join(", ")}`
      : "";
    lines.push(`\n${i++}. ${r.summary.path}  (score=${r.score})`);
    lines.push(`   type=${r.summary.type}  area=${r.summary.area}  lines=${r.summary.lineCount}  size=${r.summary.sizeBytes}b`);
    if (sym) lines.push(sym);
    if (r.summary.notes) lines.push(`   notes: ${r.summary.notes}`);
    if (r.reasons.length) lines.push(`   why:   ${r.reasons.slice(0, 4).join("; ")}`);
    if (r.flags.length) lines.push(`   ⚠ ${r.flags.join(" / ")}`);
  }

  // 建议读取顺序
  const order = suggestReadOrder(ranked);
  if (order.length > 0) {
    lines.push(`\n建议阅读顺序（先 schema / provider / service，再 api / page / component）：`);
    for (let k = 0; k < order.length; k++) lines.push(`  ${k + 1}. ${order[k]}`);
  }

  // 通用提醒
  lines.push(`\n提醒：`);
  lines.push(`  · 不要直接读 public/generated、tmp、.next 里的任何文件`);
  lines.push(`  · 读大文件请用行号区间，不要整文件 fetch`);
  lines.push(`  · 如果还是定位不到，再考虑 grep / semantic search\n`);

  return lines.join("\n");
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.query) {
    console.error(`用法：npm run context:find -- "<关键词>"`);
    console.error(`     可选：--json, --top=20, --area=demo`);
    process.exit(1);
  }

  const summaries = loadJson<FileSummaryDoc>("file-summary-map.json").files;
  const areaDoc = loadJson<AreaMapDoc>("area-map.json");
  const routeDoc = loadJson<RouteDoc>("route-map.json");

  const keywords = expandKeywords(cli.query);
  if (keywords.length === 0) {
    console.error(`[context-router] 解析不到关键词，请用更具体的查询。`);
    process.exit(1);
  }

  const candidates = cli.area
    ? summaries.filter((f) => f.area === cli.area)
    : summaries;

  const ranked: ScoredFile[] = [];
  for (const f of candidates) {
    const r = scoreFile(f, keywords);
    if (r) ranked.push(r);
  }
  ranked.sort((a, b) => b.score - a.score || a.summary.path.localeCompare(b.summary.path));
  const top = ranked.slice(0, cli.top);

  if (cli.json) {
    process.stdout.write(JSON.stringify({
      query: cli.query,
      keywords,
      area: cli.area,
      total: ranked.length,
      results: top.map((r) => ({
        path: r.summary.path,
        type: r.summary.type,
        area: r.summary.area,
        score: r.score,
        lineCount: r.summary.lineCount,
        sizeBytes: r.summary.sizeBytes,
        importantSymbols: r.summary.importantSymbols,
        notes: r.summary.notes,
        reasons: r.reasons,
        flags: r.flags,
      })),
      suggestedReadOrder: suggestReadOrder(top),
    }, null, 2) + "\n");
    return;
  }

  console.log(formatHuman(cli, top, keywords, areaDoc.areas, routeDoc.routes));
}

main();
