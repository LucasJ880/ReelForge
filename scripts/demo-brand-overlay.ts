import { existsSync, mkdirSync, statSync } from "node:fs";
import { copyFileSync } from "node:fs";
import path from "node:path";
import {
  applyBrandOverlay,
  type OverlayDurationMode,
  type OverlayPlacement,
} from "../src/lib/video-generation/brand-overlay-renderer";

/**
 * Demo / probe script for the brand overlay layer.
 *
 *   npm run demo:brand-overlay
 *
 * Optional env knobs:
 *   DEMO_VIDEO_PATH   absolute path to a source MP4 (defaults to one of the
 *                     mock-clips bundled in /public/mock-clips)
 *   DEMO_LOGO_PATH    absolute path to a logo PNG (defaults to
 *                     public/brand/sunny-logo.png; if missing, a fallback PNG
 *                     is auto-generated under tmp/)
 *   DEMO_PLACEMENT    top-right | top-left | bottom-right | bottom-left
 *   DEMO_DURATION     full_video | first_3s | last_5s
 *   DEMO_OPACITY      0..1
 *   DEMO_OUT_DIR      defaults to tmp/brand-overlay-demo
 *
 * The script intentionally does NOT touch the database / Blob — it just
 * exercises the standalone renderer and prints the resulting MP4 path so a
 * human can spot-check whether the logo lands correctly.
 */

const PROJECT_ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.resolve(PROJECT_ROOT, "tmp/brand-overlay-demo");
const DEFAULT_VIDEO = path.resolve(
  PROJECT_ROOT,
  "public/mock-clips/9x16.mp4",
);
const DEFAULT_LOGO_PRIMARY = path.resolve(
  PROJECT_ROOT,
  "public/brand/sunny-logo.png",
);
const DEFAULT_LOGO_FALLBACK = path.resolve(
  PROJECT_ROOT,
  "tmp/brand-overlay-demo/_fallback-logo.png",
);

async function main() {
  const opts = readOptionsFromEnv();
  const outDir = opts.outDir;
  mkdirSync(outDir, { recursive: true });

  banner("Brand Overlay Demo");

  ensureFile(opts.video, "source video", () => {
    throw new Error(
      `source video not found at ${opts.video}.\n` +
        "Provide one via DEMO_VIDEO_PATH=/abs/path/to/video.mp4",
    );
  });

  const logoPath = await resolveLogoPath(opts.logo);

  console.log(`source video : ${opts.video}`);
  console.log(`logo file    : ${logoPath}`);
  console.log(`output dir   : ${outDir}`);
  console.log(`placement    : ${opts.placement}`);
  console.log(`opacity      : ${opts.opacity}`);
  console.log(`duration mode: ${opts.durationMode}`);

  const result = await applyBrandOverlay({
    sourceVideo: opts.video,
    logo: logoPath,
    placement: opts.placement,
    opacity: opts.opacity,
    durationMode: opts.durationMode,
    outputDir: outDir,
  });

  banner("Done");
  console.log(`output file : ${result.outputPath}`);
  console.log(`output url  : ${result.outputUrl}`);
  console.log(`filter graph: ${result.filterGraph}`);
  if (result.warnings.length > 0) {
    console.log(`warnings    :`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  const sizeKb = Math.round(statSync(result.outputPath).size / 1024);
  console.log(`output size : ${sizeKb} KB`);
}

interface DemoOptions {
  video: string;
  logo: string;
  outDir: string;
  placement: OverlayPlacement;
  opacity: number;
  durationMode: OverlayDurationMode;
}

function readOptionsFromEnv(): DemoOptions {
  return {
    video: env("DEMO_VIDEO_PATH") ?? DEFAULT_VIDEO,
    logo: env("DEMO_LOGO_PATH") ?? DEFAULT_LOGO_PRIMARY,
    outDir: env("DEMO_OUT_DIR") ?? DEFAULT_OUT_DIR,
    placement: parsePlacement(env("DEMO_PLACEMENT")),
    opacity: parseOpacity(env("DEMO_OPACITY")),
    durationMode: parseDuration(env("DEMO_DURATION")),
  };
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function parsePlacement(v: string | undefined): OverlayPlacement {
  if (
    v === "top-left" ||
    v === "top-right" ||
    v === "bottom-left" ||
    v === "bottom-right"
  ) {
    return v;
  }
  return "top-right";
}

function parseDuration(v: string | undefined): OverlayDurationMode {
  if (v === "full_video" || v === "first_3s" || v === "last_5s") return v;
  return "full_video";
}

function parseOpacity(v: string | undefined): number {
  if (!v) return 0.88;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0.88;
  return Math.min(1, Math.max(0, n));
}

function ensureFile(p: string, label: string, onMissing: () => void) {
  if (!existsSync(p)) onMissing();
  const st = statSync(p);
  if (!st.isFile() || st.size === 0) {
    throw new Error(`${label} at ${p} is empty or not a file`);
  }
}

/**
 * If the user provided a logo path that exists, use it. Otherwise generate a
 * tiny sharp-rendered fallback PNG so the demo still produces a watermarked
 * MP4 even when no real logo is checked in. We don't bundle any brand asset
 * in git on purpose — production logos arrive via Vercel Blob from the order
 * flow.
 */
async function resolveLogoPath(requested: string): Promise<string> {
  if (existsSync(requested) && statSync(requested).size > 0) {
    return requested;
  }
  console.log(
    `note: logo not found at ${requested}; generating placeholder fallback`,
  );
  if (existsSync(DEFAULT_LOGO_FALLBACK)) return DEFAULT_LOGO_FALLBACK;

  mkdirSync(path.dirname(DEFAULT_LOGO_FALLBACK), { recursive: true });
  /// Try sharp first (bundled dep). If sharp rasterization fails (rare), try
  /// to copy any PNG already in /public so the demo still has *something* to
  /// composite. This keeps the demo runnable without a real Sunny logo.
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fde68a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </radialGradient>
  </defs>
  <circle cx="256" cy="256" r="220" fill="url(#g)" stroke="#fff" stroke-width="14"/>
  <text x="256" y="298" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="160" font-weight="800" fill="#7c2d12">S</text>
</svg>`;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const fs = await import("node:fs/promises");
    await fs.writeFile(DEFAULT_LOGO_FALLBACK, buf);
    return DEFAULT_LOGO_FALLBACK;
  } catch (err) {
    /// sharp failed — last-ditch fallback: any PNG inside /public that we own.
    const svgPath = path.resolve(PROJECT_ROOT, "public/next.svg");
    if (existsSync(svgPath)) {
      copyFileSync(svgPath, DEFAULT_LOGO_FALLBACK);
      return DEFAULT_LOGO_FALLBACK;
    }
    throw new Error(
      `cannot generate or locate a fallback logo PNG: ${(err as Error).message}`,
    );
  }
}

function banner(title: string) {
  const bar = "─".repeat(Math.max(8, title.length + 4));
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

main().catch((err) => {
  console.error("\n[demo-brand-overlay] failed:");
  console.error(err);
  process.exit(1);
});
