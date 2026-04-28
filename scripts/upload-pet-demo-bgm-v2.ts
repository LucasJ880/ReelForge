/**
 * 一次性脚本：把替换了背景音乐的 pet_store_chinese_demo_30s_no_text_bgm_v2.mp4
 * 上传到 Vercel Blob，并打印新 URL。
 *
 * 使用方法：
 *   npx tsx scripts/upload-pet-demo-bgm-v2.ts
 *
 * 上传完成后请把日志里的 URL 写入 src/lib/data/demo-seed.ts 的 DEMO_SEED_VIDEO_URL。
 */
import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

async function main() {
  const localPath = resolve(
    process.cwd(),
    "tmp/pet-demo-no-text/pet_store_chinese_demo_30s_no_text_bgm_v2.mp4",
  );
  const blobKey = "demo-seed/pet_store_chinese_demo_30s_no_text_bgm_v2.mp4";

  const size = statSync(localPath).size;
  console.log(`uploading ${localPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN 未配置");
  }

  const result = await put(blobKey, readFileSync(localPath), {
    access: "public",
    contentType: "video/mp4",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  console.log("blob url:", result.url);

  const head = await fetch(result.url, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  console.log(`HEAD status=${head.status}`);
  console.log(`Content-Type=${head.headers.get("content-type")}`);
  console.log(`Content-Length=${head.headers.get("content-length")}`);
}

main().catch((err) => {
  console.error("[upload-pet-demo-bgm-v2] failed:", err);
  process.exit(1);
});
