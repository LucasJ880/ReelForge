/**
 * 窗帘客户 · 爆款风格批量出片（5 支 × 15s · 9:16 · Seedance 2.0 Omni-Reference）。
 *
 * 输入：8 张客户窗帘实拍图（成品安装照）。
 * 输出：5 支按「爆款广告」模版结构（style-templates.ts 新增分类）出的 15 秒竖屏广告，
 *       每支使用 2-3 张实拍图作为 Omni-Reference 锚定真实产品/空间。
 *
 * 用法：
 *   npm run demo:curtain            # submit + wait + download 一条龙（幂等，断点续跑）
 *   npm run demo:curtain -- --phase=submit
 *   npm run demo:curtain -- --phase=wait
 *
 * 前置：ARK_API_KEY / BLOB_READ_WRITE_TOKEN 已配置，VIDEO_ENGINE_MOCK 未开。
 * 产物：tmp/curtain-viral-ads/submission.json + tmp/curtain-viral-ads/video-N.mp4
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { put } from "@vercel/blob";
import { getSeedanceStatus, submitSeedanceJob } from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const OUTPUT_DIR = resolve(process.cwd(), "tmp/curtain-viral-ads");
const SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission.json");
const ASSET_DIR =
  process.env.CURTAIN_ASSET_DIR ||
  resolve(
    process.env.HOME || "~",
    ".cursor/projects/Users-evan-Documents-ReelForge/assets",
  );

/** 8 张客户实拍图（编号 → 文件名前缀，顺序即「图片N」引用顺序） */
const SOURCE_IMAGES: Array<{ key: string; filePrefix: string; note: string }> = [
  { key: "img1_brown_blackout_bedroom", filePrefix: "Image_20260705170605_297", note: "棕色遮光帘+白纱 黑轨道 卧室地毯" },
  { key: "img2_cream_slider_condo", filePrefix: "Image_20260705170623_302", note: "奶油色蛇形帘 公寓阳台推拉门" },
  { key: "img3_taupe_pleat_bedroom", filePrefix: "Image_20260705170613_299", note: "灰褐色三褶帘+白纱 卧室" },
  { key: "img4_vaulted_luxury", filePrefix: "Image_20260705170550_295", note: "尖顶天花吊灯 灰褐色帘 豪宅" },
  { key: "img5_bathroom_tieback", filePrefix: "Image_20260705170557_296", note: "浴室交叉白纱+系带主帘" },
  { key: "img6_marble_floor_sheer", filePrefix: "Image_20260705170616_300", note: "白纱+咖色帘 大理石地面 通顶" },
  { key: "img7_cream_luxury_bedroom", filePrefix: "Image_20260705170619_301", note: "奶油色蛇形帘 精致卧室梳妆台" },
  { key: "img8_beige_living_frenchdoor", filePrefix: "Image_20260705170609_298", note: "米色亚麻帘+白纱 客厅法式门" },
];

const SHARED_QUALITY = [
  "Photorealistic real-footage look, true-to-life color, natural fabric physics.",
  "The curtains, rails, rooms and materials MUST exactly match the reference images — never redesign, recolor or restyle them.",
  "SPATIAL BOUNDARY: stay within the photographed rooms; never invent unseen rooms or angles.",
  "PRODUCT SHAPE LOCK: curtain pleat pattern, fabric color and rail hardware stay pixel-consistent in every shot.",
  "LIGHTING CONTINUITY LOCK: light direction and color temperature continuous between adjacent shots.",
  "no logo, no brand text, no URLs, no readable text, no QR codes, no watermarks, no people unless specified.",
].join(" ");

type CurtainVideo = {
  index: number;
  title: string;
  templateId: string;
  /// SOURCE_IMAGES 下标（0-based），顺序即 prompt 里 image 1 / image 2 / image 3
  imageIdx: number[];
  prompt: string;
};

const VIDEOS: CurtainVideo[] = [
  {
    index: 1,
    title: "成果前置爆款 · 奶油奢华卧室",
    templateId: "tpl_viral_result_first",
    imageIdx: [6, 3], // img7 cream luxury bedroom, img4 vaulted luxury
    prompt: [
      "9:16 vertical premium home-decor ad, 15s story told in 5 precisely edited cuts. Result-first viral structure: the wow shot comes FIRST.",
      "",
      "LOCATION: the exact rooms in image 1 (elegant cream bedroom with vanity and ripple-fold curtains) and image 2 (grand vaulted-ceiling room with chandelier and floor-to-ceiling drapes).",
      "PRODUCT (must exactly match the reference images): custom ripple-fold curtains in warm cream and greige tones with white sheer inner layer, mounted on sleek ceiling tracks.",
      "",
      "0-2s: cinematic hero shot — slow push-in on the fully styled cream bedroom of image 1, golden-hour glow through the sheer layer, curtains perfectly draped. Camera: slow push-in.",
      "2-5s: quick rewind-style whip transition, then macro glide along the ripple-fold pleats catching warm light, fabric texture crisp and tactile. Camera: macro slider.",
      "5-8s: the white sheer layer glides smoothly along its track, sunlight diffusing through it into soft glow across the bed. Camera: slow lateral slide.",
      "8-12s: match cut to the vaulted-ceiling room of image 2 — wide reveal of the chandelier and full-height drapes framing the tall windows. Camera: slow tilt-up from sofa to peak.",
      "12-15s: closing wide of the luxurious space bathed in filtered daylight, curtains as the hero of the room. Camera: static wide, gentle light movement.",
      "",
      "Audio: soft airy ambient interior tone, no narration, no music with vocals.",
      "Style: result-first reveal edit, cinematic hero opening shot, satisfying detail montage, warm aspirational home tones, high retention pacing.",
      "",
      SHARED_QUALITY,
    ].join("\n"),
  },
  {
    index: 2,
    title: "空间焕新对比爆款 · 卧室遮光改造",
    templateId: "tpl_viral_before_after_room",
    imageIdx: [2, 0], // img3 taupe pleat bedroom, img1 brown blackout bedroom
    prompt: [
      "9:16 vertical home-makeover ad, 15s told in 5 cuts. Locked-off before/after viral structure with a hard match cut.",
      "",
      "LOCATION: the exact bedrooms in image 1 (taupe pinch-pleat curtains with white sheer) and image 2 (rich brown blackout curtains with white sheer on black track).",
      "PRODUCT (must exactly match the reference images): layered blackout + sheer curtain system, taupe and brown fabrics, crisp pleats, wall-to-wall coverage.",
      "",
      "0-3s: BEFORE — locked-off static wide of the bedroom of image 1 with the window BARE and no curtains, flat dull overcast light, room feels unfinished and exposed. Camera: locked-off tripod.",
      "3-5s: tension close-up of the bare window frame and harsh glare spilling onto the mattress. Camera: static close-up.",
      "5-6s: HARD MATCH CUT — the exact same framing now fully dressed with the taupe pinch-pleat curtains and white sheer of image 1, soft warm layered light. Camera: identical locked-off framing.",
      "6-10s: slow orbit soaking in the transformed room, sheer glowing softly, pleats falling in perfect waves. Camera: slow orbit.",
      "10-15s: cut to the bedroom of image 2 — the brown blackout layer glides closed along its black track, room dims into a cozy sleep cave, then sheer-only state returns soft daylight. Camera: slow push-in then hold.",
      "",
      "Audio: quiet room ambience with a subtle satisfying fabric swoosh on the match cut, no narration.",
      "Style: locked-off before/after match cut, instant makeover impact, expensive-look upgrade, dramatic yet realistic contrast.",
      "",
      SHARED_QUALITY,
    ].join("\n"),
  },
  {
    index: 3,
    title: "痛点狙击爆款 · 清晨刺眼阳光",
    templateId: "tpl_viral_pain_solution",
    imageIdx: [0, 1], // img1 brown blackout bedroom, img2 cream slider condo
    prompt: [
      "9:16 vertical UGC-style ad shot on a phone, 15s told in 5 quick cuts. Pain-point viral structure: suffer first, solve instantly.",
      "",
      "CHARACTER (keep 100% identical in every cut): one relatable East Asian woman around 30, shoulder-length black hair slightly messy from sleep, oversized light-grey cotton pajama set, no makeup, genuine expressive face.",
      "LOCATION: the exact condo bedrooms in image 1 (brown blackout curtains with white sheer) and image 2 (cream ripple-fold curtains on sliding balcony door).",
      "PRODUCT (must exactly match the reference images): floor-to-ceiling blackout curtains with white sheer inner layer on smooth ceiling tracks.",
      "",
      '0-3s: harsh 6AM sunlight blasts through a bare window straight onto her face in bed; she squints awake, annoyed, pulls the duvet over her head. Camera: handheld close-up on her face. Dialogue (spoken in Chinese, tired and annoyed): "又被晒醒了…真的受不了了".',
      "3-6s: she walks to the window of image 2 and reaches for the cream curtain edge, morning glare flooding the glass slider. Camera: handheld follow from behind.",
      "6-9s: THE FIX — one smooth pull, the blackout layer of image 1 glides closed along its track, the room falls into soft cinematic darkness in one second. Camera: static medium on the window, satisfying glide.",
      '9-12s: close-up of her face relaxing back onto the pillow in the darkened room, visible relief, small smile. Camera: slow push-in. Dialogue (spoken softly in Chinese): "这下能睡到自然醒了".',
      "12-15s: closing shot — later, sheers half-open, soft filtered daylight, she sips coffee by the window looking calm. Camera: static wide, warm and quiet.",
      "",
      "Audio: natural room ambience, her spoken Chinese lines as natural voiceover, curtain glide sound, no music.",
      "Style: authentic handheld iPhone footage, realistic skin texture, natural motion blur, pain-point dramatization, visible problem visibly solved.",
      "",
      SHARED_QUALITY.replace(", no people unless specified", ""),
    ].join("\n"),
  },
  {
    index: 4,
    title: "光影质感沉浸爆款 · 白纱光影",
    templateId: "tpl_viral_sensory_texture",
    imageIdx: [4, 7, 5], // img5 bathroom tieback, img8 beige living frenchdoor, img6 marble floor sheer
    prompt: [
      "9:16 vertical sensory atmosphere film, 15s told in 6 slow cuts. Pure texture-and-light viral structure, no people, no dialogue.",
      "",
      "LOCATION: the exact rooms in image 1 (bathroom with crossed white sheers and tieback drapes over a freestanding tub), image 2 (beige linen curtains with sheers in a living room with French doors) and image 3 (white sheers with mocha drapes over a marble floor).",
      "PRODUCT (must exactly match the reference images): layered custom curtains — white translucent sheers with heavier linen/chenille outer drapes on discreet tracks and rods.",
      "",
      "0-3s: extreme macro of the white sheer fabric backlit by morning sun, individual weave threads glowing, light rays diffusing through. Camera: macro glide.",
      "3-5s: in the bathroom of image 1, the crossed sheers sway gently as if from a soft breeze, light patches drifting across the tub. Camera: static, letting light move.",
      "5-8s: rack focus from the sheer layer to the heavier linen drape of image 2, texture contrast between translucent and dense weave. Camera: rack focus close-up.",
      "8-11s: slow dolly through the living room of image 2, French-door light pouring through double-layered curtains, soft moving shadows on the sofa. Camera: slow dolly-in.",
      "11-13s: in the room of image 3, sunlight glides across the marble floor as the sheer diffuses it into a soft glow, mocha drapes framing the edges. Camera: slow pan low over the floor up to the curtains.",
      "13-15s: tranquil closing wide at dusk — warm interior lamps on, curtains at rest, serene premium calm. Camera: static wide.",
      "",
      "Audio: hushed airy interior ambience only, no narration, no music.",
      "Style: sensory macro texture film, backlit fabric translucency, light and shadow choreography, dreamy premium atmosphere, muted elegant color grade.",
      "",
      SHARED_QUALITY,
    ].join("\n"),
  },
  {
    index: 5,
    title: "成果前置爆款 · 通顶玻璃门改造",
    templateId: "tpl_viral_result_first",
    imageIdx: [1, 5], // img2 cream slider condo, img6 marble floor sheer
    prompt: [
      "9:16 vertical premium home-decor ad, 15s story told in 5 precisely edited cuts. Result-first viral structure for floor-to-ceiling glass doors.",
      "",
      "LOCATION: the exact rooms in image 1 (condo bedroom with cream ripple-fold curtains covering a sliding balcony door) and image 2 (floor-to-ceiling white sheers with mocha drapes over a marble floor).",
      "PRODUCT (must exactly match the reference images): full-height ripple-fold curtains and sheers on ceiling-mounted tracks, tailored for large glass sliders and tall openings.",
      "",
      "0-2s: hero shot — the cream ripple-fold curtains of image 1 fully drawn across the glass slider, perfect vertical waves floor to ceiling, soft morning glow. Camera: slow push-in.",
      "2-5s: whip transition, then the curtain glides open along its ceiling track revealing the balcony view, fabric waves flowing like water. Camera: static on the glide.",
      "5-8s: macro of the ripple-fold heading and the smooth-running track hardware, precise even spacing of every fold. Camera: macro pan along the top rail.",
      "8-12s: match cut to the space of image 2 — white sheers diffusing daylight over the marble floor, mocha outer drapes framing the full-height opening. Camera: slow lateral dolly.",
      "12-15s: closing wide — both layers settled, the room feels twice as tall and instantly more expensive, calm filtered light everywhere. Camera: static wide with gentle light movement.",
      "",
      "Audio: soft ambient interior tone with a subtle track-glide sound, no narration, no music with vocals.",
      "Style: result-first reveal edit, satisfying process detail, warm aspirational home tones, crisp product close-ups, high retention pacing.",
      "",
      SHARED_QUALITY,
    ].join("\n"),
  },
];

type SubmissionRecord = {
  purpose: "curtain-viral-ads-5x15s";
  ratio: "9:16";
  durationSec: number;
  model: string;
  submittedAt: string;
  updatedAt: string;
  imageBlobUrls: Record<string, string>;
  videos: Array<{
    index: number;
    title: string;
    templateId: string;
    imageKeys: string[];
    externalJobId?: string;
    status?: "submitted" | "failed";
    seedanceStatus?: string;
    progress?: number;
    videoUrl?: string;
    thumbnailUrl?: string;
    localPath?: string;
    errorMessage?: string;
  }>;
};

function readRecord(): SubmissionRecord | null {
  if (!existsSync(SUBMISSION_PATH)) return null;
  return JSON.parse(readFileSync(SUBMISSION_PATH, "utf8")) as SubmissionRecord;
}

function writeRecord(record: SubmissionRecord) {
  record.updatedAt = new Date().toISOString();
  writeFileSync(SUBMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function assertRealMode() {
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    throw new Error("VIDEO_ENGINE_MOCK 已开启；本脚本只做真实出片，请关掉 mock。");
  }
  if (!process.env.ARK_API_KEY) throw new Error("缺少 ARK_API_KEY");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("缺少 BLOB_READ_WRITE_TOKEN");
}

async function uploadSourceImages(record: SubmissionRecord) {
  banner("Step 1: 上传 8 张窗帘实拍图到 Vercel Blob（幂等）");
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(ASSET_DIR);
  for (const img of SOURCE_IMAGES) {
    if (record.imageBlobUrls[img.key]) {
      console.log(`  ✓ ${img.key} 已上传，跳过`);
      continue;
    }
    const fileName = files.find((f) => f.startsWith(img.filePrefix));
    if (!fileName) throw new Error(`资产目录缺少 ${img.filePrefix}*（${ASSET_DIR}）`);
    const data = readFileSync(resolve(ASSET_DIR, fileName));
    const blob = await put(`curtain-demo/${img.key}.png`, data, {
      access: "public",
      contentType: "image/png",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    record.imageBlobUrls[img.key] = blob.url;
    writeRecord(record);
    console.log(`  ↑ ${img.key} → ${blob.url}`);
  }
}

async function submitVideos(record: SubmissionRecord) {
  banner("Step 2: 提交 5 支 15s 爆款结构视频到 Seedance（Omni-Reference）");
  for (const video of VIDEOS) {
    const row = record.videos.find((v) => v.index === video.index)!;
    if (row.externalJobId) {
      console.log(`  ✓ 视频${video.index}「${video.title}」已提交 (${row.externalJobId})，跳过`);
      continue;
    }
    const refUrls = video.imageIdx.map((i) => {
      const key = SOURCE_IMAGES[i].key;
      const url = record.imageBlobUrls[key];
      if (!url) throw new Error(`图片 ${key} 尚未上传`);
      return url;
    });
    console.log(`  → 提交视频${video.index}「${video.title}」 refs=${video.imageIdx.map((i) => i + 1).join(",")} promptChars=${video.prompt.length}`);
    try {
      const { jobId } = await submitSeedanceJob({
        prompt: video.prompt,
        referenceImageUrls: refUrls,
        mode: "reference",
        duration: record.durationSec,
        ratio: "9:16",
        resolution: "1080p",
        model: record.model,
        generateAudio: true,
      });
      row.externalJobId = jobId;
      row.status = "submitted";
      row.errorMessage = undefined;
      writeRecord(record);
      console.log(`    externalJobId = ${jobId}`);
    } catch (err) {
      row.status = "failed";
      row.errorMessage = (err as Error).message;
      writeRecord(record);
      throw new Error(`视频${video.index} 提交失败: ${(err as Error).message}`);
    }
  }
}

async function waitAndDownload(record: SubmissionRecord) {
  banner("Step 3: 轮询直至 5 支全部完成并下载");
  const POLL_INTERVAL_MS = 20_000;
  const MAX_WAIT_MS = 30 * 60_000;
  const started = Date.now();

  for (;;) {
    let allDone = true;
    for (const row of record.videos) {
      if (!row.externalJobId || row.localPath) continue;
      const r = await getSeedanceStatus(row.externalJobId);
      row.seedanceStatus = r.rawProviderStatus;
      row.progress = r.progress;
      if (r.status === "completed" && r.videoUrl) {
        row.videoUrl = r.videoUrl;
        row.thumbnailUrl = r.thumbnailUrl;
        const local = resolve(OUTPUT_DIR, `video-${row.index}.mp4`);
        const res = await fetch(r.videoUrl);
        if (!res.ok) throw new Error(`下载失败 video-${row.index}: HTTP ${res.status}`);
        writeFileSync(local, Buffer.from(await res.arrayBuffer()));
        row.localPath = local;
        console.log(`  ✓ 视频${row.index} 完成 → ${local}`);
      } else if (r.status === "failed") {
        row.errorMessage = r.errorMessage ?? "provider failed";
        writeRecord(record);
        throw new Error(`视频${row.index} 生成失败: ${row.errorMessage}`);
      } else {
        allDone = false;
        console.log(`  … 视频${row.index} ${r.rawProviderStatus}${r.progress != null ? ` ${r.progress}%` : ""}`);
      }
      writeRecord(record);
    }
    if (allDone) break;
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("等待超过 30 分钟，请稍后用 --phase=wait 续跑");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  banner("全部完成");
  for (const row of record.videos) {
    console.log(`  视频${row.index}「${row.title}」 → ${row.localPath}`);
  }
}

async function main() {
  assertRealMode();
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
  const phase = phaseArg ? phaseArg.slice("--phase=".length) : "all";

  let record = readRecord();
  if (!record) {
    record = {
      purpose: "curtain-viral-ads-5x15s",
      ratio: "9:16",
      durationSec: 15,
      model: process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      imageBlobUrls: {},
      videos: VIDEOS.map((v) => ({
        index: v.index,
        title: v.title,
        templateId: v.templateId,
        imageKeys: v.imageIdx.map((i) => SOURCE_IMAGES[i].key),
      })),
    };
    writeRecord(record);
  }

  if (phase === "all" || phase === "submit") {
    await uploadSourceImages(record);
    await submitVideos(record);
  }
  if (phase === "all" || phase === "wait") {
    await waitAndDownload(record);
  }
}

main().catch((err) => {
  console.error("\n[curtain-viral-ads] 失败:", (err as Error).message);
  process.exit(1);
});
