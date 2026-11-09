/**
 * 真机压测（2026-11，抖音矩阵上线前「轮 2」）：10 个品类 × 2 个钩子角度 × A/B 两组 = 40 条（20 对），走商家在创作页点出来的
 * 同一条生产路径（单条故事板 → 确认 → 出片 → 合成 → 帧质检；15 秒、9:16、中文口播），分早 / 午 / 晚三波投，看管线够不够稳，
 * 顺带回答两个问题：帧质检这道闸值不值得留；出方案不调 OpenAI 行不行。纯逻辑：scripts/lib/soak-run.ts（单测 tests/soak-run.test.ts）。
 *
 * 怎么走的生产路径：
 *   - 写操作（传商品图、出故事板、确认、生成视频、取消）用测试账号登录后调线上的接口，和浏览器发的请求一样。
 *     派发的业务逻辑在 /api/video-generation/dispatch 这个路由里（幂等登记、额度、建单、选线路），没有可在本机调用的
 *     service 入口，本机进程也解不出登录会话；走接口还能测到线上函数的超时与请求体上限，本机调 service 测不到。
 *   - 之后的出帧、轮询、合成、质检、清扫都由线上的定时任务推进。脚本只读库观察（.env.local 的生产库，只 SELECT），
 *     不调对账、不替定时任务干活。所以这里的端到端时长是「商家点完就关页面」的口径，比一直开着页面略慢。
 *   - 幂等键带 exp-2611- 前缀，库里一眼认得出是压测数据。但平台读数目前只按批次（BatchJob）的键排除实验数据，
 *     单条任务没有批次：这一轮的成败会进创始人日报与线路健康读数，看那些数字时要知道有压测在跑。
 *   - 帧质检照线上的设置开着跑，脚本不关、不绕。
 *
 * A/B 两组（同一件商品、同一个角度、同一批商品图，一对的两条在同一波、走同一条线路）：
 *   - A 组「调 OpenAI 出方案」：现状。建故事板与生成视频都调线上接口，镜头卡、原话英译、创意简报、看参考图、一致性设定、
 *     段提示词都由线上调模型出。
 *   - B 组「不调 OpenAI 出方案」：用的开关是 LLM_FORCE_MOCK=true（src/lib/providers/openai.ts 的 isLLMForcedMock），
 *     它是进程级的环境变量，没有按请求的版本，所以只能设在本机这个进程里，线上不动：
 *       1. 故事板在本机进程里建（createStoryboardRun，与线上路由调的是同一个 service，同样计一小时限流）：
 *          镜头卡退回模板节拍、原话不英译（帧提示词直接带商家原话）。第 0 帧由本机提交给出图供应商，其余帧仍由线上定时任务提交。
 *       2. 生成视频仍调线上接口，但带上 confirmedPrompts（创作页「确认脚本」用的同一个字段）：本机在同一个开关下跑一遍
 *          buildPlan（创意简报、看参考图、一致性设定、段提示词全走启发式兜底），把 AI 段的提示词正文交上去盖掉线上的。
 *     做不到「线上完全不调 OpenAI」的地方（没有为此改生产代码）：
 *       - 线上派发照样会调模型重出一遍方案，只是 AI 段的提示词正文被盖掉。负面提示词（会拼进给视频模型的提示词）、
 *         派发前的质量把关（会不会被拦）仍来自线上那份调了模型的方案；
 *       - 所以 B 组「生成视频」那一下的用时仍含模型调用，不代表砍掉 OpenAI 之后的耗时；
 *       - B 组第 0 帧是本机代码、本机网络提交的（A 组是线上函数），故事板出图走哪家也按本机的环境变量判。
 *     这个开关在本机进程里还会关掉帧质检、内容审核、故事板自动评审的看图——但这三样本来就不在本机跑（质检与审核在线上，
 *     故事板是人工确认不走自动评审），所以对 A 组、对线上其它步骤都没有影响。
 *
 * 子命令（在仓库根目录跑，产物落 tmp/experiments-2026-11/soak/<run-key>/，tmp 不进仓库）：
 *   run     先按实时套餐单价估算点数并打印（两组分开列）；带 --confirm-spend --max-points <上限> 才真提交，超过上限直接拒绝。
 *           每一步落盘，随时 Ctrl-C；重跑从断点续上，已有故事板号 / 任务号的只续查、绝不重提。
 *   cancel  取消所有在途条目（走线上的取消接口：故事板取消会改写幂等键，已派发的按条返还额度）。
 *   report  汇总成功率、端到端 P50 / P90、提交确认未知、故事板帧失败率、帧质检分布，对照放行线逐项给结论；另出两节
 *           「帧质检去留依据」「出方案对照」，并生成 A/B 盲评页 blind-review.html（左右随机、不显示组别，沿用评测集的盲评页）。
 *   tally   读盲评页导出的票（--votes <JSON>），揭盲算 B 组的胜 / 平 / 负；票存进运行目录，之后的 report 会带上。
 *
 * run 的参数：
 *   --run-key <名字>            必填，小写字母 / 数字 / 连字符，如 soak-1110
 *   --wave morning|noon|evening|all   这次投哪一波（真提交时必填；all = 不分波，冒烟用）
 *   --arms / --cases / --angles / --limit N   只跑子集（第一次真提交时定下来，之后不用再给）；--limit 2 = 第一对的 A 与 B
 *   --runway <n>                其中 n 条（偶数，按对）点名走 Runway；要同时给 --runway-usd-per-video <单价> 与 --max-usd <上限>
 *   --confirm-spend --max-points <上限>   真提交
 *   --base-url <线上地址>       真提交与取消时必填（或环境变量 SOAK_BASE_URL），如 https://reelforge-delta.vercel.app
 *   --account-file <路径>       测试账号文件，缺省 tmp/ceo-test-account.txt（两行：email: … / password: …）；不用 demo 账号
 *   --per-hour 8 --max-in-flight 6 --max-wait-min 240   投放节奏（线上限流：一小时最多新建 10 轮故事板）
 *   --retry                     把失败 / 已取消的条目换新一次尝试（换幂等键，重新花一轮的钱）
 *   --allow-unready             线上健康检查没报库结构同步（轮 0 没上线）也照跑
 *
 * 例：
 *   npx tsx scripts/ops/soak-run.ts run --run-key soak-1110
 *   npx tsx scripts/ops/soak-run.ts run --run-key soak-1110 --wave morning \
 *     --base-url https://reelforge-delta.vercel.app --confirm-spend --max-points 23000
 *   npx tsx scripts/ops/soak-run.ts report --run-key soak-1110 --qa-csv tmp/soak-1110-qa.csv
 *   npx tsx scripts/ops/soak-run.ts tally --run-key soak-1110 --votes ~/Downloads/votes-soak-1110.json
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  SHUYU_RESERVE_POINTS_DEFAULT,
  checkBudgetGate,
  parsePositiveLimit,
} from "../lib/experiment-budget";
import {
  SOAK_DURATION_SEC,
  SOAK_FRAMES_PER_ITEM,
  SOAK_GROUPS,
  SOAK_HOOK_ANGLES,
  SOAK_WAVES,
  SOAK_WAVE_LABELS,
  assertManifestMatches,
  assignRunwayRoutes,
  deriveSoakOutcome,
  estimateSoakSpend,
  expandSoakItems,
  firstSoakAttempt,
  initialSoakRecord,
  isSoakInFlight,
  nextSoakStep,
  parseWave,
  renderSoakReport,
  retrySoakRecord,
  selectSoakItems,
  soakBlindPairs,
  soakBlindTally,
  soakDispatchBody,
  soakIdempotencyKey,
  soakStoryboardBody,
  soakSubmitAllowance,
  summarizeSoak,
  type SoakAttempt,
  type SoakBlindTally,
  type SoakFirstPassInput,
  type SoakItem,
  type SoakManifest,
  type SoakRecord,
} from "../lib/soak-run";
import {
  blindLayout,
  parseGoldenSetCases,
  renderBlindReviewPage,
  type BlindPair,
  type BlindVotes,
  type GoldenSetCase,
} from "../lib/video-golden-set";
import { computeFirstPass, parseQaCsv } from "./qa-first-pass";

const REPO = resolve(__dirname, "../..");
const CASES_FILE = join(REPO, "scripts/eval/golden-set.cases.json");
const OUTPUT_ROOT = join(REPO, "tmp/experiments-2026-11/soak");
/// 传过的商品图记在这里（按线上地址 + 账号 + 原图地址），冒烟与全量共用，不重复传
const ASSET_CACHE_FILE = join(OUTPUT_ROOT, "uploaded-assets.json");
const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/u;
/// 等线上推进时多久读一次库。10 秒一次：帧质检进行中的状态只留几十秒，读得勤才抄得到它的认领时刻
const POLL_MS = 10_000;
const SCHEDULER_MS = 5_000;
/// 线上建故事板的函数最长跑 120 秒（先设计镜头卡再提交第 0 帧）；派发要重出方案，给足 5 分钟
const STORYBOARD_TIMEOUT_MS = 150_000;
const DISPATCH_TIMEOUT_MS = 300_000;
/// 「可安全重试」的派发错误最多换几次键再试
const DISPATCH_RETRY_MAX = 3;
/// 建故事板连续撞几次网络错误 / 5xx 就记失败（同一个键重发，不会多建）
const CREATE_TRANSIENT_MAX = 5;

type Flags = Record<string, string | true>;
type Db = (typeof import("@/lib/db"))["db"];
type Json = Record<string, unknown>;

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

const flag = (flags: Flags, name: string): string | null => (typeof flags[name] === "string" ? (flags[name] as string) : null);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const nowIso = () => new Date().toISOString();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function intFlag(flags: Flags, name: string, fallback: number): number {
  const raw = flag(flags, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} 要给非负整数`);
  return value;
}

// ---------------------------------------------------------------------------
// 运行目录：清单（选了哪些条、各走哪一波哪条线路）在第一次真提交时定下来
// ---------------------------------------------------------------------------

interface RunContext {
  runKey: string;
  runDir: string;
  cases: Map<string, GoldenSetCase>;
  items: SoakItem[];
  /// 清单是否已经落盘（= 这个 run-key 真提交过）
  persisted: boolean;
}

function runContext(flags: Flags): RunContext {
  const runKey = flag(flags, "run-key");
  if (!runKey || !/^[a-z0-9][a-z0-9-]{2,47}$/u.test(runKey)) {
    throw new Error("必须给 --run-key（小写字母、数字、连字符，如 soak-1110）");
  }
  const runDir = join(OUTPUT_ROOT, runKey);
  const snapshot = join(runDir, "cases.json");
  const cases = parseGoldenSetCases(readJson(existsSync(snapshot) ? snapshot : CASES_FILE));
  const manifestPath = join(runDir, "manifest.json");
  const manifest = existsSync(manifestPath) ? readJson<SoakManifest>(manifestPath) : null;
  const selecting = ["arms", "cases", "angles", "limit", "runway"].some((name) => flags[name] !== undefined);
  let items = manifest?.items ?? [];
  if (!manifest || selecting) {
    const limit = flag(flags, "limit");
    items = assignRunwayRoutes(
      selectSoakItems(expandSoakItems(cases), {
        arms: flag(flags, "arms"),
        cases: flag(flags, "cases"),
        angles: flag(flags, "angles"),
        limit: limit === null ? null : Number(limit),
      }),
      intFlag(flags, "runway", 0),
    );
    if (manifest) assertManifestMatches(manifest, items);
  }
  return { runKey, runDir, cases: new Map(cases.map((item) => [item.id, item])), items, persisted: manifest !== null };
}

function persistManifest(context: RunContext): void {
  if (context.persisted) return;
  mkdirSync(context.runDir, { recursive: true });
  copyFileSync(CASES_FILE, join(context.runDir, "cases.json"));
  const manifest: SoakManifest = { version: 1, runKey: context.runKey, createdAt: nowIso(), items: context.items };
  writeJson(join(context.runDir, "manifest.json"), manifest);
  context.persisted = true;
}

const recordPath = (context: RunContext, id: string) => join(context.runDir, "items", `${id}.json`);

function loadRecords(context: RunContext): SoakRecord[] {
  return context.items.map((item) => {
    const path = recordPath(context, item.id);
    return existsSync(path) ? readJson<SoakRecord>(path) : initialSoakRecord(item);
  });
}

function loadEnv(): void {
  loadEnvConfig(REPO, true);
  /// 读价目表要真打 Shuyu：别被本地 mock 开关换成假价
  process.env.VIDEO_ENGINE_MOCK = "false";
  process.env.IMAGE_ENGINE_MOCK = "false";
  /// 本机进程只读价目与库：供应商探测结果不往生产库的能力状态里写
  process.env.CAPABILITY_WRITE_THROUGH = "0";
  /// B 组的开关：本机进程里出方案的各步一律不调语言模型（文件头写了它管到哪、管不到哪）。A 组的写操作都发到线上，不受它影响
  process.env.LLM_FORCE_MOCK = "true";
}

// ---------------------------------------------------------------------------
// 线上会话：用测试账号登录，之后的写操作都发到线上的接口
// ---------------------------------------------------------------------------

function loadCredentials(flags: Flags): { email: string; password: string } {
  const file = resolve(REPO, flag(flags, "account-file") ?? "tmp/ceo-test-account.txt");
  if (!existsSync(file)) {
    throw new Error(`找不到测试账号文件 ${relative(REPO, file)}（--account-file 指定；两行：email: … / password: …）`);
  }
  const fields = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z]+)\s*[:：=]\s*(.+?)\s*$/u.exec(line);
    if (match) fields.set(match[1].toLowerCase(), match[2]);
  }
  const email = fields.get("email");
  const password = fields.get("password");
  if (!email || !password) throw new Error(`${relative(REPO, file)} 里要有 email 与 password 两行`);
  return { email, password };
}

function baseUrlOf(flags: Flags): string {
  const raw = (flag(flags, "base-url") ?? process.env.SOAK_BASE_URL ?? "").trim().replace(/\/+$/u, "");
  if (!raw) throw new Error("要给线上地址：--base-url https://…（或环境变量 SOAK_BASE_URL）");
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("--base-url 要用 https");
  return url.origin;
}

class ProdSession {
  private readonly cookies = new Map<string, string>();
  private loggingIn: Promise<void> | null = null;
  userId = "";

  constructor(
    readonly baseUrl: string,
    private readonly credentials: { email: string; password: string },
  ) {}

  private async raw(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const pair = header.split(";")[0];
      const cut = pair.indexOf("=");
      if (cut > 0) this.cookies.set(pair.slice(0, cut), pair.slice(cut + 1));
    }
    return response;
  }

  /** 登录（并发的调用共用同一次）。会话最长 12 小时、每次发版即失效，所以每次运行都重新登录。 */
  login(): Promise<void> {
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  private async doLogin(): Promise<void> {
    this.cookies.clear();
    const csrf = (await (await this.raw("/api/auth/csrf", {}, 30_000)).json().catch(() => null)) as { csrfToken?: string } | null;
    if (!csrf?.csrfToken) throw new Error("登录失败：拿不到 csrfToken");
    await this.raw(
      "/api/auth/callback/credentials",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...this.credentials, csrfToken: csrf.csrfToken, json: "true" }),
      },
      30_000,
    );
    if (![...this.cookies.keys()].some((name) => SESSION_COOKIE.test(name))) {
      throw new Error("登录失败：没有拿到会话 cookie（检查测试账号文件，或线上是否不让这个账号登录）");
    }
  }

  /** 发一个 JSON 请求；401 时重新登录再发一次。网络错误 / 超时照抛，由调用方决定怎么续。 */
  async json(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<{ status: number; body: Json | null }> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.raw(
        path,
        {
          method,
          headers: { "content-type": "application/json", ...options.headers },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        },
        options.timeoutMs ?? 60_000,
      );
      if (response.status === 401 && attempt === 0) {
        await this.login();
        continue;
      }
      return { status: response.status, body: (await response.json().catch(() => null)) as Json | null };
    }
  }
}

/**
 * 开工前的三道保险：线上健康且库结构同步（轮 0 上线后才有这个字段）；不是 demo 账号；
 * 本机连的库里查得到这个账号（否则观察的库和提交的环境不是同一个）。
 */
async function openSession(flags: Flags, db: Db): Promise<ProdSession> {
  const baseUrl = baseUrlOf(flags);
  const credentials = loadCredentials(flags);
  const { isDemoAccountEmail } = await import("@/lib/demo-account");
  if (isDemoAccountEmail(credentials.email)) throw new Error("demo 账号不跑付费生成：换测试账号（--account-file）");

  const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(30_000) });
  const health = (await response.json().catch(() => null)) as { ok?: unknown; schema?: unknown } | null;
  if (!response.ok || health?.ok !== true) throw new Error(`线上健康检查没过（HTTP ${response.status}）`);
  if (health.schema !== "in_sync") {
    const detail =
      health.schema === undefined
        ? "健康检查里没有库结构同步字段：轮 0（迁移同步检查）还没上线"
        : `健康检查报库结构 ${String(health.schema)}`;
    if (flags["allow-unready"] !== true) throw new Error(`${detail}。压测要等轮 0 / 轮 1 上线后再跑；确实要跑加 --allow-unready`);
    console.log(`[soak] 注意：${detail}（--allow-unready 放行）`);
  }

  const session = new ProdSession(baseUrl, credentials);
  await session.login();
  const user = await db.adminUser.findUnique({
    where: { email: credentials.email.trim().toLowerCase() },
    select: { id: true, disabledAt: true },
  });
  if (!user || user.disabledAt) throw new Error("本机连的库里查不到这个测试账号（或已停用）：.env.local 的库和 --base-url 不是同一个环境");
  session.userId = user.id;
  console.log(`[soak] 已登录 ${baseUrl}（测试账号 ${user.id.slice(0, 8)}…）`);
  return session;
}

/** 把用例的商品图传成这个账号名下的素材（线上的直传三步：换凭证 → 直传 Blob → 登记），返回每个用例的素材号。 */
async function ensureAssets(session: ProdSession, cases: readonly GoldenSetCase[]): Promise<Map<string, string[]>> {
  const cache: Record<string, string> = existsSync(ASSET_CACHE_FILE) ? readJson(ASSET_CACHE_FILE) : {};
  const { put } = await import("@vercel/blob/client");
  const result = new Map<string, string[]>();
  for (const item of cases) {
    const ids: string[] = [];
    for (const url of item.productImages) {
      const key = `${session.baseUrl}|${session.userId}|${url}`;
      if (!cache[key]) {
        const source = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!source.ok) throw new Error(`商品图下载失败 HTTP ${source.status}：${url}`);
        const bytes = Buffer.from(await source.arrayBuffer());
        const contentType = source.headers.get("content-type")?.split(";")[0].trim() || "image/png";
        const ticket = await session.json("POST", "/api/upload/blob/ticket", {
          body: { contentType, size: bytes.byteLength, prefix: "unified-input" },
        });
        if (ticket.body?.ok !== true || ticket.body.mode !== "direct") {
          throw new Error(`换不到直传凭证（HTTP ${ticket.status} ${String(ticket.body?.code ?? ticket.body?.mode ?? "")}）`);
        }
        await put(String(ticket.body.pathname), bytes, { access: "public", token: String(ticket.body.clientToken), contentType });
        const done = await session.json("POST", "/api/upload/blob/complete", { body: { ticket: ticket.body.ticket }, timeoutMs: 90_000 });
        const assetId = (done.body?.asset as { id?: unknown } | undefined)?.id;
        if (typeof assetId !== "string") {
          throw new Error(`商品图登记失败（HTTP ${done.status} ${String(done.body?.code ?? "")}）：${item.id}`);
        }
        cache[key] = assetId;
        writeJson(ASSET_CACHE_FILE, cache);
        console.log(`[soak] ${item.id} 商品图已上传 ${ids.length + 1}/${item.productImages.length}`);
      }
      ids.push(cache[key]);
    }
    result.set(item.id, ids);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 观察：只读库，把事实抄进记录
// ---------------------------------------------------------------------------

/** frameQaDetail.blockCount：这一段累计被质检拦了几次（坏数据按 0，与线上读法一致）。 */
function frameQaBlockCount(detail: unknown): number {
  const raw = detail && typeof detail === "object" ? (detail as { blockCount?: unknown }).blockCount : null;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

async function refreshAttempt(db: Db, attempt: SoakAttempt): Promise<void> {
  if (!attempt.storyboard.runId) return;
  const run = await db.storyboardRun.findUnique({
    where: { id: attempt.storyboard.runId },
    select: {
      status: true,
      approvedAt: true,
      errorMessage: true,
      planningDegradations: true,
      frames: {
        orderBy: [{ ordinal: "asc" }, { attempt: "asc" }],
        select: { ordinal: true, attempt: true, isCurrent: true, status: true, submissionState: true, planId: true, errorCode: true },
      },
      videoBrief: {
        select: {
          id: true,
          status: true,
          errorMessage: true,
          finalVideoUrl: true,
          contentAngle: { select: { round: { select: { deliveryOrderId: true } } } },
          finalVideo: { select: { status: true, stitchedVideoUrl: true, finishedAt: true, ffmpegError: true } },
          videoJobs: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              status: true,
              submissionState: true,
              submissionErrorClass: true,
              videoRouteSnapshot: true,
              frameQaStatus: true,
              frameQaCheckedAt: true,
              frameQaDetail: true,
              retryCount: true,
              submitAttempts: true,
              submittedAt: true,
              finishedAt: true,
              supersededAt: true,
              providerUnitPoints: true,
              providerUnitPriceUsd: true,
              errorMessage: true,
            },
          },
        },
      },
    },
  });
  if (!run) return;
  const { storyboard, dispatch, video } = attempt;
  storyboard.status = run.status;
  storyboard.error = run.errorMessage;
  storyboard.frames = run.frames.map((frame) => ({ ...frame }));
  storyboard.degradedStages = Array.isArray(run.planningDegradations)
    ? run.planningDegradations.flatMap((entry) =>
        entry && typeof entry === "object" && "stage" in entry && typeof entry.stage === "string" ? [entry.stage] : [],
      )
    : [];
  if (run.status !== "GENERATING") storyboard.readyAt ??= nowIso();
  if (run.approvedAt) storyboard.approvedAt = iso(run.approvedAt);
  const brief = run.videoBrief;
  if (!brief) return;
  dispatch.briefId = brief.id;
  dispatch.deliveryOrderId = brief.contentAngle.round.deliveryOrderId;
  /// 接口明确拒过的（例如全部段提交确认未知）保留拒绝结论，其余只要建出了 brief 就是已受理
  if (dispatch.state !== "rejected") dispatch.state = "accepted";
  video.briefStatus = brief.status;
  video.finalVideoStatus = brief.finalVideo?.status ?? null;
  video.finalVideoUrl = brief.finalVideo?.stitchedVideoUrl ?? brief.finalVideoUrl;
  video.finishedAt = iso(brief.finalVideo?.finishedAt);
  video.error = brief.finalVideo?.ffmpegError ?? brief.errorMessage;
  const previous = new Map(video.jobs.map((job) => [job.id, job]));
  video.jobs = brief.videoJobs.map((job) => ({
    id: job.id,
    status: job.status,
    submissionState: job.submissionState,
    submissionErrorClass: job.submissionErrorClass,
    route: job.videoRouteSnapshot,
    frameQaStatus: job.frameQaStatus,
    frameQaBlockCount: frameQaBlockCount(job.frameQaDetail),
    frameQaCheckedAt: iso(job.frameQaCheckedAt),
    /// 质检进行中时库里这一列是认领时刻，结论一写就被覆盖：撞上了就抄下来，之后一直留着
    frameQaClaimedAt:
      job.frameQaStatus === "CHECKING" && job.frameQaCheckedAt
        ? job.frameQaCheckedAt.toISOString()
        : (previous.get(job.id)?.frameQaClaimedAt ?? null),
    retryCount: job.retryCount,
    submitAttempts: job.submitAttempts,
    submittedAt: iso(job.submittedAt),
    finishedAt: iso(job.finishedAt),
    superseded: job.supersededAt !== null,
    unitPoints: job.providerUnitPoints,
    unitUsd: job.providerUnitPriceUsd === null ? null : Number(job.providerUnitPriceUsd),
    error: job.errorMessage,
  }));
}

// ---------------------------------------------------------------------------
// run：估算 → 预算闸 → 按节奏投放，每条一条独立的「道」走完三下点击
// ---------------------------------------------------------------------------

interface LaneContext {
  context: RunContext;
  session: ProdSession;
  db: Db;
  assets: Map<string, string[]>;
  deadline: number;
  /// 线上回了「一小时内新建故事板太多」：到这个时刻之前不再新开
  rateLimitedUntil: number;
}

let stopping = false;

function describeFailure(response: { status: number; body: Json | null }): string {
  return `HTTP ${response.status} ${String(response.body?.code ?? "")}：${String(response.body?.error ?? "没有可读的错误信息")}`.slice(0, 300);
}

type CreateStoryboardResult = { ok: true; runId: string; status: string | null } | { ok: false; status: number; text: string };

/**
 * 建故事板。A 组调线上接口；B 组在本机进程里调同一个 service（LLM_FORCE_MOCK 已在 loadEnv 里打开：镜头卡退回模板、
 * 原话不英译），同样按「用户发起」计一小时限流。两边用同一套请求体与幂等键规则。
 */
async function createStoryboard(lane: LaneContext, record: SoakRecord, key: string): Promise<CreateStoryboardResult> {
  const body = soakStoryboardBody(lane.context.cases.get(record.caseId)!, record.angleId, lane.assets.get(record.caseId)!);
  if (record.group === "A") {
    const response = await lane.session.json("POST", "/api/video-generation/storyboards", {
      headers: { "Idempotency-Key": key },
      body,
      timeoutMs: STORYBOARD_TIMEOUT_MS,
    });
    const run = response.body?.run as { id?: unknown; status?: unknown } | undefined;
    return response.body?.ok === true && typeof run?.id === "string"
      ? { ok: true, runId: run.id, status: typeof run.status === "string" ? run.status : null }
      : { ok: false, status: response.status, text: describeFailure(response) };
  }
  const { createStoryboardRun, StoryboardRequestError } = await import("@/lib/video-generation/storyboard-service");
  try {
    const run = await createStoryboardRun({ userId: lane.session.userId, idempotencyKey: key, ...body, personRefsAllowed: false, userInitiated: true });
    return { ok: true, runId: run.id, status: run.status };
  } catch (error) {
    if (error instanceof StoryboardRequestError) return { ok: false, status: error.status, text: `${error.code}：${error.message}`.slice(0, 300) };
    throw error;
  }
}

/// 「确认脚本」字段的上限（线上 dispatch 路由的 confirmedPromptsSchema）：单段 4000 字、最多 20 段
const CONFIRMED_PROMPT_MAX_CHARS = 4000;
const CONFIRMED_PROMPTS_MAX = 20;

/**
 * B 组：在本机进程里不调模型出一遍方案，取 AI 段的提示词正文。与线上派发同样先解析素材（只读库）再 buildPlan（无副作用）。
 * 超出「确认脚本」字段上限就抛错——截短等于换了一份提示词，不如如实记失败。
 */
async function heuristicSegmentPrompts(userId: string, request: unknown): Promise<Array<{ segmentOrder: number; prompt: string }>> {
  const { unifiedVideoGenerationRequestSchema } = await import("@/lib/schemas/unified-input");
  const { resolveOwnedCreationRequest } = await import("@/lib/services/media-asset-service");
  const { buildPlan } = await import("@/lib/video-generation/generation-supervisor");
  const plan = await buildPlan(await resolveOwnedCreationRequest({ userId, request: unifiedVideoGenerationRequestSchema.parse(request) }));
  const prompts = plan.segments
    .filter((segment) => segment.type === "ai_generated_clip" && segment.prompt?.trim())
    .map((segment) => ({ segmentOrder: segment.order, prompt: segment.prompt!.trim() }));
  if (prompts.length === 0) throw new Error("方案里没有 AI 段");
  if (prompts.length > CONFIRMED_PROMPTS_MAX) throw new Error(`AI 段 ${prompts.length} 个，超过确认脚本字段的 ${CONFIRMED_PROMPTS_MAX} 段上限`);
  const tooLong = prompts.find((entry) => entry.prompt.length > CONFIRMED_PROMPT_MAX_CHARS);
  if (tooLong) throw new Error(`第 ${tooLong.segmentOrder} 段提示词 ${tooLong.prompt.length} 字，超过确认脚本字段的 ${CONFIRMED_PROMPT_MAX_CHARS} 字上限`);
  return prompts;
}

/** 走一条：返回 "requeue" = 被限流放回队列，其余情况走到终态、超时或被叫停为止。 */
async function runLane(lane: LaneContext, record: SoakRecord): Promise<"finished" | "requeue" | "paused"> {
  const { context, session, db } = lane;
  const item = context.cases.get(record.caseId)!;
  const assetIds = lane.assets.get(record.caseId)!;
  const save = () => writeJson(recordPath(context, record.id), record);
  let transient = 0;

  while (!stopping && Date.now() < lane.deadline) {
    const attempt = record.current;
    /// 另一个终端跑了 cancel：认下它写的取消时刻，别用内存里的旧记录盖回去
    const path = recordPath(context, record.id);
    if (existsSync(path)) {
      const disk = readJson<SoakRecord>(path);
      if (disk.current.attempt === attempt.attempt && disk.current.cancelledAt) attempt.cancelledAt = disk.current.cancelledAt;
    }
    await refreshAttempt(db, attempt).catch((error: unknown) => console.log(`[soak] ${record.id} 读库失败（稍后再读）：${errorText(error)}`));
    const step = nextSoakStep(record);
    save();

    if (step.kind === "done") {
      const { outcome } = step;
      console.log(`[soak] ${record.id} ${outcome.kind === "succeeded" ? "成片完成" : outcome.kind === "cancelled" ? "已取消" : `失败（${outcome.stage}）：${outcome.reason}`}`);
      return "finished";
    }

    if (step.kind === "create_storyboard") {
      const key = soakIdempotencyKey(context.runKey, record, "storyboard");
      /// 上一次请求发出去没拿到号：先按幂等键查库，建成了就直接接上
      if (attempt.storyboard.requestedAt) {
        const existing = await db.storyboardRun.findFirst({ where: { userId: session.userId, idempotencyKey: key }, select: { id: true } });
        if (existing) {
          attempt.storyboard.runId = existing.id;
          save();
          continue;
        }
      }
      const firstRequest = attempt.storyboard.requestedAt === null;
      attempt.storyboard.requestedAt ??= nowIso();
      save();
      const startedMs = Date.now();
      try {
        const response = await createStoryboard(lane, record, key);
        if (response.ok) {
          attempt.storyboard.runId = response.runId;
          attempt.storyboard.status = response.status;
          attempt.storyboard.createMs = Date.now() - startedMs;
          console.log(`[soak] ${record.id} 故事板已建 ${response.runId}（${record.group === "B" ? "本机建，不调模型" : "线上接口"}）`);
        } else if (response.status === 429) {
          /// 没建成、没扣点：放回队列，等下一个整点
          if (firstRequest) attempt.storyboard.requestedAt = null;
          const nextHour = new Date();
          nextHour.setHours(nextHour.getHours() + 1, 0, 30, 0);
          lane.rateLimitedUntil = nextHour.getTime();
          save();
          console.log(`[soak] ${record.id} 线上限流（${response.text}），下个整点再投`);
          return "requeue";
        } else if (response.status >= 500 && (transient += 1) < CREATE_TRANSIENT_MAX) {
          console.log(`[soak] ${record.id} 建故事板 ${response.text}，同一个键稍后重发`);
          await sleep(POLL_MS);
        } else {
          attempt.storyboard.error = response.text;
        }
      } catch (error) {
        /// 超时 / 断网：可能已经建了。留着请求时刻，下一圈先查库再用同一个键重发
        if ((transient += 1) >= CREATE_TRANSIENT_MAX) attempt.storyboard.error = `建故事板连续 ${transient} 次没有答复：${errorText(error)}`;
        else {
          console.log(`[soak] ${record.id} 建故事板没有答复（${errorText(error)}），稍后续上`);
          await sleep(POLL_MS);
        }
      }
      save();
      continue;
    }

    if (step.kind === "approve_storyboard") {
      const response = await session
        .json("POST", `/api/video-generation/storyboards/${encodeURIComponent(attempt.storyboard.runId!)}/approve`)
        .catch((error: unknown) => ({ status: 0, body: { error: errorText(error) } as Json }));
      if (response.body?.ok === true) {
        attempt.storyboard.status = "APPROVED";
        attempt.storyboard.approvedAt = nowIso();
        console.log(`[soak] ${record.id} 故事板已确认`);
        save();
      } else {
        /// 状态刚变（例如被取消）或一时没发成：下一圈读库就知道该干什么
        console.log(`[soak] ${record.id} 确认故事板没成（${describeFailure(response)}），稍后再看`);
        await sleep(POLL_MS);
      }
      continue;
    }

    if (step.kind === "dispatch") {
      const key = soakIdempotencyKey(context.runKey, record, "dispatch");
      const base = { item, angleId: record.angleId, assetIds, storyboardRunId: attempt.storyboard.runId!, route: record.route };
      if (record.group === "B" && attempt.dispatch.confirmedPrompts === null) {
        /// B 组：本机不调模型算一遍段提示词，落盘后随请求交上去；算不出来或放不进字段就记失败，不退回去用线上调模型的那份
        try {
          const startedMs = Date.now();
          attempt.dispatch.confirmedPrompts = await heuristicSegmentPrompts(session.userId, soakDispatchBody(base).request);
          attempt.dispatch.localPlanMs = Date.now() - startedMs;
        } catch (error) {
          Object.assign(attempt.dispatch, { state: "rejected", code: "LOCAL_PLAN_FAILED", error: `本机不调模型出方案失败：${errorText(error)}` });
          save();
          continue;
        }
      }
      attempt.dispatch.state = "requested";
      attempt.dispatch.requestedAt ??= nowIso();
      save();
      try {
        const startedMs = Date.now();
        const response = await session.json("POST", "/api/video-generation/dispatch", {
          headers: { "Idempotency-Key": key },
          body: soakDispatchBody({ ...base, confirmedPrompts: attempt.dispatch.confirmedPrompts }),
          timeoutMs: DISPATCH_TIMEOUT_MS,
        });
        attempt.dispatch.requestMs = Date.now() - startedMs;
        const body = response.body;
        attempt.dispatch.httpStatus = response.status;
        if (body?.ok === true && typeof body.briefId === "string") {
          Object.assign(attempt.dispatch, {
            state: "accepted",
            briefId: body.briefId,
            deliveryOrderId: typeof body.deliveryOrderId === "string" ? body.deliveryOrderId : null,
            code: null,
            error: null,
          });
          console.log(`[soak] ${record.id} 已派发（${record.route === "runway" ? "点名 Runway" : "默认线路"}${record.group === "B" ? "，段提示词用本机不调模型算的" : ""}）brief ${body.briefId}`);
        } else if (body?.code === "REQUEST_IN_PROGRESS" || !body) {
          /// 上一次请求还在处理，或答复读不出来：保持同一个键，等一圈再看库
          await sleep(POLL_MS);
        } else {
          Object.assign(attempt.dispatch, { code: typeof body.code === "string" ? body.code : null, error: typeof body.error === "string" ? body.error : null });
          /// 和创作页同一条规则：服务端明说「可以直接重试」才换键再试，其余一律当终态，不自作主张重提
          if (body.retryable === true && body.action === "retry" && attempt.dispatch.retries < DISPATCH_RETRY_MAX) {
            attempt.dispatch.retries += 1;
            attempt.dispatch.state = "pending";
            console.log(`[soak] ${record.id} 派发 ${describeFailure(response)}，换键重试第 ${attempt.dispatch.retries} 次`);
            save();
            await sleep(POLL_MS);
          } else {
            attempt.dispatch.state = "rejected";
          }
        }
      } catch (error) {
        console.log(`[soak] ${record.id} 派发没有答复（${errorText(error)}）：同一个键稍后续上，不会重复建任务`);
        await sleep(POLL_MS);
      }
      save();
      continue;
    }

    await sleep(POLL_MS);
  }
  return "paused";
}

async function livePrices() {
  const { getAvailableShuyuImagePlans, getShuyuBalance, resolveShuyuVideoPlan, shuyuVideoPlanPointsForDuration } =
    await import("@/lib/providers/shuyu");
  const { selectAuditedImage2Plan } = await import("@/lib/providers/shuyu-catalog");
  const imagePlan = selectAuditedImage2Plan({ imagePlans: await getAvailableShuyuImagePlans({ timeoutMs: 15_000 }) }, "2K");
  const videoPlan = await resolveShuyuVideoPlan({ timeoutMs: 15_000 });
  const balance = await getShuyuBalance({ timeoutMs: 15_000 }).catch(() => null);
  return {
    imagePlan,
    videoPlan,
    frameUnitPoints: imagePlan.points ?? null,
    videoUnitPoints: shuyuVideoPlanPointsForDuration(videoPlan, SOAK_DURATION_SEC),
    availablePoints: balance?.available_points ?? null,
  };
}

async function commandRun(flags: Flags): Promise<void> {
  const context = runContext(flags);
  loadEnv();
  const waveFlag = flag(flags, "wave");
  const wave = waveFlag === null ? null : parseWave(waveFlag);
  const records = loadRecords(context);
  /// --retry：失败 / 已取消的换新一次尝试；只在内存里换，真提交时才随记录落盘
  const retried = flags.retry === true ? records.filter((record) => retrySoakRecord(record)).length : 0;
  const inWave = (record: SoakRecord) => wave === null || wave === "all" || record.wave === wave;
  const queue = records.filter((record) => inWave(record) && !isSoakInFlight(record) && nextSoakStep(record).kind === "create_storyboard");
  const resumable = records.filter(isSoakInFlight);
  const scope = [...resumable, ...queue];

  const prices = await livePrices();
  const runwayUnitUsd = parsePositiveLimit(flag(flags, "runway-usd-per-video"));
  const estimateOf = (subset: readonly SoakRecord[]) =>
    estimateSoakSpend({ records: subset, frameUnitPoints: prices.frameUnitPoints, shuyuVideoUnitPoints: prices.videoUnitPoints, runwayVideoUnitUsd: runwayUnitUsd });
  const estimate = estimateOf(scope);
  const runwayCount = context.items.filter((item) => item.route === "runway").length;

  const groupCounts = SOAK_GROUPS.map((group) => `${group.id} 组 ${context.items.filter((item) => item.group === group.id).length}`).join(" / ");
  console.log(`[soak] ${context.runKey}：共 ${context.items.length} 条（${groupCounts}；Shuyu ${context.items.length - runwayCount} / Runway ${runwayCount}），${SOAK_DURATION_SEC} 秒 9:16 中文口播，每条 ${SOAK_FRAMES_PER_ITEM} 帧故事板 + 1 条视频`);
  console.log(`[soak] 出帧套餐 ${prices.imagePlan.planId}（${prices.frameUnitPoints ?? "?"} 点/张），视频套餐 ${prices.videoPlan.planId} ${prices.videoPlan.displayName}（${SOAK_DURATION_SEC} 秒 ${prices.videoUnitPoints} 点）`);
  for (const name of SOAK_WAVES) {
    const subset = records.filter((record) => record.wave === name);
    const sub = estimateOf(subset);
    console.log(`[soak]   ${SOAK_WAVE_LABELS[name]}（${name}）${subset.length} 条，其中还要花钱的部分约 ${sub.totalPoints} 点${sub.totalUsd > 0 ? ` + $${sub.totalUsd}` : ""}`);
  }
  console.log(`[soak] 这次的范围：${wave === null ? "全部三波" : wave === "all" ? "不分波" : `${SOAK_WAVE_LABELS[wave]}这一波`}，新投 ${queue.length} 条，续跑在途 ${resumable.length} 条${retried > 0 ? `（含重试 ${retried} 条）` : ""}`);
  for (const line of estimate.lines.filter((entry) => entry.count > 0)) {
    const unit = line.unitPoints !== null ? `${line.unitPoints} 点` : line.unitUsd !== null ? `$${line.unitUsd}` : "未定价";
    console.log(`[soak]   ${line.armId}：${line.count} × ${unit} = ${line.unitPoints !== null ? `${line.points} 点` : line.unitUsd !== null ? `$${line.usd}` : "?"}`);
  }
  console.log(`[soak] 合计预估 ${estimate.totalPoints} 点${estimate.totalUsd > 0 ? ` + $${estimate.totalUsd}（Runway 另计）` : ""}（实扣以 Shuyu 为准）`);
  console.log("[soak] 估算不含的部分：故事板帧提交确认未知时线上自动重提的那一帧；Shuyu 明确失败后线上自动改交 Runway 的那条视频（美元计）。");
  const reservePoints = parsePositiveLimit(flag(flags, "reserve-points")) ?? SHUYU_RESERVE_POINTS_DEFAULT;
  console.log(
    prices.availablePoints !== null
      ? `[soak] Shuyu 余额 ${prices.availablePoints} 点，跑完约剩 ${prices.availablePoints - estimate.totalPoints} 点（预留线 ${reservePoints}）`
      : "[soak] 查不到 Shuyu 余额：真提交时预算闸会拦下",
  );
  if (flags["confirm-spend"] !== true) {
    console.log("[soak] 只做了估算：没有登录、没有提交任何任务。真提交加 --wave <哪一波> --base-url <线上地址> --confirm-spend --max-points <上限>");
    return;
  }

  if (wave === null) throw new Error("真提交要说清投哪一波：--wave morning|noon|evening|all");
  const gate = checkBudgetGate({
    estimate,
    maxPoints: parsePositiveLimit(flag(flags, "max-points")),
    maxUsd: parsePositiveLimit(flag(flags, "max-usd")),
    availablePoints: prices.availablePoints,
    reservePoints,
  });
  if (!gate.ok) {
    for (const reason of gate.reasons) console.log(`[soak] 预算闸拦下：${reason}`);
    process.exitCode = 1;
    return;
  }
  if (scope.length === 0) {
    console.log("[soak] 这一波没有要投或要续的条目。");
    return;
  }

  /// B 组靠这个开关才不调模型：没生效就别开工（否则 B 组会悄悄变成第二个 A 组）
  const { isLLMForcedMock } = await import("@/lib/ai");
  if (!isLLMForcedMock()) throw new Error("LLM_FORCE_MOCK 没生效：B 组做不到不调模型，拒绝开工");
  const { db } = await import("@/lib/db");
  try {
    const session = await openSession(flags, db);
    persistManifest(context);
    const neededCases = [...new Set(scope.map((record) => record.caseId))].map((id) => context.cases.get(id)!);
    const lane: LaneContext = {
      context,
      session,
      db,
      assets: await ensureAssets(session, neededCases),
      deadline: Date.now() + intFlag(flags, "max-wait-min", 240) * 60_000,
      rateLimitedUntil: 0,
    };
    const perHour = intFlag(flags, "per-hour", 8);
    const maxInFlight = intFlag(flags, "max-in-flight", 6);
    process.once("SIGINT", () => {
      stopping = true;
      console.log("\n[soak] 收到 Ctrl-C：做完手头这一步就停。已建的故事板和已派发的视频线上照常跑，重跑同一条命令接着走；要取消用 cancel 子命令");
    });

    const active = new Set<string>();
    const start = (record: SoakRecord) => {
      active.add(record.id);
      void runLane(lane, record)
        .then((result) => {
          if (result === "requeue") queue.unshift(record);
        })
        .catch((error: unknown) => console.log(`[soak] ${record.id} 这一条中断（记录已落盘，重跑续上）：${errorText(error)}`))
        .finally(() => active.delete(record.id));
    };
    for (const record of resumable) start(record);
    console.log(`[soak] 开始：一小时最多新开 ${perHour} 轮故事板，同时在途不超过 ${maxInFlight} 条，最多守 ${Math.round((lane.deadline - Date.now()) / 60_000)} 分钟`);

    let lastBeat = 0;
    while ((queue.length > 0 || active.size > 0) && Date.now() < lane.deadline) {
      if (stopping && active.size === 0) break;
      /// 一圈最多新开一条，别把十几个建故事板的请求同时砸给线上
      if (!stopping && queue.length > 0 && Date.now() >= lane.rateLimitedUntil) {
        const allowance = soakSubmitAllowance({
          now: new Date(),
          requestedAts: records.flatMap((record) => [...record.history, record.current].map((attempt) => attempt.storyboard.requestedAt)),
          perHour,
          inFlight: active.size,
          maxInFlight,
        });
        if (allowance > 0) start(queue.shift()!);
      }
      if (Date.now() - lastBeat > 5 * 60_000) {
        lastBeat = Date.now();
        const done = records.filter((record) => deriveSoakOutcome(record.current) !== null).length;
        console.log(`[soak] ${nowIso()} 在途 ${active.size} 条，待投 ${queue.length} 条，已有结果 ${done} / ${records.length}`);
      }
      await sleep(SCHEDULER_MS);
    }
    stopping = true;
    while (active.size > 0) await sleep(500);
    const left = records.filter((record) => deriveSoakOutcome(record.current) === null && (isSoakInFlight(record) || queue.includes(record)));
    console.log(
      left.length === 0
        ? `[soak] 这一波跑完了。看结果：npx tsx scripts/ops/soak-run.ts report --run-key ${context.runKey}`
        : `[soak] 停下时还有 ${left.length} 条没出结果（${left.slice(0, 6).map((record) => record.id).join("、")}${left.length > 6 ? "…" : ""}）：重跑同一条命令接着走`,
    );
  } finally {
    await db.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// cancel：取消所有在途条目
// ---------------------------------------------------------------------------

async function commandCancel(flags: Flags): Promise<void> {
  const context = runContext(flags);
  if (!context.persisted) throw new Error(`${context.runKey} 还没真提交过，没有可取消的`);
  loadEnv();
  const records = loadRecords(context).filter(isSoakInFlight);
  if (records.length === 0) {
    console.log("[soak] 没有在途的条目。");
    return;
  }
  const { db } = await import("@/lib/db");
  try {
    const session = await openSession({ ...flags, "allow-unready": true }, db);
    let cancelled = 0;
    for (const record of records) {
      const attempt = record.current;
      const save = () => writeJson(recordPath(context, record.id), record);
      if (!attempt.storyboard.runId) {
        /// 请求发出去没拿到号：按幂等键看线上到底建没建
        const key = soakIdempotencyKey(context.runKey, record, "storyboard");
        const existing = await db.storyboardRun.findFirst({ where: { userId: session.userId, idempotencyKey: key }, select: { id: true } });
        if (existing) attempt.storyboard.runId = existing.id;
      }
      await refreshAttempt(db, attempt);
      if (deriveSoakOutcome(attempt)) {
        save();
        console.log(`[soak] ${record.id} 已经有结果了，不用取消`);
        continue;
      }
      const cancelOrder = async (): Promise<boolean> => {
        const response = await session.json("POST", `/api/library/${encodeURIComponent(attempt.dispatch.deliveryOrderId!)}/cancel`);
        if (response.body?.ok === true) return true;
        console.log(`[soak] ${record.id} 取消视频没成：${describeFailure(response)}`);
        return false;
      };
      let ok = false;
      if (attempt.dispatch.deliveryOrderId) {
        ok = await cancelOrder();
      } else if (attempt.storyboard.runId) {
        const response = await session.json("POST", `/api/video-generation/storyboards/${encodeURIComponent(attempt.storyboard.runId)}/cancel`);
        if (response.body?.ok === true) ok = true;
        else if (response.body?.code === "INVALID_STATE") {
          /// 故事板已确认或已结束：线上不会再出图扣点，本机记下取消后也不会再去派发
          ok = true;
        } else if (response.body?.code === "STORYBOARD_IN_DISPATCH") {
          await refreshAttempt(db, attempt);
          if (attempt.dispatch.deliveryOrderId) ok = await cancelOrder();
          else console.log(`[soak] ${record.id} 正在派发中，过一分钟再跑一次 cancel`);
        } else {
          console.log(`[soak] ${record.id} 取消故事板没成：${describeFailure(response)}`);
        }
      } else {
        /// 线上什么都没建成
        ok = true;
      }
      if (ok) {
        attempt.cancelledAt = nowIso();
        cancelled += 1;
        await refreshAttempt(db, attempt);
        console.log(`[soak] ${record.id} 已取消`);
      }
      save();
    }
    console.log(`[soak] 取消 ${cancelled} / ${records.length} 条。素材与已出的分镜图都保留；要重跑这些条目用 run --retry（换新的幂等键）`);
    if (cancelled < records.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// report：读库刷新事实 → 汇总 → 对照放行线；tally：盲评揭盲
// ---------------------------------------------------------------------------

/**
 * 人工评分：沿用 qa-first-pass 的口径（首次成片且两位评分人的商品分、人物分都 ≥ 1），分母是全部已投且没取消的条目。
 * 另把「两位都评了」的条目按合格 / 不合格分开，给帧质检对照用（只看分数，不看是不是首次成片）。
 */
function firstPassFromCsv(runKey: string, records: readonly SoakRecord[], csvPath: string): SoakFirstPassInput {
  const rows = parseQaCsv(readFileSync(csvPath, "utf8"));
  const subjects = records
    .map((record) => ({ record, attempt: firstSoakAttempt(record) }))
    .filter(({ attempt }) => attempt.storyboard.requestedAt !== null && deriveSoakOutcome(attempt)?.kind !== "cancelled")
    .map(({ record, attempt }) => {
      const job = attempt.video.jobs.filter((entry) => !entry.superseded).at(-1);
      return {
        itemId: record.id,
        job: job
          ? { videoJobId: job.id, retryCount: job.retryCount, submitAttempts: job.submitAttempts, status: job.status }
          : { videoJobId: `no-job:${record.id}`, retryCount: 0, submitAttempts: 0, status: null },
      };
    });
  const result = computeFirstPass(runKey, rows, subjects.map((subject) => subject.job));
  if (result.unknownVideoIds.length > 0) console.log(`[soak] 评分表里有 ${result.unknownVideoIds.length} 个视频号不属于这一轮：${result.unknownVideoIds.join(", ")}`);
  const itemOf = new Map(subjects.map((subject) => [subject.job.videoJobId, subject.itemId]));
  const scores: SoakFirstPassInput["scores"] = {};
  for (const verdict of result.verdicts) {
    const itemId = itemOf.get(verdict.videoJobId);
    if (itemId && verdict.raters.length >= 2) scores[itemId] = verdict.scoresOk ? "ok" : "bad";
  }
  return { firstPass: result.firstPass, total: result.totalVideos, rated: result.ratedVideos - result.singleRaterVideos, scores };
}

const blindKeyPath = (context: RunContext) => join(context.runDir, "blind-key.json");
const votesDir = (context: RunContext) => join(context.runDir, "votes");

/** 已经交回来的票（tally 子命令存进运行目录的），按盲评布局揭盲成 B 组的胜平负。 */
function storedBlindTallies(context: RunContext): SoakBlindTally[] {
  if (!existsSync(blindKeyPath(context)) || !existsSync(votesDir(context))) return [];
  const { layout } = readJson<{ layout: BlindPair[] }>(blindKeyPath(context));
  return readdirSync(votesDir(context))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = readJson<{ reviewer?: string; votes: BlindVotes }>(join(votesDir(context), name));
      return soakBlindTally(layout, file.votes, file.reviewer ?? "");
    });
}

/**
 * 盲评页：两组都出了成片的对，左右随机、不显示组别（沿用评测集的布局与页面）。成片下载到 review/<对>-L.mp4 / -R.mp4，
 * 文件名与页面里都不出现组别；哪边是哪组只记在 blind-key.json 里（别给评审人看）。返回进了页面的对数。
 */
async function writeBlindReview(context: RunContext, records: readonly SoakRecord[]): Promise<number> {
  const pairs = soakBlindPairs(records);
  if (pairs.length === 0) return 0;
  const layout = blindLayout(context.runKey, pairs.map((pair) => pair.pairId), ["A", "B"]);
  writeJson(blindKeyPath(context), { runKey: context.runKey, layout });
  const reviewDir = join(context.runDir, "review");
  mkdirSync(reviewDir, { recursive: true });
  const sections = [];
  for (const placed of layout) {
    const pair = pairs.find((entry) => entry.pairId === placed.caseId)!;
    const sides = [["L", placed.left], ["R", placed.right]] as const;
    let complete = true;
    for (const [side, group] of sides) {
      const file = join(reviewDir, `${pair.pairId}-${side}.mp4`);
      if (existsSync(file)) continue;
      const response = await fetch(pair.videos[group as "A" | "B"], { signal: AbortSignal.timeout(120_000) }).catch(() => null);
      if (!response?.ok) {
        console.log(`[soak] ${pair.pairId} 成片下载失败（HTTP ${response?.status ?? "无答复"}），这一对先不进盲评页`);
        complete = false;
        break;
      }
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    if (!complete) continue;
    const item = context.cases.get(pair.caseId)!;
    const angle = SOAK_HOOK_ANGLES.find((entry) => entry.id === pair.angleId)!;
    sections.push({
      id: pair.pairId,
      title: `${sections.length + 1}. ${item.category} · ${item.productName} · ${angle.label}`,
      notes: [
        { label: "商家原话", text: item.story },
        { label: "开头钩子", text: angle.direction },
        { label: "口播", text: item.voiceover },
        { label: "重点看", text: item.watchFor.join("；") },
      ],
      leftSrc: `review/${pair.pairId}-L.mp4`,
      rightSrc: `review/${pair.pairId}-R.mp4`,
    });
  }
  writeFileSync(join(context.runDir, "blind-review.html"), renderBlindReviewPage({ runKey: context.runKey, sections }));
  return sections.length;
}

async function commandReport(flags: Flags): Promise<void> {
  const context = runContext(flags);
  if (!context.persisted) throw new Error(`${context.runKey} 还没真提交过，没有可汇总的`);
  const records = loadRecords(context);
  if (flags["no-refresh"] !== true) {
    loadEnv();
    const { db } = await import("@/lib/db");
    try {
      for (const record of records) {
        for (const attempt of [...record.history, record.current]) await refreshAttempt(db, attempt);
        if (record.current.storyboard.requestedAt || record.history.length > 0) writeJson(recordPath(context, record.id), record);
      }
    } finally {
      await db.$disconnect();
    }
  }
  const blindPairs = flags["no-blind-page"] === true ? 0 : await writeBlindReview(context, records);
  const csv = flag(flags, "qa-csv");
  const now = new Date();
  const summary = summarizeSoak(records, {
    now,
    firstPass: csv ? firstPassFromCsv(context.runKey, records, resolve(csv)) : null,
    blindTallies: storedBlindTallies(context),
  });
  const text = renderSoakReport(context.runKey, summary, now);
  writeFileSync(join(context.runDir, "report.md"), `${text}\n`);

  /// 评分模板：每位评分人复制一份，填 0–2 的商品分与人物分（口型分可空），合成一个 CSV 再喂给 --qa-csv。不带组别
  const template = ["batchJobId,videoJobId,productScore,personScore,lipScore,rater,videoUrl"];
  for (const record of records) {
    const attempt = firstSoakAttempt(record);
    const job = attempt.video.jobs.filter((entry) => !entry.superseded).at(-1);
    if (job && attempt.video.finalVideoUrl) template.push(`${context.runKey},${job.id},,,,,${attempt.video.finalVideoUrl}`);
  }
  writeFileSync(join(context.runDir, "qa-template.csv"), `${template.join("\n")}\n`);
  console.log(text);
  console.log(`\n[soak] 已写 ${relative(REPO, join(context.runDir, "report.md"))}；评分模板 qa-template.csv（${template.length - 1} 条成片）`);
  if (blindPairs > 0) {
    console.log(`[soak] 盲评页 ${relative(REPO, join(context.runDir, "blind-review.html"))}（${blindPairs} 对，连同 review/ 目录一起给评审人；blind-key.json 与 report.md 别给）。评完把导出的 JSON 交给 tally --votes`);
  }
}

function commandTally(flags: Flags): void {
  const context = runContext(flags);
  const votesPath = flag(flags, "votes");
  if (!votesPath) throw new Error("--votes <盲评页导出的 JSON>");
  if (!existsSync(blindKeyPath(context))) throw new Error("还没有盲评布局：先跑 report 生成盲评页");
  const { layout } = readJson<{ layout: BlindPair[] }>(blindKeyPath(context));
  const file = readJson<{ reviewer?: string; votes: BlindVotes }>(resolve(votesPath));
  const tally = soakBlindTally(layout, file.votes, file.reviewer ?? "");
  writeJson(join(votesDir(context), `${tally.reviewer.replace(/[^\p{L}\p{N}_-]/gu, "_")}.json`), { reviewer: tally.reviewer, votes: file.votes });
  console.log(`# ${context.runKey} 出方案盲评（评审：${tally.reviewer}，评了 ${tally.pairsVoted} 对，共 ${layout.length} 对）\n`);
  console.log("| 项 | B 胜 | 平 | B 负 |\n| --- | --- | --- | --- |");
  for (const row of tally.rows) console.log(`| ${row.label} | ${row.win} | ${row.tie} | ${row.loss} |`);
  console.log(`\n[soak] 票已存进运行目录；再跑 report --run-key ${context.runKey} 会把它带进「出方案对照」`);
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));
  if (command === "run") return commandRun(flags);
  if (command === "cancel") return commandCancel(flags);
  if (command === "report") return commandReport(flags);
  if (command === "tally") return commandTally(flags);
  console.log(readFileSync(__filename, "utf8").split("*/")[0]);
}

main().catch((error: unknown) => {
  console.error(`[soak] ${errorText(error)}`);
  process.exitCode = 1;
});
