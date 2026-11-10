import { readdirSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * 「代码比库新」发布闸（2026-11-09）：11-08 部署带了迁移却没在生产库执行，没人发现。
 *
 * 构建时把仓库里的迁移名清单内联进产物；/api/health 拿它和库里 `_prisma_migrations`
 * 已完成的行比，缺一条就报 schema: "behind"，发布后冒烟据此判红。
 * prisma/migrations 不进函数包（见 runtimeTracingExcludes），所以只能构建时读。
 */
const MIGRATION_DIR_PATTERN = /^\d{8,14}_[a-z0-9_]+$/;

export function migrationNames(entries: readonly string[]): string[] {
  return entries.filter((name) => MIGRATION_DIR_PATTERN.test(name)).sort();
}

function readMigrationNames(): string {
  try {
    return migrationNames(readdirSync(path.join(process.cwd(), "prisma", "migrations"))).join(",");
  } catch {
    /// 读不到目录（非常规构建环境）：留空，health 报 not_checked 而不是误报落后
    return "";
  }
}

export const legacyPlatformRedirects = [
  { source: "/design", destination: "/app/create", permanent: true },
  { source: "/batch-create", destination: "/app/batches/new", permanent: true },
  { source: "/batches/:id", destination: "/app/batches/:id", permanent: true },
  { source: "/personal", destination: "/app/create", permanent: true },
  { source: "/personal/agent", destination: "/app/create", permanent: true },
  { source: "/personal/create-video", destination: "/app/create", permanent: true },
  { source: "/personal/templates", destination: "/app/templates", permanent: true },
  { source: "/personal/videos", destination: "/app/library", permanent: true },
  { source: "/personal/videos/:id", destination: "/app/library/:id", permanent: true },
  { source: "/personal/billing", destination: "/app/create", permanent: true },
  { source: "/business", destination: "/app/create", permanent: true },
  { source: "/business/create-ad-video", destination: "/app/create", permanent: true },
  { source: "/business/creative-studio", destination: "/app/create", permanent: true },
  { source: "/business/products", destination: "/app/library", permanent: true },
  { source: "/business/products/:id", destination: "/app/library/:id", permanent: true },
  { source: "/business/performance", destination: "/app/racing", permanent: true },
  { source: "/business/recommendations", destination: "/app/racing", permanent: true },
  { source: "/business/billing", destination: "/app/create", permanent: true },
  { source: "/business/integrations", destination: "/app/create", permanent: true },
  { source: "/business/digital-human-store-ad", destination: "/app/create", permanent: true },
] as const;

/**
 * 媒体运行时（4.1 / 4.2）：只给真正要在函数里跑 ffmpeg 的路由打包二进制与素材。
 *
 * - ffmpeg：ffmpeg-static 安装时按构建机平台下载的单个二进制（Vercel 构建机即
 *   linux-x64，约 80MB）。代码从不 import ffmpeg-static（见 src/lib/media/ffmpeg-bin.ts），
 *   所以它不会被文件追踪带进其它函数；这里按路由精确补进来。
 * - 中文字体：Noto Sans SC（OFL-1.1）静态 TTF + 授权文本；fontconfig 配置在运行时
 *   生成到 /tmp（src/lib/media/media-fonts.ts），不需要随包。
 * - BGM：字幕 / 混音后期引用的授权配乐（BGM_TRACKS）。
 *
 * cron 两个函数只做帧质检（抽帧 + 影子检查），只要二进制；品牌封装、健康探针与
 * 成片合成（C3：/api/cron/stitch-dispatch 在 STITCH_RUNTIME=inprocess 下就是生产合成器）
 * 要烧字幕、渲染尾卡、混 BGM，才带字体与配乐。
 */
const FFMPEG_STATIC_BINARY = "./node_modules/ffmpeg-static/ffmpeg";
const CJK_FONT_FILES = [
  "./node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf",
  "./node_modules/@expo-google-fonts/noto-sans-sc/LICENSE_FONT",
  "./assets/fonts/NotoSansSC-Regular.*",
];
/// 曲库文件（目录在 src/lib/video-generation/bgm-catalog.ts）。这里不 import 源码模块——构建配置出错会让整次部署失败，
/// 所以写成固定的两条：最早那一首 + public/audio/bgm 下的整套；tests/bgm-catalog.test.ts 守着「目录里的每个文件都被这两条盖住」。
const BGM_FILES = ["./scripts/assets/pet-kit-bgm.mp3", "./public/audio/bgm/*.mp3"];
const MEDIA_RENDER_FILES = [FFMPEG_STATIC_BINARY, ...CJK_FONT_FILES, ...BGM_FILES];

export const mediaRuntimeTracingIncludes: Record<string, string[]> = {
  "/api/cron/poll-videos": [FFMPEG_STATIC_BINARY],
  "/api/cron/process-batches": [FFMPEG_STATIC_BINARY],
  "/api/brand-packaging": MEDIA_RENDER_FILES,
  "/api/health/media": MEDIA_RENDER_FILES,
  "/api/cron/stitch-dispatch": MEDIA_RENDER_FILES,
};

/**
 * 函数包里永远用不到的仓库目录（C3 上线时 /api/brand-packaging 299.6MB 超过 Vercel 250MB 上限）。
 *
 * 媒体代码里有 `process.cwd()` 拼路径，文件追踪会保守地把整个仓库带进去；这里显式排除：
 * public/ 走 CDN、运行时从不读盘；文档 / 设计稿 / 视觉基线 / 代码索引 / 测试 / 本地产物都不在运行时。
 * 运行时真正读的仓库文件（assets/fonts、assets/sunnyshutter、scripts/assets 的 BGM）不在排除之列。
 */
export const runtimeTracingExcludes: Record<string, string[]> = {
  "*": [
    "./public/**",
    "./docs/**",
    "./designs/**",
    "./visual-baseline/**",
    "./ai-context/**",
    "./tests/**",
    "./e2e/**",
    "./qa/**",
    "./tmp/**",
    "./test-results/**",
    "./playwright-report/**",
    "./prisma/migrations/**",
    "./.github/**",
  ],
};

/**
 * Phase 5 — legacy URL redirects.
 *
 * 老路径 308 permanent redirect 到 /internal/* 或 /business/*；
 * /wizard/* 由 middleware.ts 直接返回 410 Gone（旧 wizard 已下线）。
 *
 * 308 vs 301: 308 在 method 改变方面更严格（GET/POST 都保留 method）；
 * 这些路径都是页面 GET，影响等价。
 */
const nextConfig: NextConfig = {
  /// 会话「发布即失效」的版本号（src/lib/session-policy.ts）：构建时内联，middleware（edge）
  /// 与 NextAuth（node）拿到同一个值。Vercel 构建时注入 VERCEL_GIT_COMMIT_SHA；
  /// 本地构建没有 → 空串 → 不按发布失效（闲置超时与绝对上限照常生效）。
  env: {
    AIVORA_SESSION_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    /// 这次构建带的迁移名清单（逗号分隔），/api/health 的 schema 字段用它核对生产库
    AIVORA_EXPECTED_MIGRATIONS: readMigrationNames(),
  },
  /// 运行时 require 的包不进打包产物（ffmpeg-static 的入口按 __dirname 定位二进制）
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: mediaRuntimeTracingIncludes,
  outputFileTracingExcludes: runtimeTracingExcludes,
  async redirects() {
    return [
      ...legacyPlatformRedirects,
      // 旧代运营中台 2026-10-28 删除（只留帧质检运维页）：旧入口一律落到 /internal/frame-qa
      { source: "/internal", destination: "/internal/frame-qa", permanent: false },
      ...["/orders", "/rounds", "/briefs", "/qa", "/publish", "/metrics", "/distillation", "/demo-leads", "/admin", "/settings"].flatMap(
        (path) => [
          { source: path, destination: "/internal/frame-qa", permanent: false },
          { source: `${path}/:path*`, destination: "/internal/frame-qa", permanent: false },
          { source: `/internal${path}`, destination: "/internal/frame-qa", permanent: false },
          { source: `/internal${path}/:path*`, destination: "/internal/frame-qa", permanent: false },
        ],
      ),
      { source: "/internal/ai-usage/:path*", destination: "/internal/frame-qa", permanent: false },
      { source: "/internal/ai-usage", destination: "/internal/frame-qa", permanent: false },
      { source: "/internal/reports/:path*", destination: "/internal/frame-qa", permanent: false },
      { source: "/internal/reports", destination: "/internal/frame-qa", permanent: false },
      { source: "/internal/videos", destination: "/internal/frame-qa", permanent: false },
      // 公开旧页 /persona、/showcase 2026-10-28 删除
      { source: "/persona", destination: "/app", permanent: false },
      { source: "/showcase", destination: "/", permanent: false },

      // Customer-facing projects → business products
      { source: "/projects", destination: "/app/library", permanent: true },
      { source: "/projects/:path*", destination: "/app/library/:path*", permanent: true },
      // Legacy /videos was an operator-friendly aggregate; redirect to internal until Phase 2
      // splits it explicitly into business + personal libraries.
      { source: "/videos", destination: "/app/library", permanent: true },
      { source: "/videos/:path*", destination: "/app/library/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
