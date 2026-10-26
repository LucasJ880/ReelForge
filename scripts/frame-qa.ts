/**
 * Frame QA CLI — 对任意成片（本地文件或 URL）手动跑「抽帧 + 文字/错字检测」门禁。
 *
 * 平台管线里同一门禁已自动接在段完成 → SUCCEEDED 之间；
 * 这个 CLI 用于脚本批量出片（demo:curtain 等）在发布进成片库前的最后一道人工触发检查，
 * 以及 X-SCAF-9 / §7 P0-1 验收时把逐条 verdict 落成 JSON 证据。
 *
 * 用法：
 *   npm run frame:qa -- tmp/curtain-viral-ads/video-3-v2a1.mp4
 *   npm run frame:qa -- https://.../final.mp4 tmp/other.mp4
 *   npm run frame:qa -- final.mp4 --refs https://.../product-1.jpg,https://.../product-2.jpg
 *   npm run frame:qa -- final.mp4 --json > evidence.json
 *
 * 选项：
 *   --refs <url,url>   商品参考图。runFrameTextQa 目前的签名只有 { frameCount }，没有
 *                      references 字段，所以这里只在输出里回显并标注「待 P01-B 接入」；
 *                      P01-B 落地后把 refs 传进 opts 即可，不改本文件以外的东西。
 *   --json             把完整 verdict（含 issues / shadow / 回显的 refs）作为 JSON 数组打到 stdout；
 *                      人读的进度行改走 stderr，stdout 保持纯 JSON 可直接重定向。
 *
 * 退出码：0 = 全部通过；1 = 存在被拦截的视频；2 = 用法错误 / 门禁未启用 / 执行失败。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

interface CliArgs {
  targets: string[];
  refs: string[];
  json: boolean;
}

function parseFrameQaArgs(argv: string[]): CliArgs {
  const targets: string[] = [];
  const refs: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("--refs=")) {
      refs.push(...splitRefs(arg.slice("--refs=".length)));
    } else if (arg === "--refs") {
      refs.push(...splitRefs(argv[i + 1] ?? ""));
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`未知选项：${arg}`);
    } else {
      targets.push(arg);
    }
  }
  return { targets, refs, json };
}

function splitRefs(value: string): string[] {
  return value
    .split(",")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);
}

const REFS_NOTE = "references 待 P01-B 接入 runFrameTextQa；本次仅回显，未参与判定";

async function main() {
  /// loadEnvConfig 之后再 import，确保 OPENAI_API_KEY 等已注入
  const { runFrameTextQa, isFrameQaEnabled } = await import(
    "../src/lib/video-generation/frame-qa"
  );

  const args = parseFrameQaArgs(process.argv.slice(2));
  if (args.targets.length === 0) {
    console.error("用法：npm run frame:qa -- <视频文件或URL> [更多...] [--refs <url,url>] [--json]");
    process.exit(2);
  }
  if (!isFrameQaEnabled()) {
    console.error(
      "门禁未启用：需要 OPENAI_API_KEY，且 FRAME_QA_DISABLED / VIDEO_ENGINE_MOCK / LLM_FORCE_MOCK 均未开启。",
    );
    process.exit(2);
  }

  /// --json 时 stdout 只放 JSON，人读行全部走 stderr
  const say = (line: string) => (args.json ? process.stderr : process.stdout).write(`${line}\n`);

  if (args.refs.length > 0) {
    say(`参考图 ×${args.refs.length}（${REFS_NOTE}）`);
    for (const ref of args.refs) say(`  · ${ref}`);
  }

  let blocked = 0;
  const results: Array<{
    target: string;
    references: string[];
    referencesApplied: false;
    referencesNote: string;
    verdict: Awaited<ReturnType<typeof runFrameTextQa>>;
  }> = [];
  for (const target of args.targets) {
    say(`→ ${target}`);
    const verdict = await runFrameTextQa(target);
    results.push({
      target,
      references: args.refs,
      referencesApplied: false,
      referencesNote: REFS_NOTE,
      verdict,
    });
    if (!verdict.checked) {
      say(`  ⚠ ${verdict.summary}`);
      continue;
    }
    if (verdict.ok) {
      say(`  ✓ ${verdict.summary}`);
    } else {
      blocked += 1;
      say(`  ✗ ${verdict.summary}`);
    }
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  }

  if (blocked > 0) {
    say(`\n结论：${blocked}/${args.targets.length} 支被拦截，禁止交付。`);
    process.exit(1);
  }
  say(`\n结论：${args.targets.length} 支全部通过，可以交付。`);
}

main().catch((err) => {
  console.error("[frame-qa] 执行失败:", (err as Error).message);
  process.exit(2);
});
