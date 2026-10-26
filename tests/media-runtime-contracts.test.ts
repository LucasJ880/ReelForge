/**
 * A3 媒体运行时契约：
 * - 4.1 ffmpeg 调用只走 src/lib/media/ffmpeg-bin；函数运行时不再依赖 ffprobe；
 *   GitHub Actions 拼接 runner 的依赖图里没有 ffmpeg-bin / ffmpeg-static。
 * - 4.1/4.2 二进制、中文字体、BGM 只精确打进需要的 5 个函数（C3 加上 stitch-dispatch 合成函数）。
 * - 4.3 两个 cron 设 maxDuration 并在帧质检预算上下文里跑。
 * - 4.5 两处拼接不再强转 30fps。
 * - 尾卡：生产默认（inprocess）当场渲染；只有回滚模式 external 才延迟给 runner；
 *   品牌封装 forceLocal 任何模式都内联。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import nextConfig, { mediaRuntimeTracingIncludes } from "../next.config";
import { BUNDLED_CJK_FONT_CANDIDATES } from "../src/lib/media/media-fonts";
import { BGM_TRACKS } from "../src/lib/video-generation/audio-post-production";
import { frameQaBudgetUsage } from "../src/lib/services/frame-qa-gate";
import { renderBrandEndCard } from "../src/lib/video-generation/brand-end-card-renderer";
import * as pollVideosRoute from "../src/app/api/cron/poll-videos/route";
import * as processBatchesRoute from "../src/app/api/cron/process-batches/route";
import * as stitchDispatchRoute from "../src/app/api/cron/stitch-dispatch/route";
import { STITCH_DISPATCH_MAX_DURATION_SEC } from "../src/lib/services/stitch-dispatch-service";
import { __test__ as binTest } from "../src/lib/media/ffmpeg-bin";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/// 去掉注释，只检查真正的代码
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const MEDIA_FILES = [
  "src/lib/video-generation/frame-qa.ts",
  "src/lib/video-generation/tail-trim.ts",
  "src/lib/video-generation/brand-end-card-renderer.ts",
  "src/lib/video-generation/brand-overlay-renderer.ts",
  "src/lib/video-generation/brand-packaging-service.ts",
  "src/lib/services/stitch-service.ts",
  "src/lib/services/stitch-composer.ts",
  /// C3：b-roll 合成在 inprocess 合成函数里跑——Vercel 上没有 PATH 上的 ffmpeg，也没有 ffprobe
  "src/lib/services/broll-assembly-service.ts",
  "src/lib/media/stitch-pipeline.ts",
  "src/lib/media/frame-qa-shadow.ts",
  "src/lib/media/media-health.ts",
];

test("[media-runtime] ffmpeg 调用只走 ffmpeg-bin：不再直接 execFile / 不再依赖 ffprobe", () => {
  for (const rel of MEDIA_FILES) {
    const src = code(rel);
    assert.doesNotMatch(src, /\bexecFile\b|\bspawn\(/, `${rel} 不得自己 spawn ffmpeg`);
    assert.doesNotMatch(src, /["']ffprobe["']|FFPROBE_BIN/, `${rel} 不得依赖 ffprobe`);
    assert.doesNotMatch(src, /process\.env\.FFMPEG_BIN/, `${rel} 不得自己解析 FFMPEG_BIN`);
  }
});

test("[media-runtime] 没有任何源码静态 import ffmpeg-static（只经 tracing 精确打包）", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const src = readFileSync(full, "utf8");
        if (/from\s+["']ffmpeg-static["']|require\(\s*["']ffmpeg-static["']\s*\)|import\(\s*["']ffmpeg-static["']\s*\)/.test(src)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));
  assert.deepEqual(offenders, []);
});

/// 解析本地相对 / @/ 别名 import，递归收集依赖图
function localImportGraph(entryRel: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, entryRel)];
  const resolveFile = (base: string): string | null => {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  };
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(/(?:from\s+|import\(\s*)["']([^"']+)["']/g)) {
      const spec = match[1];
      let base: string | null = null;
      if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
      else if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
      else {
        seen.add(`pkg:${spec}`);
        continue;
      }
      const resolved = resolveFile(base);
      if (resolved) queue.push(resolved);
    }
  }
  return new Set([...seen].map((f) => (f.startsWith("pkg:") ? f : path.relative(ROOT, f))));
}

test("[media-runtime] stitch-runner（GH Actions，apt ffmpeg）依赖图里没有 ffmpeg-bin / ffmpeg-static / Next / Prisma", () => {
  const graph = localImportGraph("scripts/stitch-runner.ts");
  assert.ok(graph.has("src/lib/media/frame-rate.ts"), "runner 应复用纯函数帧率决策");
  /// 1025：runner 没有中文字体时生产字幕全是豆腐块。media-fonts 只用 node 内置模块，
  /// workflow 里装同版本字体包，runner 与应用共用同一套字体解析与 fonts.conf。
  assert.ok(graph.has("src/lib/media/media-fonts.ts"), "runner 应复用打包中文字体");
  for (const forbidden of [
    "src/lib/media/ffmpeg-bin.ts",
    "pkg:ffmpeg-static",
    "pkg:@prisma/client",
    "pkg:next/server",
  ]) {
    assert.ok(!graph.has(forbidden), `stitch-runner 不得引入 ${forbidden}`);
  }
});

test("[media-runtime] 4.7 不让 Turbopack 把整个项目追进函数（叠加 ffmpeg 后会超 250MB）", () => {
  const bin = code("src/lib/media/ffmpeg-bin.ts");
  /// 裸 execFile(<动态命令>, <动态参数>) 会被当成可能的 `node <script>` 去追整个项目
  assert.doesNotMatch(bin, /\bexecFile\(/);
  assert.match(bin, /execFileAsync\(ffmpegBin\(\)/);
  /// 从动态路径 createRequire 同样会触发整项目追踪
  assert.doesNotMatch(bin, /createRequire/);
  /// 运行时拼出来的 cwd 路径一律带 turbopackIgnore
  const raw = (rel: string) => read(rel);
  assert.match(
    raw("src/lib/media/stitch-pipeline.ts"),
    /path\.resolve\(\/\*turbopackIgnore: true\*\/ process\.cwd\(\), effects\.bgmPath\)/,
  );
  for (const rel of [
    "src/lib/media/ffmpeg-bin.ts",
    "src/lib/media/media-fonts.ts",
    "src/lib/media/media-health.ts",
    "src/lib/media/stitch-pipeline.ts",
    "src/lib/services/stitch-service.ts",
    "src/lib/services/stitch-composer.ts",
    "src/lib/video-generation/brand-packaging-service.ts",
  ]) {
    const src = raw(rel);
    for (const match of src.matchAll(/process\.cwd\(\)/g)) {
      const before = src.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
      assert.match(before, /turbopackIgnore: true\*\/\s*$/, `${rel} 的 process.cwd() 缺 turbopackIgnore`);
    }
  }
});

test("[media-runtime] 4.5 两处拼接不再强转 30fps", () => {
  assert.doesNotMatch(code("src/lib/services/stitch-service.ts"), /fps=30\b/);
  assert.doesNotMatch(code("src/lib/media/stitch-pipeline.ts"), /fps=30\b/);
  assert.match(code("src/lib/media/stitch-pipeline.ts"), /pickStitchFrameRate/);
  const runner = code("scripts/stitch-runner.ts");
  assert.doesNotMatch(runner, /"-r",\s*"30"/);
  assert.match(runner, /"-r",\s*targetFps/);
});

test("[media-runtime] tracing：二进制 / 字体 / BGM 只进 5 个函数，路径与运行时解析一致", () => {
  assert.deepEqual(Object.keys(mediaRuntimeTracingIncludes).sort(), [
    "/api/brand-packaging",
    "/api/cron/poll-videos",
    "/api/cron/process-batches",
    "/api/cron/stitch-dispatch",
    "/api/health/media",
  ]);
  assert.equal(nextConfig.outputFileTracingIncludes, mediaRuntimeTracingIncludes);
  assert.ok(nextConfig.serverExternalPackages?.includes("ffmpeg-static"));

  const binary = "./node_modules/ffmpeg-static/ffmpeg";
  /// cron 只做帧质检：只要二进制，不背字体与配乐
  assert.deepEqual(mediaRuntimeTracingIncludes["/api/cron/poll-videos"], [binary]);
  assert.deepEqual(mediaRuntimeTracingIncludes["/api/cron/process-batches"], [binary]);
  const bgmPath = BGM_TRACKS.find((track) => track.path)?.path;
  /// C3：stitch-dispatch 在 inprocess 下就是生产合成器（烧字幕 / 渲染尾卡 / 混 BGM）
  for (const route of ["/api/brand-packaging", "/api/health/media", "/api/cron/stitch-dispatch"]) {
    const includes = mediaRuntimeTracingIncludes[route];
    assert.ok(includes.includes(binary), route);
    assert.ok(includes.includes(`./${BUNDLED_CJK_FONT_CANDIDATES[2]}`), `${route} 字体`);
    assert.ok(includes.includes(`./${bgmPath}`), `${route} BGM`);
    /// 不允许整包通配（ffmpeg-static 整包或整个字体包都会把函数撑大）
    assert.ok(!includes.some((p) => /node_modules\/[^/]+\/\*\*/.test(p)), route);
  }
  /// BGM 文件真实存在于仓库（被 gitignore 的话线上必 404）
  assert.ok(existsSync(path.join(ROOT, String(bgmPath))));
});

test("[media-runtime] 4.3 两个 cron 设 maxDuration=300（C3：stitch-dispatch 合成函数同样 300，且与时间预算常量一致）", () => {
  assert.equal(pollVideosRoute.maxDuration, 300);
  assert.equal(processBatchesRoute.maxDuration, 300);
  assert.equal(stitchDispatchRoute.maxDuration, 300);
  assert.equal(stitchDispatchRoute.maxDuration, STITCH_DISPATCH_MAX_DURATION_SEC);
  assert.equal(stitchDispatchRoute.runtime, "nodejs");
  assert.match(code("src/app/api/cron/process-batches/route.ts"), /runWithFrameQaBudget\(/);
});

test("[media-runtime] 4.3 poll-videos 的轮询 / 清扫跑在帧质检预算上下文里，响应回显用量", async (t: TestContext) => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "machine-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
  const seen: Array<string | null> = [];
  const handler = pollVideosRoute.createPollVideosHandler({
    startSchedulerHeartbeat: (() => ({
      finish: () => ({ status: "ok" }),
    })) as never,
    pollRunningJobs: async () => {
      seen.push(frameQaBudgetUsage()?.label ?? null);
      return { polled: 0, updated: 0 };
    },
    pollPendingProductImageJobs: async () => ({ polled: 0, recovered: 0 }) as never,
    pollPendingStoryboardRuns: async () => 0 as never,
    pollPendingContentPostRenders: async () => 0 as never,
    sweepStuckTasks: async () => {
      seen.push(frameQaBudgetUsage()?.label ?? null);
      return {} as never;
    },
  });
  const response = await handler(
    new NextRequest("http://localhost/api/cron/poll-videos", {
      headers: { authorization: "Bearer machine-secret" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["cron:poll-videos", "cron:poll-videos"]);
  const body = (await response.json()) as { frameQa?: { label: string; used: number } };
  assert.equal(body.frameQa?.label, "cron:poll-videos");
  assert.equal(body.frameQa?.used, 0);
  /// 上下文随请求结束
  assert.equal(frameQaBudgetUsage(), null);
});

test("[media-runtime] 尾卡：生产默认 inprocess 当场渲染、external（回滚）才延迟；forceLocal 任何模式都内联", async (t: TestContext) => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    NODE_ENV: env.NODE_ENV,
    STITCH_RUNTIME: env.STITCH_RUNTIME,
    FFMPEG_BIN: env.FFMPEG_BIN,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    binTest.resetCache();
  });
  env.NODE_ENV = "production";
  delete env.STITCH_RUNTIME;
  /// 指向不存在的二进制：只验证分支，不真渲染
  env.FFMPEG_BIN = "/nonexistent/ffmpeg-for-test";
  binTest.resetCache();
  const input = {
    briefId: "brand-pack-test-end",
    aspectRatio: "9:16",
    plan: {
      mode: "auto_end_card",
      logoAssetId: null,
      endCardDurationSeconds: 3,
      brandName: "晴窗遮阳",
      renderStrategy: "render_ffmpeg_overlay",
      warnings: [],
    },
  } as unknown as Parameters<typeof renderBrandEndCard>[0];

  /// 生产默认（NODE_ENV=production、未设 STITCH_RUNTIME）= inprocess：assembly 在合成函数里跑，
  /// 必须真去找 ffmpeg 渲染（这里指向不存在的二进制 → skipped），而不是延迟给已不存在的 runner。
  const productionDefault = await renderBrandEndCard(input);
  assert.equal(productionDefault?.source, "skipped", "inprocess 必须当场渲染尾卡");

  env.STITCH_RUNTIME = "external";
  const deferred = await renderBrandEndCard(input);
  assert.equal(deferred?.source, "deferred-external", "回滚模式 external 仍交给外部 runner");

  const inline = await renderBrandEndCard(input, { forceLocal: true });
  assert.equal(inline?.source, "skipped", "forceLocal 必须真去找 ffmpeg，而不是延迟");
  assert.match(read("src/lib/video-generation/brand-packaging-service.ts"), /forceLocal: true/);
});

test("函数包排除仓库杂物（C3 上线时品牌封装 299.6MB 超过 Vercel 250MB），但不排除运行时要读的素材", async () => {
  const { runtimeTracingExcludes } = await import("../next.config");
  const all = runtimeTracingExcludes["*"] ?? [];
  for (const dir of ["./public/**", "./docs/**", "./designs/**", "./visual-baseline/**", "./ai-context/**", "./tmp/**", "./test-results/**"]) {
    assert.ok(all.includes(dir), dir);
  }
  for (const needed of ["assets", "scripts", "node_modules"]) {
    assert.ok(!all.some((glob) => glob.startsWith(`./${needed}`)), `${needed} 是运行时素材（字体 / 尾卡 / BGM / ffmpeg），不能排除`);
  }
});
