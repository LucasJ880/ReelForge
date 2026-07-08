/**
 * 保全已付费资产：把卡住任务的分镜段（Seedance 签名 URL，24h 过期）下载到本地
 * tmp/recovery/，防止签名过期后资产丢失。只读 DB + 下载，不产生任何生成费用。
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());
const db = new PrismaClient();

const JOB_ID = process.argv[2] ?? "cmrcbuam4000ul404ns0ryqo3";
const OUT_DIR = process.argv[3] ?? "tmp/recovery/cmrcbuald000sl404w9j4cvd0";

async function main() {
  const seg = await db.videoJob.findUnique({ where: { id: JOB_ID } });
  if (!seg?.outputVideoUrl) throw new Error("segment 无 outputVideoUrl");
  const res = await fetch(seg.outputVideoUrl);
  console.log(
    "GET status:",
    res.status,
    res.headers.get("content-type"),
    res.headers.get("content-length"),
  );
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, `seg-${seg.segmentIndex ?? 0}.mp4`);
  await writeFile(dest, buf);
  console.log("saved:", dest, "bytes:", buf.length);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
