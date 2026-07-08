/**
 * 把恢复时使用的本地保全段文件上传到持久存储，并把 VideoJob.outputVideoUrl
 * 从 file:// 本地路径改成持久 URL。免费步骤（存储上传 + DB 更新），不重新生成。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const JOB_ID = process.argv[2] ?? "cmrcbuam4000ul404ns0ryqo3";

async function main() {
  const { db } = await import("../src/lib/db");
  const { getStorageProvider } = await import("../src/lib/storage");

  const job = await db.videoJob.findUnique({ where: { id: JOB_ID } });
  if (!job?.outputVideoUrl) throw new Error("job 无 outputVideoUrl");
  if (!job.outputVideoUrl.startsWith("file://")) {
    console.log(`outputVideoUrl 不是 file://，无需处理: ${job.outputVideoUrl.slice(0, 80)}`);
    return;
  }

  const localPath = fileURLToPath(job.outputVideoUrl);
  const buf = await readFile(localPath);
  const storage = getStorageProvider();
  if (!storage.isConfigured()) throw new Error("storage provider 未配置");
  const obj = await storage.uploadBuffer("renders", buf, {
    key: `video-jobs/${job.id}/segment-${job.segmentIndex ?? 0}.mp4`,
    access: "public",
    contentType: "video/mp4",
    overwrite: true,
  });
  await db.videoJob.update({
    where: { id: job.id },
    data: { outputVideoUrl: obj.url },
  });
  console.log(`段已转存持久存储并回写: ${obj.url}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
