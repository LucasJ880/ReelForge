import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getSeedanceStatus,
  submitSeedanceJob,
} from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const TARGET_NAME = "pet_store_chinese_demo_30s_no_text";
const OUTPUT_DIR = resolve(process.cwd(), "tmp/pet-demo-no-text");
const SEG_DIR = resolve(OUTPUT_DIR, "segments");
const FINAL_LOCAL = resolve(OUTPUT_DIR, `${TARGET_NAME}.mp4`);
const FINAL_THUMB = resolve(OUTPUT_DIR, `${TARGET_NAME}.jpg`);
const STORYBOARD_MD = resolve(OUTPUT_DIR, "storyboard.md");
const PREFLIGHT_LOG = resolve(OUTPUT_DIR, "preflight.json");

const ARK_BASE_URL =
  process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_VIDEO_MODEL =
  process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128";

const CLIP_PATHS: Record<string, string> = {
  c1: "/Users/evan/Downloads/Videos2026-04-27_195247_322.mp4",
  c2: "/Users/evan/Downloads/Videos2026-04-27_195241_323.mp4",
  c3: "/Users/evan/Downloads/Videos2026-04-27_195236_740.mp4",
  c4: "/Users/evan/Downloads/Videos2026-04-27_195224_574.mp4",
  c5: "/Users/evan/Downloads/Videos2026-04-27_195218_056.mp4",
};

const REAL_OPENING = {
  clipId: "c5",
  startSec: 0.6,
  durationSec: 4.0,
};

type ShotPlan = {
  id: string;
  refClipId: string;
  generateSec: 5 | 10;
  finalDurationSec: number;
  fallbackClipId: string;
  fallbackStartSec: number;
  fallbackDurationSec: number;
  promptZh: string;
  promptEn: string;
};

const SEEDANCE_PLAN: ShotPlan[] = [
  {
    id: "s1",
    refClipId: "c5",
    generateSec: 10,
    finalDurationSec: 7,
    fallbackClipId: "c5",
    fallbackStartSec: 4.5,
    fallbackDurationSec: 7,
    promptZh:
      "Shot 1（门店氛围）：从真实推门进入宠物店后，自然过渡到温暖明亮的店内。货架整齐，宠物用品丰富，真实手机短视频拍摄质感，轻微商业广告感。镜头缓慢推进。竖屏 9:16，避免任何文字、招牌乱码、卡通风格、豪华商场感。",
    promptEn:
      "Vertical 9:16 cinematic shot transitioning from a pet store entrance into a warm bright interior. Tidy shelves filled with pet products, real handheld phone-camera realism with subtle commercial polish. Slow gentle dolly-in. Photoreal local shop look, no luxury mall feel. Strictly no on-screen text, no signage gibberish, no logos.",
  },
  {
    id: "s2",
    refClipId: "c4",
    generateSec: 10,
    finalDurationSec: 10,
    fallbackClipId: "c2",
    fallbackStartSec: 0.5,
    fallbackDurationSec: 10,
    promptZh:
      "Shot 2（商品广告）：宠物食品、零食、玩具、护理用品货架的高质量广告展示镜头。镜头缓慢扫过货架与商品细节，干净有层次，宠物店宣传片质感。竖屏 9:16，禁止文字、漂浮商品、奇怪 logo、畸形人手。",
    promptEn:
      "Vertical 9:16 commercial advertising shot of pet store shelves: pet food, treats, toys, grooming supplies. Slow camera glide across shelves and product details, clean layered display, premium pet store ad polish. Photoreal, warm yet professional. Strictly no on-screen text, no floating products, no fake signage, no distorted hands.",
  },
  {
    id: "s3",
    refClipId: "c1",
    generateSec: 10,
    finalDurationSec: 10,
    fallbackClipId: "c1",
    fallbackStartSec: 0.5,
    fallbackDurationSec: 10,
    promptZh:
      "Shot 3（宠物可爱瞬间 + 温暖收尾）：宠物在店内自然互动、回头、靠近玩具或货架，最后画面收在温暖明亮的宠物店整体氛围。竖屏 9:16，宠物动作真实自然，禁止拟人化、畸形、卡通、屏幕文字、CTA、水印。",
    promptEn:
      "Vertical 9:16 emotional pet shot ending with warm overall store atmosphere: a pet naturally turning to look at the camera, then approaching toys or shelves, finally settling into a warm bright pet store wide view. Photoreal, healing tone, breed/coloring resembling the reference. Strictly no anthropomorphism, no distortion, no cartoon, no on-screen text, no CTA, no watermark.",
  },
];

const NEGATIVE_PROMPT_SUFFIX =
  " Negative: subtitles, captions, on-screen text, watermark, third-party logos, gibberish signage, deformed hands, deformed pets, floating items, cartoon, dreamy fantasy, luxury mall.";

const MAX_FAILED_SHOTS = 1;

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function ensureTools() {
  sh("ffmpeg -version > /dev/null");
  sh("ffprobe -version > /dev/null");
}

function sh(command: string): string {
  return execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function logSection(title: string) {
  console.log(`\n--- ${title} ---`);
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SEG_DIR);
  ensureTools();

  banner("Step 0/6: Preflight 检查");
  const preflight = await runPreflight();
  writeFileSync(PREFLIGHT_LOG, JSON.stringify(preflight, null, 2), "utf8");
  if (!preflight.ok) {
    throw new Error(`Preflight 未通过：${preflight.failures.join("; ")}`);
  }

  banner("Step 1/6: 准备真实素材开场（无 AI 生成）");
  const openingPath = prepareRealOpening();

  banner("Step 2/6: Seedance 生成 3 段主镜头（限量 retry）");
  const shots = await runSeedanceShots(preflight.refUrls);

  banner("Step 3/6: 拼接 9:16 主轨（已静音）");
  const baseVideo = buildSilentTimeline(openingPath, shots);
  const baseDuration = probeDuration(baseVideo);
  console.log("base duration:", baseDuration.toFixed(2), "s");
  if (baseDuration < 27 || baseDuration > 36) {
    throw new Error(`时长超出范围: ${baseDuration.toFixed(2)}s`);
  }

  banner("Step 4/6: 准备温暖治愈背景音乐");
  const bgInfo = await prepareBackgroundMusic(baseDuration);
  console.log("bg source:", bgInfo.source, bgInfo.detail);

  banner("Step 5/6: 静音叠加 BGM 导出最终成片（无字幕/无配音/无屏幕文字）");
  muxNoTextWithBgm(baseVideo, bgInfo.localPath, FINAL_LOCAL);
  captureThumb(FINAL_LOCAL, FINAL_THUMB);
  const finalDuration = probeDuration(FINAL_LOCAL);
  console.log("final duration:", finalDuration.toFixed(2), "s");

  banner("Step 6/6: 上传 Blob + 回写 demo seed");
  const videoBlob = await put(`demo-seed/${TARGET_NAME}.mp4`, readFileSync(FINAL_LOCAL), {
    access: "public",
    contentType: "video/mp4",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const thumbBlob = await put(`demo-seed/${TARGET_NAME}.jpg`, readFileSync(FINAL_THUMB), {
    access: "public",
    contentType: "image/jpeg",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  writeDemoSeed({
    videoUrl: videoBlob.url,
    thumbUrl: thumbBlob.url,
    durationSec: Number(finalDuration.toFixed(2)),
    shots,
    bgInfo,
    realOpeningSec: REAL_OPENING.durationSec,
  });
  writeStoryboardMd({ shots, bgInfo, finalDuration });

  console.log("\nvideo blob:", videoBlob.url);
  console.log("thumb blob:", thumbBlob.url);
  console.log("done.");
}

type PreflightResult = {
  ok: boolean;
  failures: string[];
  arkEndpoint: string;
  arkModel: string;
  refUrls: Record<string, { url: string; status: number; bytes: number; contentType: string | null }>;
};

async function runPreflight(): Promise<PreflightResult> {
  const failures: string[] = [];
  const refUrls: PreflightResult["refUrls"] = {};

  logSection("环境变量检查");
  const arkKeyLen = (process.env.ARK_API_KEY || "").length;
  const blobKeyLen = (process.env.BLOB_READ_WRITE_TOKEN || "").length;
  console.log("ARK_API_KEY:", arkKeyLen > 0 ? `set(len=${arkKeyLen})` : "MISSING");
  console.log("BLOB_READ_WRITE_TOKEN:", blobKeyLen > 0 ? `set(len=${blobKeyLen})` : "MISSING");
  console.log("ARK endpoint:", ARK_BASE_URL);
  console.log("ARK model   :", ARK_VIDEO_MODEL);
  if (!process.env.ARK_API_KEY) failures.push("ARK_API_KEY 未配置");
  if (!process.env.BLOB_READ_WRITE_TOKEN) failures.push("BLOB_READ_WRITE_TOKEN 未配置");

  logSection("Ark endpoint 网络可达性");
  try {
    const probe = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/preflight-probe`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.ARK_API_KEY || ""}` },
    });
    console.log(`Ark probe status=${probe.status}`);
    if (probe.status >= 500) {
      failures.push(`Ark endpoint 返回 5xx: ${probe.status}`);
    }
  } catch (err) {
    failures.push(`Ark endpoint 无法访问: ${(err as Error).message}`);
  }

  logSection("素材文件检查（5 段真实素材必须存在）");
  for (const [id, path] of Object.entries(CLIP_PATHS)) {
    if (!existsSync(path)) {
      failures.push(`素材缺失: ${id} -> ${path}`);
      continue;
    }
    const sz = statSync(path).size;
    console.log(`${id}: ${path} (${(sz / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (failures.length > 0) {
    return { ok: false, failures, arkEndpoint: ARK_BASE_URL, arkModel: ARK_VIDEO_MODEL, refUrls };
  }

  logSection("抽参考帧并上传 Blob");
  for (const [id, path] of Object.entries(CLIP_PATHS)) {
    const probe = JSON.parse(
      sh(`ffprobe -v error -print_format json -show_format "${path}"`),
    ) as { format?: { duration?: string } };
    const duration = Number(probe.format?.duration || 0);
    const ss = Math.max(0.4, duration * 0.4);
    const framePath = resolve(OUTPUT_DIR, `${id}-frame.jpg`);
    sh(`ffmpeg -y -ss ${ss.toFixed(2)} -i "${path}" -frames:v 1 -q:v 2 "${framePath}"`);
    const blob = await put(
      `demo-seed/pet-no-text-ref-${id}.jpg`,
      readFileSync(framePath),
      {
        access: "public",
        contentType: "image/jpeg",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
    const head = await fetch(blob.url, { method: "GET", headers: { Range: "bytes=0-0" } });
    const ct = head.headers.get("content-type");
    const sz = statSync(framePath).size;
    refUrls[id] = { url: blob.url, status: head.status, bytes: sz, contentType: ct };
    console.log(
      `[ref ${id}] url=${blob.url} status=${head.status} content-type=${ct} bytes=${sz}`,
    );
    if (head.status !== 200 && head.status !== 206) {
      failures.push(`参考帧 ${id} 公网不可访问: status=${head.status}`);
    }
    if (!ct || !ct.startsWith("image/")) {
      failures.push(`参考帧 ${id} content-type 异常: ${ct}`);
    }
    if (sz < 5_000) {
      failures.push(`参考帧 ${id} 文件过小: ${sz} bytes`);
    }
    if (sz > 8_000_000) {
      failures.push(`参考帧 ${id} 文件过大: ${sz} bytes`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    arkEndpoint: ARK_BASE_URL,
    arkModel: ARK_VIDEO_MODEL,
    refUrls,
  };
}

type SeedanceShotResult = ShotPlan & {
  jobId: string | null;
  refUrl: string;
  rawPath: string | null;
  trimmedPath: string;
  videoUrl: string | null;
  source: "seedance" | "ken-burns-fallback";
  attempts: number;
  failureReason?: string;
};

async function runSeedanceShots(
  refUrls: PreflightResult["refUrls"],
): Promise<SeedanceShotResult[]> {
  const reuseMap = parseReuseSeedanceIds(process.env.REUSE_SEEDANCE_JOB_IDS);
  const out: SeedanceShotResult[] = [];
  let failures = 0;

  for (const plan of SEEDANCE_PLAN) {
    const ref = refUrls[plan.refClipId];
    if (!ref) {
      throw new Error(`Preflight 没有 ${plan.refClipId} 的参考帧 URL`);
    }
    console.log(
      `\n>>> [seedance ${plan.id}] start | refClip=${plan.refClipId} refUrl=${ref.url} | gen=${plan.generateSec}s -> trim=${plan.finalDurationSec}s`,
    );

    const reusedJobId = reuseMap.get(plan.id);
    const fullPrompt = `${plan.promptEn}${NEGATIVE_PROMPT_SUFFIX}`;
    const trimmedPath = resolve(OUTPUT_DIR, `${plan.id}-trimmed.mp4`);

    let attempts = 0;
    let result: { jobId: string; videoUrl: string } | null = null;
    let lastErr = "";

    if (reusedJobId) {
      try {
        attempts += 1;
        console.log(`  [${plan.id}] reuse jobId=${reusedJobId}`);
        const done = await pollSeedanceUntilDone(reusedJobId);
        if (!done.videoUrl) throw new Error("reuse job 没有 video_url");
        result = { jobId: reusedJobId, videoUrl: done.videoUrl };
      } catch (err) {
        lastErr = (err as Error).message;
        console.warn(`  [${plan.id}] reuse 失败: ${lastErr}`);
      }
    }

    while (!result && attempts < 1 + 2) {
      attempts += 1;
      try {
        console.log(`  [${plan.id}] submit attempt ${attempts}`);
        const submitted = await submitSeedanceJob({
          prompt: fullPrompt,
          duration: plan.generateSec,
          ratio: "9:16",
          referenceImageUrls: [ref.url],
        });
        console.log(`  [${plan.id}] jobId=${submitted.jobId}`);
        const done = await pollSeedanceUntilDone(submitted.jobId);
        if (!done.videoUrl) throw new Error("Seedance 返回无 video_url");
        result = { jobId: submitted.jobId, videoUrl: done.videoUrl };
      } catch (err) {
        lastErr = (err as Error).message;
        console.warn(`  [${plan.id}] attempt ${attempts} 失败: ${lastErr}`);
        if (attempts >= 1 + 2) break;
        await sleep(2500 * attempts);
      }
    }

    if (result) {
      const rawPath = resolve(OUTPUT_DIR, `${plan.id}-raw.mp4`);
      const dl = await fetch(result.videoUrl);
      if (!dl.ok) {
        const msg = `下载 Seedance mp4 失败: status=${dl.status}`;
        console.warn(`  [${plan.id}] ${msg}`);
        failures += 1;
        if (failures > MAX_FAILED_SHOTS) {
          throw new Error(`已有 ${failures} 个 Seedance shot 失败，超过阈值（${MAX_FAILED_SHOTS}），中止生成。最近失败: ${msg}`);
        }
        applyKenBurnsFallback(plan, trimmedPath);
        out.push({
          ...plan,
          jobId: result.jobId,
          refUrl: ref.url,
          rawPath: null,
          trimmedPath,
          videoUrl: null,
          source: "ken-burns-fallback",
          attempts,
          failureReason: msg,
        });
        continue;
      }
      writeFileSync(rawPath, Buffer.from(await dl.arrayBuffer()));
      sh(
        `ffmpeg -y -ss 0 -t ${plan.finalDurationSec.toFixed(2)} -i "${rawPath}" -an -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=0.02:saturation=1.06:contrast=1.03,unsharp=3:3:0.3:3:3:0.0" -r 30 -c:v libx264 -preset slow -crf 19 "${trimmedPath}"`,
      );
      console.log(`  [${plan.id}] OK -> ${trimmedPath}`);
      out.push({
        ...plan,
        jobId: result.jobId,
        refUrl: ref.url,
        rawPath,
        trimmedPath,
        videoUrl: result.videoUrl,
        source: "seedance",
        attempts,
      });
      continue;
    }

    failures += 1;
    console.warn(`  [${plan.id}] 全部 retry 失败 (${attempts} 次): ${lastErr}`);
    if (failures > MAX_FAILED_SHOTS) {
      throw new Error(
        `已有 ${failures} 个 Seedance shot 全部失败，超过阈值（${MAX_FAILED_SHOTS}），中止生成。最近失败原因: ${lastErr}`,
      );
    }
    applyKenBurnsFallback(plan, trimmedPath);
    out.push({
      ...plan,
      jobId: null,
      refUrl: ref.url,
      rawPath: null,
      trimmedPath,
      videoUrl: null,
      source: "ken-burns-fallback",
      attempts,
      failureReason: lastErr,
    });
  }

  console.log(`\n[seedance summary] 成功=${out.filter((s) => s.source === "seedance").length}, 补位=${out.filter((s) => s.source === "ken-burns-fallback").length}`);
  return out;
}

function applyKenBurnsFallback(plan: ShotPlan, output: string) {
  const src = CLIP_PATHS[plan.fallbackClipId];
  if (!src) throw new Error(`Ken Burns 补位失败：${plan.fallbackClipId} 不存在`);
  const ss = plan.fallbackStartSec.toFixed(2);
  const dur = plan.fallbackDurationSec.toFixed(2);
  console.log(`  [${plan.id}] 使用 Ken Burns 补位: ${plan.fallbackClipId} ss=${ss} dur=${dur}`);
  const filter = [
    `scale=2160:3840:force_original_aspect_ratio=increase`,
    `crop=2160:3840`,
    `zoompan=z='min(zoom+0.0008,1.18)':d=${Math.round(Number(dur) * 30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`,
    `eq=brightness=0.03:saturation=1.08:contrast=1.04`,
  ].join(",");
  sh(
    `ffmpeg -y -ss ${ss} -t ${dur} -i "${src}" -an -vf "${filter}" -r 30 -c:v libx264 -preset slow -crf 19 "${output}"`,
  );
}

async function pollSeedanceUntilDone(jobId: string) {
  const timeout = 12 * 60 * 1000;
  const interval = 8000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await getSeedanceStatus(jobId);
    if (st.status === "completed") return st;
    if (st.status === "failed") {
      throw new Error(`Seedance ${jobId} 失败: ${st.errorMessage || "unknown"}`);
    }
    await sleep(interval);
  }
  throw new Error(`Seedance ${jobId} 轮询超时`);
}

function prepareRealOpening(): string {
  const src = CLIP_PATHS[REAL_OPENING.clipId];
  const out = resolve(OUTPUT_DIR, "opening.mp4");
  sh(
    `ffmpeg -y -ss ${REAL_OPENING.startSec.toFixed(2)} -t ${REAL_OPENING.durationSec.toFixed(2)} -i "${src}" -an -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=0.02:saturation=1.06:contrast=1.04" -r 30 -c:v libx264 -preset slow -crf 19 "${out}"`,
  );
  return out;
}

function buildSilentTimeline(openingPath: string, shots: SeedanceShotResult[]): string {
  const files = [openingPath, ...shots.map((s) => s.trimmedPath)];
  const list = resolve(SEG_DIR, "concat.txt");
  writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"), "utf8");
  const out = resolve(OUTPUT_DIR, "base-silent.mp4");
  sh(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${out}"`);
  return out;
}

async function prepareBackgroundMusic(targetSec: number) {
  const explicit = process.env.BG_MUSIC_PATH;
  const bgOut = resolve(OUTPUT_DIR, "bg-music.mp3");
  if (explicit && existsSync(explicit)) {
    loopAndShape(explicit, targetSec, bgOut);
    return { source: "local", detail: explicit, localPath: bgOut };
  }
  const remote = process.env.BG_MUSIC_URL;
  if (remote) {
    try {
      const resp = await fetch(remote, {
        headers: { "User-Agent": "Mozilla/5.0 AivoraDemo" },
      });
      if (resp.ok) {
        const tmp = resolve(OUTPUT_DIR, "bg-remote.mp3");
        writeFileSync(tmp, Buffer.from(await resp.arrayBuffer()));
        loopAndShape(tmp, targetSec, bgOut);
        return { source: "url", detail: remote, localPath: bgOut };
      }
      console.warn("BGM URL 下载失败 status=", resp.status);
    } catch (err) {
      console.warn("BGM URL 失败:", (err as Error).message);
    }
  }
  // Hard fail: 严禁再用 ffmpeg sine / synth pad 拼背景音乐——听起来像噪点，不能给客户看。
  // 必须提供真实的免版税音乐素材，例如：
  //   BG_MUSIC_PATH=tmp/pet-demo-no-text/bgm-candidates/wholesome.mp3
  //   BG_MUSIC_URL=https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wholesome.mp3
  throw new Error(
    "未提供真实 BGM 素材：请设置 BG_MUSIC_PATH 或 BG_MUSIC_URL（已禁用 synth 兜底，避免噪点输出）",
  );
}

function loopAndShape(input: string, targetSec: number, output: string) {
  const fadeOutStart = Math.max(0, targetSec - 2.0);
  sh(
    `ffmpeg -y -stream_loop -1 -i "${input}" -t ${targetSec.toFixed(2)} -af "afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2,volume=0.55" -c:a libmp3lame -b:a 192k "${output}"`,
  );
}

// 已弃用：ffmpeg 合成的 sine + tremolo "warm pad" 在客户视频里听起来像噪点，
// 不能再作为兜底输出。保留函数签名仅为兼容历史调用，调用即抛错。
function synthWarmPad(_targetSec: number, _output: string): never {
  throw new Error(
    "synthWarmPad 已弃用：禁止使用 ffmpeg sine / synth pad 作为 BGM。请提供真实的免版税音乐（BG_MUSIC_PATH 或 BG_MUSIC_URL）。",
  );
}

function muxNoTextWithBgm(baseVideo: string, bgMusic: string, output: string) {
  sh(
    `ffmpeg -y -i "${baseVideo}" -i "${bgMusic}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "${output}"`,
  );
}

function captureThumb(video: string, out: string) {
  sh(`ffmpeg -y -ss 00:00:06 -i "${video}" -frames:v 1 -q:v 2 "${out}"`);
}

function probeDuration(path: string): number {
  const out = sh(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${path}"`,
  );
  return Number(out.trim() || "0");
}

function parseReuseSeedanceIds(raw?: string) {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v) map.set(k, v);
  }
  return map;
}

function writeDemoSeed(args: {
  videoUrl: string;
  thumbUrl: string;
  durationSec: number;
  shots: SeedanceShotResult[];
  bgInfo: { source: string; detail: string };
  realOpeningSec: number;
}) {
  const seedPath = resolve(process.cwd(), "src/lib/data/demo-seed.ts");
  const seedanceLine = args.shots
    .map((s) => `${s.id}:${s.jobId || "fallback"}(${s.source})`)
    .join(", ");

  const scenePlan = [
    {
      time: `0-${args.realOpeningSec.toFixed(0)}s`,
      visual: "真实门店素材开场（c5）",
      narration: "无字幕、无旁白，仅画面建立可信度",
      overlay: "真实素材锚点",
    },
    ...args.shots.map((s, idx) => {
      const startSec =
        args.realOpeningSec +
        args.shots.slice(0, idx).reduce((acc, x) => acc + x.finalDurationSec, 0);
      const endSec = startSec + s.finalDurationSec;
      const labelMap: Record<string, string> = {
        s1: "门店氛围镜头",
        s2: "宠物用品广告镜头",
        s3: "宠物可爱瞬间 + 温暖收尾",
      };
      return {
        time: `${startSec.toFixed(0)}-${endSec.toFixed(0)}s`,
        visual:
          s.source === "seedance"
            ? `Seedance ${s.id} · ${labelMap[s.id] || s.id}（基于 ${s.refClipId}）`
            : `补位镜头 ${s.id} · ${labelMap[s.id] || s.id}（基于 ${s.fallbackClipId}）`,
        narration: "纯画面，无字幕、无配音",
        overlay:
          s.source === "seedance" ? "AI 生成宠物店镜头" : "Ken Burns 真实素材补位",
      };
    }),
  ];

  const seed = `/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/build-pet-demo-no-text.ts 自动生成；不要手动改动。
 *
 * 生成时间：${new Date().toISOString()}
 * 数据源：pet-store-real-assets + seedance（无字幕/无旁白版）
 * Seedance jobs: ${seedanceLine}
 * BGM: ${args.bgInfo.source}（${args.bgInfo.detail}）
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = {
  tiktokUrl: "https://example.com/pet-store-no-text-demo",
  clientIndustry: "宠物店 / 宠物生活馆",
  clientOffer: "门店日常服务、宠物护理、商品零售",
  targetAudience: "附近 3-5 公里养宠家庭与年轻白领用户",
  tone: "friendly",
};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = {
  source: "llm-only",
  reference: {
    url: "https://example.com/pet-store-no-text-demo",
    author: "pet_store_demo",
    caption: "真实素材锚点 + Seedance 宠物店主镜头，纯画面 + 治愈背景音乐。",
    hashtags: ["宠物店", "Seedance", "AI视频", "宣传片"],
    music: "warm-acoustic",
    durationSec: ${args.durationSec},
    metrics: {
      plays: 184000,
      likes: 14600,
      comments: 812,
      shares: 2680,
      engagementRate: 9.83,
    },
    coverUrl: ${JSON.stringify(args.thumbUrl)},
  },
  intelligence: {
    viralFormula: "真实素材锚点 + Seedance 3 个主镜头 + 治愈BGM，让客户一眼看到 AI 出片质感。",
    hook: "前 ${args.realOpeningSec.toFixed(0)} 秒先用真实门店画面建立可信度，再切入 AI 优化镜头制造质感惊喜。",
    retentionMechanics: [
      "真实素材开场降低距离感",
      "Seedance 3 段镜头：氛围 / 商品 / 宠物可爱",
      "无字幕无配音，靠画面节奏与BGM驱动",
      "结尾自然温暖，避免广告腔",
    ],
    visualPattern: [
      "真实门店锚点",
      "AI 生成温暖室内推进",
      "AI 商品广告级展示",
      "AI 宠物可爱 + 整体氛围收尾",
    ],
    audienceTriggers: [
      "宠物可爱瞬间带来情绪连接",
      "干净商品陈列建立专业信任",
      "温暖治愈背景音乐缓解广告感",
    ],
    commentSignals: [
      "看起来真实又有质感",
      "想去门店逛逛",
      "这种短视频很适合发本地号",
    ],
    riskNotes: [
      "AI 镜头避免畸形与文字幻觉",
      "BGM 控制在中低音量，避免盖过画面",
      "不出现旁白与字幕，保持纯视觉",
    ],
  },
  clientVersion: {
    positioning: "纯画面 + 治愈背景音乐，约 ${args.durationSec.toFixed(0)} 秒，适合直接发布到社媒主页。",
    title: "约 ${args.durationSec.toFixed(0)} 秒宠物店宣传片：真实锚点 + Seedance 3 段主镜头",
    digitalHumanScript: "",
    scenePlan: ${JSON.stringify(scenePlan, null, 2)},
    captions: [],
    brollPrompts: ${JSON.stringify(args.shots.map((s) => s.promptZh), null, 2)},
    cta: "上传真实素材，Aivora 帮你快速生成可发布宣传片。",
  },
  providerPlan: {
    digitalHuman: "heygen-ready",
    seedance: [
      "Shot 1-3 已用 Seedance 真实生成（含失败时 Ken Burns 真实素材补位）",
      "可继续按行业扩展生成镜头模板",
    ],
    nextKeys: ["ARK_API_KEY", "BLOB_READ_WRITE_TOKEN"],
  },
};

export const DEMO_SEED_VIDEO_URL = ${JSON.stringify(args.videoUrl)};
export const DEMO_SEED_VIDEO_THUMBNAIL = ${JSON.stringify(args.thumbUrl)};
export const DEMO_SEED_VIDEO_DURATION_SEC = ${args.durationSec};
export const DEMO_SEED_VIDEO_SUBTITLE_URL = "";
export const DEMO_SEED_BACKGROUND_VIDEO_URL = "";
export const DEMO_SEED_AVATAR_ID = "";
`;
  writeFileSync(seedPath, seed, "utf8");
}

function writeStoryboardMd(args: {
  shots: SeedanceShotResult[];
  bgInfo: { source: string; detail: string };
  finalDuration: number;
}) {
  const lines = [
    "# 宠物店 Demo（无字幕 / 无旁白 / 纯画面 + BGM）",
    "",
    `- 真实开场：${REAL_OPENING.clipId}（${REAL_OPENING.durationSec}s）`,
    `- BGM：${args.bgInfo.source}（${args.bgInfo.detail}）`,
    `- 成片时长：${args.finalDuration.toFixed(2)}s`,
    "",
    "## Seedance 主镜头（3 段）",
    ...args.shots.map(
      (s) =>
        `- ${s.id}（${s.finalDurationSec}s, ref=${s.refClipId}, source=${s.source}, attempts=${s.attempts}${s.failureReason ? `, fail=${s.failureReason}` : ""}）：${s.promptZh}`,
    ),
    "",
    "## 重要约束",
    "- 不嵌任何字幕/旁白/中文配音",
    "- Seedance 提示词带 negative prompt 抑制文字、畸形、卡通",
    "- 静音原素材，仅保留 BGM",
    "- 单 shot 失败用 Ken Burns 真实素材补位；≥2 shot 失败直接中止",
  ];
  writeFileSync(STORYBOARD_MD, lines.join("\n"), "utf8");
}

main().catch((err) => {
  console.error("[build-pet-demo-no-text] failed:", err);
  process.exit(1);
});
