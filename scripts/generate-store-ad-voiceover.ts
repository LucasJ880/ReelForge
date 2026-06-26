/**
 * 数字人探店广告 · 中文口播旁白生成
 * ==================================================================
 *
 * 读取 storyboard.json（分镜 + 字幕 + 时长），用 gpt-5.5 写出「真人探店感」的
 * 中文口播旁白（口语化、有网感、不僵硬），再用火山「大模型语音合成」（豆包语音）
 * 逐段合成 mp3，供 stitch 阶段做「旁白为主 + BGM 压低」的混音。
 *
 * 产物：
 *   tmp/digital-human-store-ad/voiceover/vo-{shotId}.mp3
 *   tmp/digital-human-store-ad/narration.json
 *
 * 需要：OPENAI_API_KEY（写旁白）+ 火山语音合成凭证（VOLC_TTS_APPID / VOLC_TTS_ACCESS_TOKEN）。
 *
 * 用法：
 *   npm run demo:store-ad:vo
 *   VOLC_TTS_VOICE_TYPE=zh_female_xxx_bigtts npm run demo:store-ad:vo   # 换音色
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

import { synthesizeSpeech, isVolcTtsConfigured } from "../src/lib/providers/volc-tts";

const ROOT = resolve(process.cwd(), "tmp/digital-human-store-ad");
const STORYBOARD_PATH = resolve(ROOT, "storyboard.json");
const VO_DIR = resolve(ROOT, "voiceover");
const NARRATION_PATH = resolve(ROOT, "narration.json");

/// 与主脚本 BRIEF 保持一致（旁白上下文）。
const BRIEF = {
  industry: "宠物店 / 猫咪主题店",
  storeDescription:
    "一家浅蓝白粉色系、很治愈的猫咪主题宠物店：透明玻璃猫舍寄养区 + 木质猫爬架、白色木框收银台 + 招财猫、可爱产品货架、靠窗休息区与落地玻璃门。",
  brandName: "Aivora",
};

interface StoryboardShot {
  id: string;
  durationSec: number;
  caption: string;
  sceneType: "model_store" | "product_cutaway";
}
interface StoryboardFile {
  shots: StoryboardShot[];
}
interface NarrationLine {
  id: string;
  text: string;
}

async function main() {
  banner("数字人探店广告 · 中文口播旁白（gpt-5.5 文案 + 火山大模型 TTS）");

  if (!existsSync(STORYBOARD_PATH)) {
    throw new Error(`找不到 ${STORYBOARD_PATH}，请先跑 npm run demo:store-ad:keyframes`);
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法生成旁白文案。");
  }
  if (!isVolcTtsConfigured()) {
    throw new Error(
      "缺少火山语音合成凭证：请在 .env.local 配置 VOLC_TTS_APPID 与 VOLC_TTS_ACCESS_TOKEN（详见 .env.example）。",
    );
  }
  ensureTools();
  ensureDir(VO_DIR);

  const storyboard = JSON.parse(
    readFileSync(STORYBOARD_PATH, "utf8"),
  ) as StoryboardFile;
  const shots = storyboard.shots;

  const lines = await writeNarration(shots);

  const voiceType = process.env.VOLC_TTS_VOICE_TYPE || "(默认音色)";
  banner(`火山大模型 TTS 合成（voice=${voiceType}）`);
  const results: Array<NarrationLine & { mp3: string; durationSec: number }> = [];
  for (const line of lines) {
    const out = resolve(VO_DIR, `vo-${line.id}.mp3`);
    const audio = await synthesizeSpeech({
      text: line.text,
      encoding: "mp3",
      uid: "aivora-store-ad",
      /// V1（1.0 音色）语速倍率：探店口播略快、更有网感
      speedRatio: Number(process.env.VOLC_TTS_SPEED || 1.08),
      /// V3（2.0 音色）语速 [-50,100]：略快一点
      speechRate: Number(process.env.VOLC_TTS_SPEECH_RATE || 12),
      /// V3 2.0 表现力提示：真人探店、轻松热情、不浮夸
      contextTexts: [
        "用轻松自然、像在跟好朋友分享的探店语气说，热情但不浮夸，有亲和力。",
      ],
    });
    writeFileSync(out, audio);
    const dur = probeDurationSec(out);
    console.log(`vo-${line.id}.mp3  ≈${dur.toFixed(1)}s  「${line.text}」`);
    results.push({ ...line, mp3: out, durationSec: dur });
  }

  writeFileSync(
    NARRATION_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), lines: results }, null, 2),
    "utf8",
  );
  banner("口播旁白生成完成");
  console.log(`narration.json 已写入：${NARRATION_PATH}`);
  console.log("下一步：npm run demo:store-ad:stitch（会自动混入旁白并压低 BGM）");
}

/**
 * 用 gpt-5.5（director tier）为每个分镜写「真人探店感」中文旁白。
 * 动态导入 openai 模块：因为它在加载时实例化 OpenAI 单例（读 KEY），
 * 必须在 loadEnvConfig 之后再加载，否则会拿到占位 key。
 */
async function writeNarration(shots: StoryboardShot[]): Promise<NarrationLine[]> {
  const { chatJsonByTier } = await import("../src/lib/providers/openai");

  const shotBrief = shots
    .map(
      (s, i) =>
        `${i + 1}. id=${s.id}（${s.durationSec}s，${
          s.sceneType === "product_cutaway" ? "猫咪空镜" : "模特在店内"
        }）参考字幕：「${s.caption}」`,
    )
    .join("\n");

  const system = [
    "你是一位很会拍探店短视频的中文博主，专门给宠物店写口播旁白。",
    "你的旁白要有「真实的人在说话」的感觉：口语、自然、亲切、有网感，",
    "像真的在店里边逛边和粉丝聊天，绝不能是僵硬的广告腔或书面语。",
    "可以用语气词（比如「真的」「也太」「绝了」「来」），但不要浮夸做作。",
    "不要出现英文、不要念标点、不要写括号说明。",
  ].join("\n");

  const user = [
    `门店信息：${BRIEF.industry}。${BRIEF.storeDescription}`,
    `品牌：${BRIEF.brandName}。`,
    "",
    "请为下面每个分镜各写一句中文口播旁白，整体连起来是一条完整的探店视频解说，",
    "有开场吸引、逐个介绍亮点、结尾引导（地址/关注）的节奏。",
    "每句长度要贴合该镜头时长：约每秒 4~5 个汉字，宁可短一点也不要超时、念不完。",
    "（例：5 秒镜头 ≈ 18~24 字；4 秒镜头 ≈ 14~18 字。）",
    "",
    "分镜列表：",
    shotBrief,
    "",
    '只输出 JSON：{"lines":[{"id":"镜头id","text":"该镜头的中文旁白"}, ...]}，',
    "顺序和数量必须与分镜列表完全一致。",
  ].join("\n");

  try {
    const res = await chatJsonByTier<{ lines: NarrationLine[] }>({
      tier: "director",
      stage: "digital_human_store_ad_voiceover",
      system,
      user,
      temperature: 0.8,
      maxTokens: 3000,
    });
    const lines = res.data?.lines;
    if (Array.isArray(lines) && lines.length === shots.length) {
      /// 以分镜顺序为准，按 id 对齐，缺失则回退字幕。
      return shots.map((s) => {
        const hit = lines.find((l) => l.id === s.id);
        return { id: s.id, text: (hit?.text || s.caption).trim() };
      });
    }
    console.warn("gpt-5.5 旁白结构不符，回退用字幕作为旁白。");
  } catch (err) {
    console.warn(
      `gpt-5.5 旁白生成失败（${(err as Error).message}），回退用字幕作为旁白。`,
    );
  }
  return shots.map((s) => ({ id: s.id, text: s.caption }));
}

function probeDurationSec(input: string): number {
  try {
    const out = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nokey=1:noprint_wrappers=1",
      input,
    ]).toString("utf8");
    const parsed = Number(out.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function ensureTools() {
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
}
function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}
function banner(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

main().catch((err) => {
  console.error("\n口播旁白生成失败：");
  console.error((err as Error).message);
  process.exit(1);
});
