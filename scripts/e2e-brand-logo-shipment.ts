/**
 * 印上品牌 Logo · 真机全链路验收（CEO Plan B 验收标准，会产生真实供应商费用）。
 *
 * 链路（每一阶段幂等、断点续跑，状态在 tmp/brand-logo-e2e/state.json）：
 *   1. imprint  — 产品图工作台同一条服务路径 createProductImageJob(brandLogo)：
 *                 SunnyShutter 窗帘实拍图 + 品牌包 logo 作第二参考图 → 印 logo 产品图
 *   2. video    — Seedance 直连（generate-curtain-viral-ads 同款路数）：
 *                 印 logo 产品图作参考，Narration 台词写进 prompt 由模型原生开口
 *   3. package  — 平台品牌封装模块 applyClientBrandPackaging：
 *                 同一份台词烧录对齐字幕 + 导出 SRT + 授权 BGM；
 *                 角标/尾卡都关（验收对象是「logo 印在产品上」，不靠角标）
 *   4. verify   — ffprobe 音轨 / 抽帧（logo 肉眼复核用）/ SRT 摘要 / 验收报告
 *
 * 验收判据（2026-08-04 CEO WeChat）：语音字幕全齐且对齐、产品上有 logo 不脱节、
 * 尾卡本轮不管。
 *
 * 用法：
 *   npm run e2e:brand-logo                       # 全链路（断点续跑）
 *   npm run e2e:brand-logo -- --phase=imprint    # 只出印 logo 产品图（先看图再烧视频）
 *   npm run e2e:brand-logo -- --redo-imprint     # 印得不满意，重抽一张
 *   npm run e2e:brand-logo -- --source-asset=<mediaAssetId>  # 指定源图
 */
import { loadEnvConfig } from "@next/env";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

/// 强制按开发档加载（.env.local 优先），绝不读 .env.production.local ——
/// 那份是线上快照（VIDEO_ENGINE_MOCK="true"），混进来会把真机验收判成 mock。
loadEnvConfig(process.cwd(), true);

const OUTPUT_DIR = resolve(process.cwd(), "tmp/brand-logo-e2e");
const STATE_PATH = resolve(OUTPUT_DIR, "state.json");
const ACCOUNT = "bill@sunnyshutter.ca";

const IMPRINT_POLL_MS = 5_000;
const IMPRINT_TIMEOUT_MS = 10 * 60_000;
/// 0728 实测合作方 15s 排队+出片可超 15 分钟，放宽到 40 分钟。
const VIDEO_TIMEOUT_MS = 40 * 60_000;

/**
 * 口播台词（英文，SunnyShutter 面向加拿大客户）。
 * 同一份文本三处共用：Seedance prompt 里的 Narration（模型原生开口）、
 * 封装阶段的确定性字幕切分、SRT 导出 —— 这就是「语音字幕齐且对齐」的机制。
 */
const NARRATION_LINES = [
  "Morning glare again? Not in this bedroom.",
  "Custom blackout curtains from SunnyShutter, measured and made for your exact window.",
  "Soft light when you want it, total blackout when you need it.",
] as const;
const VOICEOVER_SCRIPT = NARRATION_LINES.join(" ");

/// 印 logo 产品图的生成指令（走生产同一条 buildProductImagePrompt v3 管线）。
/// 第一抽教训（2026-08-04）：不指定落位时模型把 logo 缩成拉链小圆牌，字只剩
/// 「SUNN」。客户描述里钉死落位与尺寸，要求整字清晰。
const IMPRINT_PROMPT =
  "Warm inviting bedroom scene at golden hour, curtains fully installed and neatly draped, " +
  "natural daylight diffusing through the sheer layer, keep the fabric drape and hardware realistic. " +
  "Print the brand logo from reference image 2 on the front face of the shade's bottom rail, " +
  "centered, spanning roughly one third of the rail width, complete spelling, crisp and clearly " +
  "legible at a glance, factory-printed finish that follows the rail's surface and lighting.";

/**
 * 视频 prompt：沿用 generate-curtain-viral-ads 已验证的爆款结构 + 产品锁，
 * 但把「禁止一切 logo」改述为「必须原样保留印在产品上的 SunnyShutter logo」。
 */
function buildVideoPrompt(): string {
  const quality = [
    "Photorealistic real-footage look, true-to-life color, natural fabric physics.",
    "The curtains, room and materials MUST exactly match reference image 1 — never redesign, recolor or restyle them.",
    "LOGO LOCK: the SunnyShutter brand logo printed on the curtain fabric in image 1 is part of the product. Keep it visible and pixel-faithful — identical letterforms, spelling, colors and placement. Never redraw, blur, warp or remove it.",
    "No other logos, no extra brand text, no URLs, no readable on-screen text, no QR codes, no watermarks, no people.",
    "SPATIAL BOUNDARY: stay within the photographed room; never invent unseen rooms or angles.",
    "LIGHTING CONTINUITY LOCK: light direction and color temperature continuous between adjacent shots.",
  ].join(" ");
  return [
    "9:16 vertical premium home-decor selling ad, 15s story told in 5 precisely edited cuts. Result-first structure with spoken narration.",
    "",
    "LOCATION: the exact bedroom in reference image 1.",
    "PRODUCT (must exactly match reference image 1): custom layered blackout curtains with sheer inner layer, with the SunnyShutter logo printed on the fabric.",
    "",
    `0-3s: cinematic hero shot — slow push-in on the fully styled bedroom of image 1, golden glow through the sheer layer, curtains perfectly draped. Camera: slow push-in. Narration (spoken in English, warm confident voice): "${NARRATION_LINES[0]}"`,
    `3-8s: macro glide across the curtain fabric passing the printed SunnyShutter logo, weave texture crisp, the logo stays sharp and legible exactly as in image 1. Camera: slow macro slider. Narration (same voice): "${NARRATION_LINES[1]}"`,
    "8-11s: the blackout layer glides closed along its track, the room dims into a cozy sleep cave in one satisfying motion. Camera: static medium on the window.",
    `11-15s: layers reopen to soft filtered daylight, closing wide of the serene bedroom with the curtains as hero, logo naturally visible in frame. Camera: static wide, gentle light movement. Narration (same voice): "${NARRATION_LINES[2]}"`,
    "",
    "Audio: the three English narration lines spoken naturally as voiceover, soft room ambience under them, a subtle track-glide sound at 8s, no music with vocals.",
    "Style: result-first reveal edit, satisfying detail montage, warm aspirational home tones, high retention pacing.",
    "",
    quality,
  ].join("\n");
}

/// 封装阶段与台词共用的后期设置：字幕开 + SRT 导出 + 低音量授权 BGM；
/// 口播是 Seedance 原生音轨，封装只保留/混音，不再调用外部 TTS。
const POST_PRODUCTION = {
  audio: {
    voiceover: {
      enabled: true,
      voiceId: "seedance-native",
      language: "en-US",
      script: VOICEOVER_SCRIPT,
    },
    bgm: { trackId: "wholesome" as const, volume: 0.12 },
  },
  captions: {
    enabled: true,
    style: "plain" as const,
    language: "en-US",
    position: "bottom" as const,
    exportSrt: true,
  },
};

type State = {
  startedAt: string;
  updatedAt: string;
  sourceAsset?: { id: string; url: string };
  brandPackage?: { id: string; name: string; logoUrl: string };
  imprint?: {
    jobId: string;
    outputAssetId: string;
    outputUrl: string;
    localPath: string;
    pointsSnapshot: number | null;
  };
  video?: {
    externalJobId: string;
    planId?: string;
    videoUrl?: string;
    localPath?: string;
  };
  /// 被供应商退款终结的套餐：重投时拉黑，避免反复栽进同一条死队列。
  refundedPlanIds?: string[];
  packaged?: {
    blobUrl: string;
    localPath: string;
    srtPath?: string;
  };
};

const run = promisify(execFile);

function log(step: string, detail = ""): void {
  console.log(`\n▸ ${step}${detail ? `\n  ${detail}` : ""}`);
}

function readState(): State {
  if (!existsSync(STATE_PATH)) {
    return { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
}

function writeState(state: State): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function assertRealMode(): void {
  for (const flag of ["VIDEO_ENGINE_MOCK", "IMAGE_ENGINE_MOCK"]) {
    const value = process.env[flag]?.toLowerCase();
    if (value === "1" || value === "true" || value === "yes") {
      throw new Error(`${flag}=${value} 已开启；本脚本只做真实出片验收，请关掉 mock。`);
    }
  }
  /// Shuyu key 与 provider 同规则：大写为准，小写为历史部署兼容。
  /// Seedance 凭证按 runtime profile 解析（ARK_API_KEY / BYTEPLUS_ARK_API_KEY 等），
  /// 由 provider 在提交时给出精确报错，这里不重复造判定。
  if (!process.env.SHUYU_API_KEY?.trim() && !process.env.shuyu_api_key?.trim()) {
    throw new Error("缺少 SHUYU_API_KEY / shuyu_api_key");
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("缺少 BLOB_READ_WRITE_TOKEN");
}

async function probeStreams(url: string): Promise<{
  hasAudio: boolean;
  durationSec: number;
  width: number;
  height: number;
}> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    url,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  return {
    hasAudio: Boolean(parsed.streams?.some((s) => s.codec_type === "audio")),
    durationSec: Number(parsed.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

async function download(url: string, toPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  writeFileSync(toPath, Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------- 阶段 1

async function stageImprint(state: State, options: { redo: boolean; sourceAssetId?: string }) {
  const { db } = await import("@/lib/db");
  const { createProductImageJob, reconcileProductImageJob } = await import(
    "@/lib/services/product-image-service"
  );
  const { findWorkspaceBrandPackageForUser } = await import(
    "@/lib/services/workspace-brand-package-service"
  );

  if (state.imprint && !options.redo) {
    log("阶段 1 · 印 logo 产品图", `已完成（job=${state.imprint.jobId}），跳过。--redo-imprint 可重抽`);
    return;
  }
  if (options.redo) state.imprint = undefined;

  const user = await db.adminUser.findUnique({
    where: { email: ACCOUNT },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`找不到账号 ${ACCOUNT}`);

  /// 品牌包：优先该账号可见的 SunnyShutter 锁定包（全局只读）。
  const pkgRow = await db.workspaceBrandPackage.findFirst({
    where: { isGlobal: true, isActive: true, clientProfileId: "sunnyshutter" },
    select: { id: true },
  });
  if (!pkgRow) throw new Error("找不到全局 SunnyShutter 品牌包");
  const brandPackage = await findWorkspaceBrandPackageForUser(pkgRow.id, user.id);
  if (!brandPackage) throw new Error("SunnyShutter 品牌包对该账号不可见");
  if (!brandPackage.logoAsset.mimeType.startsWith("image/")) {
    throw new Error("品牌包 logo 资产不是图片");
  }
  state.brandPackage = {
    id: brandPackage.id,
    name: brandPackage.name,
    logoUrl: brandPackage.logoAsset.url,
  };

  /// 源图：真实上传原图（排除历史故事板帧），可 --source-asset 指定。
  const source = options.sourceAssetId
    ? await db.mediaAsset.findFirst({
        where: { id: options.sourceAssetId, userId: user.id, mimeType: { startsWith: "image/" } },
      })
    : await db.mediaAsset.findFirst({
        where: {
          userId: user.id,
          mimeType: { startsWith: "image/" },
          url: { contains: "/uploads/" },
        },
        orderBy: { createdAt: "desc" },
      });
  if (!source) throw new Error("该账号没有可用的真实产品图（或指定的 --source-asset 无效）");
  state.sourceAsset = { id: source.id, url: source.url };
  writeState(state);

  log("阶段 1 · 印 logo 产品图（被验收的新功能）", [
    `账号：${user.email}`,
    `源图：${source.id}`,
    `品牌包：${brandPackage.name}（logo=${brandPackage.logoAsset.url.slice(0, 70)}…）`,
  ].join("\n  "));

  const job = await createProductImageJob({
    userId: user.id,
    idempotencyKey: `e2e-brand-logo-${Date.now()}`,
    prompt: IMPRINT_PROMPT,
    preset: "lifestyle",
    aspectRatio: "9:16",
    resolution: "2K",
    resultCount: 1,
    sourceAsset: source,
    brandLogo: {
      packageId: brandPackage.id,
      assetId: brandPackage.logoAsset.id,
      url: brandPackage.logoAsset.url,
    },
  });
  log("产品图任务已提交", `jobId=${job.id} · 快照 brandLogoUrl=${Boolean(job.brandLogoUrl)}`);

  const startedAt = Date.now();
  let current = job;
  while (
    !["SUCCEEDED", "FAILED", "CANCELLED"].includes(current.status) &&
    Date.now() - startedAt < IMPRINT_TIMEOUT_MS
  ) {
    await new Promise((r) => setTimeout(r, IMPRINT_POLL_MS));
    current = (await reconcileProductImageJob(job.id, user.id)) ?? current;
    process.stdout.write(`  ${Math.round((Date.now() - startedAt) / 1000)}s → ${current.status}\n`);
  }
  const output = current.outputs[0];
  if (current.status !== "SUCCEEDED" || !output?.asset) {
    throw new Error(`印 logo 产品图未成功：${current.status} ${current.errorMessage ?? ""}`);
  }

  const localPath = resolve(OUTPUT_DIR, "imprinted-product.png");
  await download(output.asset.url, localPath);
  state.imprint = {
    jobId: current.id,
    outputAssetId: output.asset.id,
    outputUrl: output.asset.url,
    localPath,
    pointsSnapshot: current.pointsSnapshot,
  };
  writeState(state);
  log("印 logo 产品图已产出", [
    output.asset.url,
    `本地：${localPath}`,
    "⚠️ 烧视频前先肉眼确认 logo 保真（不满意用 --redo-imprint 重抽）",
  ].join("\n  "));
}

// ---------------------------------------------------------------- 阶段 2

async function stageVideo(state: State) {
  if (!state.imprint) throw new Error("请先完成阶段 1（imprint）");
  /// 生产视频线路 = Shuyu（转售 seedance 模型），BytePlus 直连凭证已废弃
  /// （2026-08-04 真机验证 401）。提交/轮询范式照抄 sunnyshutter-shade-pipeline。
  const { createShuyuVideoTask, resolveShuyuVideoPlans } = await import(
    "@/lib/providers/shuyu"
  );
  const { pollShuyuTaskUntilDone } = await import(
    "@/lib/video-generation/sunnyshutter-shade-pipeline"
  );

  if (!state.video?.externalJobId) {
    /// 套餐 ID 会轮换（f99f8b3 教训），一律按实时目录解析已审计套餐，
    /// 逐个降级提交；720P 优先。
    const refunded = new Set(state.refundedPlanIds ?? []);
    const plans = (await resolveShuyuVideoPlans({ timeoutMs: 20_000 }))
      .filter((plan) => plan.inputImagesMax >= 1 && !refunded.has(plan.planId))
      .sort((a, b) => (a.resolution === b.resolution ? 0 : a.resolution === "720P" ? -1 : 1));
    if (plans.length === 0) throw new Error("Shuyu 无可用已审计视频套餐（或全部已被退款拉黑）");

    const prompt = buildVideoPrompt();
    log(
      "阶段 2 · Shuyu 真机出片",
      `promptChars=${prompt.length} · ref=印 logo 产品图 · 候选套餐=${plans.map((p) => p.planId).join(",")}`,
    );
    let lastError: unknown;
    let submitted = false;
    for (let round = 0; round < 3 && !submitted; round += 1) {
      if (round > 0) await new Promise((r) => setTimeout(r, 15_000 * round));
      for (const plan of plans) {
        try {
          const created = await createShuyuVideoTask({
            timeoutMs: 20_000,
            providerRequestKey:
              `e2e-brand-logo:${plan.planId}:${Date.now()}`.slice(0, 120),
            planId: plan.planId,
            prompt: prompt.slice(0, 4_500),
            duration: 15,
            aspectRatio: "9:16",
            inputImages: [state.imprint.outputUrl],
          });
          state.video = { externalJobId: created.taskId, planId: plan.planId };
          writeState(state);
          log("已提交", `taskId=${created.taskId} · plan=${plan.planId}（${plan.displayName} · ${plan.resolution}）`);
          submitted = true;
          break;
        } catch (error) {
          lastError = error;
          const retryable = /繁忙|busy|refunded|unavailable|timed out|不可用/i.test(
            error instanceof Error ? error.message : String(error),
          );
          if (!retryable) throw error;
          log("套餐提交被拒，降级重试", `${plan.planId}: ${(error as Error).message}`);
        }
      }
    }
    if (!submitted) {
      throw lastError instanceof Error
        ? lastError
        : new Error("所有 Shuyu 视频套餐提交失败");
    }
  } else {
    log("阶段 2 · Shuyu 真机出片", `已提交（${state.video.externalJobId}），继续轮询`);
  }

  const video = state.video;
  if (!video) throw new Error("视频任务状态缺失（state.video 未持久化）");

  if (!video.videoUrl) {
    try {
      const done = await pollShuyuTaskUntilDone(video.externalJobId, {
        label: "brand-logo-e2e",
        pollMs: 6_000,
        maxWaitMs: VIDEO_TIMEOUT_MS,
      });
      video.videoUrl = done.url;
      writeState(state);
    } catch (error) {
      /// 供应商退款 = 本任务已死且未计费：拉黑该套餐、清掉任务号，
      /// 下次重跑自动换套餐重投。
      if (/terminal: (refunded|refund_error|failed)/.test((error as Error).message ?? "")) {
        if (video.planId) {
          state.refundedPlanIds = [...(state.refundedPlanIds ?? []), video.planId];
        }
        state.video = undefined;
        writeState(state);
        throw new Error(
          `视频任务被供应商终结（${(error as Error).message}）；已拉黑套餐 ${video.planId ?? "?"}，重跑本命令将自动换套餐重投`,
        );
      }
      throw error;
    }
  }

  const localPath = resolve(OUTPUT_DIR, "clean-master.mp4");
  await download(video.videoUrl, localPath);
  video.localPath = localPath;
  writeState(state);
  const clean = await probeStreams(localPath);
  log("干净原片已产出", [
    video.videoUrl,
    `${clean.width}x${clean.height} · ${clean.durationSec.toFixed(1)}s · 原生音轨=${clean.hasAudio ? "有" : "无（验收要求有口播，无音轨即失败）"}`,
  ].join("\n  "));
  if (!clean.hasAudio) {
    throw new Error("原片没有音轨 —— 口播缺失，不满足验收；请重跑阶段 2 重抽");
  }
}

// ---------------------------------------------------------------- 阶段 3

async function stagePackage(state: State) {
  if (!state.video?.localPath) throw new Error("请先完成阶段 2（video）");
  const { applyClientBrandPackaging } = await import(
    "@/lib/video-generation/brand-packaging-service"
  );

  if (state.packaged) {
    log("阶段 3 · 封装 + 字幕烧录", "已完成，跳过");
    return;
  }
  log("阶段 3 · 封装 + 字幕烧录", "角标关 / 尾卡关（验收对象是印在产品上的 logo）· 字幕 + SRT + BGM");
  const packaged = await applyClientBrandPackaging({
    sourceVideoPath: state.video.localPath,
    clientProfileId: "sunnyshutter",
    options: {
      includeLogo: false,
      includeEndCard: false,
      aspectRatio: "9:16",
      postProduction: POST_PRODUCTION,
    },
    outputDir: OUTPUT_DIR,
    outputId: `brand-logo-e2e-${Date.now().toString(36)}`,
  });
  state.packaged = {
    blobUrl: packaged.blobUrl,
    localPath: packaged.localPath,
  };
  /// 封装模块把 SRT 写在自己的临时目录里不外传；字幕切分是确定性的，
  /// 这里用同一对函数按成片实际时长重建同一份 SRT 作为交付件。
  const { buildDeterministicCues, renderSrtCaptions } = await import(
    "@/lib/video-generation/audio-post-production"
  );
  const finalProbe = await probeStreams(packaged.localPath);
  const srtPath = resolve(OUTPUT_DIR, "captions.srt");
  writeFileSync(
    srtPath,
    renderSrtCaptions(buildDeterministicCues(VOICEOVER_SCRIPT, finalProbe.durationSec)),
    "utf8",
  );
  state.packaged.srtPath = srtPath;
  writeState(state);
  log("封装完成", [
    packaged.blobUrl,
    `本地：${packaged.localPath}`,
    `裁尾=${packaged.steps.tailTrimmedSeconds}s · 角标=${packaged.steps.logoApplied} · 尾卡=${packaged.steps.endCardApplied}`,
    packaged.warnings.length ? `警告：${packaged.warnings.join("; ")}` : "无警告",
  ].join("\n  "));
}

// ---------------------------------------------------------------- 阶段 4

async function stageVerify(state: State) {
  if (!state.packaged) throw new Error("请先完成阶段 3（package）");
  const final = await probeStreams(state.packaged.localPath);
  const framesDir = resolve(OUTPUT_DIR, "frames");
  if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });
  for (const second of [1, 4, 7, 10, 13]) {
    await run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-ss", String(second),
      "-i", state.packaged.localPath,
      "-frames:v", "1",
      resolve(framesDir, `t${second}s.png`),
    ]);
  }

  const report = [
    "# 印上品牌 Logo · 真机验收报告",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- 账号：${ACCOUNT}`,
    `- 源图：${state.sourceAsset?.id}`,
    `- 品牌包：${state.brandPackage?.name}`,
    `- 印 logo 产品图 job：${state.imprint?.jobId}（${state.imprint?.outputUrl}）`,
    `- Seedance 任务：${state.video?.externalJobId}`,
    `- 成片：${state.packaged.blobUrl}`,
    "",
    "## 机器判据",
    `- 成片规格：${final.width}x${final.height} · ${final.durationSec.toFixed(1)}s`,
    `- 音轨（口播+BGM）：${final.hasAudio ? "✅ 有" : "❌ 无"}`,
    `- 字幕：随片烧录（plain/底部/en-US），SRT=${state.packaged.srtPath ?? "（见封装临时目录）"}`,
    `- 台词三句：${NARRATION_LINES.map((l) => `“${l}”`).join(" / ")}`,
    "",
    "## 待人工复核（抽帧在 frames/）",
    "- [ ] 产品上的 SunnyShutter logo 清晰、无变形、不脱节（t4s 特写帧重点看）",
    "- [ ] 字幕文本与口播内容一致、时间大致对齐",
    "- [ ] 画面产品与源图一致（无重设计）",
  ].join("\n");
  const reportPath = resolve(OUTPUT_DIR, "REPORT.md");
  writeFileSync(reportPath, `${report}\n`, "utf8");

  log("阶段 4 · 验收产物", [
    `成片本地：${state.packaged.localPath}`,
    `成片 URL：${state.packaged.blobUrl}`,
    `抽帧：${framesDir}`,
    `报告：${reportPath}`,
  ].join("\n  "));
  if (!final.hasAudio) throw new Error("成片没有音轨，不满足「语音字幕都要有」");
  console.log("\n✅ 全链路完成。抽帧与成片请人工过目后交付。\n");
}

// ---------------------------------------------------------------- 主流程

async function main() {
  assertRealMode();
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const phaseArg = args.find((a) => a.startsWith("--phase="))?.slice("--phase=".length) ?? "all";
  const redo = args.includes("--redo-imprint");
  const sourceAssetId = args.find((a) => a.startsWith("--source-asset="))?.slice("--source-asset=".length);

  const state = readState();
  writeState(state);

  if (phaseArg === "all" || phaseArg === "imprint") {
    await stageImprint(state, { redo, sourceAssetId });
  }
  if (phaseArg === "all" || phaseArg === "video") await stageVideo(state);
  if (phaseArg === "all" || phaseArg === "package") await stagePackage(state);
  if (phaseArg === "all" || phaseArg === "verify") await stageVerify(state);

  const { db } = await import("@/lib/db");
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("\n❌ 验收失败：", error);
  try {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  } catch {
    /* 断开失败不掩盖真实错误 */
  }
  process.exit(1);
});
