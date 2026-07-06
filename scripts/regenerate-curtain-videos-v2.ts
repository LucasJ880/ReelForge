/**
 * 窗帘爆款视频 v2 重生成（针对 CEO 验收反馈的 4 支废片）。
 *
 * v1 废片根因（复盘）：
 *   1. 一支视频混用 2-3 个不同房间的参考图 → 模型在房间之间乱切/混合，
 *      「女主关窗帘变成另一只手拉另一款帘」正是跨空间叙事导致的身份断裂。
 *   2. prompt 里带中文口播台词 → 模型烧录字幕，中文字形不可控（「晒」→「曬」）。
 *   3. 喂了造型怪异的交叉纱帘图（img5）→ 幻视画面。
 *
 * v2 硬性规则：
 *   - 一支视频 = 一个房间 = 一款窗帘（单图 Omni-Reference 锚定）
 *   - 全片零画面文字（字幕后期 overlay），负面清单显式禁止
 *   - 人物只允许一个、全程同装同发型，动作必须由该人物在画面内完成
 *   - 弃用 img5 交叉纱帘图
 *
 * 用法：
 *   npm run demo:curtain:v2                    # submit + wait + download（幂等续跑）
 *   npm run demo:curtain:v2 -- --phase=submit
 *   npm run demo:curtain:v2 -- --phase=wait
 *   npm run demo:curtain:v2 -- --redo=3        # 某支 QA 不过，清记录重新提交
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSeedanceStatus, submitSeedanceJob } from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

const OUTPUT_DIR = resolve(process.cwd(), "tmp/curtain-viral-ads");
const V1_SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission.json");
const V2_SUBMISSION_PATH = resolve(OUTPUT_DIR, "submission-v2.json");

/** 全片零文字 + 单空间锁 + 产品像素级还原（v2 三大铁律，每支 prompt 末尾必带） */
const HARD_GUARDS = [
  "ABSOLUTE TEXT BAN (a single frame with text = failed video): zero on-screen text of any kind — no subtitles, no captions, no titles, no lettering, no numbers, no logos, no watermarks, no UI elements.",
  "SINGLE SPACE LOCK: every second of the video stays inside the ONE room shown in the reference image; never invent other rooms, hallways or exterior views; never blend architecture.",
  "PRODUCT IDENTITY LOCK: the curtains, sheer layer, track hardware, fabric color and pleat pattern must match the reference image exactly in every frame — never redesign, recolor or restyle.",
  "ARCHITECTURE LOCK: walls, ceiling, light fixtures and furniture stay exactly as photographed; curtains exist ONLY on the window wall shown in the reference — never wrap curtains around corners onto other walls, never swap ceiling lamps for recessed downlights.",
  "Photorealistic real-footage look, true-to-life color, natural fabric physics, no morphing, no warping geometry.",
].join(" ");

type CurtainVideoV2 = {
  index: number;
  title: string;
  templateId: string;
  /// v1 submission.json 里的 imageBlobUrls key（单图锚定）
  imageKey: string;
  prompt: string;
};

const VIDEOS_V2: CurtainVideoV2[] = [
  {
    index: 2,
    title: "空间焕新对比爆款 · 卧室遮光改造",
    templateId: "tpl_viral_before_after_room",
    imageKey: "img3_taupe_pleat_bedroom",
    prompt: [
      "9:16 vertical home-decor ad, 15s told in 5 cuts, all inside the SINGLE bedroom of the reference image (taupe pinch-pleat curtains with white sheer inner layer).",
      "Concept: light-state before/after — the same room transformed purely by drawing the curtains. No people.",
      "",
      "0-3s: BEFORE — locked-off static wide: main curtains fully open at the sides, only the white sheer covering the window, harsh flat midday glare washing out the bed, room feels exposed. Camera: locked-off tripod.",
      "3-5s: static close-up of the harsh glare spilling across the pillows through the sheer. Camera: static close-up, same window.",
      "5-6s: HARD MATCH CUT on the identical wide framing — the taupe pinch-pleat curtains now drawn closed, light instantly soft, warm and layered, the room feels finished and expensive. Camera: identical locked-off framing.",
      "6-10s: from the same locked-off position, slow push-in toward the closed curtains, pleats falling in perfect vertical waves, cozy dim warmth. Camera: slow push-in only, no new angles — the window wall is the ONLY wall with curtains.",
      "10-13s: macro glide along the pinch-pleat heading and fabric texture catching the soft light. Camera: macro slider on the same curtains, same window wall.",
      "13-15s: closing static wide identical to the opening framing, curtains closed, serene premium calm. Camera: static wide, same tripod position.",
      "",
      "Audio: quiet room ambience, one satisfying fabric glide sound on the match cut, no narration, no music.",
      "Style: locked-off before/after match cut, instant light makeover, dramatic yet realistic contrast, believable lived-in bedroom.",
      "",
      HARD_GUARDS,
      "No people in any frame.",
    ].join("\n"),
  },
  {
    index: 3,
    title: "痛点狙击爆款 · 清晨刺眼阳光",
    templateId: "tpl_viral_pain_solution",
    imageKey: "img1_brown_blackout_bedroom",
    prompt: [
      "9:16 vertical UGC-style ad shot on a phone, 15s told in 5 cuts, all inside the SINGLE bedroom of the reference image (rich brown blackout curtains with white sheer on a black ceiling track).",
      "",
      "CHARACTER LOCK (the only person, 100% identical in every shot): one East Asian woman around 30, shoulder-length black hair slightly messy from sleep, oversized light-grey cotton pajama set, no makeup. Every action is performed BY HER, visible in frame — never a disembodied hand, never a second person, never different clothing.",
      "",
      "0-3s: harsh 6AM sunlight blasts through the white sheer straight onto her face in bed; she squints awake, annoyed, groans softly and shields her eyes with her forearm. Camera: handheld close-up on her face. NO dialogue.",
      "3-6s: medium handheld shot — she sits up, walks to the window of this same room and stands beside the brown blackout curtain, morning glare flooding through the sheer. Her full figure and grey pajamas clearly visible. Camera: handheld follow.",
      "6-9s: medium shot framing BOTH her and the window: she pulls the brown blackout curtain closed along its black track in one smooth motion, the room dims into soft darkness while she is still in frame. Camera: static medium, satisfying glide.",
      "9-12s: close-up of her face sinking back onto the pillow in the darkened room, visible relief, small smile, eyes closing. Camera: slow push-in. NO dialogue.",
      "12-15s: closing static wide of the darkened cozy bedroom, curtains fully closed, she sleeps peacefully under the duvet. Camera: static wide.",
      "",
      "Audio: natural room ambience, soft annoyed groan then relieved sigh (non-verbal only), curtain glide sound, no spoken words, no music.",
      "Style: authentic handheld iPhone footage, realistic skin texture, natural motion blur, pain-point dramatization, visible problem visibly solved by the same person.",
      "",
      HARD_GUARDS,
    ].join("\n"),
  },
  {
    index: 4,
    title: "光影质感沉浸爆款 · 白纱光影",
    templateId: "tpl_viral_sensory_texture",
    imageKey: "img6_marble_floor_sheer",
    prompt: [
      "9:16 vertical sensory atmosphere film, 15s told in 6 slow cuts, all inside the SINGLE room of the reference image (floor-to-ceiling white sheers with mocha outer drapes over a polished marble floor). No people, no dialogue.",
      "",
      "0-3s: extreme macro of the white sheer fabric backlit by morning sun, individual weave threads glowing, light rays diffusing through. Camera: macro glide along the sheer.",
      "3-6s: the sheer sways gently as if from a soft breeze, soft light patches drifting across the marble floor. Camera: static, letting light move.",
      "6-9s: rack focus from the translucent sheer to the heavier mocha drape beside it, texture contrast between airy and dense weave. Camera: rack focus close-up, same window wall.",
      "9-12s: slow low dolly over the marble floor as sunlight glides across it, the sheer diffusing the light into a soft glow, mocha drapes framing the edges. Camera: slow pan low over the floor rising to the curtains.",
      "12-13.5s: macro of the mocha drape folds catching a warm edge light. Camera: macro slider.",
      "13.5-15s: tranquil closing wide of the same room at dusk, warm interior glow, curtains at rest, serene premium calm. Camera: static wide.",
      "",
      "Audio: hushed airy interior ambience only, no narration, no music.",
      "Style: sensory macro texture film, backlit fabric translucency, light and shadow choreography, dreamy premium atmosphere, muted elegant color grade.",
      "",
      HARD_GUARDS,
      "No people in any frame.",
    ].join("\n"),
  },
  {
    index: 5,
    title: "成果前置爆款 · 通顶玻璃门改造",
    templateId: "tpl_viral_result_first",
    imageKey: "img2_cream_slider_condo",
    prompt: [
      "9:16 vertical premium home-decor ad, 15s told in 5 cuts, all inside the SINGLE condo room of the reference image (cream ripple-fold curtains on a ceiling track covering a full-height glass sliding door). No people.",
      "",
      "0-2s: hero shot — the cream ripple-fold curtains fully drawn across the glass slider, perfect vertical waves floor to ceiling, soft morning glow through the fabric. Camera: slow push-in.",
      "2-6s: the curtain glides smoothly open along its ceiling track revealing the bright glass door and balcony light, fabric waves flowing like water; the motion reads as a smooth motorized glide, no hands visible. Camera: static on the glide.",
      "6-9s: macro pan along the ripple-fold heading and the ceiling track hardware, precise even spacing of every fold, crisp fabric texture. Camera: macro pan along the top rail.",
      "9-12s: the curtain glides closed again, daylight melting into a soft cream glow across the room. Camera: slow lateral dolly, same window.",
      "12-15s: closing static wide — curtains settled, the room feels taller and instantly more expensive, calm filtered light everywhere. Camera: static wide with gentle light movement.",
      "",
      "Audio: soft ambient interior tone with a subtle track-glide sound, no narration, no music with vocals.",
      "Style: result-first reveal edit, satisfying glide motion, warm aspirational home tones, crisp product close-ups, high retention pacing.",
      "",
      HARD_GUARDS,
      "No people in any frame, no hands in any frame.",
    ].join("\n"),
  },
];

type V2Record = {
  purpose: "curtain-viral-ads-v2-regen";
  ratio: "9:16";
  durationSec: number;
  model: string;
  submittedAt: string;
  updatedAt: string;
  videos: Array<{
    index: number;
    title: string;
    templateId: string;
    imageKey: string;
    attempt: number;
    externalJobId?: string;
    status?: "submitted" | "failed";
    seedanceStatus?: string;
    progress?: number;
    videoUrl?: string;
    localPath?: string;
    errorMessage?: string;
  }>;
};

function readV2(): V2Record | null {
  if (!existsSync(V2_SUBMISSION_PATH)) return null;
  return JSON.parse(readFileSync(V2_SUBMISSION_PATH, "utf8")) as V2Record;
}

function writeV2(record: V2Record) {
  record.updatedAt = new Date().toISOString();
  writeFileSync(V2_SUBMISSION_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function assertRealMode() {
  const flag = process.env.VIDEO_ENGINE_MOCK?.toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    throw new Error("VIDEO_ENGINE_MOCK 已开启；本脚本只做真实出片。");
  }
  if (!process.env.ARK_API_KEY) throw new Error("缺少 ARK_API_KEY");
}

function loadImageBlobUrls(): Record<string, string> {
  if (!existsSync(V1_SUBMISSION_PATH)) {
    throw new Error("找不到 v1 submission.json（参考图 Blob 地址来源），先跑 npm run demo:curtain");
  }
  const v1 = JSON.parse(readFileSync(V1_SUBMISSION_PATH, "utf8")) as {
    imageBlobUrls: Record<string, string>;
  };
  return v1.imageBlobUrls;
}

async function submitAll(record: V2Record, imageUrls: Record<string, string>) {
  banner("Step 1: 提交 4 支 v2 重生成任务（单图单空间锚定 + 零画面文字）");
  for (const video of VIDEOS_V2) {
    const row = record.videos.find((v) => v.index === video.index)!;
    if (row.externalJobId) {
      console.log(`  ✓ 视频${video.index} 已提交 (${row.externalJobId}, attempt ${row.attempt})，跳过`);
      continue;
    }
    const refUrl = imageUrls[video.imageKey];
    if (!refUrl) throw new Error(`缺少参考图 ${video.imageKey}`);
    console.log(`  → 视频${video.index}「${video.title}」 ref=${video.imageKey} attempt=${row.attempt}`);
    try {
      const { jobId } = await submitSeedanceJob({
        prompt: video.prompt,
        referenceImageUrls: [refUrl],
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
      writeV2(record);
      console.log(`    externalJobId = ${jobId}`);
    } catch (err) {
      row.status = "failed";
      row.errorMessage = (err as Error).message;
      writeV2(record);
      throw new Error(`视频${video.index} 提交失败: ${(err as Error).message}`);
    }
  }
}

async function waitAndDownload(record: V2Record) {
  banner("Step 2: 轮询直至全部完成并下载");
  const POLL_INTERVAL_MS = 20_000;
  const MAX_WAIT_MS = 40 * 60_000;
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
        const local = resolve(OUTPUT_DIR, `video-${row.index}-v2a${row.attempt}.mp4`);
        const res = await fetch(r.videoUrl);
        if (!res.ok) throw new Error(`下载失败 video-${row.index}: HTTP ${res.status}`);
        writeFileSync(local, Buffer.from(await res.arrayBuffer()));
        row.localPath = local;
        console.log(`  ✓ 视频${row.index} 完成 → ${local}`);
      } else if (r.status === "failed") {
        row.errorMessage = r.errorMessage ?? "provider failed";
        writeV2(record);
        throw new Error(`视频${row.index} 生成失败: ${row.errorMessage}`);
      } else {
        allDone = false;
        console.log(`  … 视频${row.index} ${r.rawProviderStatus}${r.progress != null ? ` ${r.progress}%` : ""}`);
      }
      writeV2(record);
    }
    if (allDone) break;
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("等待超时，请稍后用 --phase=wait 续跑");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  banner("v2 全部完成 — 下一步逐帧 QA");
  for (const row of record.videos) {
    console.log(`  视频${row.index}「${row.title}」 attempt=${row.attempt} → ${row.localPath}`);
  }
}

async function main() {
  assertRealMode();
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
  const phase = phaseArg ? phaseArg.slice("--phase=".length) : "all";
  const redoArg = process.argv.find((a) => a.startsWith("--redo="));

  let record = readV2();
  if (!record) {
    record = {
      purpose: "curtain-viral-ads-v2-regen",
      ratio: "9:16",
      durationSec: 15,
      model: process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      videos: VIDEOS_V2.map((v) => ({
        index: v.index,
        title: v.title,
        templateId: v.templateId,
        imageKey: v.imageKey,
        attempt: 1,
      })),
    };
    writeV2(record);
  }

  if (redoArg) {
    const idx = Number(redoArg.slice("--redo=".length));
    const row = record.videos.find((v) => v.index === idx);
    if (!row) throw new Error(`没有视频 ${idx}`);
    row.attempt += 1;
    row.externalJobId = undefined;
    row.status = undefined;
    row.seedanceStatus = undefined;
    row.progress = undefined;
    row.videoUrl = undefined;
    row.localPath = undefined;
    row.errorMessage = undefined;
    writeV2(record);
    console.log(`已重置视频${idx}，attempt=${row.attempt}，将重新提交`);
  }

  const imageUrls = loadImageBlobUrls();
  if (phase === "all" || phase === "submit") await submitAll(record, imageUrls);
  if (phase === "all" || phase === "wait") await waitAndDownload(record);
}

main().catch((err) => {
  console.error("\n[curtain-v2] 失败:", (err as Error).message);
  process.exit(1);
});
