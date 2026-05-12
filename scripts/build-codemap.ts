/**
 * scripts/build-codemap.ts
 *
 * 轻量 codemap 生成器。扫描仓库关键源文件，输出一组 AI 可读的 JSON / Markdown 文件
 * 到 ai-context/，目的是让 Cursor / Claude / Opus 等 AI agent 在做开发任务前先读
 * 这份"项目地图"，从而避免反复扫描整个 repo、读取大文件造成的 token 浪费。
 *
 * 关键设计原则：
 *   1. 不修改任何业务代码，只产生只读的元数据文件
 *   2. 零新增运行时依赖（只用 Node 内置 + 项目已有 tsx）
 *   3. 不读取任何 .env / 二进制 / 媒体 / 构建产物
 *   4. 不做 LLM 调用，全部用静态规则推断 type / area / notes
 *   5. 失败要安静：遇到无法解析的文件就跳过，不抛错中断整个构建
 *
 * 用法：
 *   npm run codemap:build
 *
 * 产物：
 *   ai-context/repo-map.json         项目顶层结构 + 技术栈识别
 *   ai-context/file-summary-map.json 每个源文件的类型/区域/导入导出/notes
 *   ai-context/route-map.json        Next.js 路由 / API endpoint 列表
 *   ai-context/dependency-map.json   每个文件的 local / external import
 *   ai-context/area-map.json         按功能域归类的文件清单
 *   ai-context/agent-entry.md        AI agent 阅读入口，强制 token 预算规则
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";

// ----------------------------- 路径常量 -----------------------------

// 通过 npm run codemap:build 触发时 cwd 一定是 repo root；为了支持直接 tsx 调用，
// 我们也兜底向上找 package.json。
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
const OUTPUT_DIR = join(REPO_ROOT, "ai-context");

// ----------------------------- 排除规则 -----------------------------

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "out",
  "coverage",
  "tmp",
  "logs",
  "_legacy",
  "ai-context",
]);

// 这些目录虽然不全部排除，但子目录里的大体积产物要跳过
const EXCLUDED_SUBPATHS = [
  // 已生成的视频/图片产物（占用 50M+，不应进 prompt）
  "public/generated",
];

const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".avi",
  ".mp3", ".wav", ".m4a", ".flac", ".ogg",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".tiff",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".ico",
  ".db", ".sqlite", ".sqlite3",
  ".bin", ".dat",
  ".tsbuildinfo",
]);

// 这些文件名（精确匹配）也跳过——通常是体积大或包含敏感信息
const EXCLUDED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
  "next-env.d.ts",
]);

// .env / 任何 secret-looking file 一律跳过
function isSecretFile(relPath: string): boolean {
  const base = relPath.split(sep).pop() ?? "";
  if (base.startsWith(".env")) return true;
  if (/secret|credential|private[-_.]key/i.test(base)) return true;
  return false;
}

// 处理 secrets.example 这种文件——我们允许读 .env.example 但不输出内容
function isEnvExample(relPath: string): boolean {
  const base = relPath.split(sep).pop() ?? "";
  return base === ".env.example" || base === ".env.production.example";
}

// ----------------------------- 类型定义 -----------------------------

type FileType =
  | "page"
  | "layout"
  | "component"
  | "api"
  | "server-action"
  | "prisma"
  | "script"
  | "config"
  | "util"
  | "service"
  | "provider"
  | "test"
  | "doc"
  | "i18n"
  | "type"
  | "schema"
  | "style"
  | "workflow"
  | "unknown";

type FileArea =
  | "demo"
  | "real-footage-ads"
  | "video-generation"
  | "media-processing"
  | "ffmpeg"
  | "upload"
  | "blob-storage"
  | "prisma"
  | "auth"
  | "payments"
  | "marketing-site"
  | "admin"
  | "shared-ui"
  | "scripts"
  | "config"
  | "tests"
  | "i18n"
  | "ai-providers"
  | "metrics"
  | "publishing"
  | "wizard"
  | "shared"
  | "unknown";

interface FileSummary {
  path: string;
  type: FileType;
  area: FileArea;
  exports: string[];
  imports: string[];
  importantSymbols: string[];
  lineCount: number;
  sizeBytes: number;
  notes: string;
}

interface RouteEntry {
  routePath: string;
  filePath: string;
  kind: "page" | "layout" | "error" | "not-found" | "loading" | "template" | "api" | "server-action";
  httpMethods?: string[];
  group?: string;
  isDynamic?: boolean;
  notes?: string;
}

interface DependencyEntry {
  file: string;
  imports: string[];
  localImports: string[];
  externalImports: string[];
}

// ----------------------------- 工具函数 -----------------------------

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function relPosix(p: string): string {
  return relative(REPO_ROOT, p).split(sep).join("/");
}

function shouldSkipDir(absPath: string, name: string): boolean {
  if (EXCLUDED_DIRS.has(name)) return true;
  const rel = relPosix(absPath);
  for (const sub of EXCLUDED_SUBPATHS) {
    if (rel === sub || rel.startsWith(sub + "/")) return true;
  }
  return false;
}

function shouldSkipFile(absPath: string): boolean {
  const rel = relPosix(absPath);
  const base = rel.split("/").pop() ?? "";
  if (EXCLUDED_FILENAMES.has(base)) return true;
  if (isSecretFile(rel) && !isEnvExample(rel)) return true;
  const ext = extname(base).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return true;
  return false;
}

// 文本文件扩展名，我们才尝试读内容做静态分析
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".json", ".jsonc",
  ".md", ".mdx", ".mdc",
  ".css", ".scss", ".sass",
  ".prisma",
  ".yml", ".yaml",
  ".sh",
  ".sql",
]);

function isTextFile(absPath: string): boolean {
  const ext = extname(absPath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // 无扩展名的文件（README, LICENSE 等）也尝试读
  if (ext === "") {
    const base = absPath.split(sep).pop() ?? "";
    if (/^(readme|license|changelog|notice|authors)$/i.test(base)) return true;
  }
  return false;
}

// ----------------------------- 静态分析 -----------------------------

const IMPORT_RE = /(?:import\s+(?:[^'"`;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|require\(|import\()\s*['"`]([^'"`]+)['"`]\)?/g;

function extractImports(source: string): string[] {
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const spec = match[1];
    if (!spec) continue;
    out.add(spec);
  }
  return Array.from(out);
}

const EXPORT_NAMED_RE = /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /export\s+\{\s*([^}]+)\s*\}/g;

function extractExports(source: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  EXPORT_NAMED_RE.lastIndex = 0;
  while ((m = EXPORT_NAMED_RE.exec(source)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(source)) !== null) {
    const list = m[1] ?? "";
    for (const piece of list.split(",")) {
      const name = piece.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  if (/export\s+default\b/.test(source)) {
    out.add("default");
  }
  return Array.from(out);
}

// 从源码识别 React component 或 hook 名（首字母大写 / use 开头）
function extractImportantSymbols(exports: string[]): string[] {
  const ranked = [...exports].filter((e) => e !== "default");
  // 把疑似组件 / hook 排前面，再补 default
  ranked.sort((a, b) => {
    const aw = /^[A-Z]/.test(a) || /^use[A-Z]/.test(a) ? 0 : 1;
    const bw = /^[A-Z]/.test(b) || /^use[A-Z]/.test(b) ? 0 : 1;
    return aw - bw;
  });
  if (exports.includes("default")) ranked.push("default");
  return ranked.slice(0, 8);
}

// 在 API route 中识别导出的 HTTP 方法
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
function extractHttpMethods(source: string): string[] {
  const out: string[] = [];
  for (const m of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${m}\\b`);
    if (re.test(source)) out.push(m);
  }
  return out;
}

// ----------------------------- 类型 / 区域分类 -----------------------------

function classifyType(relPath: string, source: string | null): FileType {
  const p = relPath;
  if (p === "prisma/schema.prisma" || p.endsWith(".prisma")) return "prisma";
  if (p.startsWith("prisma/")) return "schema";
  if (p.startsWith("tests/")) return "test";
  if (/\.test\.(ts|tsx|js|jsx)$/.test(p)) return "test";
  if (p.startsWith("scripts/")) return "script";
  if (p.startsWith("docs/") || /\.mdx?$/.test(p) || p === "README.md") return "doc";
  if (p.startsWith(".github/workflows/")) return "workflow";
  if (p.startsWith("src/types/")) return "type";
  if (p.startsWith("src/i18n/")) return "i18n";
  if (/\.(css|scss|sass)$/.test(p)) return "style";

  if (p.startsWith("src/app/api/")) {
    if (/\/route\.(ts|tsx|js|jsx)$/.test(p)) return "api";
  }
  if (p.startsWith("src/app/")) {
    if (/\/page\.(ts|tsx|js|jsx)$/.test(p)) return "page";
    if (/\/layout\.(ts|tsx|js|jsx)$/.test(p)) return "layout";
    if (/\/(error|not-found|loading|template)\.(ts|tsx|js|jsx)$/.test(p)) return "page";
  }
  if (source && /^\s*['"]use server['"]\s*;?/m.test(source)) return "server-action";
  if (p.startsWith("src/components/")) return "component";
  if (p.startsWith("src/lib/services/")) return "service";
  if (p.startsWith("src/lib/providers/")) return "provider";
  if (p.startsWith("src/lib/schemas/") || p.startsWith("src/lib/validators/")) return "schema";
  if (p.startsWith("src/lib/")) return "util";

  // 顶层配置
  if (
    p === "next.config.ts" ||
    p === "next.config.js" ||
    p === "tsconfig.json" ||
    p === "package.json" ||
    p === "eslint.config.mjs" ||
    p === "postcss.config.mjs" ||
    p === "components.json" ||
    p === "vercel.json" ||
    p === ".vercelignore" ||
    p === ".gitignore"
  ) return "config";

  return "unknown";
}

interface AreaRule {
  area: FileArea;
  test: (relPath: string, source: string | null) => boolean;
}

const AREA_RULES: AreaRule[] = [
  // 顺序很重要——更具体的规则放前面
  { area: "tests", test: (p) => p.startsWith("tests/") || /\.test\.(ts|tsx|js|jsx)$/.test(p) },
  { area: "config", test: (p) => p.startsWith(".github/") || /^(next\.config|tsconfig|eslint\.config|postcss\.config|components\.json|vercel\.json|package\.json|\.vercelignore|\.gitignore|next-env\.d\.ts)$/.test(p) || /^\.env\./.test(p) },
  { area: "i18n", test: (p) => p.startsWith("src/i18n/") },
  { area: "prisma", test: (p) => p.startsWith("prisma/") },
  { area: "ai-providers", test: (p) => p.startsWith("src/lib/providers/") },
  { area: "wizard", test: (p) => p.startsWith("src/components/wizard/") || p.includes("/wizard-") || p.endsWith("/wizard.tsx") },
  { area: "real-footage-ads", test: (p) => p.includes("real-footage-ads") || p.includes("real-footage-walkthrough") || p.includes("sunny-shutter") },
  { area: "demo", test: (p) => p.startsWith("src/components/demo/") || p.startsWith("src/app/api/demo/") || p.includes("/demo/") || p.includes("demo-") || p.startsWith("src/lib/demo/") || p.includes("walkthrough") || p.includes("pet-demo") },
  { area: "ffmpeg", test: (p, src) => /stitch|loudness|concat-mp4/i.test(p) || (src ? /(?:spawn|exec|execSync|spawnSync)\s*\(\s*["']ffmpeg["']|from\s+["']fluent-ffmpeg["']|loudnorm\s*=/.test(src) : false) },
  { area: "media-processing", test: (p, src) => /stitch|render|encode|transcode|thumbnail/i.test(p) || (src ? /ffmpeg|@vercel\/blob.*put\(/i.test(src) : false) },
  { area: "blob-storage", test: (p, src) => (src ? /@vercel\/blob/.test(src) : false) },
  { area: "upload", test: (p) => p.includes("upload") || p.includes("attachment-uploader") },
  { area: "video-generation", test: (p) => p.startsWith("src/lib/video-generation/") || p.startsWith("src/components/video-generation/") || p.startsWith("src/app/api/video-generation/") || p.includes("video-job") || p.includes("seedance") },
  { area: "publishing", test: (p) => p.startsWith("src/app/api/publish") || p.includes("publish-service") || p.includes("/publish/") },
  { area: "metrics", test: (p) => p.includes("/metrics") || p.includes("metrics-service") },
  { area: "auth", test: (p) => /\bauth\b/.test(p) && !p.includes("video") && !p.includes("ai-usage") },
  { area: "payments", test: (p) => /\b(billing|payment|stripe|checkout)\b/i.test(p) },
  { area: "admin", test: (p) => p.startsWith("src/app/(internal)/") || p.includes("/admin/") },
  { area: "marketing-site", test: (p) => p.startsWith("src/app/(public)/") || p.includes("coming-soon") || p.startsWith("src/app/(personal)/") || p.startsWith("src/app/(business)/") },
  { area: "shared-ui", test: (p) => p.startsWith("src/components/ui/") },
  { area: "scripts", test: (p) => p.startsWith("scripts/") },
];

function classifyArea(relPath: string, source: string | null): FileArea {
  // 文档/测试/i18n 优先靠路径定，不让 source 关键词污染
  if (relPath.startsWith("tests/") || /\.test\.(ts|tsx|js|jsx)$/.test(relPath)) return "tests";
  if (relPath.startsWith("docs/") || relPath === "README.md") return "shared";
  if (relPath.startsWith(".github/")) return "config";
  if (relPath.startsWith("src/i18n/")) return "i18n";

  for (const rule of AREA_RULES) {
    if (rule.test(relPath, source)) return rule.area;
  }
  if (relPath.startsWith("src/components/")) return "shared";
  if (relPath.startsWith("src/lib/")) return "shared";
  return "unknown";
}

// 生成简短 notes
function buildNotes(relPath: string, type: FileType, area: FileArea, source: string | null): string {
  const fragments: string[] = [];
  switch (type) {
    case "api": fragments.push("Next.js API route handler"); break;
    case "page": fragments.push("Next.js App Router page"); break;
    case "layout": fragments.push("Next.js App Router layout"); break;
    case "server-action": fragments.push("Next.js server action ('use server')"); break;
    case "prisma": fragments.push("Prisma schema (database source of truth)"); break;
    case "schema": fragments.push("Schema / validation"); break;
    case "script": fragments.push("Maintenance / one-off script (run via tsx)"); break;
    case "config": fragments.push("Build / runtime config"); break;
    case "test": fragments.push("Unit / integration test"); break;
    case "provider": fragments.push("External API provider wrapper"); break;
    case "service": fragments.push("Business logic service"); break;
    case "component": fragments.push("React component"); break;
    case "doc": fragments.push("Documentation"); break;
    case "i18n": fragments.push("i18n / localization"); break;
    case "workflow": fragments.push("GitHub Actions workflow"); break;
    case "type": fragments.push("Shared TypeScript types"); break;
    case "style": fragments.push("Stylesheet"); break;
    case "util": fragments.push("Utility / helper module"); break;
  }

  // 基于源码内容做更精细的提示——只对真实代码文件生效，避免 Prisma schema / 文档里的关键词污染 notes
  const isCode = type === "api" || type === "page" || type === "layout" ||
                 type === "server-action" || type === "component" || type === "service" ||
                 type === "provider" || type === "util" || type === "script" || type === "test";
  if (source && isCode) {
    if (/from\s+["']openai["']/.test(source)) fragments.push("uses OpenAI SDK");
    if (/from\s+["']@vercel\/blob["']/.test(source)) fragments.push("uses Vercel Blob storage");
    if (/from\s+["']@prisma\/client["']/.test(source) || /import\s+\{\s*prisma\s*\}/.test(source) || /\bprisma\.\w+\.(?:findMany|findUnique|findFirst|create|update|delete|upsert|count)\(/.test(source)) fragments.push("hits Prisma DB");
    if (/from\s+["'][^"']*providers\/seedance["']/.test(source) || /\bgetSeedanceStatus\b|\bsubmitSeedance/.test(source)) fragments.push("calls Seedance video generator");
    // 必须看到真正的 ffmpeg 调用证据，而不仅是字符串里出现 "ffmpeg"
    const ffmpegCall =
      /(?:spawn|exec|execSync|spawnSync)\s*\(\s*["']ffmpeg["']/.test(source) ||
      /from\s+["']fluent-ffmpeg["']/.test(source) ||
      /require\s*\(\s*["']fluent-ffmpeg["']\s*\)/.test(source) ||
      /loudnorm\s*=/.test(source);
    if (ffmpegCall) fragments.push("FFmpeg / audio loudness pipeline");
    if (/next-auth|getServerSession/.test(source)) fragments.push("NextAuth session check");
    if (/^\s*['"]use client['"]\s*;?/m.test(source)) fragments.push("client component");
  }

  if (area && area !== "unknown" && area !== "shared") fragments.push(`area=${area}`);

  return fragments.join("; ");
}

// ----------------------------- 主扫描器 -----------------------------

interface CollectedFile {
  abs: string;
  rel: string;
  sizeBytes: number;
  isText: boolean;
  source: string | null;
  lineCount: number;
}

function* walk(dir: string): Generator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const abs = join(dir, name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (shouldSkipDir(abs, name)) continue;
      yield* walk(abs);
    } else if (entry.isFile()) {
      if (shouldSkipFile(abs)) continue;
      yield abs;
    }
  }
}

function collectFiles(): CollectedFile[] {
  const out: CollectedFile[] = [];
  for (const abs of walk(REPO_ROOT)) {
    let st: ReturnType<typeof statSync>;
    try { st = statSync(abs); } catch { continue; }
    const rel = relPosix(abs);

    const text = isTextFile(abs);
    let source: string | null = null;
    let lineCount = 0;

    // 限制最大读取尺寸，防止意外巨型文件（>1MB 的纯文本不读）
    const MAX_READ_BYTES = 1024 * 1024;
    if (text && st.size <= MAX_READ_BYTES) {
      source = safeRead(abs);
      if (source !== null) {
        // 对 .env.example 我们读但不写入 source（防止任何 secret-like 内容外泄）
        if (isEnvExample(rel)) source = "";
        lineCount = source.length === 0 ? 0 : source.split(/\r?\n/).length;
      }
    } else if (text) {
      // 文本文件但太大，记录行数为 0，不读内容
      source = null;
    }

    out.push({
      abs,
      rel,
      sizeBytes: st.size,
      isText: text,
      source,
      lineCount,
    });
  }
  return out;
}

// ----------------------------- 路由提取 -----------------------------

function deriveRoutePath(relPath: string): { route: string; group?: string; isDynamic: boolean } {
  // 例：src/app/(internal)/internal/metrics/page.tsx → /internal/metrics
  // 例：src/app/api/demo/real-footage-ads/waitlist/route.ts → /api/demo/real-footage-ads/waitlist
  const after = relPath.replace(/^src\/app\//, "");
  const segments = after.split("/");
  segments.pop(); // 去掉文件名
  const groups: string[] = [];
  const cleaned: string[] = [];
  for (const seg of segments) {
    if (/^\(.+\)$/.test(seg)) {
      groups.push(seg.slice(1, -1));
      continue;
    }
    cleaned.push(seg);
  }
  let route = "/" + cleaned.join("/");
  route = route.replace(/\/+$/, "") || "/";
  const isDynamic = /\[.+\]/.test(route);
  return { route, group: groups[0], isDynamic };
}

function buildRouteMap(files: CollectedFile[]): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const f of files) {
    if (!f.rel.startsWith("src/app/")) continue;
    const base = f.rel.split("/").pop() ?? "";
    const m = base.match(/^(page|layout|error|not-found|loading|template|route)\.(ts|tsx|js|jsx)$/);
    if (!m) continue;
    const kind = m[1];
    const { route, group, isDynamic } = deriveRoutePath(f.rel);

    if (kind === "route") {
      out.push({
        routePath: route,
        filePath: f.rel,
        kind: "api",
        httpMethods: f.source ? extractHttpMethods(f.source) : [],
        group,
        isDynamic,
      });
      continue;
    }

    let isServerAction = false;
    if (f.source && /^\s*['"]use server['"]\s*;?/m.test(f.source)) {
      isServerAction = true;
    }

    out.push({
      routePath: route,
      filePath: f.rel,
      kind: kind as RouteEntry["kind"],
      group,
      isDynamic,
      notes: isServerAction ? "contains 'use server' directive" : undefined,
    });
  }
  // 按 routePath 排序，方便 AI 查阅
  out.sort((a, b) => a.routePath.localeCompare(b.routePath) || a.kind.localeCompare(b.kind));
  return out;
}

// ----------------------------- 输出构建 -----------------------------

function buildSummaries(files: CollectedFile[]): FileSummary[] {
  const summaries: FileSummary[] = [];
  for (const f of files) {
    const type = classifyType(f.rel, f.source);
    const area = classifyArea(f.rel, f.source);

    let exports: string[] = [];
    let imports: string[] = [];
    let importantSymbols: string[] = [];

    if (f.source) {
      try {
        exports = extractExports(f.source);
        imports = extractImports(f.source);
        importantSymbols = extractImportantSymbols(exports);
      } catch {
        // 忽略单文件解析失败
      }
    }

    summaries.push({
      path: f.rel,
      type,
      area,
      exports: exports.slice(0, 30),
      imports: imports.slice(0, 30),
      importantSymbols,
      lineCount: f.lineCount,
      sizeBytes: f.sizeBytes,
      notes: buildNotes(f.rel, type, area, f.source),
    });
  }
  summaries.sort((a, b) => a.path.localeCompare(b.path));
  return summaries;
}

function buildDependencyMap(summaries: FileSummary[]): DependencyEntry[] {
  return summaries
    .filter((s) => s.imports.length > 0)
    .map((s) => {
      const localImports: string[] = [];
      const externalImports: string[] = [];
      for (const imp of s.imports) {
        if (imp.startsWith(".") || imp.startsWith("@/") || imp.startsWith("~/")) {
          localImports.push(imp);
        } else if (imp.startsWith("node:")) {
          externalImports.push(imp);
        } else {
          externalImports.push(imp);
        }
      }
      return {
        file: s.path,
        imports: s.imports,
        localImports,
        externalImports,
      };
    });
}

function buildAreaMap(summaries: FileSummary[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const s of summaries) {
    if (!map[s.area]) map[s.area] = [];
    map[s.area].push(s.path);
  }
  for (const k of Object.keys(map)) map[k].sort();
  return map;
}

interface RepoMapShape {
  topLevelDirs: string[];
  stack: string[];
  package: { name: string; version: string };
}

function buildRepoMap(summaries: FileSummary[], routes: RouteEntry[]): RepoMapShape & Record<string, unknown> {
  // top-level 目录列举（排除被忽略的）
  const topLevel: string[] = [];
  try {
    const entries = readdirSync(REPO_ROOT, { withFileTypes: true }) as import("node:fs").Dirent[];
    for (const entry of entries) {
      const name = String(entry.name);
      if (!entry.isDirectory()) continue;
      if (shouldSkipDir(join(REPO_ROOT, name), name)) continue;
      topLevel.push(name);
    }
  } catch { /* noop */ }
  topLevel.sort();

  // 读 package.json 摘要技术栈
  const pkgJson = safeRead(join(REPO_ROOT, "package.json"));
  const stack: string[] = [];
  let packageName = "";
  let packageVersion = "";
  let scripts: Record<string, string> = {};
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        name?: string;
        version?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      packageName = pkg.name ?? "";
      packageVersion = pkg.version ?? "";
      scripts = pkg.scripts ?? {};
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const stackHints: Array<[string, string]> = [
        ["next", "Next.js"],
        ["react", "React"],
        ["@prisma/client", "Prisma ORM"],
        ["@vercel/blob", "Vercel Blob"],
        ["next-auth", "NextAuth.js"],
        ["openai", "OpenAI SDK"],
        ["tailwindcss", "Tailwind CSS"],
        ["framer-motion", "Framer Motion"],
        ["zod", "Zod schemas"],
        ["bcryptjs", "bcryptjs"],
        ["apify-client", "Apify TikTok scraper"],
      ];
      for (const [dep, label] of stackHints) {
        if (allDeps[dep]) stack.push(`${label} (${allDeps[dep]})`);
      }
    } catch { /* noop */ }
  }

  // 区域分布
  const areaCounts: Record<string, number> = {};
  for (const s of summaries) areaCounts[s.area] = (areaCounts[s.area] ?? 0) + 1;

  // 类型分布
  const typeCounts: Record<string, number> = {};
  for (const s of summaries) typeCounts[s.type] = (typeCounts[s.type] ?? 0) + 1;

  // 关键文件高亮
  const importantFiles = summaries
    .filter((s) =>
      s.path === "prisma/schema.prisma" ||
      s.path === "next.config.ts" ||
      s.path === "package.json" ||
      s.path === "src/app/layout.tsx" ||
      s.path === "src/middleware.ts" ||
      s.path === "src/lib/auth.ts" ||
      s.path === "src/lib/db.ts" ||
      s.path === "scripts/stitch-runner.ts" ||
      s.path === "src/i18n/index.ts" ||
      s.path === "README.md"
    )
    .map((s) => ({ path: s.path, type: s.type, area: s.area, notes: s.notes }));

  // 路由统计
  const routesByKind: Record<string, number> = {};
  for (const r of routes) routesByKind[r.kind] = (routesByKind[r.kind] ?? 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    package: { name: packageName, version: packageVersion },
    topLevelDirs: topLevel,
    stack,
    fileTotals: {
      total: summaries.length,
      byType: typeCounts,
      byArea: areaCounts,
    },
    routes: {
      total: routes.length,
      byKind: routesByKind,
    },
    importantFiles,
    scripts,
    excluded: {
      dirs: Array.from(EXCLUDED_DIRS).sort(),
      subpaths: EXCLUDED_SUBPATHS,
      mediaExtensions: Array.from(MEDIA_EXTENSIONS).sort(),
      filenames: Array.from(EXCLUDED_FILENAMES).sort(),
      secretsPolicy: "Files matching .env*, secret*, credential*, *private-key* are skipped entirely.",
    },
  };
}

// ----------------------------- agent-entry.md -----------------------------

function buildAgentEntry(repoMap: RepoMapShape, routes: RouteEntry[], summaries: FileSummary[]): string {
  const top = repoMap.topLevelDirs.join(", ");
  const stack = repoMap.stack.join(", ");
  const totalFiles = summaries.length;
  const apiCount = routes.filter((r) => r.kind === "api").length;
  const pageCount = routes.filter((r) => r.kind === "page").length;

  return `# Agent Entry — ai-context

> 自动生成于 ${new Date().toISOString()}。AI agent 在做任何代码任务前，必须先读这份文档。
> 不要先扫整个 repo，不要先读大文件，不要重复读取 \`public/generated\` 或构建产物。

## 项目快照

- 包名：\`${repoMap.package.name}\` (v${repoMap.package.version})
- 顶层目录：${top}
- 主要技术栈：${stack || "see package.json"}
- 已索引源文件：${totalFiles}
- 路由：${pageCount} 个 page，${apiCount} 个 API endpoint

## ai-context 文件清单

| 文件 | 用途 | 何时读 |
|------|------|--------|
| \`ai-context/repo-map.json\` | 顶层结构 / 技术栈 / 区域统计 | 任务开始前必读 |
| \`ai-context/file-summary-map.json\` | 每个源文件的 type / area / 导出 / notes | 找定位 / 找对应文件 |
| \`ai-context/route-map.json\` | Next.js 路由 + API endpoint | 改路由 / 加 API / 调试 404 |
| \`ai-context/dependency-map.json\` | 文件之间的 import 关系 | 想知道"动这个文件会影响谁" |
| \`ai-context/area-map.json\` | 按功能域归类的文件清单 | 大功能改造前先扫 |
| \`ai-context/agent-entry.md\` | 你正在读的这份 | 永远第一个读 |

## 常见任务的入口

- **video generation 调试** → 先看 \`area-map.json\` 中 \`video-generation\` 与 \`ai-providers\`，再 \`grep\` 具体 service 名。
- **demo 页面 / real-footage-ads** → 先看 \`area-map.json\` 中 \`demo\` 与 \`real-footage-ads\`。
- **FFmpeg / 拼接 / 音频** → 先看 \`area-map.json\` 中 \`ffmpeg\` 与 \`media-processing\`。
- **数据库 schema 改动** → \`prisma/schema.prisma\`（改前先读 \`docs/\` 中相关 spec）。
- **路由 / API endpoint 检查** → 直接查 \`route-map.json\`，不要扫 src/app。
- **不知道改什么** → \`npm run context:find -- "关键词1 关键词2"\`，会基于路径/notes/exports 给你 top 10 文件。

## Agent Token Budget Rules

> 这套规则是硬性要求。Cursor / Claude / Opus 在本项目里都按这套走。

1. **永远先读 \`ai-context/agent-entry.md\`**（也就是这份文档）。
2. **改代码前先跑 / 看 \`context-router\`**：\`npm run context:find -- "你的任务关键词"\`。
3. **优先读精确的文件 + 行号区间**，不要整文件吞。
4. **永远不读以下路径**：
   - \`node_modules/\`、\`.next/\`、\`.git/\`、\`.vercel/\`
   - \`public/generated/\`（视频/图片成品，纯二进制 + 大）
   - \`tmp/\`、\`logs/\`、\`coverage/\`、\`dist/\`、\`build/\`
   - 任何 \`.mp4 / .mov / .webm / .jpg / .png / .gif / .pdf / .zip\` 等媒体文件
   - 任何 \`.env*\`（除了 \`.env.example\`，但**绝对不要把 example 的 key 放进 prompt**）
   - \`package-lock.json\`（特大且对任务无价值）
5. **不重读未变更的大文件**：如果你这一轮已经读过 \`prisma/schema.prisma\` 或某个长 service，跨调用前提（除非用户说改）不要再 fetch 一次。
6. **依赖关系先用 \`dependency-map.json\`**，不要用 \`grep\` 暴搜整个 repo。
7. **只有当窄上下文不足以解决问题时**，才升级到全文件读取，并尽量在一次读完。
8. 任何对 \`scripts/\` 与 \`ai-context/\` 之外文件的修改，按"改业务代码"对待——需要明确的任务说明。
9. 该 codemap 是静态生成的快照。如果 repo 结构有大幅变动（新增大目录 / 重构模块）请重新 \`npm run codemap:build\`。

## 紧急刹车

- 如果你发现自己即将读 \`public/generated/\`、\`tmp/\`、\`.next/\` 任何东西——**停下**，回到 \`area-map.json\` 重新定位。
- 如果你发现自己反复 \`grep\` 整个 repo——**停下**，跑 \`npm run context:find\` 替代。
- 如果你需要跨多个文件理解一个流程——先读 \`dependency-map.json\`，再按图谱顺序最小化读取。
`;
}

// ----------------------------- 主入口 -----------------------------

function main() {
  const start = Date.now();
  console.log("[codemap] scanning repository...");
  ensureDir(OUTPUT_DIR);

  const files = collectFiles();
  console.log(`[codemap] collected ${files.length} candidate files`);

  const summaries = buildSummaries(files);
  const routes = buildRouteMap(files);
  const deps = buildDependencyMap(summaries);
  const areaMap = buildAreaMap(summaries);
  const repoMap = buildRepoMap(summaries, routes);

  const writeJson = (name: string, data: unknown) => {
    const path = join(OUTPUT_DIR, name);
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[codemap] wrote ${relPosix(path)} (${(JSON.stringify(data).length / 1024).toFixed(1)} KB)`);
  };

  writeJson("repo-map.json", repoMap);
  writeJson("file-summary-map.json", { generatedAt: new Date().toISOString(), files: summaries });
  writeJson("route-map.json", { generatedAt: new Date().toISOString(), routes });
  writeJson("dependency-map.json", { generatedAt: new Date().toISOString(), entries: deps });
  writeJson("area-map.json", { generatedAt: new Date().toISOString(), areas: areaMap });

  const entryPath = join(OUTPUT_DIR, "agent-entry.md");
  writeFileSync(entryPath, buildAgentEntry(repoMap, routes, summaries), "utf8");
  console.log(`[codemap] wrote ${relPosix(entryPath)}`);

  const ms = Date.now() - start;
  console.log(`[codemap] done in ${ms}ms — open ai-context/agent-entry.md to start.`);
}

main();
