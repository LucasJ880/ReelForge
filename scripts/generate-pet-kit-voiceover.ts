/**
 * 为 Aivora 宠物套件 60s 讲解视频生成中文配音旁白（OpenAI TTS）。
 *
 * 每段一条旁白，落到 tmp/pet-kit-walkthrough-video/voiceover/vo-{i}.mp3，
 * 供 stitch 阶段与 BGM 混音（旁白为主、BGM 压低垫底）。
 *
 * 用法：
 *   npm run demo:vo:petkit
 *   PETKIT_TTS_VOICE=shimmer npm run demo:vo:petkit
 *
 * 需要 OPENAI_API_KEY。
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

loadEnvConfig(process.cwd());

const OUTPUT_DIR = resolve(
  process.cwd(),
  "tmp/pet-kit-walkthrough-video/voiceover",
);

/** 4 段旁白，对齐 4 个分镜（每段约 15s，旁白控制在 ~12s 内）。 */
const NARRATION: ReadonlyArray<{ index: number; text: string }> = [
  {
    index: 1,
    text: "你的宠物每天都有无数可爱瞬间，却大多被错过。Aivora 用智能硬件，自动记录下这些真实的瞬间。",
  },
  {
    index: 2,
    text: "AI 会自动识别最可爱、最有传播力的画面，从一整天的素材里挑出最值得分享的片段。",
  },
  {
    index: 3,
    text: "再一键生成可直接发布的短视频和宠物日记，每天都有新内容，全程无需剪辑。",
  },
  {
    index: 4,
    text: "主人乐于分享，带来近乎零成本的增长；真实的使用画面，也成为宠物品牌最可信的营销证据。这，就是 Aivora。",
  },
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法生成配音。");
  }
  ensureTools();
  ensureDir(OUTPUT_DIR);

  const model = process.env.PETKIT_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.PETKIT_TTS_VOICE || "nova";
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  banner(`生成中文配音旁白（model=${model} voice=${voice}）`);

  for (const line of NARRATION) {
    const out = resolve(OUTPUT_DIR, `vo-${line.index}.mp3`);
    // instructions 仅新模型支持；用宽松类型传入，旧模型会被忽略/报错则回退。
    const params: Record<string, unknown> = {
      model,
      voice,
      input: line.text,
      response_format: "mp3",
      instructions:
        "用温暖、亲切、自信的中文讲解口吻，节奏舒缓清晰，像在向投资人介绍一款打动人心的宠物产品。",
    };

    let buffer: Buffer;
    try {
      const response = await openai.audio.speech.create(
        params as unknown as Parameters<typeof openai.audio.speech.create>[0],
      );
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      // 回退：去掉 instructions，用稳定的 tts-1-hd 再试一次。
      console.warn(
        `段 ${line.index} 首选模型失败（${(err as Error).message}），回退 tts-1-hd。`,
      );
      const response = await openai.audio.speech.create({
        model: "tts-1-hd",
        voice: voice as "nova",
        input: line.text,
        response_format: "mp3",
      });
      buffer = Buffer.from(await response.arrayBuffer());
    }

    writeFileSync(out, buffer);
    const dur = probeDurationSec(out);
    console.log(`vo-${line.index}.mp3  时长≈${dur.toFixed(1)}s  ${out}`);
  }

  banner("配音生成完成");
  console.log("下一步：npm run demo:stitch:petkit（会自动混入旁白 + 压低 BGM）");
}

function probeDurationSec(input: string) {
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
  console.error("\n配音生成失败：");
  console.error((err as Error).message);
  process.exit(1);
});
