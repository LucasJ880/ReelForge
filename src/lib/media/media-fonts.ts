/**
 * 媒体运行时字体（4.2）：中文字体 + fontconfig。
 *
 * 背景：Vercel 函数（Amazon Linux）没有任何系统字体，也没有 /etc/fonts。
 * 两条渲染链都靠 fontconfig 找字：
 *   - 字幕烧录：ffmpeg `ass` 滤镜 → libass → fontconfig
 *   - 尾卡文字：sharp(SVG) → librsvg/pango → fontconfig
 * 没字体时中文要么整段不显示、要么全是豆腐块，而且不会报错 —— 成片照样「成功」。
 *
 * 做法：随函数打包一份 OFL 授权的 Noto Sans SC（next.config.ts 只给需要的
 * 路由做 outputFileTracingIncludes），运行时在可写的 tmp 目录生成 fonts.conf，
 * 设置 FONTCONFIG_FILE（同时作用于本进程的 sharp 与 ffmpeg 子进程）。
 *
 * 字体查找顺序：
 *   1. MEDIA_CJK_FONT_FILE（运维显式指定）
 *   2. assets/fonts/ 下仓库内置的 Noto Sans SC（若之后改为直接入库）
 *   3. @expo-google-fonts/noto-sans-sc 的 400Regular 静态 TTF（OFL-1.1）
 * 运维已经自己设置 FONTCONFIG_FILE 时尊重它，不覆盖。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 打包字体的 family 名（Google Fonts 版 Noto Sans SC） */
export const CJK_FONT_FAMILY = "Noto Sans SC";

/// 渲染代码里出现过的 family（ASS 样式写的是 Noto Sans CJK SC，尾卡 SVG 写
/// Helvetica/Arial）——全部别名到打包字体，避免 fontconfig 回退到不含中文的字体。
const FAMILY_ALIASES = [
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "PingFang SC",
  "Microsoft YaHei",
  "Helvetica",
  "Arial",
  "sans-serif",
];

/** 相对项目根（Vercel 上即 /var/task）的候选字体文件，按优先级排列 */
export const BUNDLED_CJK_FONT_CANDIDATES = [
  "assets/fonts/NotoSansSC-Regular.otf",
  "assets/fonts/NotoSansSC-Regular.ttf",
  "node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf",
] as const;

export type MediaFontSource = "env" | "bundled" | "none";

export interface MediaFontSetup {
  /** 解析到的中文字体文件；null = 本运行时没有中文字体（字幕/尾卡中文会缺字） */
  fontFile: string | null;
  fontDir: string | null;
  fontSource: MediaFontSource;
  /** 生效中的 fontconfig 配置文件（运维自设的或本模块生成的） */
  fontconfigFile: string | null;
  fontconfigSource: "operator" | "generated" | "none";
}

export function resolveCjkFontFile(
  opts: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    exists?: (p: string) => boolean;
  } = {},
): { file: string; source: Exclude<MediaFontSource, "none"> } | null {
  const env = opts.env ?? process.env;
  /// turbopackIgnore：字体由 next.config.ts 按路由精确打包，别让文件追踪据此扫整个项目
  const cwd = opts.cwd ?? /*turbopackIgnore: true*/ process.cwd();
  const exists = opts.exists ?? existsSync;
  const explicit = env.MEDIA_CJK_FONT_FILE?.trim();
  if (explicit && exists(/*turbopackIgnore: true*/ explicit)) {
    return { file: explicit, source: "env" };
  }
  for (const rel of BUNDLED_CJK_FONT_CANDIDATES) {
    const abs = path.join(/*turbopackIgnore: true*/ cwd, rel);
    if (exists(/*turbopackIgnore: true*/ abs)) return { file: abs, source: "bundled" };
  }
  return null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 纯函数：生成 fonts.conf（字体目录 + 可写缓存目录 + family 别名） */
export function buildFontconfigXml(args: {
  fontDirs: string[];
  cacheDir: string;
  family?: string;
}): string {
  const family = escapeXml(args.family ?? CJK_FONT_FAMILY);
  const dirs = args.fontDirs.map((dir) => `  <dir>${escapeXml(dir)}</dir>`);
  const aliases = FAMILY_ALIASES.map(
    (alias) =>
      `  <alias binding="strong"><family>${escapeXml(alias)}</family><prefer><family>${family}</family></prefer></alias>`,
  );
  return [
    `<?xml version="1.0"?>`,
    `<!DOCTYPE fontconfig SYSTEM "fonts.dtd">`,
    `<!-- 由 src/lib/media/media-fonts.ts 运行时生成；勿手改 -->`,
    `<fontconfig>`,
    ...dirs,
    `  <cachedir>${escapeXml(args.cacheDir)}</cachedir>`,
    `  <config><rescan><int>0</int></rescan></config>`,
    ...aliases,
    `</fontconfig>`,
    ``,
  ].join("\n");
}

let cachedSetup: MediaFontSetup | null = null;

/**
 * 幂等：解析字体、生成 fonts.conf、设置 FONTCONFIG_FILE。
 * 必须在第一次 sharp 文字渲染 / ffmpeg 字幕烧录之前调用（fontconfig 只在
 * 初始化时读一次环境变量）。永不 throw：失败时返回 none，渲染链按原样退化。
 */
export function ensureMediaFonts(): MediaFontSetup {
  if (cachedSetup) return cachedSetup;
  const resolved = resolveCjkFontFile();
  const fontFile = resolved?.file ?? null;
  const fontDir = fontFile ? path.dirname(fontFile) : null;
  const operatorConf = process.env.FONTCONFIG_FILE?.trim();

  if (operatorConf) {
    cachedSetup = {
      fontFile,
      fontDir,
      fontSource: resolved?.source ?? "none",
      fontconfigFile: operatorConf,
      fontconfigSource: "operator",
    };
    return cachedSetup;
  }
  if (!fontDir) {
    cachedSetup = {
      fontFile: null,
      fontDir: null,
      fontSource: "none",
      fontconfigFile: null,
      fontconfigSource: "none",
    };
    return cachedSetup;
  }

  try {
    const root = path.join(os.tmpdir(), "aivora-fontconfig");
    const cacheDir = path.join(root, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const confPath = path.join(root, "fonts.conf");
    writeFileSync(
      confPath,
      buildFontconfigXml({
        /// /usr/share/fonts 不存在时 fontconfig 自动忽略；存在时（Docker / GH runner）
        /// 给拉丁字形多一层兜底。
        fontDirs: [fontDir, "/usr/share/fonts"],
        cacheDir,
      }),
      "utf8",
    );
    process.env.FONTCONFIG_FILE = confPath;
    cachedSetup = {
      fontFile,
      fontDir,
      fontSource: resolved?.source ?? "none",
      fontconfigFile: confPath,
      fontconfigSource: "generated",
    };
  } catch (err) {
    console.warn(
      `[media-fonts] fontconfig 生成失败，字幕/尾卡中文可能缺字：${(err as Error).message}`,
    );
    cachedSetup = {
      fontFile,
      fontDir,
      fontSource: resolved?.source ?? "none",
      fontconfigFile: null,
      fontconfigSource: "none",
    };
  }
  return cachedSetup;
}

/** ffmpeg 子进程环境：带上 FONTCONFIG_FILE（ensureMediaFonts 写进了 process.env） */
export function mediaProcessEnv(): NodeJS.ProcessEnv {
  ensureMediaFonts();
  return { ...process.env };
}

export const __test__ = {
  resetCache() {
    cachedSetup = null;
  },
  FAMILY_ALIASES,
};
