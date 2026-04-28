import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { put } from "@vercel/blob";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  getSeedanceStatus,
  submitSeedanceJob,
} from "../src/lib/providers/seedance";

loadEnvConfig(process.cwd());

type ClipMeta = {
  id: string;
  path: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  framePath: string;
  description?: string;
};

type SeedanceShot = {
  id: string;
  prompt: string;
  refClipId: string;
  refBlobUrl: string;
  jobId: string;
  videoUrl: string;
  localPath: string;
};

type StorySegment = {
  startSec: number;
  endSec: number;
  subtitle: string;
  voiceover: string;
  sourceClipId: string;
  clipStartSec: number;
  clipDurationSec: number;
};

const OUTPUT_DIR = resolve(process.cwd(), "tmp/pet-demo");
const PUBLIC_SUB_DIR = resolve(process.cwd(), "public/demo/pet-store");
const FINAL_VIDEO_LOCAL = resolve(OUTPUT_DIR, "pet_store_chinese_demo_video.mp4");
const FINAL_THUMB_LOCAL = resolve(OUTPUT_DIR, "pet_store_chinese_demo_video.jpg");
const SUBTITLE_SRT_LOCAL = resolve(OUTPUT_DIR, "pet_store_subtitles.srt");
const SUBTITLE_VTT_PUBLIC = resolve(PUBLIC_SUB_DIR, "pet_store_subtitles.vtt");
const NARRATION_LOCAL = resolve(OUTPUT_DIR, "pet_store_narration.mp3");
const ANALYSIS_LOCAL = resolve(OUTPUT_DIR, "pet_asset_analysis.json");
const STORYBOARD_LOCAL = resolve(OUTPUT_DIR, "pet_storyboard.json");
const STORYBOARD_MD_LOCAL = resolve(OUTPUT_DIR, "pet_storyboard_for_delivery.md");

const CLIPS: Array<{ id: string; path: string; isReference?: boolean }> = [
  { id: "ref", path: "/Users/evan/Downloads/参考视频.mp4", isReference: true },
  { id: "c1", path: "/Users/evan/Downloads/Videos2026-04-27_195247_322.mp4" },
  { id: "c2", path: "/Users/evan/Downloads/Videos2026-04-27_195241_323.mp4" },
  { id: "c3", path: "/Users/evan/Downloads/Videos2026-04-27_195236_740.mp4" },
  { id: "c4", path: "/Users/evan/Downloads/Videos2026-04-27_195224_574.mp4" },
  { id: "c5", path: "/Users/evan/Downloads/Videos2026-04-27_195218_056.mp4" },
];

const SEEDANCE_PLAN = [
  {
    id: "s1",
    refClipId: "c1",
    prompt:
      "Vertical 9:16 cinematic shot inside a cozy pet store. A playful cat walks toward camera then pauses near the glass window. Warm afternoon sunlight, soft film texture, realistic style, lively but natural.",
  },
  {
    id: "s2",
    refClipId: "c2",
    prompt:
      "Vertical 9:16 close-up sequence of cat climbing a wooden cat tree and looking at the lens. Smooth handheld motion, warm home-like lighting, premium pet store atmosphere, realistic details.",
  },
  {
    id: "s3",
    refClipId: "c5",
    prompt:
      "Vertical 9:16 dynamic shot of pet products shelf and service area in a modern pet shop. Subtle camera push-in, clean composition, warm colors, realistic commercial quality, no text watermark.",
  },
  {
    id: "s4",
    refClipId: "c3",
    prompt:
      "Vertical 9:16 emotional hero shot: a cute cat near the storefront with soft evening light, slight slow motion feeling, gentle bokeh, heartwarming and trustworthy tone, highly realistic.",
  },
] as const;

const FINAL_SEGMENT_PLAN: Array<{
  sourceClipId: string;
  clipStartSec: number;
  clipDurationSec: number;
}> = [
  { sourceClipId: "s1", clipStartSec: 0, clipDurationSec: 10.0 },
  { sourceClipId: "s2", clipStartSec: 0, clipDurationSec: 10.0 },
  { sourceClipId: "s3", clipStartSec: 0, clipDurationSec: 10.0 },
  { sourceClipId: "c1", clipStartSec: 1.2, clipDurationSec: 10.0 },
  { sourceClipId: "s4", clipStartSec: 0, clipDurationSec: 10.0 },
  { sourceClipId: "c5", clipStartSec: 0.6, clipDurationSec: 10.0 },
];

const DEFAULT_TEXT_SEGMENTS = [
  {
    subtitle: "这家宠物店，真的很有爱。",
    voiceover: "一进门就能感受到，这里是真的把宠物当家人。",
  },
  {
    subtitle: "氛围舒服，毛孩子很放松。",
    voiceover: "环境干净又温暖，毛孩子在这里会特别放松。",
  },
  {
    subtitle: "商品和服务，一眼就看懂。",
    voiceover: "从日常用品到护理服务，客户想看的信息都能清楚呈现。",
  },
  {
    subtitle: "真实镜头，更容易建立信任。",
    voiceover: "比起夸张广告，真实画面更容易让新客户放心。",
  },
  {
    subtitle: "再加上AI镜头，质感直接拉满。",
    voiceover: "再用 Seedance 补上高级感镜头，整条视频会更有记忆点。",
  },
  {
    subtitle: "上传素材，就能快速出片。",
    voiceover: "门店只要提供素材，就能很快拿到可发布的中文宣传片。",
  },
] as const;

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(PUBLIC_SUB_DIR);
  ensureTools();
  ensureEnv();

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing-openai-api-key",
  });

  banner("Step 1/8: 素材元数据分析 + 抽帧");
  const metas = collectClipMeta();
  writeFileSync(ANALYSIS_LOCAL, JSON.stringify(metas, null, 2), "utf8");

  banner("Step 2/8: OpenAI 素材理解");
  const described = await describeClipsWithOpenAI(openai, metas);
  writeFileSync(ANALYSIS_LOCAL, JSON.stringify(described, null, 2), "utf8");

  banner("Step 3/8: Seedance 生成 4 段 AI 主镜头");
  const seedanceShots = await generateSeedanceShots(described);

  banner("Step 4/8: OpenAI 生成口语化中文分镜/字幕/旁白");
  const storyboard = await generateNaturalStoryboard(openai, described, seedanceShots);
  writeFileSync(STORYBOARD_LOCAL, JSON.stringify(storyboard, null, 2), "utf8");
  writeStoryboardMd(storyboard, described, seedanceShots);

  banner("Step 5/8: 拼接 60 秒 9:16 主视频轨");
  const sourceMap = new Map<string, string>(described.map((c) => [c.id, c.path]));
  seedanceShots.forEach((s) => sourceMap.set(s.id, s.localPath));
  const baseVideo = buildTimeline(storyboard, sourceMap);

  banner("Step 6/8: 旁白 + 字幕轨");
  await synthNarration(openai, storyboard.map((s) => s.voiceover).join(""), NARRATION_LOCAL);
  writeSrt(storyboard, SUBTITLE_SRT_LOCAL);
  writeVtt(storyboard, SUBTITLE_VTT_PUBLIC);

  banner("Step 7/8: 混音导出成片");
  muxFinalVideo(baseVideo, NARRATION_LOCAL, FINAL_VIDEO_LOCAL);
  captureThumb(FINAL_VIDEO_LOCAL, FINAL_THUMB_LOCAL);
  const duration = probeDuration(FINAL_VIDEO_LOCAL);
  console.log("final duration:", duration.toFixed(2), "sec");
  if (duration < 55 || duration > 65) {
    throw new Error(`成片时长超出范围: ${duration.toFixed(2)}s`);
  }

  banner("Step 8/8: 上传 Blob 并回写 demo seed");
  const videoBlob = await put(
    "demo-seed/pet_store_chinese_demo_video.mp4",
    readFileSync(FINAL_VIDEO_LOCAL),
    {
      access: "public",
      contentType: "video/mp4",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );
  const thumbBlob = await put(
    "demo-seed/pet_store_chinese_demo_video.jpg",
    readFileSync(FINAL_THUMB_LOCAL),
    {
      access: "public",
      contentType: "image/jpeg",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );

  writeDemoSeed({
    videoUrl: videoBlob.url,
    thumbUrl: thumbBlob.url,
    durationSec: Number(duration.toFixed(2)),
    storyboard,
    seedanceShots,
    clipMeta: described,
  });

  console.log("video blob:", videoBlob.url);
  console.log("thumb blob:", thumbBlob.url);
  console.log("subtitle vtt:", "/demo/pet-store/pet_store_subtitles.vtt");
  console.log("done.");
}

function ensureEnv() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN 未配置");
  }
  if (!process.env.ARK_API_KEY) {
    throw new Error("ARK_API_KEY 未配置，无法调用 Seedance");
  }
}

function collectClipMeta(): ClipMeta[] {
  return CLIPS.map((clip) => {
    if (!existsSync(clip.path)) {
      throw new Error(`素材不存在: ${clip.path}`);
    }
    const raw = sh(
      `ffprobe -v error -print_format json -show_streams -show_format "${clip.path}"`,
    );
    const data = JSON.parse(raw) as {
      streams: Array<{
        codec_type: string;
        width?: number;
        height?: number;
      }>;
      format: { duration?: string };
    };
    const v = data.streams.find((s) => s.codec_type === "video");
    const a = data.streams.find((s) => s.codec_type === "audio");
    if (!v?.width || !v.height || !data.format.duration) {
      throw new Error(`解析素材失败: ${clip.path}`);
    }
    const framePath = resolve(OUTPUT_DIR, `${clip.id}-frame.jpg`);
    const ss = Math.max(0.3, Number(data.format.duration) * 0.45);
    sh(`ffmpeg -y -ss ${ss.toFixed(2)} -i "${clip.path}" -frames:v 1 -q:v 2 "${framePath}"`);
    return {
      id: clip.id,
      path: clip.path,
      durationSec: Number(data.format.duration),
      width: v.width,
      height: v.height,
      hasAudio: Boolean(a),
      framePath,
    };
  });
}

async function describeClipsWithOpenAI(openai: OpenAI, clips: ClipMeta[]) {
  if (!process.env.OPENAI_API_KEY) {
    return clips.map((c) => ({ ...c, description: "真实宠物店素材镜头" }));
  }
  const out: ClipMeta[] = [];
  for (const clip of clips) {
    const b64 = readFileSync(clip.framePath).toString("base64");
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content: "你是中文分镜导演。请用中文概括画面内容，15-24字，真实、温暖。只返回JSON。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请输出 {"description":"..."}。素材ID=${clip.id}`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
    });
    const content = resp.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { description?: string };
    out.push({
      ...clip,
      description: sanitizeText(parsed.description || "真实宠物店素材镜头", 26),
    });
  }
  return out;
}

async function generateSeedanceShots(clips: ClipMeta[]): Promise<SeedanceShot[]> {
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const reuseMap = parseReuseSeedanceIds(process.env.REUSE_SEEDANCE_JOB_IDS);
  const shots: SeedanceShot[] = [];

  for (const plan of SEEDANCE_PLAN) {
    const ref = clipById.get(plan.refClipId);
    if (!ref) throw new Error(`Seedance 参考素材不存在: ${plan.refClipId}`);

    const refBlob = await put(
      `demo-seed/pet-seedance-ref-${plan.id}.jpg`,
      readFileSync(ref.framePath),
      {
        access: "public",
        contentType: "image/jpeg",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );

    const reusedJobId = reuseMap.get(plan.id);
    const submitted = reusedJobId
      ? { jobId: reusedJobId }
      : await submitSeedanceWithRetry({
          prompt: plan.prompt,
          duration: 10,
          ratio: "9:16",
          referenceImageUrls: [refBlob.url],
        });

    const done = await pollSeedanceDone(submitted.jobId);
    if (!done.videoUrl) {
      throw new Error(`Seedance 成功但无 video_url: ${plan.id}`);
    }

    const download = await fetch(done.videoUrl);
    if (!download.ok) {
      throw new Error(`下载 Seedance 视频失败: ${plan.id} status=${download.status}`);
    }
    const rawPath = resolve(OUTPUT_DIR, `${plan.id}-seedance-raw.mp4`);
    const localPath = resolve(OUTPUT_DIR, `${plan.id}-seedance-1080x1920.mp4`);
    writeFileSync(rawPath, Buffer.from(await download.arrayBuffer()));
    sh(
      `ffmpeg -y -ss 0 -t 10 -i "${rawPath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=0.03:saturation=1.08:contrast=1.03" -r 30 -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k "${localPath}"`,
    );

    shots.push({
      id: plan.id,
      prompt: plan.prompt,
      refClipId: plan.refClipId,
      refBlobUrl: refBlob.url,
      jobId: submitted.jobId,
      videoUrl: done.videoUrl,
      localPath,
    });
    console.log(`seedance ${plan.id} done:`, submitted.jobId);
  }

  return shots;
}

function parseReuseSeedanceIds(raw?: string) {
  const m = new Map<string, string>();
  if (!raw) return m;
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v) m.set(k, v);
  }
  return m;
}

async function pollSeedanceDone(jobId: string) {
  const timeout = 12 * 60 * 1000;
  const interval = 8000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await getSeedanceStatus(jobId);
    if (st.status === "completed") return st;
    if (st.status === "failed") {
      throw new Error(`Seedance 失败: ${st.errorMessage || "unknown"}`);
    }
    await sleep(interval);
  }
  throw new Error(`Seedance 轮询超时: ${jobId}`);
}

async function submitSeedanceWithRetry(options: {
  prompt: string;
  duration: number;
  ratio: string;
  referenceImageUrls: string[];
}) {
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await submitSeedanceJob(options);
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message || "";
      const retryable =
        /timeout|connect|fetch failed|ECONN|UND_ERR/i.test(msg) || i < maxAttempts;
      if (!retryable || i === maxAttempts) break;
      console.warn(`Seedance 提交失败，第 ${i} 次重试:`, msg);
      await sleep(2500 * i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Seedance 提交失败");
}

async function generateNaturalStoryboard(
  openai: OpenAI,
  clips: ClipMeta[],
  shots: SeedanceShot[],
): Promise<StorySegment[]> {
  let textSegments = [...DEFAULT_TEXT_SEGMENTS] as Array<{
    subtitle: string;
    voiceover: string;
  }>;

  if (process.env.OPENAI_API_KEY) {
    try {
      const clipMap = new Map(clips.map((c) => [c.id, c]));
      const shotSummary = shots.map((s) => ({
        id: s.id,
        ref: clipMap.get(s.refClipId)?.description || s.refClipId,
      }));
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.65,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content:
              "你是中文短视频导演。请写6段口语化文案，像店主在和潜在客户聊天，不要官话。请严格返回 JSON。",
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                style: "温暖、可爱、真实、有生活感",
                mustMention: "这条视频包含 Seedance 生成镜头",
                outputSchema: {
                  segments: "Array<{subtitle:string,voiceover:string}> (长度必须6)",
                },
                rules: {
                  subtitle: "每条不超过18字",
                  voiceover: "每条20-34字，口语化",
                },
                shotSummary,
              },
              null,
              2,
            ),
          },
        ],
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as {
        segments?: Array<{ subtitle?: string; voiceover?: string }>;
      };
      if (parsed.segments?.length === 6) {
        textSegments = parsed.segments.map((s, i) => ({
          subtitle: sanitizeText(s.subtitle || DEFAULT_TEXT_SEGMENTS[i].subtitle, 18),
          voiceover: sanitizeText(s.voiceover || DEFAULT_TEXT_SEGMENTS[i].voiceover, 36),
        }));
      }
    } catch (err) {
      console.warn("OpenAI 分镜文案失败，使用默认口语文案:", (err as Error).message);
    }
  }

  const segments: StorySegment[] = [];
  let cursor = 0;
  for (let i = 0; i < FINAL_SEGMENT_PLAN.length; i += 1) {
    const seg = FINAL_SEGMENT_PLAN[i];
    const text = textSegments[i] || DEFAULT_TEXT_SEGMENTS[i];
    const end = cursor + seg.clipDurationSec;
    segments.push({
      startSec: Number(cursor.toFixed(2)),
      endSec: Number(end.toFixed(2)),
      subtitle: text.subtitle,
      voiceover: text.voiceover,
      sourceClipId: seg.sourceClipId,
      clipStartSec: seg.clipStartSec,
      clipDurationSec: seg.clipDurationSec,
    });
    cursor = end;
  }
  return segments;
}

function buildTimeline(segments: StorySegment[], sourceMap: Map<string, string>) {
  const segDir = resolve(OUTPUT_DIR, "segments");
  ensureDir(segDir);
  const files: string[] = [];

  segments.forEach((seg, idx) => {
    const src = sourceMap.get(seg.sourceClipId);
    if (!src) {
      throw new Error(`找不到片段来源: ${seg.sourceClipId}`);
    }
    const out = resolve(segDir, `seg-${String(idx + 1).padStart(2, "0")}.mp4`);
    sh(
      `ffmpeg -y -ss ${seg.clipStartSec.toFixed(2)} -t ${seg.clipDurationSec.toFixed(
        2,
      )} -i "${src}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=0.03:saturation=1.06:contrast=1.03" -r 30 -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k "${out}"`,
    );
    files.push(out);
  });

  const list = resolve(segDir, "concat.txt");
  writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"), "utf8");
  const base = resolve(OUTPUT_DIR, "pet_store_base_concat.mp4");
  sh(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${base}"`);
  return base;
}

async function synthNarration(openai: OpenAI, text: string, outputPath: string) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const speech = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
      });
      writeFileSync(outputPath, Buffer.from(await speech.arrayBuffer()));
      return;
    } catch (err) {
      console.warn("OpenAI TTS 失败，fallback 到系统语音:", (err as Error).message);
    }
  }
  const txt = resolve(OUTPUT_DIR, "narration.txt");
  writeFileSync(txt, text, "utf8");
  const aiff = resolve(OUTPUT_DIR, "narration.aiff");
  sh(`say -v Ting-Ting -f "${txt}" -o "${aiff}"`);
  sh(`ffmpeg -y -i "${aiff}" -c:a libmp3lame -b:a 192k "${outputPath}"`);
}

function writeSrt(segments: StorySegment[], out: string) {
  const body = segments
    .map((s, i) => `${i + 1}\n${fmtSrt(s.startSec)} --> ${fmtSrt(s.endSec)}\n${s.subtitle}\n`)
    .join("\n");
  writeFileSync(out, body, "utf8");
}

function writeVtt(segments: StorySegment[], out: string) {
  ensureDir(dirname(out));
  const body =
    "WEBVTT\n\n" +
    segments
      .map((s) => `${fmtVtt(s.startSec)} --> ${fmtVtt(s.endSec)}\n${s.subtitle}`)
      .join("\n\n");
  writeFileSync(out, body, "utf8");
}

function muxFinalVideo(baseVideo: string, narration: string, output: string) {
  sh(
    `ffmpeg -y -i "${baseVideo}" -i "${narration}" -filter_complex "[0:a]volume=0.18[a0];[1:a]volume=1.05,acompressor=threshold=-16dB:ratio=3:attack=50:release=200[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${output}"`,
  );
}

function captureThumb(video: string, out: string) {
  sh(`ffmpeg -y -ss 00:00:04 -i "${video}" -frames:v 1 -q:v 2 "${out}"`);
}

function writeDemoSeed(args: {
  videoUrl: string;
  thumbUrl: string;
  durationSec: number;
  storyboard: StorySegment[];
  seedanceShots: SeedanceShot[];
  clipMeta: ClipMeta[];
}) {
  const seedanceSummary = args.seedanceShots.map((s) => `${s.id}:${s.jobId}`).join(", ");
  const seedPath = resolve(process.cwd(), "src/lib/data/demo-seed.ts");
  const content = `/**
 * Demo 种子数据：客户打开 /demo/ai-video 第一眼看到的真实样例。
 *
 * 由 scripts/build-pet-demo-seed.ts 自动生成；不要手动改动。
 *
 * 生成时间：${new Date().toISOString()}
 * 数据源：pet-store-real-assets + seedance + openai
 * Seedance jobs: ${seedanceSummary}
 */
import type {
  DemoVideoAnalysisInput,
  DemoVideoAnalysisResult,
} from "@/lib/services/demo-video-analysis-service";

export const DEMO_SEED_INPUT: DemoVideoAnalysisInput = {
  tiktokUrl: "https://example.com/pet-store-demo-reference",
  clientIndustry: "宠物店 / 宠物生活馆",
  clientOffer: "门店日常服务、宠物护理、商品零售与会员服务",
  targetAudience: "附近 3-5 公里养宠家庭与年轻白领用户",
  tone: "friendly",
};

export const DEMO_SEED_RESULT: DemoVideoAnalysisResult = {
  source: "llm-only",
  reference: {
    url: "https://example.com/pet-store-demo-reference",
    author: "pet_store_demo",
    caption: "真实宠物店素材 + Seedance AI 镜头，生成可发布中文宣传片。",
    hashtags: ["宠物店", "猫咪", "Seedance", "AI视频"],
    music: "ambient",
    durationSec: ${args.durationSec},
    metrics: {
      plays: 162000,
      likes: 12400,
      comments: 728,
      shares: 2430,
      engagementRate: 9.58,
    },
    coverUrl: ${JSON.stringify(args.thumbUrl)},
  },
  intelligence: {
    viralFormula: "真实门店镜头负责信任，Seedance AI 镜头负责高级质感，组合后更容易转化。",
    hook: "开场先给猫咪和店内氛围，再快速拉到AI质感镜头，3秒内建立兴趣。",
    retentionMechanics: [
      "真实镜头和 AI 镜头交替，节奏更有层次",
      "每屏一句短字幕，手机端一眼可读",
      "口语化旁白降低广告感，提升亲和度",
      "结尾 CTA 明确，便于客户理解产品价值",
    ],
    visualPattern: [
      "猫咪特写 + 门店环境",
      "商品/服务区信息镜头",
      "Seedance 生成的电影感补充镜头",
      "温暖色调与轻快节奏统一",
    ],
    audienceTriggers: [
      "宠物可爱瞬间带来的情绪连接",
      "真实门店画面带来的信任感",
      "AI 质感画面带来的专业感",
    ],
    commentSignals: [
      "看起来真实又高级",
      "门店靠谱，愿意到店体验",
      "这种视频很适合发社媒",
    ],
    riskNotes: [
      "AI 镜头占比不宜过高，避免失真感",
      "旁白避免官腔，保持口语化",
      "字幕继续控制短句，防止信息过载",
    ],
  },
  clientVersion: {
    positioning: "基于真实素材+Seedance生成镜头，快速输出适合中文社媒发布的宠物店宣传片。",
    title: "真实素材 + Seedance AI 镜头，一分钟生成宠物店宣传片",
    digitalHumanScript: ${JSON.stringify(args.storyboard.map((s) => s.voiceover).join(""))},
    scenePlan: [
      { time: "0-10s", visual: "Seedance猫咪氛围镜头", narration: "先抓情绪", overlay: "真实感开场" },
      { time: "10-20s", visual: "Seedance门店生活感镜头", narration: "建立空间信任", overlay: "温暖门店氛围" },
      { time: "20-30s", visual: "Seedance商品与服务镜头", narration: "传达可消费信息", overlay: "服务价值可视化" },
      { time: "30-40s", visual: "真实门店猫咪镜头", narration: "强化真实可信", overlay: "真实素材承接" },
      { time: "40-50s", visual: "Seedance高级质感镜头", narration: "提升整体质感", overlay: "AI镜头增强记忆" },
      { time: "50-60s", visual: "真实素材收尾", narration: "明确行动引导", overlay: "上传素材即可出片" },
    ],
    captions: ${JSON.stringify(args.storyboard.map((s) => s.subtitle), null, 2)},
    brollPrompts: ${JSON.stringify(args.seedanceShots.map((s) => s.prompt), null, 2)},
    cta: "上传真实素材，Aivora 帮你快速生成可发布宣传片。",
  },
  providerPlan: {
    digitalHuman: "heygen-ready",
    seedance: [
      "Seedance 4段 AI 主镜头已实拍融合",
      "可继续按行业扩展生成镜头模板",
    ],
    nextKeys: ["ARK_API_KEY", "OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN"],
  },
};

export const DEMO_SEED_VIDEO_URL = ${JSON.stringify(args.videoUrl)};
export const DEMO_SEED_VIDEO_THUMBNAIL = ${JSON.stringify(args.thumbUrl)};
export const DEMO_SEED_VIDEO_DURATION_SEC = ${args.durationSec};
export const DEMO_SEED_VIDEO_SUBTITLE_URL = "/demo/pet-store/pet_store_subtitles.vtt";
export const DEMO_SEED_BACKGROUND_VIDEO_URL = "";
export const DEMO_SEED_AVATAR_ID = "";
`;
  writeFileSync(seedPath, content, "utf8");
}

function writeStoryboardMd(storyboard: StorySegment[], clips: ClipMeta[], shots: SeedanceShot[]) {
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const lines = [
    "# 宠物店宣传视频 Storyboard（Seedance主导版）",
    "",
    ...storyboard.map((s, i) => {
      const src = shots.find((x) => x.id === s.sourceClipId)
        ? `Seedance ${s.sourceClipId}`
        : basename(clipById.get(s.sourceClipId)?.path || s.sourceClipId);
      return `- ${i + 1}. ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s | 来源：${src} | 字幕：${s.subtitle} | 旁白：${s.voiceover}`;
    }),
    "",
    "## Seedance 生成任务",
    ...shots.map((s) => `- ${s.id} | job=${s.jobId} | ref=${s.refClipId}`),
    "",
    "## 素材分析摘要",
    ...clips
      .filter((c) => c.id !== "ref")
      .map((c) => `- ${basename(c.path)}：${c.description || "真实门店素材"}`),
  ];
  writeFileSync(STORYBOARD_MD_LOCAL, lines.join("\n"), "utf8");
}

function sanitizeText(text: string, maxLen: number) {
  const cleaned = (text || "").replace(/\s+/g, "").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxLen - 1))}…`;
}

function fmtSrt(sec: number) {
  const s = Math.max(0, sec);
  const hh = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(s % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((s - Math.floor(s)) * 1000)
    .toString()
    .padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

function fmtVtt(sec: number) {
  return fmtSrt(sec).replace(",", ".");
}

function probeDuration(path: string): number {
  const out = sh(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${path}"`,
  );
  return Number(out.trim() || "0");
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function ensureTools() {
  sh("ffmpeg -version > /dev/null");
  sh("ffprobe -version > /dev/null");
}

function sh(command: string): string {
  return execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("[build-pet-demo-seed] failed:", err);
  process.exit(1);
});
