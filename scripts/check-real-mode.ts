/**
 * Dev mode preflight —— 在跑 dev / staging 前打印当前 4 个 provider 的真实/mock 状态。
 *
 * 设计目的：
 *   - 防止「以为是 mock，实际在烧真钱」的静默扣费场景
 *   - 一行命令就能看到全景：LLM / Seedance / OpenAI Image / 拼接 runtime
 *   - 在 predev / GitHub Action / 手动跑前真测时统一入口
 *
 * 用法：
 *   npm run mode:check                # 仅打印
 *   npm run mode:check -- --strict    # 任何 REAL 都 exit 1（CI / dry-run 防呆）
 *
 * 不依赖 src/ 任何模块（避免反向引用）；只读 process.env，跟 src/lib/providers/seedance.ts
 * 的 isMockMode 判断逻辑保持一致。
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

type Mode = "MOCK" | "REAL";
interface ProviderState {
  name: string;
  mode: Mode;
  reason: string;
  detail: string;
  estimatedCostNote: string;
}

const ROOT = process.cwd();

/**
 * 自动加载 .env.local（不依赖 dotenv 包；只为了 dev 命令行方便看真实 env）。
 * - 已在 process.env 里的不覆盖（cli/parent 优先级最高）
 * - 仅按行 KEY=VALUE 解析，不支持 multiline / 引号转义（够用）
 */
function loadEnvFiles() {
  const candidates = [
    path.join(ROOT, ".env.local"),
    path.join(ROOT, ".env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function checkLLM(): ProviderState {
  const llmMock = parseBool(process.env.LLM_FORCE_MOCK);
  const dirMock = parseBool(process.env.DIRECTOR_FORCE_MOCK);
  const scriptMock = parseBool(process.env.SCRIPT_FORCE_MOCK);
  const apiKey = !!process.env.OPENAI_API_KEY;
  if (llmMock || dirMock || scriptMock) {
    return {
      name: "LLM (OpenAI)",
      mode: "MOCK",
      reason:
        llmMock ? "LLM_FORCE_MOCK=true"
          : dirMock ? "DIRECTOR_FORCE_MOCK=true"
          : "SCRIPT_FORCE_MOCK=true",
      detail: apiKey
        ? "API key configured but mock flag overrides"
        : "no API key (would fail if mock disabled)",
      estimatedCostNote: "$0 / preview, $0 / dispatch",
    };
  }
  if (!apiKey) {
    return {
      name: "LLM (OpenAI)",
      mode: "MOCK",
      reason: "no OPENAI_API_KEY (auto-fallback inside services)",
      detail: "set OPENAI_API_KEY + unset LLM_FORCE_MOCK to go real",
      estimatedCostNote: "$0 (no key)",
    };
  }
  const dirModel = process.env.OPENAI_DIRECTOR_MODEL || "gpt-5.5";
  const scriptModel = process.env.OPENAI_SCRIPT_MODEL || "gpt-5.5";
  return {
    name: "LLM (OpenAI)",
    mode: "REAL",
    reason: "OPENAI_API_KEY set + no FORCE_MOCK flag",
    detail: `director=${dirModel} script=${scriptModel}`,
    estimatedCostNote: "~$0.05–0.20 / preview-or-dispatch (gpt-5.5/4.1 mix)",
  };
}

function checkSeedance(): ProviderState {
  /// 与 src/lib/providers/seedance.ts 的 isMockMode 完全同构
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  const apiKey = !!process.env.BYTEPLUS_ARK_API_KEY;
  const model = process.env.ARK_VIDEO_MODEL || "dreamina-seedance-2-0-260128";
  if (flag === "1" || flag === "true" || flag === "yes") {
    return {
      name: "Seedance (BytePlus ModelArk international)",
      mode: "MOCK",
      reason: "VIDEO_ENGINE_MOCK=true",
      detail: apiKey
        ? "API key configured but explicitly forced mock"
        : "no API key (mock-only)",
      estimatedCostNote: "$0 / segment",
    };
  }
  if (flag === "0" || flag === "false" || flag === "no") {
    return {
      name: "Seedance (BytePlus ModelArk international)",
      mode: "REAL",
      reason: "VIDEO_ENGINE_MOCK=false (explicit)",
      detail: apiKey
        ? `model=${model}`
        : "❌ no BYTEPLUS_ARK_API_KEY — real mode forced but submit will throw",
      estimatedCostNote: "待确认（企业账号注册后回填）",
    };
  }
  /// 未设置：一律 mock；真实调用必须显式 VIDEO_ENGINE_MOCK=false
  return {
    name: "Seedance (BytePlus ModelArk international)",
    mode: "MOCK",
    reason: apiKey
      ? "API key set but VIDEO_ENGINE_MOCK unset (safe default mock)"
      : "no BYTEPLUS_ARK_API_KEY + no VIDEO_ENGINE_MOCK (safe default mock)",
    detail: "set BYTEPLUS_ARK_API_KEY + VIDEO_ENGINE_MOCK=false to go real",
    estimatedCostNote: "$0 / segment",
  };
}

function checkOpenAIImage(): ProviderState {
  const mock = parseBool(process.env.IMAGE_ENGINE_MOCK);
  const apiKey = !!process.env.OPENAI_API_KEY;
  if (mock) {
    return {
      name: "OpenAI Image (Logo / End card)",
      mode: "MOCK",
      reason: "IMAGE_ENGINE_MOCK=true",
      detail: apiKey ? "API key set but mock forced" : "no API key",
      estimatedCostNote: "$0 / image",
    };
  }
  if (!apiKey) {
    return {
      name: "OpenAI Image (Logo / End card)",
      mode: "MOCK",
      reason: "no OPENAI_API_KEY (auto mock)",
      detail: "set OPENAI_API_KEY + unset IMAGE_ENGINE_MOCK to go real",
      estimatedCostNote: "$0 / image",
    };
  }
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  return {
    name: "OpenAI Image (Logo / End card)",
    mode: "REAL",
    reason: "OPENAI_API_KEY set + IMAGE_ENGINE_MOCK!=true",
    detail: `model=${model}`,
    estimatedCostNote: "~$0.04–0.08 / image",
  };
}

function checkStitchRuntime(): ProviderState {
  /// 与 src/lib/services/stitch-service.ts 的 stitchRuntimeMode 同构
  const explicit = (process.env.STITCH_RUNTIME ?? "").trim().toLowerCase();
  const enable = process.env.ENABLE_VIDEO_STITCHING;
  if (enable === "false") {
    return {
      name: "Stitch (FFmpeg)",
      mode: "MOCK",
      reason: "ENABLE_VIDEO_STITCHING=false",
      detail: "multi-segment will reuse first segment URL (demo only)",
      estimatedCostNote: "$0 (no real stitch)",
    };
  }
  let runtime: "local" | "external";
  let reason: string;
  if (explicit === "local") {
    runtime = "local";
    reason = "STITCH_RUNTIME=local (explicit)";
  } else if (explicit === "external") {
    runtime = "external";
    reason = "STITCH_RUNTIME=external (explicit)";
  } else if (process.env.NODE_ENV === "production") {
    runtime = "external";
    reason = "NODE_ENV=production (auto external)";
  } else {
    runtime = "local";
    reason = "non-production + no STITCH_RUNTIME (auto local)";
  }
  return {
    name: "Stitch (FFmpeg)",
    mode: "REAL",
    reason,
    detail:
      runtime === "local"
        ? "in-process ffmpeg (needs `which ffmpeg` on PATH)"
        : "delegated to GH Action runner (.github/workflows/stitch-videos.yml)",
    estimatedCostNote: "~$0.001 / final video (Blob upload)",
  };
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function header(s: string) {
  console.log("\n" + "─".repeat(72));
  console.log(`  ${s}`);
  console.log("─".repeat(72));
}

function row(state: ProviderState) {
  const tag = state.mode === "REAL" ? "🔥 REAL" : "✅ MOCK";
  console.log(`  ${tag.padEnd(10)} ${state.name}`);
  console.log(`             reason : ${state.reason}`);
  console.log(`             detail : ${state.detail}`);
  console.log(`             cost   : ${state.estimatedCostNote}`);
}

function checkBlob(): ProviderState {
  const token = !!process.env.BLOB_READ_WRITE_TOKEN;
  return {
    name: "Vercel Blob",
    mode: token ? "REAL" : "MOCK",
    reason: token
      ? "BLOB_READ_WRITE_TOKEN set"
      : "BLOB_READ_WRITE_TOKEN MISSING — stitch-service / openai-image will throw",
    detail: token
      ? "uploads will publish to public.blob.vercel-storage.com"
      : "any upload attempt fails fast (no silent file:// fallback)",
    estimatedCostNote: token
      ? "tiny ($) per video; pay per GB stored + GB egress"
      : "$0 (no uploads)",
  };
}

function main() {
  loadEnvFiles();

  const args = process.argv.slice(2);
  const strict = args.includes("--strict");

  const states = [
    checkLLM(),
    checkSeedance(),
    checkOpenAIImage(),
    checkStitchRuntime(),
    checkBlob(),
  ];

  header("Aivora · Provider Mode Preflight");
  for (const s of states) row(s);

  const realCount = states.filter((s) => s.mode === "REAL").length;
  const isProd = process.env.NODE_ENV === "production";

  console.log("");
  console.log(`  summary    : ${realCount} of ${states.length} providers in REAL mode`);
  console.log(`  NODE_ENV   : ${process.env.NODE_ENV ?? "(undefined)"}`);
  console.log(`  guidance   : ${guidance(realCount, isProd)}`);
  console.log("");

  if (strict && realCount > 0) {
    console.error("  ❌ --strict: aborting because 1+ provider is REAL");
    process.exit(1);
  }
}

function guidance(realCount: number, isProd: boolean): string {
  if (isProd) {
    return realCount === 5
      ? "production with all REAL → expected ✓"
      : "production with mocked providers → unusual; double-check env";
  }
  if (realCount === 0) return "all mock — safe to develop / iterate UI";
  if (realCount < 3) return "partial REAL — be aware of costs on each dispatch";
  return "全部 REAL — 每次 Generate 都会真扣 Seedance/OpenAI 额度，确认你想这么做";
}

main();
