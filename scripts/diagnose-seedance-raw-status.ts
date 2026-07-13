/**
 * 只读诊断：直接向 Seedance 查询指定 externalJobId 的原始任务状态。
 * 仅 GET 状态查询，零计费、无写操作。
 * 用法: npx tsx scripts/diagnose-seedance-raw-status.ts <jobId1> <jobId2> ...
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.log("用法: npx tsx scripts/diagnose-seedance-raw-status.ts <externalJobId...>");
    return;
  }
  const apiKey = process.env.BYTEPLUS_ARK_API_KEY;
  if (!apiKey) {
    console.log("BYTEPLUS_ARK_API_KEY 未配置，无法查询（生产为 mock 模式？）");
    return;
  }
  const baseUrl =
    process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3";

  for (const id of ids) {
    const res = await fetch(`${baseUrl}/contents/generations/tasks/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    console.log("=".repeat(80));
    console.log(`jobId=${id} http=${res.status}`);
    try {
      const data = JSON.parse(text);
      // 只打印诊断需要的字段，避免超长 base64 / URL 刷屏
      console.log(
        JSON.stringify(
          {
            id: data.id,
            status: data.status,
            error: data.error ?? null,
            created_at: data.created_at,
            updated_at: data.updated_at,
            model: data.model,
            usage: data.usage ?? null,
            has_video_url: !!(data.content?.video_url || data.video_url),
          },
          null,
          2,
        ),
      );
    } catch {
      console.log(text.slice(0, 500));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
