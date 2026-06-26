/**
 * 数字人探店广告 · 本地演示脚本（薄包装）
 * ==================================================================
 *
 * 复用产品化管线 src/lib/video-generation/digital-human/store-ad-pipeline.ts，
 * 用「预置虚拟人 asset:// + 本地门店实景图 + 宠物店 brief」生成一条竖版探店广告，
 * 输出到 public/generated/aivora-digital-human-pet-store-30s-9x16.mp4。
 *
 * 与生产 runner 走的是同一条管线，仅输入来源不同（本地图片 → 先传 Blob → URL）。
 *
 * 需要：ARK_API_KEY / OPENAI_API_KEY / 火山 TTS 凭证 / BLOB_READ_WRITE_TOKEN。
 * 用法：npm run demo:store-ad
 */
import { loadEnvConfig } from "@next/env";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

const STORE_ASSET_DIR = resolve(process.cwd(), "public/demo/pet-store");
const PUBLIC_OUTPUT = resolve(
  process.cwd(),
  "public/generated/aivora-digital-human-pet-store-30s-9x16.mp4",
);
const STORE_REFS_CACHE = resolve(
  process.cwd(),
  "tmp/digital-human-store-ad/store-refs.json",
);

const STORE_IMAGES = ["store-3.png", "store-1.png", "store-2.png"];

const BRIEF = {
  industry: "宠物店 / 猫咪主题店",
  storeDescription:
    "一家浅蓝白粉色系、很治愈的猫咪主题宠物店：透明玻璃猫舍寄养区 + 木质猫爬架、白色木框收银台 + 招财猫、可爱产品货架、靠窗休息区与落地玻璃门。",
  sellingPoints: ["透明玻璃猫舍可随时看主子", "店主精挑好物闭眼入", "会员洗护寄养打折"],
  cta: "地址放评论区，周末冲～",
  brandName: "Aivora",
};

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_PROVIDER) {
    throw new Error("需要 BLOB_READ_WRITE_TOKEN（或配置 STORAGE_PROVIDER）来上传门店图。");
  }

  const storeImageUrls = await ensureStoreImageUrls();

  const { runDigitalHumanAdPipeline } = await import(
    "../src/lib/video-generation/digital-human/store-ad-pipeline"
  );
  const { AVATARS } = await import(
    "../src/lib/video-generation/digital-human/avatar-catalog"
  );
  const { getVoiceById, DEFAULT_VOICE_ID } = await import(
    "../src/lib/video-generation/digital-human/voice-catalog"
  );

  const avatar = AVATARS[0];
  const voice = getVoiceById(DEFAULT_VOICE_ID)!;

  const result = await runDigitalHumanAdPipeline(
    {
      jobId: "demo-pet-store",
      avatarAssetUri: avatar.assetUri,
      voiceType: voice.voiceType,
      storeImageUrls,
      industry: BRIEF.industry,
      storeDescription: BRIEF.storeDescription,
      sellingPoints: BRIEF.sellingPoints,
      cta: BRIEF.cta,
      brandName: BRIEF.brandName,
      durationSec: 28,
      aspectRatio: "9:16",
    },
    {
      // 复用既有工作目录：含上次的中文配音 mp3（vo-*.mp3）与门店图缓存，
      // 因此无需火山 TTS 凭证即可保留原配音，仅重跑 Seedance 出「开口型」新片段。
      workDir: resolve(process.cwd(), "tmp/digital-human-store-ad"),
      logger: (m) => console.log(m),
    },
  );

  ensureDir(resolve(process.cwd(), "public/generated"));
  copyFileSync(result.finalVideoPath, PUBLIC_OUTPUT);
  console.log(`\n成片 ≈ ${result.durationSec.toFixed(1)}s`);
  console.log("finalLocalPath =", PUBLIC_OUTPUT);
  console.log("publicUrl =", "/generated/aivora-digital-human-pet-store-30s-9x16.mp4");
}

/** 上传本地门店图到 Blob 得到公网 URL（缓存到 store-refs.json，重跑不重复上传）。 */
async function ensureStoreImageUrls(): Promise<string[]> {
  const cached = readJsonIfExists<{ urls: string[] }>(STORE_REFS_CACHE);
  if (cached?.urls?.length === STORE_IMAGES.length) return cached.urls;

  const { getStorageProvider } = await import("../src/lib/storage");
  const storage = getStorageProvider();
  const urls: string[] = [];
  for (const name of STORE_IMAGES) {
    const path = resolve(STORE_ASSET_DIR, name);
    if (!existsSync(path)) throw new Error(`门店图不存在：${path}`);
    const { url } = await storage.uploadBuffer("renders", readFileSync(path), {
      key: `digital-human-store-ad/demo/${name.replace(".png", "")}-${Date.now()}.png`,
      contentType: "image/png",
      access: "public",
    });
    urls.push(url);
    console.log(`· 门店图 ${name} → ${url}`);
  }
  ensureDir(resolve(process.cwd(), "tmp/digital-human-store-ad"));
  writeFileSync(STORE_REFS_CACHE, JSON.stringify({ urls }, null, 2), "utf8");
  return urls;
}

function readJsonIfExists<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

main().catch((err) => {
  console.error("\n生成失败：", (err as Error).message);
  process.exit(1);
});
